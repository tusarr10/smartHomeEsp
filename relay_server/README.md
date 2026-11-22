# SmartHome Relay Gateway & Fallback Server (MTK Edition)

Ultra-lightweight edge relay, proxy, and user dashboard specifically engineered to run efficiently on embedded routers and single-board computers (such as **MediaTek MTK 830 / MT7621** or similar with **512 MB RAM**).

---

## 🌟 Key Features

1. **Intelligent Store-and-Forward Proxy:**
   - **When Central Server is ONLINE:** Seamlessly receives node telemetry and forwards it to your Main Central Server (`central_server_js`). Commands issued from the Central Server are delivered back to your ESP nodes.
   - **When Central Server is OFFLINE:** Automatically enters **Standalone Fallback Mode**. The relay server continues operating 24/7, serving the user dashboard and switching relays without interruption.

2. **Ultra-Low Memory Footprint (MTK 512MB RAM Optimized):**
   - Built entirely on **pure Node.js standard libraries** (`node:http`, `node:net`, `node:fs`, `node:path`).
   - **Zero C-compiler / native binary dependencies** (no `node-gyp`, no `gcc` required on OpenWrt).
   - Runs smoothly with only **~20 MB to 35 MB of RAM** (`--max-old-space-size=64`).

3. **Dedicated User Interface:**
   - **Switches & Relays:** Fast one-tap toggles for ESP8266 / PCF8574 channels.
   - **Exact Circuit Breaker Dashboard:** Full monitoring matching the central server: Mains Voltage, Current, Active Power, Frequency, Internal Temperature, Earth Leakage Current, and the Main Contact Breaker Switch (DP 108).
   - **Sensors Grid:** Real-time sensor readings and telemetry metrics.
   - **Edge Automations:** Simple, robust IF-THEN rules that execute locally even when the Central Server PC is powered off.

4. **Dual Telemetry Ingestion:**
   - **TCP Port 2000:** High-speed raw newline-delimited JSON stream matching the `app2` ESP8266 firmware.
   - **HTTP Port 9200:** REST endpoint (`/api/telemetry`).

---

## 🏗️ Architecture

```
                                  +-----------------------------+
                                  | Central Server (Main PC)    |
                                  | (Full Fleet, Admin, Logs)   |
                                  +--------------^--------------+
                                                 | HTTP Proxy Sync
                                                 | (when online)
+-----------------------+         +--------------v--------------+         +--------------------------+
|  ESP8266 Fleet Nodes  |         |   SmartHome Relay Gateway   |         | User Mobile / Browser    |
|  (app2 C++ Firmware)  +-------->|      (MTK 830 / 512MB)      |<------->| (Responsive Dashboard)   |
+-----------------------+  TCP    +--------------^--------------+   SSE   +--------------------------+
                          :2000                  |
                                                 | LAN Polling (:8085 / LAN)
                                  +--------------v--------------+
                                  | Wi-Fi Smart Circuit Breaker |
                                  | (Voltage, Current, Leakage) |
                                  +-----------------------------+
```

---

## 🚀 Quick Start

### 1. Configuration (`config.json`)
Check `config.json` before starting:
```json
{
  "server_name": "SmartHome Relay Gateway",
  "bind_host": "0.0.0.0",
  "http_port": 9200,
  "tcp_port": 2000,
  "central_server": {
    "enabled": true,
    "url": "http://192.168.1.100:9100",
    "health_check_interval_sec": 5
  },
  "breaker": {
    "enabled": true,
    "portal_url": "http://127.0.0.1:8085",
    "direct_ip": "192.168.1.164"
  }
}
```

### 2. Running on Windows (for testing)
Double-click `run.bat` or run:
```cmd
node --max-old-space-size=64 server.js
```
Open your browser at: `http://localhost:9200`

### 3. Deploying to MediaTek Router (OpenWrt / Linux)
1. Install Node.js on the router:
   ```sh
   opkg update
   opkg install node
   ```
2. Copy the `relay_server/` folder to `/root/relay_server/` or `/opt/relay_server/`.
3. Make the runner executable and start:
   ```sh
   chmod +x run.sh
   ./run.sh
   ```

### 4. Running as a Procd Service on OpenWrt (Auto-start on boot)
Create `/etc/init.d/relay-gateway`:
```sh
#!/bin/sh /etc/rc.common
START=99
USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command /usr/bin/node --max-old-space-size=64 /root/relay_server/server.js
    procd_set_param respawn
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}
```
Enable and start the service:
```sh
chmod +x /etc/init.d/relay-gateway
/etc/init.d/relay-gateway enable
/etc/init.d/relay-gateway start
```

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/telemetry` | `POST` | Ingests node telemetry & replies with queued commands |
| `/api/events` | `GET` | Live Server-Sent Events (SSE) stream for real-time dashboard |
| `/api/nodes` | `GET` | Returns list of registered nodes and channel states |
| `/api/nodes/:nodeId/channels/:chId/set` | `POST` | Toggles relay switch ON/OFF (`{"state": true}`) |
| `/api/breaker` | `GET` | Returns circuit breaker registers (V, A, W, kWh, temp, etc.) |
| `/api/breaker/switch` | `POST` | Trips or closes main breaker contact (`{"state": true}`) |
| `/api/automations` | `GET/POST` | Manages local edge rules |
| `/api/status` | `GET` | Gateway memory stats, uptime, and Central link status |
