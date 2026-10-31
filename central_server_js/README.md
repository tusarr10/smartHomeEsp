# SmartHome Central Management Platform (Node.js / JS Edition) 🏠⚡

**High-Performance Multi-Node Fleet Controller, TCP Telemetry Ingestion Engine & Real-time Web Dashboard**

Migrated from Python FastAPI / SQLite to pure JavaScript (Node.js 20+) with zero native build tool dependencies, native `node:sqlite`, raw TCP socket streaming, and full REST & WebSocket integration.

---

## 🌟 Architecture & Features

```
                          ┌─────────────────────────────────────┐
                          │     Windows Host Central Server     │
                          │        (central_server_js)          │
                          │                                     │
                          │   ┌─────────────────────────────┐   │
                          │   │   Express REST + Web UI     │   │
                          │   │    (Port 9100 / Port 8080)  │   │
                          │   └──────────────┬──────────────┘   │
                          │                  │                  │
                          │   ┌──────────────┴──────────────┐   │
                          │   │    Unified Node Manager     │   │
                          │   └──────┬───────────────┬──────┘   │
                          │          │               │          │
                          │   ┌──────┴──────┐ ┌──────┴──────┐   │
                          │   │ TCP Server  │ │  WebSocket  │   │
                          │   │ (Port 2000) │ │(/api/v1/ws) │   │
                          │   └──────┬──────┘ └──────┬──────┘   │
                          └──────────┼───────────────┼──────────┘
                                     │               │
        ┌────────────────────────────┴───────────────┴─────────────────────────────┐
        │                                                                          │
        ▼                                                                          ▼
 ┌───────────────┐                                                          ┌───────────────┐
 │ ESP8266 Node  │                                                          │ ESP8266 Node  │
 │ (192.168.1.x) │                                                          │ (192.168.1.105│
 │ Relays 1 & 2  │                                                          │ Relays & Time │
 └───────────────┘                                                          └───────────────┘
```

1. **Dual Ingestion Protocol**:
   - **Raw TCP Sockets (Port 2000)**: Real-time framed newline/JSON telemetry streams from ESP8266 nodes.
   - **HTTP REST Ingestion (`/api/telemetry` & `/api/node/telemetry`)**: For HTTP-configured nodes.
2. **Bi-Directional Command Execution**:
   - Dispatches commands immediately over LAN HTTP (`http://<node_ip>/api/gpio/state` with automatic admin session authorization).
   - If a node is offline or LAN HTTP is unreachable, queues the command for the next TCP/HTTP heartbeat sync (`{ commands: [...] }`).
3. **Built-in `node:sqlite` Storage**:
   - Uses Node.js 22/24's native `node:sqlite` engine (`data/fleet.db`).
   - Zero compilation, zero C++ build issues on Windows.
4. **Rich Dual-API Coverage**:
   - Full `/api/v1/...` REST API for the bundled Single-Page Application (SPA) dashboard.
   - `/api/...` REST & Server-Sent Events (SSE) `/api/events` compatible with lightweight tools.
   - WebSocket `/api/v1/ws` for live zero-refresh updates.

---

## 🚀 Quick Start

### 1. Run the Server
From the project folder:
```powershell
cd central_server_js
npm start
```
Or double-click `run.bat`.

### 2. Access the Dashboard
Open your browser at:
👉 **`http://localhost:9100`**

---

## 🔌 Connecting NodeMCU (`192.168.1.105`)

In your ESP8266's web dashboard (`http://192.168.1.105`):
1. Navigate to **Settings** -> **Central Receiver / Fleet Telemetry**.
2. **Receiver Mode**: Enabled.
3. **Protocol**: `Raw TCP Socket (Stream)` or `HTTP POST`.
4. **Server Host/IP**: Your PC's LAN IP (`192.168.1.10`).
5. **Server Port**: `2000` (for TCP) or `9100` (for HTTP).
6. Click **Save Settings** and **Test Connection**.

---

## 📖 API Reference

### System & Fleet
- `GET /api/v1/system/overview` - Fleet count, online/offline nodes, relay stats.
- `GET /api/v1/nodes` - List all registered fleet nodes with relays.
- `GET /api/v1/nodes/:nodeId` - Detailed telemetry and history for a node.
- `DELETE /api/v1/nodes/:nodeId` - Unregister node from fleet.
- `POST /api/v1/nodes/:nodeId/restart` - Remotely soft-reboot microcontroller.

### GPIO & Relays
- `GET /api/v1/relays` - All relays across all fleet nodes.
- `POST /api/v1/relays/:nodeId/:channelId/command` - Dispatch toggle / pulse / setState.
- `POST /api/v1/relays/broadcast` - Switch all relays across rooms or nodes.
- `GET /api/v1/relays/:nodeId/:channelId/history` - State transition event log.

### Real-Time Streaming
- `WS /api/v1/ws` - WebSocket real-time live events.
- `GET /api/events` - Server-Sent Events (SSE) telemetry stream.
- `POST /api/telemetry` & `POST /api/node/telemetry` - HTTP telemetry ingestion.
