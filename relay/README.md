# SmartHome Go Edge Broker (`smarthome-edge`)

Ultra-lightweight, high-performance edge control plane engineered specifically in **Go (Golang)** to run natively on the **Jio AX6000 JIDU6J01** (MediaTek MT7986A Filogic 830, Quad-core Cortex-A53, 512 MB RAM, OpenWrt 25.12-SNAPSHOT).

---

## 🌟 Core Architecture

```
                                  +-----------------------------+
                                  | Central Server (PC / Cloud) |
                                  | (RBAC, SQLite History, OTA) |
                                  +--------------^--------------+
                                                 | Outbound Sync
                                                 | (when PC is ON)
+-----------------------+         +--------------v--------------+         +--------------------------+
|  ESP8266 Fleet Nodes  |         |   Jio AX6000 OpenWrt Router |         | Android App / Client     |
|  (app2 C++ Firmware)  +-------->|    (Go Edge Broker Process) |<------->| (REST & WebSocket :9200) |
+-----------------------+  TCP    +--------------^--------------+         +--------------------------+
                          :2000                  |
                                                 | LAN Polling (:8085 / LAN)
                                  +--------------v--------------+
                                  | Wi-Fi Smart Circuit Breaker |
                                  | (Voltage, Current, Leakage) |
                                  +-----------------------------+
```

### Key Highlights
1. **Always-On Local Authority:** ESP nodes and Android mobile app connect directly to the router. The central PC is never a dependency for toggling relays, reading sensors, or monitoring circuit breakers.
2. **Pure Static Binary:** Zero runtime dependencies on OpenWrt (no Node.js, no Python, no shared libraries).
3. **Low Resource Footprint:** Consumes only ~15 MB to 25 MB RAM and <1% idle CPU.
4. **Framing & Protocol:** Uses standard NDJSON (newline-delimited JSON) on TCP port `2000`, matching your existing ESP `app2` firmware.
5. **Circuit Breaker:** Complete live telemetry (V, A, W, kWh, Hz, °C, mA) and contact switch control (DP 108).
6. **Persistent Spool:** Bounded disk queue on `/overlay/smarthome-edge/events` for critical state changes.

---

## 📁 Repository Structure

```
relay/
├── cmd/
│   └── edge/
│       └── main.go          <-- Entrypoint: TCP, HTTP, WebSocket & signal handling
├── config/
│   └── config.json          <-- Default configuration file
├── internal/
│   ├── auth/                <-- Token validation & node scope enforcement
│   ├── config/              <-- Configuration loader
│   ├── httpapi/             <-- REST API & static web dashboard router
│   ├── queue/               <-- Bounded append-only JSONL event spool
│   ├── state/               <-- In-memory Live State Cache & command queue
│   ├── syncer/              <-- Outbound Central PC sync & Breaker poller
│   ├── tcp/                 <-- Raw TCP NDJSON Gateway (Port 2000 / 2001)
│   └── websocket/           <-- RFC 6455 pure Go WebSocket hub
├── openwrt/
│   └── smarthome-edge.init  <-- OpenWrt procd service definition
├── web/                     <-- Embedded browser testing dashboard
│   ├── index.html
│   ├── style.css
│   └── app.js
├── build_arm64.bat          <-- Cross-compiles for Jio AX6000 OpenWrt ARM64
├── build_windows.bat        <-- Compiles for Windows local testing
├── run.bat                  <-- Runs locally on Windows
└── go.mod
```

---

## 🔨 Building & Testing

### 1. Test Locally on Windows

Double-click `run.bat` or run in terminal:
```cmd
cd relay
go run ./cmd/edge -config ./config/config.json
```
Open **`http://localhost:9200`** in your browser to view the live edge dashboard.

### 2. Cross-Compile for Jio AX6000 OpenWrt (ARM64)

Run `build_arm64.bat` on your PC, or execute:
```cmd
cd relay
set GOOS=linux
set GOARCH=arm64
set CGO_ENABLED=0
go build -trimpath -ldflags="-s -w" -o bin/smarthome-edge ./cmd/edge
```
This generates `bin/smarthome-edge` (~10 MB standalone executable).

---

## 🚀 Deploying to Jio AX6000 OpenWrt

### Step 1: Copy Files to Router
From your PC (using SCP or WinSCP):
```sh
scp relay/bin/smarthome-edge root@192.168.1.1:/usr/bin/smarthome-edge
scp relay/config/config.json root@192.168.1.1:/etc/smarthome-edge/config.json
scp relay/openwrt/smarthome-edge.init root@192.168.1.1:/etc/init.d/smarthome-edge
```

### Step 2: Set Permissions & Enable Service
SSH into the router:
```sh
ssh root@192.168.1.1

# Make executable
chmod +x /usr/bin/smarthome-edge
chmod +x /etc/init.d/smarthome-edge

# Enable and start via OpenWrt procd
/etc/init.d/smarthome-edge enable
/etc/init.d/smarthome-edge start
```

### Step 3: Verify Status
```sh
# Check if running
ps | grep smarthome-edge

# Check listening ports
netstat -lntp | grep -E '2000|9200'

# Check logs
logread | grep smarthome-edge
```

---

## 📡 API Reference for Android App

| Endpoint | Method | Description |
|---|---|---|
| `/api/v1/health` | `GET` | Broker health, uptime, and memory usage |
| `/api/v1/nodes` | `GET` | Returns list of authorized nodes (filtered by token scope) |
| `/api/v1/nodes/{id}` | `GET` | Single node details and channels |
| `/api/v1/nodes/{id}/commands` | `POST` | Toggles relay switch (`{"channelId": 1, "state": true}`) |
| `/api/v1/breaker` | `GET` | Live circuit breaker telemetry (V, A, W, kWh, Temp, Leakage) |
| `/api/v1/breaker/switch` | `POST` | Trips or closes main breaker contact (`{"state": true}`) |
| `/api/v1/edge/status` | `GET` | Edge broker diagnostics and Central PC connectivity |
| `/api/v1/ws` | `WS` | Real-time WebSocket event stream (`node_status`, `pin_update`, `breaker_update`) |
