import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Dict, List, Any, Optional
import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session_factory
from app.models.node import Node, NodeHeartbeat
from app.models.relay import Relay, RelayEvent
from app.models.telemetry import TelemetryRecord
from app.models.system import SystemEvent
from app.services.websocket_manager import ws_manager

logger = logging.getLogger("DeviceService")

class DeviceService:
    """
    Common Unified Device Management Layer.
    Provides protocol-agnostic node ingestion, relay dispatch, and state reconciliation.
    """
    
    def __init__(self):
        self.pending_command_queues: Dict[str, List[Dict[str, Any]]] = {} # node_id -> [command_dict]
        self.active_node_last_seen: Dict[str, float] = {}

    async def handle_telemetry(self, payload: Dict[str, Any], protocol: str = "TCP") -> List[Dict[str, Any]]:
        """
        Processes incoming telemetry from any protocol (TCP, MQTT, HTTP).
        Updates node metadata, relay physical states, logs telemetry, triggers automations,
        and returns any pending commands for the node.
        """
        node_id = payload.get("nodeId")
        if not node_id:
            logger.warning(f"Rejected telemetry missing nodeId from protocol {protocol}")
            return []

        now_epoch = time.time()
        self.active_node_last_seen[node_id] = now_epoch
        event_type = payload.get("eventType", "heartbeat")

        async with async_session_factory() as session:
            try:
                # 1. Upsert Node Record
                stmt = select(Node).where(Node.node_id == node_id)
                res = await session.execute(stmt)
                node = res.scalars().first()

                node_name = payload.get("nodeName") or node_id
                ip_addr = payload.get("ip") or (node.ip_address if node else "")
                mac_addr = payload.get("mac") or (node.mac_address if node else "")
                fw_version = payload.get("firmwareVersion") or (node.firmware_version if node else "1.6.0")
                rssi = payload.get("rssi", 0)
                uptime = payload.get("uptimeSec", 0)
                heap = payload.get("freeHeap", 0)

                was_online = node.is_online if node else False

                if not node:
                    node = Node(
                        node_id=node_id,
                        name=node_name,
                        hardware_type="ESP8266" if "NodeMCU" in fw_version or "ESP8266" in payload.get("hardware", "") else "ESP8266",
                        firmware_version=fw_version,
                        ip_address=ip_addr,
                        mac_address=mac_addr,
                        gateway=payload.get("gateway", ""),
                        rssi=rssi,
                        uptime_sec=uptime,
                        free_heap=heap,
                        is_online=True,
                        status="Online",
                        last_seen_at=datetime.utcnow()
                    )
                    session.add(node)
                    await session.flush()
                    logger.info(f"Registered new node: {node_id} ({node_name}) via {protocol}")
                else:
                    node.name = node_name
                    node.ip_address = ip_addr
                    if mac_addr: node.mac_address = mac_addr
                    node.firmware_version = fw_version
                    node.rssi = rssi
                    node.uptime_sec = uptime
                    node.free_heap = heap
                    node.is_online = True
                    node.status = "Online"
                    node.last_seen_at = datetime.utcnow()

                # If transition from Offline -> Online
                if not was_online:
                    sys_ev = SystemEvent(
                        node_id=node_id,
                        category=protocol,
                        severity="INFO",
                        description=f"Node '{node_name}' ({ip_addr}) came ONLINE via {protocol}",
                        execution_result="SUCCESS"
                    )
                    session.add(sys_ev)
                    await ws_manager.broadcast("node_status", {"node_id": node_id, "is_online": True, "status": "Online"})

                # 2. Record Heartbeat
                hb = NodeHeartbeat(
                    node_id=node_id,
                    timestamp=datetime.utcnow(),
                    epoch=now_epoch,
                    rssi=rssi,
                    free_heap=heap,
                    uptime_sec=uptime
                )
                session.add(hb)

                # 3. Store Partition-Ready Historical Telemetry
                telem = TelemetryRecord(
                    node_id=node_id,
                    event_type=event_type,
                    ip=ip_addr,
                    rssi=rssi,
                    free_heap=heap,
                    uptime_sec=uptime,
                    payload_json=json.dumps(payload),
                    timestamp=datetime.utcnow(),
                    epoch=now_epoch
                )
                session.add(telem)

                # 4. Synchronize Reported GPIO Channels
                channels_data = payload.get("channels", [])
                relay_changes = []

                for ch in channels_data:
                    ch_id = ch.get("id")
                    if ch_id is None: continue
                    pin = ch.get("pin", 0)
                    ch_name = ch.get("name", f"Relay {ch_id}")
                    room = ch.get("room", "General")
                    function = ch.get("function", "Relay")
                    active_low = bool(ch.get("activeLow", True))
                    initial_mode = int(ch.get("initialMode", 0))
                    enabled = bool(ch.get("enabled", True))
                    physical_state = bool(ch.get("state", False))

                    r_stmt = select(Relay).where(Relay.node_id == node_id, Relay.channel_id == ch_id)
                    r_res = await session.execute(r_stmt)
                    relay = r_res.scalars().first()

                    if not relay:
                        relay = Relay(
                            node_id=node_id,
                            channel_id=ch_id,
                            pin=pin,
                            name=ch_name,
                            room=room,
                            function=function,
                            active_low=active_low,
                            initial_mode=initial_mode,
                            enabled=enabled,
                            current_state=physical_state,
                            requested_state=physical_state,
                            is_syncing=False,
                            last_changed_at=datetime.utcnow()
                        )
                        session.add(relay)
                    else:
                        old_state = relay.current_state
                        if old_state != physical_state:
                            relay.current_state = physical_state
                            relay.requested_state = physical_state
                            relay.is_syncing = False
                            relay.last_changed_at = datetime.utcnow()
                            
                            ev = RelayEvent(
                                node_id=node_id,
                                channel_id=ch_id,
                                old_state=old_state,
                                new_state=physical_state,
                                trigger_source=f"NODE_{protocol}",
                                confirmed=True
                            )
                            session.add(ev)
                            relay_changes.append({
                                "node_id": node_id,
                                "channel_id": ch_id,
                                "old_state": old_state,
                                "new_state": physical_state
                            })

                await session.commit()

                # Broadcast live updates
                await ws_manager.broadcast("telemetry_update", {
                    "node_id": node_id,
                    "ip": ip_addr,
                    "rssi": rssi,
                    "free_heap": heap,
                    "uptime_sec": uptime,
                    "channels": channels_data,
                    "event_type": event_type
                })

                for change in relay_changes:
                    await ws_manager.broadcast("relay_state_confirmed", change)

            except Exception as e:
                logger.error(f"Error processing telemetry for node {node_id}: {e}")
                await session.rollback()

        # 5. Return and clear queued commands for this node
        return self.pending_command_queues.pop(node_id, [])

    async def dispatch_command(self, node_id: str, channel_id: int, action: str, state: bool = False, duration: int = 500) -> Dict[str, Any]:
        """
        Dispatches relay command.
        1. Updates requested_state in DB and sets is_syncing = True.
        2. Tries instant direct LAN HTTP if node IP is known.
        3. If LAN HTTP succeeds, marks confirmed.
        4. Otherwise queues command for next TCP/MQTT cycle.
        """
        async with async_session_factory() as session:
            stmt = select(Node).where(Node.node_id == node_id)
            res = await session.execute(stmt)
            node = res.scalars().first()

            if not node:
                return {"success": False, "error": f"Node {node_id} not found"}

            r_stmt = select(Relay).where(Relay.node_id == node_id, Relay.channel_id == channel_id)
            r_res = await session.execute(r_stmt)
            relay = r_res.scalars().first()

            if relay:
                relay.requested_state = state if action == "setState" else not relay.current_state
                relay.is_syncing = True
                await session.commit()

            # Broadcast command pending to dashboard
            await ws_manager.broadcast("relay_command_dispatched", {
                "node_id": node_id,
                "channel_id": channel_id,
                "action": action,
                "state": state
            })

            cmd_payload = {
                "action": action,
                "id": channel_id,
                "gpioId": channel_id,
                "state": state,
                "duration": duration
            }

            # Attempt Direct LAN HTTP
            if node.ip_address and node.ip_address.strip() and node.ip_address != "0.0.0.0":
                try:
                    url = f"http://{node.ip_address}/api/gpio/state"
                    async with httpx.AsyncClient(timeout=settings.COMMAND_TIMEOUT_SEC) as client:
                        resp = await client.post(url, json={"id": channel_id, "action": action, "state": state, "duration": duration})
                        if resp.status_code == 200:
                            if relay:
                                relay.current_state = relay.requested_state
                                relay.is_syncing = False
                                await session.commit()
                            await ws_manager.broadcast("relay_state_confirmed", {
                                "node_id": node_id,
                                "channel_id": channel_id,
                                "new_state": relay.current_state if relay else state
                            })
                            return {"success": True, "delivery": "direct_lan_http", "message": "Command executed instantly via LAN"}
                except Exception as ex:
                    logger.debug(f"Direct LAN HTTP to {node.ip_address} failed ({ex}), falling back to queue.")

            # Queue for next node check-in
            if node_id not in self.pending_command_queues:
                self.pending_command_queues[node_id] = []
            self.pending_command_queues[node_id].append(cmd_payload)

            return {"success": True, "delivery": "queued", "message": "Command queued for next node check-in"}

    async def check_offline_loop(self):
        """Monitors last-seen timestamps and marks offline nodes."""
        threshold = settings.NODE_OFFLINE_THRESHOLD_SEC
        while True:
            try:
                await asyncio.sleep(5.0)
                now = time.time()
                async with async_session_factory() as session:
                    stmt = select(Node).where(Node.is_online == True)
                    res = await session.execute(stmt)
                    online_nodes = res.scalars().all()

                    for node in online_nodes:
                        last_seen = self.active_node_last_seen.get(node.node_id)
                        if last_seen is None and node.last_seen_at:
                            last_seen = node.last_seen_at.timestamp()

                        if last_seen and (now - last_seen > threshold):
                            node.is_online = False
                            node.status = "Offline"
                            sys_ev = SystemEvent(
                                node_id=node.node_id,
                                category="SYSTEM",
                                severity="WARNING",
                                description=f"Node '{node.name}' missed heartbeats and marked OFFLINE",
                                execution_result="TIMEOUT"
                            )
                            session.add(sys_ev)
                            await session.commit()
                            await ws_manager.broadcast("node_status", {
                                "node_id": node.node_id,
                                "is_online": False,
                                "status": "Offline"
                            })
                            logger.info(f"Node {node.node_id} marked OFFLINE (timeout {threshold}s)")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in offline monitor loop: {e}")

device_service = DeviceService()
