# smartHomeEsp 🏠⚡

**ESP8266 Multi-Channel Smart Home Controller & Central Telemetry Fleet Node**

[![Firmware Version](https://img.shields.io/badge/firmware-v1.6.0-blue.svg)](https://github.com/tusarr10/smartHomeEsp)
[![ESP8266](https://img.shields.io/badge/platform-ESP8266-orange.svg)](https://www.espressif.com/en/products/socs/esp8266)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An enterprise-ready, reliable, and responsive IoT smart home relay controller powered by NodeMCU / ESP8266 with LittleFS storage, real-time web dashboard, automation schedules, and a multi-node Central Telemetry Receiver engine.

---

## 🌟 Key Features

### 1. Multi-Channel GPIO Relay Control
- Real-time switching, pulse mode, and inverted logic support.
- **Power-Loss State Persistence**: Automatically stores GPIO state transitions to LittleFS flash (with smart write-cycling protection), restoring exact pin states after unexpected power outages or reboots.

### 2. Central Receiver & Fleet Telemetry Engine (v1.6.0)
- Connect multiple distributed nodes to a single central monitoring & control server (e.g. `192.168.1.10:2000`).
- **Dual Protocols**:
  - **HTTP/REST (POST)**: Reports structured JSON payload to central endpoints.
  - **Raw TCP Socket**: Persistent or on-demand socket streaming for high-speed industrial telemetry hubs.
- **Bi-Directional Command Execution**: Node executes remote JSON commands (`setState`, `toggle`, `pulse`, `reboot`) received in server responses.
- **Smart Event Triggers**: Debounced real-time push on any relay state change + configurable heartbeat intervals (5s to 300s).
- **Security**: Node identification via unique MAC-based node IDs (`NODE-XXXXXXXXXXXX`) and bearer `authToken`.

### 3. Comprehensive Dynamic Diagnostics & System Info
- Hardware & software reset reason decoder (`ESP.getResetReason()`).
- LittleFS filesystem breakdown (Total, Used, Free in KB & percentage).
- Real-time RAM heap tracking (Current Free Heap & Minimum Historic Heap).
- Wi-Fi signal diagnostics (SSID, RSSI dBm, Link Quality %, IP, Gateway, Subnet, DNS, MAC).
- System uptime and permanent restart boot counter.

### 4. Advanced Networking & Time Sync
- Dual Wi-Fi modes: Dynamic DHCP client or Static IP manual configuration.
- Indian Standard Time (IST UTC+05:30) NTP synchronization with automatic DST and local POSIX timezone handling.

### 5. Responsive Web UI & Live Dashboard
- Modern dark-mode dashboard built with pure HTML5, CSS3, and vanilla JavaScript (no external CDN dependencies required for offline LAN operation).
- Built-in Over-The-Air (OTA) firmware and filesystem update portal.

---

## 📁 Repository Structure

```
smartHomeEsp/
├── app2/
│   ├── data/                 # LittleFS filesystem assets
│   │   ├── index.html        # Responsive Single Page Application UI
│   │   ├── style.css         # Modern Dark Theme Stylesheet
│   │   └── app.js            # Dashboard logic & API handlers
│   ├── src/
│   │   ├── main.cpp          # System bootstrap & main loop
│   │   ├── config.h          # Global configuration & pins
│   │   ├── receiver_client.h # Central Receiver Telemetry Client
│   │   ├── receiver_client.cpp
│   │   ├── gpio_manager.h    # Relay state management & LittleFS persistence
│   │   ├── gpio_manager.cpp
│   │   ├── wifi_manager.h    # Wi-Fi DHCP/Static management
│   │   ├── wifi_manager.cpp
│   │   ├── web_server.h      # REST API & WebSockets
│   │   └── web_server.cpp
│   └── platformio.ini        # PlatformIO build configuration
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
- [VS Code](https://code.visualstudio.com/) with the [PlatformIO IDE extension](https://platformio.org/)
- NodeMCU ESP8266 (ESP-12E / ESP-12F) or compatible board
- Micro-USB cable

### Building & Flashing

1. **Clone the repository:**
   ```bash
   git clone https://github.com/tusarr10/smartHomeEsp.git
   cd smartHomeEsp/app2
   ```

2. **Build and Upload Firmware:**
   ```bash
   pio run --target upload
   ```

3. **Build and Upload Web Filesystem (LittleFS):**
   ```bash
   pio run --target uploadfs
   ```

4. **Access the Dashboard:**
   - Connect to the ESP8266's IP address in your browser (e.g. `http://192.168.1.105`).

---

## 📡 Central Receiver API Spec

When the node connects to your central receiver server, it sends telemetry payloads in the following format:

```json
{
  "nodeId": "NODE-BCDDC223386C",
  "nodeName": "ESP-SmartHome-01",
  "version": "1.6.0",
  "event": "heartbeat",
  "timestamp": "2026-10-31 01:45:00",
  "epoch": 1793400900,
  "system": {
    "ip": "192.168.1.105",
    "mac": "BC:DD:C2:23:38:6C",
    "rssi": -52,
    "uptime": 12480,
    "freeHeap": 26840
  },
  "states": [
    { "pin": 5,  "label": "Living Room Light", "state": 1 },
    { "pin": 4,  "label": "Ceiling Fan",       "state": 0 },
    { "pin": 14, "label": "Air Conditioner",   "state": 1 },
    { "pin": 12, "label": "Balcony Lamp",      "state": 0 }
  ]
}
```

The Central Server can respond with commands in JSON:
```json
{
  "commands": [
    { "action": "setState", "pin": 5, "state": 0 },
    { "action": "pulse", "pin": 4, "duration": 500 }
  ]
}
```

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
