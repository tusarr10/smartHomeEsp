# SmartHome Central Management Platform 🏠⚡

**Complete Multi-Node IoT Automation, Monitoring and Firmware Management System**

[![Platform](https://img.shields.io/badge/platform-Windows%20PC-blue.svg)](https://microsoft.com/windows)
[![Backend](https://img.shields.io/badge/backend-FastAPI%20%7C%20Python%203.11-009688.svg)](https://fastapi.tiangolo.com)
[![Database](https://img.shields.io/badge/database-PostgreSQL%20%2B%20SQLAlchemy%202.0-336791.svg)](https://www.postgresql.org)
[![Communication](https://img.shields.io/badge/protocols-MQTT%20%7C%20TCP%202000%20%7C%20REST-orange.svg)]()
[![Hardware](https://img.shields.io/badge/hardware-ESP8266%20%7C%20ESP32%20%7C%20ESP--01-green.svg)]()

---

## 🌟 1. System Overview

The **SmartHome Central Management Platform** serves as the primary intelligence, telemetry collector, and fleet controller for the entire smart home network. Running on a host Windows PC, it orchestrates distributed microcontrollers across the home, coordinates sensor data, evaluates multi-condition automation rules, provides zero-refresh live dashboards via WebSockets, and manages staged OTA firmware distributions.

```
                          ┌─────────────────────────────────────┐
                          │     Windows Host Central Server     │
                          │                                     │
                          │   ┌─────────────────────────────┐   │
                          │   │   FastAPI Web & REST API    │   │
                          │   │         (Port 8000)         │   │
                          │   └──────────────┬──────────────┘   │
                          │                  │                  │
                          │   ┌──────────────┴──────────────┐   │
                          │   │   Unified Device Service    │   │
                          │   └──────┬───────────────┬──────┘   │
                          │          │               │          │
                          │   ┌──────┴──────┐ ┌──────┴──────┐   │
                          │   │ TCP Server  │ │ MQTT Client │   │
                          │   │ (Port 2000) │ │ (Port 1883) │   │
                          │   └──────┬──────┘ └──────┬──────┘   │
                          └──────────┼───────────────┼──────────┘
                                     │               │
       ┌─────────────────────────────┴───────────────┴─────────────────────────────┐
       │                                                                           │
       ▼                                             ▼                             ▼
┌───────────────┐                             ┌───────────────┐             ┌───────────────┐
│ NODE_LIVING_01│                             │NODE_BEDROOM_01│             │ NODE_GATE_01  │
│ (ESP8266 MCU) │                             │    (ESP32)    │             │   (ESP-01)    │
│ Relays 1 & 2  │                             │ Relays & DHT  │             │ Pulse Relay   │
└───────────────┘                             └───────────────┘             └───────────────┘
```

---

## 🚀 2. Quick Start on Windows

### Prerequisites
1. **Python 3.10 or 3.11** installed and added to your system `PATH`.
2. *(Recommended)* **PostgreSQL 14+** (the server includes an automatic SQLite fallback so it can run immediately without setup if PostgreSQL is not yet configured).
3. *(Optional)* **Mosquitto MQTT Broker** installed on Windows.

### One-Click Installation & Launch

1. **Install Dependencies**:
   Double click or run in PowerShell:
   ```cmd
   scripts\install_windows.bat
   ```
2. **Start the Platform**:
   ```cmd
   scripts\start_all.bat
   ```
3. **Open the Dashboard**:
   Open your browser to:
   👉 **`http://localhost:8000`**

---

## 🔌 3. Firmware Integration (`SmartHome-NodeMCU`)

The central server is designed to integrate seamlessly with the existing `SmartHome-NodeMCU` firmware located in `app2/`:

### Configuring the ESP8266 Node
In the ESP8266 web dashboard (`http://192.168.1.105`):
1. Navigate to **Settings** -> **Central Receiver / Fleet Telemetry**.
2. Set **Protocol** to `Raw TCP Socket (Stream)` or `HTTP POST`.
3. Set **Server Host/IP** to your Windows PC's LAN IP (e.g. `192.168.1.10`).
4. Set **Server Port** to `2000` (for TCP) or `8000` (for HTTP).
5. Click **Save Settings** and **Test Connection**.

### Node Telemetry Payload Format
```json
{
  "nodeId": "NODE_LIVING_01",
  "nodeName": "Living Room Hub",
  "eventType": "heartbeat",
  "timestamp": "2026-10-31 01:45:00",
  "epoch": 1793400900,
  "ip": "192.168.1.105",
  "gateway": "192.168.1.1",
  "mac": "BC:DD:C2:23:38:6C",
  "rssi": -52,
  "uptimeSec": 12480,
  "freeHeap": 26840,
  "firmwareVersion": "1.6.0",
  "channels": [
    {
      "id": 1,
      "pin": 5,
      "name": "Living Room Light",
      "room": "Living Room",
      "function": "Relay",
      "activeLow": true,
      "initialMode": 0,
      "enabled": true,
      "state": false
    },
    {
      "id": 2,
      "pin": 4,
      "name": "Ceiling Fan",
      "room": "Living Room",
      "function": "Relay",
      "activeLow": true,
      "initialMode": 0,
      "enabled": true,
      "state": true
    }
  ]
}
```

### Server Command Injection Response
```json
{
  "status": "ok",
  "commands": [
    { "action": "setState", "id": 1, "state": true },
    { "action": "toggle", "id": 2 },
    { "action": "pulse", "id": 1, "duration": 500 },
    { "action": "reboot" }
  ]
}
```

---

## 🌐 4. Multi-Protocol Communication

### Protocol 1: Raw TCP Socket (Port 2000)
- **High-Speed Industrial Stream**: Fast framing with newline delimiters.
- Multiple simultaneous nodes supported concurrently via `asyncio`.
- Bi-directional command delivery during heartbeat responses.

### Protocol 2: MQTT Broker (Port 1883)
- Topic hierarchy:
  - `smarthome/nodes/{node_id}/telemetry` (QoS 1)
  - `smarthome/nodes/{node_id}/status` (LWT: `Online` / `Offline`)
  - `smarthome/nodes/{node_id}/relays/command` (Central command dispatch)
  - `smarthome/nodes/{node_id}/sensors` (Sensor readings)

### Protocol 3: REST API (Port 8000)
- Standard HTTP endpoints for configuration, telemetry ingestion, and OTA.

---

## ⚙️ 5. Central Automation Engine

Automations run centrally on Windows with sub-millisecond evaluation and anti-loop cooldown protection:
- **Condition-based**: e.g. `Sensor Temperature > 32°C` -> Turn ON AC.
- **Sensor-based**: e.g. `Motion Detected on NODE_LIVING_01` -> Turn ON Chandelier on `NODE_LIVING_02`.
- **Time & Schedule**: Daily schedules, specific `HH:MM` times, weekly day masks.
- **Logic**: Full support for `AND` / `OR` condition chaining and operators (`GT`, `LT`, `EQ`, `NEQ`, `BETWEEN`).

---

## 📦 6. Firmware & OTA Management

- **Hardware Flash Limits**:
  - `ESP-01`: 512 KB maximum binary size
  - `ESP8266`: 1024 KB maximum binary size
  - `ESP32`: 2048 KB maximum binary size
- **Upload Validation**: Automatically generates and verifies MD5 and SHA256 checksums.
- **Deployment**: Streams binary to target node's `/api/ota` endpoint and tracks live progress.

---

## 🗄️ 7. PostgreSQL Database & Automated Backups

- Relational DDL script located at `database/schema.sql`.
- Automated Weekly Backup script located at `database/backup_postgres.bat`.
- Retention policy: Keeps the newest 8 weekly backups and cleans up older snapshots.
- Restore verification: `database/restore_postgres.bat [backup_file]`.

---

## 🛡️ 8. Secure Remote Access

Recommended Setup: **Tailscale VPN**
1. Install Tailscale on the host Windows PC.
2. Install Tailscale on your Android / iOS smartphone.
3. Access the dashboard from anywhere in the world using your Windows Tailscale IP:
   `http://100.x.y.z:8000`
*(No insecure router port forwarding required!)*
