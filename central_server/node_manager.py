import asyncio
import time
import json
import urllib.request
import urllib.error
from typing import Dict, List, Any, Optional, Set
from database import FleetDatabase

class NodeManager:
    """Manages active nodes, command queues, and real-time event broadcasting."""

    def __init__(self, db: FleetDatabase, config: Dict[str, Any]):
        self.db = db
        self.config = config
        self.command_queues: Dict[str, List[Dict[str, Any]]] = {}
        self.sse_subscribers: Set[asyncio.Queue] = set()
        self.server_start_epoch = time.time()
        self.packets_received = 0
        self.online_nodes_cache: Dict[str, float] = {}  # nodeId -> last_seen_epoch

    async def broadcast_sse(self, event_type: str, data: Any):
        """Broadcasts real-time events to all connected browser SSE streams."""
        message = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        dead_queues = set()
        for q in self.sse_subscribers:
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                dead_queues.add(q)
            except Exception:
                dead_queues.add(q)
        self.sse_subscribers.difference_update(dead_queues)

    def subscribe_sse(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=100)
        self.sse_subscribers.add(q)
        return q

    def unsubscribe_sse(self, q: asyncio.Queue):
        self.sse_subscribers.discard(q)

    async def process_telemetry(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Processes incoming telemetry packet from an ESP8266 node."""
        self.packets_received += 1
        node_id = data.get("nodeId")
        if not node_id:
            return []

        # Validate token if configured
        required_token = self.config.get("auth_token", "").strip()
        if required_token:
            incoming_token = data.get("token") or data.get("authToken")
            if incoming_token != required_token:
                self.db.log_audit("AUTH_FAIL", node_id, "Rejected telemetry packet due to invalid auth token")
                return []

        now = time.time()
        was_online = (node_id in self.online_nodes_cache) and (now - self.online_nodes_cache[node_id] < self.config.get("offline_timeout_sec", 30))
        self.online_nodes_cache[node_id] = now

        # Upsert into database
        self.db.upsert_node(data)
        event_type = data.get("eventType", "heartbeat")
        self.db.log_telemetry(node_id, event_type, data)

        if not was_online:
            node_name = data.get("nodeName", node_id)
            self.db.log_audit("NODE_ONLINE", node_id, f"Node '{node_name}' ({data.get('ip')}) connected to fleet")
            await self.broadcast_sse("node_status", {"nodeId": node_id, "isOnline": True})

        # Broadcast live telemetry update to UI
        await self.broadcast_sse("telemetry", {
            "nodeId": node_id,
            "nodeName": data.get("nodeName"),
            "ip": data.get("ip"),
            "rssi": data.get("rssi"),
            "uptimeSec": data.get("uptimeSec"),
            "freeHeap": data.get("freeHeap"),
            "channels": data.get("channels", []),
            "eventType": event_type,
            "timestamp": data.get("timestamp")
        })

        # Check pending command queue for this node
        pending_commands = self.command_queues.pop(node_id, [])
        return pending_commands

    async def send_or_queue_command(self, node_id: str, command: Dict[str, Any]) -> Dict[str, Any]:
        """
        Attempts direct LAN HTTP dispatch to the ESP8266 for instant response.
        If LAN HTTP is unreachable or fails, queues the command for the next TCP sync.
        """
        node = self.db.get_node(node_id)
        if not node:
            return {"success": False, "error": f"Node '{node_id}' not found in fleet"}

        ip = node.get("ip")
        action = command.get("action", "")
        channel_id = command.get("id") or command.get("gpioId")

        # Log audit
        self.db.log_audit("COMMAND_SENT", node_id, f"Dispatched command '{action}' for channel {channel_id}")

        direct_success = False
        direct_error = ""

        # Attempt direct HTTP dispatch if node has valid IP
        if ip and ip.strip():
            direct_success, direct_error = await self._dispatch_lan_http(ip, command)

        if direct_success:
            # Optimistically update database state
            new_state = False
            if action == "setState":
                new_state = bool(command.get("state", False))
                self.db.update_channel_state(node_id, int(channel_id), new_state)
            elif action == "toggle":
                node = self.db.get_node(node_id) or {}
                curr = False
                for ch in node.get("channels", []):
                    if (ch.get("id") or ch.get("channel_id")) == int(channel_id):
                        curr = bool(ch.get("state", False))
                        break
                new_state = not curr
                self.db.update_channel_state(node_id, int(channel_id), new_state)

            await self.broadcast_sse("command_executed", {
                "node_id": node_id,
                "nodeId": node_id,
                "channel_id": int(channel_id),
                "channelId": int(channel_id),
                "new_state": new_state,
                "command": command,
                "delivery": "direct_lan_http"
            })
            return {"success": True, "delivery": "direct_lan_http", "message": "Command executed instantly via LAN"}

        # Fallback: Queue command for next TCP heartbeat or state sync
        if node_id not in self.command_queues:
            self.command_queues[node_id] = []
        self.command_queues[node_id].append(command)

        return {
            "success": True,
            "delivery": "queued",
            "message": f"Command queued for next node check-in (Direct LAN HTTP: {direct_error or 'skipped'})"
        }

    async def _dispatch_lan_http(self, ip: str, command: Dict[str, Any]) -> (bool, str):
        """Asynchronously dispatches command to ESP8266 REST API on LAN."""
        def _sync_http_call():
            try:
                url = f"http://{ip}/api/gpio/state"
                payload = json.dumps(command).encode("utf-8")
                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=self.config.get("direct_http_timeout_sec", 1.8)) as resp:
                    if resp.status == 200:
                        return True, "OK"
                    return False, f"HTTP {resp.status}"
            except Exception as e:
                return False, str(e)

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _sync_http_call)

    async def broadcast_command(self, command: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatches command to all registered nodes in the fleet."""
        nodes = self.db.get_nodes()
        results = {}
        for n in nodes:
            nid = n.get("node_id")
            results[nid] = await self.send_or_queue_command(nid, command)
        return {"total_nodes": len(nodes), "results": results}

    async def check_offline_nodes_loop(self):
        """Background task checking for nodes that stopped sending heartbeats."""
        timeout_sec = self.config.get("offline_timeout_sec", 30)
        while True:
            try:
                await asyncio.sleep(4.0)
                now = time.time()
                nodes = self.db.get_nodes()
                for node in nodes:
                    nid = node.get("node_id")
                    last_seen = node.get("last_seen_epoch", 0)
                    is_currently_marked_online = bool(node.get("is_online", 0))

                    if (now - last_seen > timeout_sec) and is_currently_marked_online:
                        self.db.set_node_online(nid, False)
                        self.online_nodes_cache.pop(nid, None)
                        self.db.log_audit("NODE_OFFLINE", nid, f"Node '{node.get('node_name', nid)}' missed heartbeats and is now OFFLINE")
                        await self.broadcast_sse("node_status", {"nodeId": nid, "isOnline": False})
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[NodeManager] Offline check error: {e}")

    def get_fleet_stats(self) -> Dict[str, Any]:
        nodes = self.db.get_nodes()
        total_nodes = len(nodes)
        online_nodes = sum(1 for n in nodes if n.get("is_online"))
        
        total_channels = 0
        active_channels = 0
        for n in nodes:
            for ch in n.get("channels", []):
                total_channels += 1
                if ch.get("state"):
                    active_channels += 1

        uptime_sec = int(time.time() - self.server_start_epoch)
        return {
            "totalNodes": total_nodes,
            "onlineNodes": online_nodes,
            "offlineNodes": total_nodes - online_nodes,
            "totalChannels": total_channels,
            "activeChannels": active_channels,
            "packetsReceived": self.packets_received,
            "serverUptimeSec": uptime_sec
        }
