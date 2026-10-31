#!/usr/bin/env python3
"""
smartHomeEsp Central Fleet Server
High-Performance Dual-Protocol Server:
  - TCP Telemetry Listener (Port 2000) for ESP8266 Fleet Nodes
  - HTTP REST API & Real-time Web Dashboard (Port 8080) with Server-Sent Events (SSE)
"""

import asyncio
import json
import os
import sys
import time
import mimetypes
import urllib.parse
import urllib.request
from typing import Dict, Any, Optional

from database import FleetDatabase
from node_manager import NodeManager

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(SCRIPT_DIR, "frontend", "dist") if os.path.isdir(os.path.join(SCRIPT_DIR, "frontend", "dist")) else os.path.join(SCRIPT_DIR, "static")
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")

def load_config() -> Dict[str, Any]:
    default_config = {
        "bind_host": "0.0.0.0",
        "http_port": 8080,
        "tcp_port": 2000,
        "offline_timeout_sec": 30,
        "auth_token": "",
        "direct_http_timeout_sec": 2.0
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                default_config.update(cfg)
        except Exception as e:
            print(f"[Warning] Failed to load config.json: {e}")
    return default_config

config = load_config()
db = FleetDatabase(os.path.join(SCRIPT_DIR, "data", "fleet.db"))
node_mgr = NodeManager(db, config)


# ============================================================================
# TCP TELEMETRY LISTENER (Default Port 2000)
# ============================================================================
async def handle_tcp_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    peer = writer.get_extra_info("peername")
    client_ip = peer[0] if peer else "unknown"
    buffer = ""

    try:
        # Read incoming telemetry until newline or client disconnect
        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=5.0)
            if not line:
                break
            buffer += line.decode("utf-8", errors="ignore")
            if "\n" in buffer or buffer.strip().endswith("}"):
                break

        buffer = buffer.strip()
        if buffer:
            try:
                payload = json.loads(buffer)
                # Ensure IP is captured from connection if missing in payload
                if not payload.get("ip") or payload.get("ip") == "0.0.0.0":
                    payload["ip"] = client_ip

                # Process telemetry in fleet manager
                pending_cmds = await node_mgr.process_telemetry(payload)

                response_obj: Dict[str, Any] = {"status": "ok", "time": int(time.time())}
                if pending_cmds:
                    response_obj["commands"] = pending_cmds

                resp_str = json.dumps(response_obj) + "\n"
                writer.write(resp_str.encode("utf-8"))
                await writer.drain()
            except json.JSONDecodeError as jde:
                err_resp = json.dumps({"status": "error", "message": f"Malformed JSON: {str(jde)}"}) + "\n"
                writer.write(err_resp.encode("utf-8"))
                await writer.drain()
    except asyncio.TimeoutError:
        pass
    except Exception as e:
        # Client disconnect or network reset
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


# ============================================================================
# HTTP REST API & WEB DASHBOARD (Default Port 8080)
# ============================================================================
async def send_response(writer: asyncio.StreamWriter, status_code: int, content_type: str, body: bytes, extra_headers: Optional[Dict[str, str]] = None):
    status_text = {
        200: "OK",
        204: "No Content",
        400: "Bad Request",
        404: "Not Found",
        405: "Method Not Allowed",
        500: "Internal Server Error"
    }.get(status_code, "OK")

    header_lines = [
        f"HTTP/1.1 {status_code} {status_text}",
        f"Content-Type: {content_type}",
        f"Content-Length: {len(body)}",
        "Connection: close",
        "Access-Control-Allow-Origin: *",
        "Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token"
    ]
    if extra_headers:
        for k, v in extra_headers.items():
            header_lines.append(f"{k}: {v}")

    header_raw = "\r\n".join(header_lines) + "\r\n\r\n"
    writer.write(header_raw.encode("latin-1") + body)
    await writer.drain()


async def send_json(writer: asyncio.StreamWriter, data: Any, status_code: int = 200):
    body = json.dumps(data, indent=2).encode("utf-8")
    await send_response(writer, status_code, "application/json; charset=utf-8", body)


async def serve_static_file(writer: asyncio.StreamWriter, filepath: str):
    if not os.path.isfile(filepath):
        await send_response(writer, 404, "text/plain", b"File not found")
        return

    mime, _ = mimetypes.guess_type(filepath)
    if not mime:
        mime = "application/octet-stream"

    try:
        with open(filepath, "rb") as f:
            content = f.read()
        await send_response(writer, 200, mime, content)
    except Exception as e:
        await send_response(writer, 500, "text/plain", f"Error reading file: {e}".encode())


async def handle_sse_stream(writer: asyncio.StreamWriter):
    """Server-Sent Events stream for live real-time web dashboard."""
    header = (
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: text/event-stream\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: keep-alive\r\n"
        "Access-Control-Allow-Origin: *\r\n\r\n"
    )
    writer.write(header.encode("latin-1"))
    await writer.drain()

    # Send initial fleet stats
    init_data = f"event: stats\ndata: {json.dumps(node_mgr.get_fleet_stats())}\n\n"
    writer.write(init_data.encode("utf-8"))
    await writer.drain()

    queue = node_mgr.subscribe_sse()
    try:
        while True:
            msg = await queue.get()
            writer.write(msg.encode("utf-8"))
            await writer.drain()
    except (asyncio.CancelledError, ConnectionResetError, BrokenPipeError):
        pass
    finally:
        node_mgr.unsubscribe_sse(queue)
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def handle_http_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        # Read Request Line
        req_line = await asyncio.wait_for(reader.readline(), timeout=10.0)
        if not req_line:
            writer.close()
            return

        parts = req_line.decode("utf-8", errors="ignore").strip().split(" ")
        if len(parts) < 2:
            writer.close()
            return

        method, raw_path = parts[0].upper(), parts[1]
        parsed_url = urllib.parse.urlparse(raw_path)
        path = parsed_url.path

        # Read Headers
        headers: Dict[str, str] = {}
        content_length = 0
        while True:
            hline = await asyncio.wait_for(reader.readline(), timeout=5.0)
            if not hline or hline in (b"\r\n", b"\n"):
                break
            line_str = hline.decode("utf-8", errors="ignore").strip()
            if ":" in line_str:
                hk, hv = line_str.split(":", 1)
                headers[hk.strip().lower()] = hv.strip()

        if "content-length" in headers:
            try:
                content_length = int(headers["content-length"])
            except ValueError:
                content_length = 0

        # Handle Preflight OPTIONS
        if method == "OPTIONS":
            await send_response(writer, 204, "text/plain", b"")
            return

        # Read Body if POST
        body_bytes = b""
        if content_length > 0:
            body_bytes = await asyncio.wait_for(reader.readexactly(content_length), timeout=10.0)

        body_json: Dict[str, Any] = {}
        if body_bytes and headers.get("content-type", "").startswith("application/json"):
            try:
                body_json = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                pass

        # --------------------------------------------------------------------
        # ROUTE DISPATCHER
        # --------------------------------------------------------------------

        # Normalize /api/v1 -> /api
        norm_path = path
        if norm_path.startswith("/api/v1"):
            norm_path = "/api" + norm_path[len("/api/v1"):]

        # Web Dashboard Static UI
        if method == "GET" and (path == "/" or path == "/index.html"):
            await serve_static_file(writer, os.path.join(STATIC_DIR, "index.html"))
            return

        if method == "GET" and (path.startswith("/assets/") or path.startswith("/static/")):
            rel_path = path.lstrip("/").split("/", 1)[-1]
            full_path = os.path.abspath(os.path.join(STATIC_DIR, "assets", rel_path))
            if not os.path.isfile(full_path):
                full_path = os.path.abspath(os.path.join(STATIC_DIR, rel_path))
            if os.path.isfile(full_path):
                await serve_static_file(writer, full_path)
            else:
                await send_response(writer, 404, "text/plain", b"File not found")
            return

        # Server-Sent Events (SSE) Stream
        if method == "GET" and (norm_path == "/api/events" or norm_path == "/api/ws"):
            await handle_sse_stream(writer)
            return

        # REST API: System Overview Stats
        if method == "GET" and norm_path == "/api/system/overview":
            stats = node_mgr.get_fleet_stats()
            resp = {
                "nodes": {
                    "total": stats.get("totalNodes", 0),
                    "online": stats.get("onlineNodes", 0),
                    "offline": stats.get("offlineNodes", 0)
                },
                "relays": {
                    "total": stats.get("totalChannels", 0),
                    "on": stats.get("activeChannels", 0),
                    "off": stats.get("totalChannels", 0) - stats.get("activeChannels", 0)
                },
                "sensors": {
                    "total": 0
                },
                "alerts": {
                    "unread": 0
                },
                "protocols": {
                    "tcp_server": {
                        "running": True,
                        "port": int(config.get("tcp_port", 2000))
                    },
                    "mqtt_broker": {
                        "connected": False,
                        "broker": "127.0.0.1:1883"
                    }
                },
                "server": {
                    "version": "1.6.0",
                    "uptime_sec": stats.get("serverUptimeSec", 0),
                    "platform": "Windows SmartHome Central Platform"
                }
            }
            await send_json(writer, resp)
            return

        # REST API: Aggregated Relays across all nodes
        if method == "GET" and norm_path == "/api/relays":
            nodes = db.get_nodes()
            all_relays = []
            for n in nodes:
                nid = n.get("node_id")
                nname = n.get("node_name", nid)
                is_online = bool(n.get("is_online"))
                for ch in n.get("channels", []):
                    all_relays.append({
                        "id": ch.get("id"),
                        "node_id": nid,
                        "node_name": nname,
                        "node_online": is_online,
                        "channel_id": ch.get("id"),
                        "pin": ch.get("pin", 0),
                        "name": ch.get("name", f"Relay {ch.get('id')}"),
                        "room": ch.get("room", "General"),
                        "function": ch.get("function", "Relay"),
                        "active_low": bool(ch.get("activeLow", True)),
                        "current_state": bool(ch.get("state", False)),
                        "requested_state": bool(ch.get("state", False)),
                        "is_syncing": False
                    })
            await send_json(writer, all_relays)
            return

        # REST API: Relay Command
        if method == "POST" and norm_path.startswith("/api/relays/") and "/command" in norm_path:
            parts = norm_path.split("/")
            # /api/relays/{node_id}/{channel_id}/command
            nid = parts[3]
            chid = int(parts[4])
            cmd = dict(body_json)
            cmd["id"] = chid
            cmd["gpioId"] = chid
            res = await node_mgr.send_or_queue_command(nid, cmd)
            await send_json(writer, res)
            return

        # REST API: Broadcast Relays
        if method == "POST" and norm_path == "/api/relays/broadcast":
            res = await node_mgr.broadcast_command(body_json)
            await send_json(writer, res)
            return

        # REST API: Sensors placeholder
        if method == "GET" and norm_path == "/api/sensors":
            await send_json(writer, [])
            return

        # REST API: Automations placeholder
        if method == "GET" and norm_path == "/api/automations":
            await send_json(writer, [])
            return

        # REST API: Firmware placeholder
        if method == "GET" and norm_path == "/api/firmware":
            await send_json(writer, [])
            return

        # REST API: System Events
        if method == "GET" and norm_path == "/api/system/events":
            logs = db.get_audit_logs(limit=50)
            events = []
            for l in logs:
                events.append({
                    "id": l.get("id"),
                    "timestamp": l.get("timestamp_str"),
                    "node_id": l.get("node_id"),
                    "category": l.get("category", "SYSTEM"),
                    "severity": "WARNING" if "FAIL" in l.get("category", "") or "OFFLINE" in l.get("category", "") else "INFO",
                    "description": l.get("message")
                })
            await send_json(writer, events)
            return

        # REST API: System Notifications
        if method == "GET" and norm_path == "/api/system/notifications":
            await send_json(writer, [])
            return

        if method == "POST" and norm_path == "/api/system/notifications/mark-read":
            await send_json(writer, {"success": True})
            return

        # REST API: System Logs
        if method == "GET" and norm_path == "/api/system/logs":
            logs = db.get_audit_logs(limit=100)
            await send_json(writer, logs)
            return

        # REST API: Nodes Fleet List
        if method == "GET" and norm_path == "/api/nodes":
            nodes = db.get_nodes()
            await send_json(writer, nodes)
            return

        # REST API: Proxy Node Configuration Backup Download
        if method == "GET" and norm_path.startswith("/api/nodes/") and norm_path.endswith("/backup/download"):
            nid = norm_path.split("/")[3]
            node = db.get_node(nid)
            ip = node.get("ip_address") if node else None
            if not ip or ip == "0.0.0.0":
                await send_json(writer, {"error": "Node not found or offline"}, status_code=404)
                return
            try:
                def _fetch_backup():
                    req = urllib.request.Request(f"http://{ip}/api/backup/download", method="GET")
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        return resp.read(), resp.headers.get("Content-Disposition", f'attachment; filename="backup_{nid}.json"')
                loop = asyncio.get_running_loop()
                data, disposition = await loop.run_in_executor(None, _fetch_backup)
                await send_response(writer, 200, "application/json; charset=utf-8", data, extra_headers={"Content-Disposition": disposition})
            except Exception as e:
                await send_json(writer, {"error": f"Failed to fetch backup from node: {str(e)}"}, status_code=502)
            return

        # REST API: Proxy Node Running Firmware Binary Download
        if method == "GET" and norm_path.startswith("/api/nodes/") and norm_path.endswith("/firmware/download"):
            nid = norm_path.split("/")[3]
            node = db.get_node(nid)
            ip = node.get("ip_address") if node else None
            if not ip or ip == "0.0.0.0":
                await send_json(writer, {"error": "Node not found or offline"}, status_code=404)
                return
            try:
                def _fetch_fw():
                    req = urllib.request.Request(f"http://{ip}/api/firmware/download", method="GET")
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        return resp.read(), resp.headers.get("Content-Disposition", f'attachment; filename="firmware_{nid}.bin"')
                loop = asyncio.get_running_loop()
                data, disposition = await loop.run_in_executor(None, _fetch_fw)
                await send_response(writer, 200, "application/octet-stream", data, extra_headers={"Content-Disposition": disposition})
            except Exception as e:
                await send_json(writer, {"error": f"Failed to fetch firmware from node: {str(e)}"}, status_code=502)
            return

        # REST API: Specific Node Detail
        if method == "GET" and norm_path.startswith("/api/nodes/"):
            nid = norm_path.split("/")[3]
            node = db.get_node(nid)
            if node:
                history = db.get_telemetry_history(nid, limit=20)
                await send_json(writer, {"node": node, "history": history})
            else:
                await send_json(writer, {"error": "Node not found"}, status_code=404)
            return

        # REST API: Dispatch Command to Node
        if method == "POST" and "/command" in norm_path and norm_path.startswith("/api/nodes/"):
            nid = norm_path.split("/")[3]
            res = await node_mgr.send_or_queue_command(nid, body_json)
            await send_json(writer, res)
            return

        # REST API: Rename Node
        if method == "POST" and "/rename" in norm_path and norm_path.startswith("/api/nodes/"):
            nid = norm_path.split("/")[3]
            new_name = body_json.get("name", "").strip()
            if new_name and db.rename_node(nid, new_name):
                await node_mgr.broadcast_sse("node_renamed", {"nodeId": nid, "name": new_name})
                await send_json(writer, {"success": True, "nodeId": nid, "name": new_name})
            else:
                await send_json(writer, {"success": False, "error": "Invalid name or node not found"}, status_code=400)
            return

        # REST API: Delete Node
        if method == "DELETE" and norm_path.startswith("/api/nodes/"):
            nid = norm_path.split("/")[3]
            if db.delete_node(nid):
                await node_mgr.broadcast_sse("node_deleted", {"nodeId": nid})
                await send_json(writer, {"success": True, "nodeId": nid})
            else:
                await send_json(writer, {"success": False, "error": "Node not found"}, status_code=404)
            return


        # REST API: Broadcast Command to All Nodes
        if method == "POST" and norm_path == "/api/broadcast/command":
            res = await node_mgr.broadcast_command(body_json)
            await send_json(writer, res)
            return

        # REST API: HTTP Telemetry Ingestion (Alternative to TCP for HTTP-configured nodes)
        if method == "POST" and norm_path == "/api/telemetry":
            peer = writer.get_extra_info("peername")
            if peer and (not body_json.get("ip") or body_json.get("ip") == "0.0.0.0"):
                body_json["ip"] = peer[0]
            pending = await node_mgr.process_telemetry(body_json)
            resp: Dict[str, Any] = {"status": "ok", "time": int(time.time())}
            if pending:
                resp["commands"] = pending
            await send_json(writer, resp)
            return

        # REST API: Fleet Summary Stats
        if method == "GET" and norm_path == "/api/stats":
            await send_json(writer, node_mgr.get_fleet_stats())
            return

        # REST API: Audit & Event Logs
        if method == "GET" and path == "/api/logs":
            logs = db.get_audit_logs(limit=100)
            await send_json(writer, {"logs": logs})
            return

        # REST API: Server Configuration
        if method == "GET" and path == "/api/config":
            # Mask token for security
            safe_cfg = dict(config)
            if safe_cfg.get("auth_token"):
                safe_cfg["has_auth_token"] = True
                safe_cfg["auth_token"] = "***"
            await send_json(writer, safe_cfg)
            return

        # 404 Fallback
        await send_response(writer, 404, "text/plain", b"Endpoint not found")

    except asyncio.TimeoutError:
        pass
    except Exception as e:
        try:
            await send_json(writer, {"error": str(e)}, status_code=500)
        except Exception:
            pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


# ============================================================================
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# SERVER MAIN RUNNER
# ============================================================================
async def main():
    host = config.get("bind_host", "0.0.0.0")
    tcp_port = int(config.get("tcp_port", 2000))
    http_port = int(config.get("http_port", 8080))

    print("=" * 65)
    print(" [SmartHome] CENTRAL FLEET SERVER v1.6.0")
    print("=" * 65)
    print(f" [TCP Telemetry]  Listening on {host}:{tcp_port}")
    print(f" [HTTP Dashboard] http://localhost:{http_port} (Listening on {host}:{http_port})")
    print(f" [Offline Watch] Timeout set to {config.get('offline_timeout_sec', 30)}s")
    print("=" * 65)
    print(" >> Ready for ESP8266 fleet connections. Press Ctrl+C to stop.\n")

    # Start TCP Server for Node Telemetry
    tcp_server = await asyncio.start_server(handle_tcp_client, host, tcp_port)

    # Start HTTP Server for Web UI & REST API
    http_server = await asyncio.start_server(handle_http_client, host, http_port)

    # Launch background task for offline node monitoring
    offline_task = asyncio.create_task(node_mgr.check_offline_nodes_loop())

    try:
        await asyncio.gather(
            tcp_server.serve_forever(),
            http_server.serve_forever(),
            offline_task
        )
    except asyncio.CancelledError:
        pass
    finally:
        tcp_server.close()
        http_server.close()
        await tcp_server.wait_closed()
        await http_server.wait_closed()
        offline_task.cancel()
        print("\n[Server] Shutdown completed gracefully.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Server] Received KeyboardInterrupt, stopping...")
