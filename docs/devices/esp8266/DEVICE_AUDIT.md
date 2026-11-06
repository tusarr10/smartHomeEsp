# DEVICE 01 FORENSIC AUDIT: ESP8266 / NODEMCU (4MB)

**Audit Target**: `esp8266_4mb`  
**SoC / Board**: ESP8266EX / NodeMCU v2 (ESP-12E / ESP-12F Module)  
**Flash Geometry**: 4MB Flash / 2MB LittleFS Partition (`eagle.flash.4m2m.ld`)  
**Firmware Version**: `1.6.0`  

---

## 1. Discovered Firmware Capabilities

Below is the verified inventory of capabilities discovered in [`esp8266_4mb/src/`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src):

| Feature Category | Implemented Capabilities | Implementation Status | Primary Source File |
|---|---|---|---|
| **Boot & Setup** | Factory reset button hold detection (5s), onboard LED status blinks, subsystem init order. | **IMPLEMENTED** | [`main.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/main.cpp) |
| **Wi-Fi Connectivity** | Dual Station & SoftAP mode, DHCP client, static IP override, Captive Portal DNS. | **IMPLEMENTED** | [`wifi_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/wifi_manager.cpp) |
| **GPIO Relay Engine** | Up to 8 channels, active-low/high inversion, state toggle, pulse timing (non-blocking). | **IMPLEMENTED** | [`gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp) |
| **State Persistence** | Power-loss state restoration across reboots, JSON serialization in LittleFS. | **IMPLEMENTED** | [`storage_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/storage_manager.cpp) |
| **Local Automation** | NTP synchronization (IST UTC+5:30), daily cron schedules, auto-off timers, interlocks. | **IMPLEMENTED** | [`automation.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/automation.cpp) |
| **Central Telemetry** | Outbound raw TCP stream (port 2000) and HTTP POST telemetry, debounced state change push. | **IMPLEMENTED** | [`receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp) |
| **Command Execution** | Remote commands (`setState`, `toggle`, `pulse`, `reboot`) with application-level UUID ACKs. | **IMPLEMENTED** | [`receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp#L367-L416) |
| **Embedded Web Server**| 35+ REST API routes on port 80, Captive Portal redirection, CORS, Basic & Token auth. | **IMPLEMENTED** | [`web_server.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp) |
| **Web Dashboard** | Dark-mode HTML5/JS/CSS SPA served from LittleFS with PROGMEM fallback if missing. | **IMPLEMENTED** | [`dashboard_html.h`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/dashboard_html.h) & `data/` |
| **OTA Updates** | Web browser multipart binary flashing (`/api/ota/upload`) + background ArduinoOTA port 8266. | **IMPLEMENTED** | [`ota_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/ota_manager.cpp) |
| **LittleFS Management**| Remote filesystem explorer (`/api/fs/list`, `upload`, `download`, `delete`, `rename`). | **IMPLEMENTED** | [`web_server.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L1187-L1325) |
| **Diagnostics & Health**| Real-time free heap, min free heap, max alloc block, fragmentation %, RSSI, reset reasons. | **IMPLEMENTED** | [`web_server.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L165-L283) |
| **Authentication** | SHA-256 password hashing, bearer session tokens, 5-attempt brute-force lockout. | **IMPLEMENTED** | [`auth_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/auth_manager.cpp) |
| **MQTT Client** | External MQTT broker client. | **NOT IMPLEMENTED** | Absent from codebase |
| **Shift Register 74HC595**| Serial-to-parallel shift register relay multiplexing. | **NOT IMPLEMENTED** | Absent; direct GPIO used |
| **Deep Sleep Mode** | Hardware timer sleep / wake cycle. | **NOT IMPLEMENTED** | ESP8266 operates continuously |

---

## 2. In-Depth Feature Audit Specifications

### Audit 1: Outbound Asynchronous TCP Telemetry Engine
1. **Feature Name**: Asynchronous TCP Socket Telemetry & Command Client
2. **Purpose**: Streams periodic node health and real-time relay state transitions to the Central Fleet Receiver (`port 2000`) without blocking the ESP8266 web server or main event loop.
3. **Actual Behavior**: Runs a 3-state non-blocking state machine (`RC_STATE_IDLE` $\rightarrow$ `RC_STATE_SENDING` $\rightarrow$ `RC_STATE_AWAITING_REPLY`). Connects outbound to `serverHost:serverPort`. Directly serializes telemetry JSON into the socket without intermediate heap string buffering. Waits up to 1500ms for incoming newline-delimited command JSON, executes received commands, queues command ACKs, and closes the socket.
4. **Internal Design**: Implemented in [`ReceiverClient::loop()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp#L49-L139). Uses non-blocking socket reads and `_rxBuf[256]` on the stack.
5. **Startup Dependencies**: Requires `StorageManager::begin()`, `WifiManager::begin()`, and an active Wi-Fi Station connection (`WiFi.status() == WL_CONNECTED`).
6. **Hardware Dependencies**: ESP8266 lwIP TCP/IP stack (`PIO_FRAMEWORK_ARDUINO_LWIP2_LOW_MEMORY`).
7. **GPIO Mapping**: Triggers immediately on any GPIO pin state change registered in `GpioManager`.
8. **Classes / Functions**: `ReceiverClient::getInstance()`, `startAsyncPush()`, `finishAsyncPush()`, `fillTelemetryDoc()`, `processServerCommands()`.
9. **Source Files**: [`esp8266_4mb/src/receiver_client.h`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.h), [`esp8266_4mb/src/receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp).
10. **Configuration Variables**: Stored in `/config/receiver.json`: `enabled` (bool), `serverHost` (string), `serverPort` (uint16), `protocol` (0=HTTP, 1=TCP), `reportIntervalSec` (uint32, default 10s), `sendOnStateChange` (bool, default true), `nodeId` (string), `authToken` (string).
11. **Communication Interfaces**: Outbound TCP Socket to port 2000 or HTTP POST to `/api/node/telemetry`.
12. **Input / Output Data**:
    - Output: JSON telemetry payload (`nodeId`, `nodeName`, `eventType`, `epoch`, `uptimeSec`, `freeHeap`, `rssi`, `channels`, `acks`).
    - Input: JSON command payload (`commands: [{ action, id, state, duration, command_uuid }]`).
13. **Persistence**: Settings persisted to LittleFS. Node ID derived from MAC address OTP eFuse (`NODE-XXXXXXXXXXXX`) if not explicitly overridden.
14. **Error Handling**: 1500ms reply timeout; increments `_packetsFailed`; aborts socket cleanly with `_tcpClient.stop(10)` to prevent TCP orphan socket exhaustion.
15. **Security Considerations**: Transmits plaintext JSON over LAN; supports optional bearer `token` field.
16. **Testing Status**: Empirically stress-tested on hardware at `192.168.1.105`. 100% memory reclamation verified with 0 socket memory leaks.
17. **Known Limitations**: Does not support TLS/SSL due to ESP8266 RAM constraints (~25KB free heap vs ~45KB required for BearSSL TLS buffers).

---

### Audit 2: Power-Loss State Persistence & GPIO Relay Actuator
1. **Feature Name**: Non-Volatile Relay State Engine
2. **Purpose**: Actuates physical relays via GPIO pins and ensures that if power is cut unexpectedly, relays return to their exact pre-outage state upon boot.
3. **Actual Behavior**: On boot, reads `/config/gpio.json`. For each configured channel, evaluates `initialMode`:
   - `0` (`INITIAL_MODE_RESTORE_LAST`): Restores the saved `state` boolean from flash.
   - `1` (`INITIAL_MODE_OFF`): Forces relay OFF regardless of prior state.
   - `2` (`INITIAL_MODE_ON`): Forces relay ON regardless of prior state.
   Applies inverted active-low logic before driving `pinMode(pin, OUTPUT)`. Whenever any relay state transitions, the updated state is flushed to LittleFS.
4. **Internal Design**: Implemented in [`GpioManager`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp). Maintains `std::vector<GpioChannel> _channels`.
5. **Startup Dependencies**: Initialized after `StorageManager::begin()` in `main.cpp` line 74.
6. **Hardware Dependencies**: Physical relay coils connected to NodeMCU GPIO pins via optocouplers or transistor driver circuits.
7. **GPIO Mapping**: Validated against `PIN_SAFETY_MAP[]` in [`config.h`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/config.h#L76-L86):
   - Safe Pins: D1 (GPIO5), D2 (GPIO4), D5 (GPIO14), D6 (GPIO12), D7 (GPIO13).
   - Boot Sensitive Pins: D0 (GPIO16), D3 (GPIO0), D4 (GPIO2), D8 (GPIO15).
8. **Classes / Functions**: `GpioManager::begin()`, `setState()`, `toggle()`, `pulse()`, `applyPhysicalPin()`, `saveToStorage()`.
9. **Source Files**: [`esp8266_4mb/src/gpio_manager.h`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.h), [`esp8266_4mb/src/gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp).
10. **Configuration Variables**: Stored in `/config/gpio.json` as an array of channel objects (`id`, `pin`, `name`, `room`, `function`, `activeLow`, `initialMode`, `enabled`, `state`).
11. **Communication Interfaces**: Interfaced via REST API (`/api/gpio/*`), remote commands from Central Server, and internal automation rules.
12. **Input / Output Data**: Input boolean desired state or pulse duration; output electrical HIGH/LOW voltage on GPIO pins.
13. **Persistence**: Writes `/config/gpio.json` on every state change.
14. **Error Handling**: Invalid pin assignment rejected (`isPinSafe()` check); duplicate pin assignment blocked (`isPinAssigned()` check).
15. **Security Considerations**: Boot-sensitive pins (e.g. GPIO0, GPIO2, GPIO15) can cause boot loops or bootloader hang if externally pulled during power-on.
16. **Testing Status**: Verified active and fully functional on physical hardware.
17. **Known Limitations**: Frequent relay toggling causes frequent LittleFS writes. LittleFS has wear leveling, but high-frequency pulsing (>10 Hz) could degrade flash sectors over extended years.
