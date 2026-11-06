# CROSS-DEVICE GAP ANALYSIS & COMPATIBILITY AUDIT

**Audit Date**: 2026-11-07  
**Scope**: Inconsistencies, Discrepancies, and Functional Gaps Across Devices & Central Server  

---

## 1. Architectural Discrepancy Matrix

| Feature Domain | Device 01 (ESP8266 4MB) | Device 02 (ESP32) | Device 03 (ESP-01 1MB) | Compatibility Impact / Risk |
|---|---|---|---|---|
| **Codebase Availability** | **Fully Implemented** (`esp8266_4mb`) | **ABSENT FROM REPO** | **Fully Implemented** (`esp01_1mb`) | Severe: ESP32 exists only as a conceptual expectation. |
| **Relay Channel Limit** | Up to 8 channels | Up to 16 channels (Target) | Fixed at 2–4 channels | Central Server must handle variable channel counts per node dynamically. |
| **Memory Allocation** | Dynamic `std::vector` | FreeRTOS heap (Target) | Fixed static array `_channels[4]` | Static array on ESP-01 prevents heap fragmentation. |
| **Web UI Serving** | LittleFS Filesystem with PROGMEM fallback | LittleFS Filesystem (Target) | **Strictly PROGMEM Gzip** | Uploading web files to ESP-01 LittleFS is unsupported and unnecessary. |
| **Automation Rules** | Local NTP + Daily Cron + Timers | FreeRTOS tasks (Target) | **Completely Offloaded to Server** | ESP-01 cannot execute local cron without Central Server. |
| **Password Crypto** | Soft SHA-256 (64 rounds) | Hardware SHA-256 (Target) | **Plaintext String Match** | ESP-01 stripped SHA-256 table to conserve 4 KB flash code space. |
| **Reset Recovery Pin** | Pin D3 (GPIO0) held for 5s | GPIO 0 Boot Button (Target) | **Explicitly Disabled (`PIN 255`)** | Essential: prevents relay actuation on GPIO 0 from resetting ESP-01. |
| **Filesystem APIs** | `/api/fs/*` (list, upload, delete) | `/api/fs/*` (Target) | **Stripped from WebServer** | LittleFS explorer in server dashboard fails with 404 on ESP-01. |

---

## 2. Inconsistencies & Protocol Gaps Between Devices & Server

### Gap 1: Configuration Sync Command Mismatch (`syncConfig`)
- **Server Implementation**: In [`configSyncService.js: line 140`](file:///d:/ai/Homeautomation_server/central_server_js/src/configSyncService.js#L140), the server sends:
  ```json
  { "action": "syncConfig", "version": 3, "config": { ... } }
  ```
  to `POST /api/commands/execute`.
- **Firmware Implementation**: In [`esp8266_4mb/src/web_server.cpp: handleCommand()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L310-L338), the supported actions are strictly:
  - `reboot`
  - `setState` / `set`
  - `toggle`
  - `pulse`
  - `readInfo`
- **Result**: Pushing a full configuration from the Central Server's "Config & Sync" view fails with HTTP 400: `{"success":false,"error":"Unknown command action"}`!
- **Correction Required**: Firmware `handleCommand()` must add an `action.equalsIgnoreCase("syncConfig")` handler, or Central Server must push config updates to `/api/gpio/save`.

### Gap 2: Plaintext Password Exposure in Flash
- **Evidence**: [`esp8266_4mb/src/auth_manager.cpp: line 122`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/auth_manager.cpp#L122) writes `doc["adminPass"] = _adminPass;` directly into `/config/system.json`.
- **Impact**: Any attacker who accesses `/api/fs/download?path=/config/system.json` or extracts flash memory obtains the raw administrative password in cleartext.
- **Correction Required**: Remove `adminPass` from storage serialization; store only the SHA-256 hash `adminPassHash`.

### Gap 3: Central Server Auto-Login Hardcoded Credentials
- **Evidence**: [`central_server_js/public/assets/app.js: line 37`](file:///d:/ai/Homeautomation_server/central_server_js/public/assets/app.js#L37) automatically falls back to:
  ```javascript
  body: JSON.stringify({ username: 'admin', password: 'admin123' })
  ```
- **Impact**: If an administrator changes their password on the server, any browser receiving a 401 will repeatedly attempt and fail to log in with the hardcoded default `admin123`, spamming authentication audit logs.

### Gap 4: Microcontroller Trusted IP Authentication Bypass
- **Evidence**: In [`esp8266_4mb/src/web_server.cpp: lines 125-130`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L125-L130):
  ```cpp
  if (rcfg.enabled && rcfg.serverHost.length() > 0) {
      String clientIp = _server.client().remoteIP().toString();
      if (clientIp == rcfg.serverHost) {
          return true; // Bypass authentication
      }
  }
  ```
- **Impact**: Any machine on the LAN that acquires or spoofs the IP address matching `serverHost` is granted full administrative access to all microcontroller REST endpoints without entering a password or session token.
- **Correction Required**: Require HMAC or Bearer `authToken` validation rather than relying on IP source addresses.
