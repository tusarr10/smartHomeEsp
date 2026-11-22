# 🏠 SmartHome Central Platform & ESP Fleet Ecosystem

> **Enterprise-Grade, Privacy-First, 100% Cloud-Free IoT Home Automation Platform**  
> Complete local control, dual-protocol telemetry (TCP/HTTP), multi-tier Home-Centric RBAC, and unified management across heterogeneous ESP8266, ESP-01 + PCF8574, and smart energy hardware.

[![Node.js Version](https://img.shields.io/badge/Node.js-v20%2B%20%7C%20v24%2B-brightgreen.svg?logo=nodedotjs)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/Database-SQLite%20(Native%20V8)-blue.svg?logo=sqlite)](https://www.sqlite.org/)
[![ESP8266](https://img.shields.io/badge/Hardware-ESP8266%20%2F%20ESP--01-orange.svg?logo=espressif)](https://www.espressif.com/)
[![PlatformIO](https://img.shields.io/badge/Toolchain-PlatformIO-yellowgreen.svg?logo=platformio)](https://platformio.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Status: Production Ready](https://img.shields.io/badge/Status-Production%20Ready-success.svg)](#)

---

## 📑 Table of Contents

1. [🎯 Project Goals & Vision](#-project-goals--vision)
2. [🏗️ System Architecture & Data Flow](#️-system-architecture--data-flow)
3. [✨ Key Features](#-key-features)
   - [Central Fleet Management Server](#1-central-fleet-management-server)
   - [Home-Centric Multi-Level RBAC](#2-home-centric-multi-level-rbac)
   - [Hardware Pin Safety & Expansion (PCF8574)](#3-hardware-pin-safety--expansion-pcf8574)
   - [Edge Node Firmware & LittleFS](#4-edge-node-firmware--littlefs)
   - [Over-The-Air (OTA) & LittleFS Deployer](#5-over-the-air-ota--littlefs-deployer)
4. [💻 System Requirements](#-system-requirements)
   - [Central Server Requirements](#central-server-requirements)
   - [Microcontroller & Hardware Requirements](#microcontroller--hardware-requirements)
   - [Developer Toolchain Requirements](#developer-toolchain-requirements)
5. [🚀 Deployment & Setup Guide](#-deployment--setup-guide)
   - [Step 1: Central Server Deployment](#step-1-central-server-deployment)
   - [Step 2: Firmware Build & Flashing (PlatformIO)](#step-2-firmware-build--flashing-platformio)
   - [Step 3: First-Run Onboarding & Node Provisioning](#step-3-first-run-onboarding--node-provisioning)
6. [📡 Telemetry & Communication Protocols](#-telemetry--communication-protocols)
   - [TCP Raw Socket Telemetry (Port 2000)](#tcp-raw-socket-telemetry-port-2000)
   - [RESTful Management API (Port 9100)](#restful-management-api-port-9100)
   - [Real-Time WebSocket Stream](#real-time-websocket-stream)
7. [📊 Resource Consumption & Performance Benchmarks](#-resource-consumption--performance-benchmarks)
8. [📁 Repository Directory Structure](#-repository-directory-structure)
9. [🔒 Security Architecture](#-security-architecture)
10. [📄 License](#-license)

---

## 🎯 Project Goals & Vision

Most consumer smart home ecosystems (Tuya, eWeLink, Google Home, Alexa) suffer from vendor lock-in, recurring cloud costs, latency overhead, internet outage vulnerabilities, and invasive telemetry tracking. 

The **SmartHome Platform** is engineered from the ground up as an **independent, zero-cloud, enterprise-ready IoT ecosystem**:

- **100% Local Network Autonomy**: Complete functionality without internet access. Nodes and servers interact entirely within the local area network (LAN).
- **Sub-Second Deterministic Latency**: Direct raw TCP socket streaming and WebSocket pipelines ensure instantaneous relay actuation (<50ms).
- **Zero Cloud Reliance & Absolute Privacy**: No external servers, no cloud subscriptions, no external tracking. Your credentials and telemetry never leave your home.
- **Fail-Safe Reliability & State Persistence**: Nodes maintain their relay states across power cuts using flash wear-leveling algorithms in LittleFS.
- **Unified Heterogeneous Fleet Management**: Central control plane seamlessly orchestrating full-sized NodeMCUs (4MB flash), ultra-compact ESP-01 / ESP-01S (1MB flash) paired with PCF8574 I2C 8-channel relay expanders, and smart energy breakers.
- **Enterprise Multi-Level RBAC**: True home-centric tenancy allowing multi-home, multi-room, multi-user role assignments (Super Admin, Home Owner, Home Admin, Family Member, Guest, Viewer) with per-device permission overrides.

---

## 🏗️ System Architecture & Data Flow

```
                           +----------------------------------------------+
                           |           Local Network (LAN / Wi-Fi)        |
                           +----------------------------------------------+
                                                  |
           +--------------------------------------+--------------------------------------+
           |                                                                             |
           v                                                                             v
+-----------------------+                                                     +-----------------------+
|  NodeMCU (ESP-12E/F)  |                                                     |  ESP-01S + PCF8574T   |
|  - 4MB Flash (LittleFS)|                                                    |  - 1MB Flash          |
|  - 13 GPIO Pins       |                                                     |  - I2C (SDA/SCL)      |
|  - Direct Relay Array |                                                     |  - 8-Channel Relay Bd |
+-----------------------+                                                     +-----------------------+
           |                                                                             |
    [Raw TCP :2000]                                                               [Raw TCP :2000]
    [HTTP REST :80]                                                               [HTTP REST :80]
           |                                                                             |
           +--------------------------------------+--------------------------------------+
                                                  |
                                                  v
                      +-------------------------------------------------------+
                      |         CENTRAL FLEET SERVER (Node.js Engine)         |
                      |  - Native SQLite Engine (fleet.db)                    |
                      |  - TCP Telemetry Hub (:2000)                          |
                      |  - HTTP REST API v1 (:9100)                           |
                      |  - WebSocket Live Broadcaster (:9100/api/v1/ws)       |
                      |  - Active Status & Pin Synchronizer (Every 5s)        |
                      |  - Central OTA & LittleFS Firmware Server             |
                      +-------------------------------------------------------+
                                                  |
                                                  v
                      +-------------------------------------------------------+
                      |       RESPONSIVE REAL-TIME WEB DASHBOARD (:9100)      |
                      |  - Home-Centric Navigation (Home -> Room -> Device)   |
                      |  - Live Pin Allocation & Relay Switching Matrix       |
                      |  - Node Hardware Inspector & Diagnostics Hub          |
                      |  - Multi-User Role & Permission Manager               |
                      |  - Central OTA Firmware & LittleFS Deployment Wizard  |
                      +-------------------------------------------------------+
```

---

## ✨ Key Features

### 1. Central Fleet Management Server
- **High-Throughput Node.js Core**: Written in modern CommonJS with native Node.js SQLite integration (`--experimental-sqlite`), eliminating heavy external database dependencies like PostgreSQL or MySQL for local deployments.
- **Bi-Directional Telemetry Engine**:
  - Ingests high-frequency sensor heartbeats and state transitions via raw TCP port `2000`.
  - Sends immediate reactive commands (`setState`, `toggle`, `pulse`, `reboot`, `syncPins`) downstream in real time.
- **Sub-Second Status Poller**: Automatically queries all fleet devices every 5 seconds to sync physical hardware pin states, memory heap metrics, Wi-Fi RSSI, and online/offline status.
- **Node Credentials Manager**: Supports per-node HTTP Basic and Bearer Authentication with a built-in connection & credential tester (`POST /api/v1/nodes/:nodeId/test-auth`).

### 2. Home-Centric Multi-Level RBAC
- **True Hierarchical Architecture**:
  $$\text{System} \longrightarrow \text{Home} \longrightarrow \text{Room} \longrightarrow \text{Node / Relays}$$
- **Role Hierarchy**:
  - **Super Admin**: Complete unrestricted global platform access.
  - **Home Owner**: Master management authority over an entire home, rooms, and devices.
  - **Home Admin**: Administrative control within assigned home.
  - **Family Member**: Standard operational access restricted to assigned rooms.
  - **Guest**: Highly restricted operational access limited to specific whitelist devices.
  - **Viewer**: Read-only monitoring access across assigned spaces.
- **Fine-Grained Device Permissions**: Direct `device_permissions` allow/deny rules that take precedence over inherited home/room roles.

### 3. Hardware Pin Safety & Expansion (PCF8574)
- **13-Pin Comprehensive NodeMCU Catalog**: Complete pin allocation matrix mapping physical labels (`D0`–`D8`, `RX`, `TX`, `SD2`, `SD3`) to GPIO numbers with strict hardware safety flags:
  - 🟢 **Safe GPIOs**: Boot-neutral pins ideal for relays (GPIO 4 / D2, GPIO 5 / D1, GPIO 12 / D6, GPIO 13 / D7, GPIO 14 / D5).
  - ⚠️ **Boot-Sensitive GPIOs**: Pins with pull-up/pull-down restrictions at boot (GPIO 0 / D3, GPIO 2 / D4, GPIO 15 / D8).
  - 🛑 **Reserved GPIOs**: Internal SPI flash pins (GPIO 9, GPIO 10) safeguarded against accidental assignment.
- **I2C PCF8574T 8-Channel Expansion**:
  - Bridges pins `100` through `107` over I2C (GPIO 0 / SDA, GPIO 2 / SCL on ESP-01).
  - Allows an ultra-compact 2-GPIO microcontroller to reliably drive an 8-channel relay board.
  - Full automatic detection and visual indicator in the web dashboard.

### 4. Edge Node Firmware & LittleFS
- **Power-Loss State Recovery**: Relays store their states in flash upon toggle, ensuring seamless restoration after a power outage without relay chatter.
- **Built-in Self-Contained Web Server**: Each node serves an internal emergency dashboard directly from LittleFS flash, enabling standalone operation if the central server is powered off.
- **IST NTP Clock Synchronization**: Synchronizes with Indian Standard Time (`UTC+05:30`) with microsecond resolution for scheduled timers.

### 5. Over-The-Air (OTA) & LittleFS Deployer
- **Zero-Cable Maintenance**: Push compiled `.bin` firmware and filesystem binaries across the LAN directly from the central dashboard.
- **1MB Flash Safety Guard**: Protects 1MB devices (ESP-01 / ESP-01S) against catastrophic flash over-allocation when attempting to push 4MB firmware builds.

---

## 💻 System Requirements

### Central Server Requirements

| Component | Minimum Specification | Recommended Specification |
| :--- | :--- | :--- |
| **Operating System** | Windows 10/11, Windows Server 2016+, Linux (Debian/Ubuntu/Alpine), macOS | Windows 11 or Ubuntu Server 22.04 LTS / 24.04 LTS |
| **Runtime** | Node.js v20.x or Node.js v24.x (with `--experimental-sqlite`) | Node.js v24.x LTS |
| **CPU** | 1 Core, 1.0 GHz x86_64 or ARM (Raspberry Pi 3+) | 2+ Cores x86_64 or ARM64 (Raspberry Pi 4/5) |
| **RAM** | 256 MB Available RAM | 512 MB+ Available RAM (Server process consumes ~165 MB) |
| **Disk Storage** | 200 MB Free Disk Space | 1 GB+ (to store firmware archives & telemetry history) |
| **Network** | Ethernet or 2.4/5GHz Wi-Fi with static IP / DHCP reservation | Gigabit Ethernet on primary LAN switch |

### Microcontroller & Hardware Requirements

| Hardware Component | Specifications | Role |
| :--- | :--- | :--- |
| **NodeMCU v2 / v3** | ESP8266 (ESP-12E or ESP-12F), 4MB SPI Flash, Micro-USB | Primary Room Multi-Relay Controller |
| **ESP-01 / ESP-01S** | ESP8266, 1MB SPI Flash, 2x4 2.54mm Header | Satellite Controller / Hidden Switchboard Node |
| **I2C Expander** | PCF8574 / PCF8574T I2C 8-Bit I/O Expander Board | Expands ESP-01 GPIO 0/2 into 8 Independent Relay Pins |
| **Relay Modules** | 1/2/4/8-Channel 5V or 3.3V Optocoupler-isolated Relays | AC Load Switching (Lights, Fans, Appliances) |
| **Power Supply** | 5V / 2A DC Regulated Power Supply | Powers ESP boards and relay coils |
| **Wi-Fi Network** | 802.11 b/g/n 2.4 GHz (WPA2-PSK) | Wireless communication bus |

### Developer Toolchain Requirements
- **VS Code** with [PlatformIO IDE Extension](https://platformio.org/)
- **C++ Compiler Toolchain**: Xtensa LX106 GCC (managed automatically by PlatformIO)
- **Git** version 2.30+

---

## 🚀 Deployment & Setup Guide

### Step 1: Central Server Deployment

#### Option A: Running on Windows (Quick Start)

1. Open PowerShell or Command Prompt.
2. Navigate to the server directory:
   ```powershell
   cd D:\ai\Homeautomation_server\central_server_js
   ```
3. Install dependencies:
   ```powershell
   npm install
   ```
4. Start the server with native SQLite support:
   ```powershell
   npm start
   # Or directly:
   node --experimental-sqlite server.js
   ```
5. Open your browser and navigate to:
   ```
   http://localhost:9100
   ```

#### Option B: Running as a Windows Background Service / Startup Daemon
You can run the server continuously in the background using `pm2` or a Windows Service wrapper:
```powershell
npm install -g pm2
pm2 start server.js --name "smarthome-server" --node-args="--experimental-sqlite"
pm2 save
pm2 startup
```

#### Option C: Running on Linux (Ubuntu / Debian / Raspberry Pi)
```bash
# 1. Install Node.js 20 or 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 2. Clone and enter directory
cd /opt/Homeautomation_server/central_server_js
npm install

# 3. Create systemd service
sudo nano /etc/systemd/system/smarthome.service
```
Paste the following systemd service unit:
```ini
[Unit]
Description=SmartHome Central Fleet Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/Homeautomation_server/central_server_js
ExecStart=/usr/bin/node --experimental-sqlite server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable smarthome
sudo systemctl start smarthome
```

---

### Step 2: Firmware Build & Flashing (PlatformIO)

#### Target 1: NodeMCU ESP8266 (4MB Flash)
1. Open the project folder in VS Code with PlatformIO.
2. Open `app2/src/config.h` and configure your credentials:
   ```cpp
   #define WIFI_SSID       "Your_Home_WiFi"
   #define WIFI_PASSWORD   "Your_WiFi_Password"
   #define CENTRAL_HOST    "192.168.1.100"  // IP of Central Server
   #define CENTRAL_PORT    2000             // TCP Telemetry Port
   ```
3. Connect the NodeMCU via Micro-USB.
4. Build and upload firmware:
   ```bash
   pio run -d app2 --target upload
   ```
5. Upload the web filesystem:
   ```bash
   pio run -d app2 --target uploadfs
   ```

#### Target 2: ESP-01 / ESP-01S + PCF8574T (1MB Flash)
1. Navigate to the `esp-01 pcf8574t` firmware directory.
2. Open `src/config.h` and set Wi-Fi and Central Server parameters.
3. Put the ESP-01 into bootloader mode (pull `GPIO 0` to `GND` during power-on).
4. Build and flash:
   ```bash
   pio run -d "esp-01 pcf8574t" --target upload
   pio run -d "esp-01 pcf8574t" --target uploadfs
   ```

---

### Step 3: First-Run Onboarding & Node Provisioning

1. **Log in to Central Dashboard**:
   - Access `http://<SERVER_IP>:9100`.
   - Default master credentials:
     - **Username**: `admin`
     - **Password**: `admin123` *(Change immediately upon first login!)*
2. **Setup Home & Rooms**:
   - Navigate to **Home Management**.
   - Create your primary home (e.g. `Primary Residence`).
   - Create your functional zones/rooms (e.g., `Master Bedroom`, `Living Room`, `Kitchen`).
3. **Discover & Assign Nodes**:
   - Devices powered on will auto-register into **Unassigned Nodes** or stream heartbeats over port `2000`.
   - Click **Node Settings** (`⚙️`) on the node card.
   - Assign the node to its Home and Room.
   - Enter matching node authentication credentials under **User ID & Password**.
   - Click **🧪 Test Connection & Authentication** to verify communication.
   - Click **💾 Save Settings**.
4. **Configure Relays & Pins**:
   - Click **Grab Pins from Node** (`🔄`) to import physical GPIO allocations directly from hardware.
   - Assign user-friendly labels (e.g., `Ceiling Light`, `Air Conditioner`).

---

## 📡 Telemetry & Communication Protocols

### TCP Raw Socket Telemetry (Port 2000)

Edge nodes stream real-time JSON packets over a persistent or event-driven TCP socket:

#### Node Heartbeat / State Ingestion Payload (Node ➔ Server)
```json
{
  "nodeId": "NODE-807D3A76657D",
  "nodeName": "ESP-01 Satellite",
  "version": "1.6.0",
  "event": "heartbeat",
  "epoch": 1795368000,
  "system": {
    "ip": "192.168.1.108",
    "mac": "80:7D:3A:76:65:7D",
    "rssi": -48,
    "uptime": 69200,
    "freeHeap": 24192,
    "hardware": "ESP8266 ESP-01 + PCF8574T (1MB)"
  },
  "states": [
    { "pin": 100, "label": "Relay 1", "state": 1 },
    { "pin": 101, "label": "Relay 2", "state": 0 }
  ]
}
```

#### Reactive Command Response (Server ➔ Node)
```json
{
  "commands": [
    { "action": "setState", "pin": 100, "state": 0 },
    { "action": "pulse", "pin": 101, "duration": 500 }
  ]
}
```

---

### RESTful Management API (Port 9100)

All administrative endpoints are namespaced under `/api/v1` and protected by Session Bearer tokens.

| Method | Endpoint | Description | Required Role / Permission |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Authenticate user & issue session token | Public |
| `GET` | `/api/v1/nodes` | Get all registered nodes & telemetry | `devices:view` |
| `GET` | `/api/v1/nodes/:nodeId` | Get detailed node hardware & pins | `devices:view` |
| `PUT` | `/api/v1/nodes/:nodeId/settings`| Update node metadata & credentials | `devices:manage` |
| `POST` | `/api/v1/nodes/:nodeId/test-auth`| Test live HTTP credentials against node | `devices:manage` |
| `POST` | `/api/v1/nodes/:nodeId/control` | Dispatch relay command (`setState`/`toggle`)| `devices:control` |
| `POST` | `/api/v1/nodes/:nodeId/sync-pins`| Grab active GPIO pins from hardware | `devices:manage` |
| `GET` | `/api/v1/homes` | List homes accessible to current user | User Session |
| `POST` | `/api/v1/homes` | Create a new home | `homes:create` |
| `GET` | `/api/v1/homes/:homeId/rooms` | List rooms inside home | Home Access |
| `POST` | `/api/v1/system/poll-now` | Trigger immediate fleet-wide status poll | `devices:control` |

---

### Real-Time WebSocket Stream

The dashboard connects to `ws://<SERVER_IP>:9100/api/v1/ws` for live synchronization. The server broadcasts state changes instantly:
- `node_status`: Node connects, disconnects, or reports fresh telemetry.
- `pin_update`: Physical or software relay toggles.
- `audit_event`: Administrative and security events logged in real time.

---

## 📊 Resource Consumption & Performance Benchmarks

*Live measurements collected on an active server running continuously for 19+ hours managing production nodes:*

```
========================================================================
 METRIC                        MEASURED VALUE          FOOTPRINT %
========================================================================
 Physical RAM (Working Set)    164.7 MB                0.51% (of 32 GB)
 Virtual Committed Memory      186.9 MB                Low
 Peak RAM Observed             195.9 MB                Low
 Active CPU Utilization        0.0% to 0.4%            Negligible
 Active Server Threads         12 Threads              libuv + V8
 Open OS Handles               275 Handles             Sockets & DB locks
 Embedded Database (fleet.db)  28.4 MB                 Zero maintenance
 Relay Actuation Latency       < 45 ms                 LAN roundtrip
========================================================================
```

---

## 📁 Repository Directory Structure

```
Homeautomation_server/
├── central_server_js/              # Central Fleet Server (Node.js + SQLite)
│   ├── data/                       # Database storage & firmware binaries
│   │   ├── fleet.db                # SQLite database (Nodes, RBAC, Telemetry)
│   │   └── firmware/               # OTA binary repository
│   ├── public/                     # High-performance web dashboard
│   │   ├── assets/                 # Vanilla JS app (app.js) & CSS styling
│   │   └── index.html              # Single Page Application entrypoint
│   ├── src/                        # Server source code
│   │   ├── auth.js                 # Multi-tier RBAC authentication middleware
│   │   ├── database.js             # SQLite abstraction & schema manager
│   │   ├── nodeManager.js          # Polling engine, TCP hub, & WebSocket manager
│   │   ├── otaService.js           # OTA flash engine with 1MB flash guard
│   │   └── routes/                 # Express REST API v1 routers
│   ├── server.js                   # Main application entry point
│   └── package.json                # Server manifest & dependencies
│
├── app2/                           # NodeMCU ESP8266 4MB Firmware (PlatformIO)
│   ├── data/                       # LittleFS web UI assets
│   ├── src/                        # C++ core (GPIO persistence, NTP, TCP client)
│   └── platformio.ini              # Build environment for NodeMCU 4MB
│
├── esp-01 pcf8574t/                # ESP-01 1MB + PCF8574 Expander Firmware
│   ├── src/                        # I2C expander driver & memory-optimized client
│   └── platformio.ini              # Build environment for ESP-01 1MB
│
├── docs/                           # Technical documentation & architecture specs
│   ├── TODO.md                     # Roadmap, expansion logs, & completed tasks
│   └── api/                        # Detailed API references
│
├── LICENSE                         # MIT License
└── README.md                       # Master Project Documentation
```

---

## 🔒 Security Architecture

1. **Isolated LAN Operation**: No outward-facing ports required. The entire fleet operates behind your router's firewall.
2. **Per-Node Authentication**: Central server validates node identity via unique MAC hashes and optional HTTP Basic/Bearer tokens. Unauthorized devices cannot control relays.
3. **Cryptographic Password Hashing**: Server user passwords are encrypted using secure salted PBKDF2 hashes stored in SQLite.
4. **Session Token Expiry**: Frontend interactions are authenticated via expiring Bearer session tokens with IP binding and user agent verification.
5. **Strict Scope Validation**: Every API call traverses the RBAC engine, verifying that the requesting user possesses valid permissions for the targeted home, room, and device.

---

## 📄 License

This project is open-source software licensed under the **[MIT License](LICENSE)**. You are free to inspect, modify, and deploy this software in personal or commercial environments.
