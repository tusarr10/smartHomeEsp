# ECOSYSTEM DEVELOPMENT GUIDE

**Scope**: Developer Environment Setup, Local Emulation, and Coding Standards  

---

## 1. Prerequisites & Tooling

To develop across the Smart Home Ecosystem, install:
1. **VS Code** with:
   - [PlatformIO IDE Extension](https://platformio.org/)
   - C/C++ Extension (Microsoft)
2. **Node.js**: Version 20.x or 22.x LTS (Must support `node:sqlite`).
3. **Python 3.10+**: For empirical test scripts in `doc/` and `stress_test/`.
4. **Hardware Tools**:
   - NodeMCU ESP8266 v2 (ESP-12E/F) board.
   - ESP8266 ESP-01 / ESP-01S with USB-UART programming adapter.
   - Micro-USB data cable (ensure it has data lines, not charge-only).

---

## 2. Setting Up Central Server

```powershell
# 1. Navigate to central server directory
cd d:\ai\Homeautomation_server\central_server_js

# 2. Install dependencies (express, cors, multer, ws)
npm install

# 3. Launch server in development mode
npm run dev
# Or run with node watch:
node --experimental-sqlite --watch server.js
```
The server will start on `http://localhost:9100` and listen for TCP telemetry on port `2000`.

---

## 3. Developing Firmware

1. Open `d:\ai\Homeautomation_server` in VS Code with PlatformIO.
2. Select target project folder (`esp8266_4mb` or `esp01_1mb`).
3. Compile using PlatformIO toolbar or CLI:
   ```powershell
   pio run -d esp8266_4mb
   ```
4. Upload firmware:
   ```powershell
   pio run -d esp8266_4mb --target upload
   ```
5. Upload LittleFS filesystem (for `esp8266_4mb`):
   ```powershell
   pio run -d esp8266_4mb --target uploadfs
   ```
