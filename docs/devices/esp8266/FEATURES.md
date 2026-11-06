# DEVICE 01 FEATURES BREAKDOWN: ESP8266 / NODEMCU (4MB)

**Device**: ESP8266 4MB Flash  
**Audit Source**: Complete inspection of `esp8266_4mb/src/`  

---

## 1. Complete Feature Inventory & Implementation Verification

### F-ESP-01: Hardware Node ID Generation
- **Status**: **IMPLEMENTED**
- **Location**: [`ReceiverClient::getHardwareNodeId()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp#L32-L37)
- **Mechanism**: Extracts hardware MAC address directly from ESP8266 OTP eFuse via `WiFi.macAddress()`, strips colons, converts to uppercase, and prefixes with `NODE-` (e.g. `NODE-BCDDC223386C`).
- **Behavior**: Ensures each node possesses a globally unique, collision-free identity that persists even across factory resets and firmware reflashing.

### F-ESP-02: Multi-Channel GPIO Switching & Pulsing
- **Status**: **IMPLEMENTED**
- **Location**: [`GpioManager::setState()`, `toggle()`, `pulse()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp#L140-L196)
- **Mechanism**: Directly manipulates ESP8266 GPIO output registers.
  - `setState(id, state)`: Sets boolean logical state.
  - `toggle(id)`: Inverts current logical state.
  - `pulse(id, durationMs)`: Activates channel, records `pulseEndTime = millis() + durationMs`, and restores original state when `GpioManager::loop()` detects expiry. Non-blocking; does not hang the event loop.

### F-ESP-03: Relay State Persistence & Power-Outage Restoration
- **Status**: **IMPLEMENTED**
- **Location**: [`GpioManager::begin()`, `saveToStorage()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp#L48-L135)
- **Mechanism**: Serializes channel states to LittleFS `/config/gpio.json`. On boot, checks `initialMode`. If set to `0` (`INITIAL_MODE_RESTORE_LAST`), restores saved boolean state.
- **Wear-Leveling Protection**: Writes only when states change; LittleFS uses dynamic wear-leveling across 2MB partition.

### F-ESP-04: Dual-Protocol Fleet Telemetry Client
- **Status**: **IMPLEMENTED**
- **Location**: [`ReceiverClient::startAsyncPush()`, `sendHttp()`, `sendTcpSync()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp)
- **Mechanism**:
  - **Raw TCP Socket (Port 2000)**: Non-blocking state machine streams structured JSON directly to the socket, prints newline delimiter, and reads server response line within 1500ms.
  - **HTTP POST (Port 9100)**: Uses `ESP8266HTTPClient` to POST JSON to `/api/node/telemetry`.
  - Supports configurable report interval (default 10s) and instant event-driven push on relay state change with 400ms debounce.

### F-ESP-05: Remote Command Execution & Application ACKs
- **Status**: **IMPLEMENTED**
- **Location**: [`ReceiverClient::processServerCommands()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp#L367-L416)
- **Mechanism**: Parses response JSON from Central Server. Dispatches commands:
  - `setState`: updates relay state.
  - `toggle`: toggles relay state.
  - `pulse`: triggers temporary relay actuation.
  - `reboot`: initiates restart after 500ms.
  Records command UUID in `_pendingAcks[MAX_PENDING_ACKS]` with execution success status, which is piggybacked onto the next telemetry payload sent to the server.

### F-ESP-06: Autonomous Rules Engine
- **Status**: **IMPLEMENTED**
- **Location**: [`AutomationEngine::loop()`, `notifyGpioStateChanged()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/automation.cpp)
- **Mechanism**:
  - `RULE_TIMER_AUTO_OFF`: Starts non-blocking countdown when a relay turns ON. When expired, turns relay OFF automatically (e.g. bathroom exhaust fan 15m timer).
  - `RULE_INTERLOCK`: When source relay matches condition state, forces target relay to target state (e.g. mutual exclusion for motorized blinds / gate opener).
  - `RULE_DAILY_SCHEDULE`: Synchronizes with NTP time and triggers relay action at specified minute-of-day (`param1 = currentHour * 60 + currentMin`).

### F-ESP-07: Dual-Tier Web Dashboard
- **Status**: **IMPLEMENTED**
- **Location**: [`WebServerManager::serveEmbeddedDashboard()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L38-L45) & [`dashboard_html.h`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/dashboard_html.h)
- **Mechanism**:
  - Primary UI: High-functionality dark-mode SPA served from LittleFS (`/index.html`, `/app.js`, `/style.css`).
  - Fallback UI: If LittleFS is unformatted, empty, or corrupted, the server serves a compressed HTML dashboard embedded in flash PROGMEM, guaranteeing that device setup and Wi-Fi configuration remain accessible.

### F-ESP-08: Captive Portal & SoftAP Wi-Fi Provisioning
- **Status**: **IMPLEMENTED**
- **Location**: [`WifiManager::setupAP()`, `WebServerManager::registerCaptiveRoutes()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/wifi_manager.cpp)
- **Mechanism**: Operates SoftAP on `192.168.4.1` with DNS server on port 53. All DNS requests resolve to `192.168.4.1`. Captive portal detection routes (`/generate_204`, `/hotspot-detect.html`, `/ncsi.txt`) return HTTP 302 redirects to `http://192.168.4.1/index.html`.

### F-ESP-09: Over-The-Air (OTA) Updates
- **Status**: **IMPLEMENTED**
- **Location**: [`OtaManager`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/ota_manager.cpp), [`WebServerManager::handleOtaUpload()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L1026-L1044)
- **Mechanism**:
  - ArduinoOTA listener on port 8266 for PlatformIO network flashing.
  - Web multipart firmware binary upload to `/api/ota/upload` with `Update.begin()`, `Update.write()`, and `Update.end(true)`.

### F-ESP-10: LittleFS Remote File Management
- **Status**: **IMPLEMENTED**
- **Location**: [`WebServerManager`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L1187-L1338)
- **Mechanism**: REST APIs allow listing files (`/api/fs/list`), uploading files (`/api/fs/upload`), downloading files (`/api/fs/download`), deleting files (`/api/fs/delete`), and renaming files (`/api/fs/rename`).

### F-ESP-11: Authentication & Security Lockout
- **Status**: **IMPLEMENTED**
- **Location**: [`AuthManager`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/auth_manager.cpp)
- **Mechanism**: Computes SHA-256 password hash. Issues 32-character random hexadecimal session tokens. Enforces 10-second temporary lockout after 5 consecutive failed login attempts. Supports Basic Auth fallback.
