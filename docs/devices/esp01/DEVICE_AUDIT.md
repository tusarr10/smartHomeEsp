# DEVICE 03 FORENSIC AUDIT: ESP-01 / ESP-01S (1MB)

**Audit Target**: `esp01_1mb`  
**SoC / Board**: ESP8266EX / ESP-01 or ESP-01S (AI-Thinker module)  
**Flash Geometry**: 1MB Flash / 64KB LittleFS Partition (`eagle.flash.1m.ld`, `flash_mode = dout`)  
**Firmware Version**: `1.6.0`  

---

## 1. Discovered Firmware Capabilities

Below is the verified inventory of capabilities discovered in [`esp01_1mb/src/`](file:///d:/ai/Homeautomation_server/esp01_1mb/src):

| Feature Category | Implemented Capabilities | Implementation Status | Primary Source File |
|---|---|---|---|
| **Boot & Setup** | Factory reset button explicitly disabled (`FACTORY_RESET_PIN = 255`) to prevent relay chatter from causing resets. | **IMPLEMENTED** | [`main.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/main.cpp#L16-L45) |
| **Wi-Fi Connectivity** | Dual Station & SoftAP mode, DHCP client, static IP override, Captive Portal DNS. | **IMPLEMENTED** | [`wifi_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/wifi_manager.cpp) |
| **GPIO Relay Engine** | Up to 4 channels (GPIO 0, GPIO 2, GPIO 3 RX, GPIO 1 TX). Static array allocation (`_channels[4]`). | **IMPLEMENTED** | [`gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/gpio_manager.cpp) |
| **State Persistence** | Power-loss state restoration across reboots, JSON serialization in LittleFS. | **IMPLEMENTED** | [`storage_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/storage_manager.cpp) |
| **Local Automation** | **OFFLOADED TO CENTRAL SERVER**: Engine is a thin satellite stub forwarding events. | **INTENTIONALLY OFFLOADED** | [`automation.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/automation.cpp) |
| **Central Telemetry** | Outbound raw TCP stream (port 2000) and HTTP POST telemetry, debounced state change push. | **IMPLEMENTED** | [`receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/receiver_client.cpp) |
| **Command Execution** | Remote commands (`setState`, `toggle`, `pulse`, `reboot`) with application-level UUID ACKs. | **IMPLEMENTED** | [`receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/receiver_client.cpp) |
| **Embedded Web Server**| Essential REST API routes on port 80, Captive Portal redirection. | **IMPLEMENTED** | [`web_server.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/web_server.cpp) |
| **Web Dashboard** | Pre-compressed gzip HTML single-page dashboard compiled directly into PROGMEM flash. | **IMPLEMENTED** | [`dashboard_html.h`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/dashboard_html.h) |
| **OTA Updates** | Web browser multipart binary flashing (`/api/ota/upload`) + ArduinoOTA. | **IMPLEMENTED** | [`ota_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/ota_manager.cpp) |
| **LittleFS Management**| Stripped of file explorer/upload/delete routes to conserve flash memory space. | **INTENTIONALLY STRIPPED** | [`web_server.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/web_server.cpp) |
| **Diagnostics & Health**| Real-time free heap, min free heap, RSSI, uptime, reset reasons. | **IMPLEMENTED** | [`web_server.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/web_server.cpp) |
| **Authentication** | Lightweight authentication without heavy 64-round SHA-256 table to maximize flash headroom. | **IMPLEMENTED** | [`auth_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/auth_manager.cpp) |
| **Shift Register 74HC595**| Serial-to-parallel shift register relay multiplexing. | **NOT IMPLEMENTED** | Absent; direct GPIO used |

---

## 2. In-Depth Feature Audit Specifications

### Audit 1: PROGMEM-Compressed Gzip Dashboard Engine
1. **Feature Name**: Flash-Resident Gzip Dashboard Engine
2. **Purpose**: Serve a responsive, dark-mode configuration web UI from an ESP-01 without consuming any space in the 64KB LittleFS partition.
3. **Actual Behavior**: The web server registers `GET /` and `GET /index.html`. It serves an in-memory binary array `DASHBOARD_HTML_GZ` directly from flash PROGMEM with header `Content-Encoding: gzip` and `Content-Type: text/html`.
4. **Internal Design**: Implemented in [`WebServerManager::serveDashboard()`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/web_server.cpp#L48-L62) referencing [`dashboard_html.h`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/dashboard_html.h). Generated at build time by [`compress_dashboard.py`](file:///d:/ai/Homeautomation_server/esp01_1mb/compress_dashboard.py).
5. **Startup Dependencies**: Core WebServer initialization in `setup()`.
6. **Hardware Dependencies**: Flash PROGMEM read controller.
7. **GPIO Mapping**: None.
8. **Classes / Functions**: `WebServerManager::serveDashboard()`, `_server.send_P(200, "text/html", (const char*)DASHBOARD_HTML_GZ, DASHBOARD_HTML_GZ_LEN)`.
9. **Source Files**: [`esp01_1mb/src/dashboard_html.h`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/dashboard_html.h), [`esp01_1mb/src/web_server.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/web_server.cpp).
10. **Configuration Variables**: None; compiled into binary.
11. **Communication Interfaces**: HTTP port 80.
12. **Input / Output Data**: Inbound HTTP GET; outbound gzip binary stream (~16.8 KB).
13. **Persistence**: Read-only flash memory (PROGMEM).
14. **Error Handling**: Served directly from PROGMEM; cannot be corrupted by filesystem crashes.
15. **Security Considerations**: Read-only; cannot be altered via filesystem upload exploits.
16. **Testing Status**: Verified active and compiled.
17. **Known Limitations**: Modifying the dashboard requires recompilation and flashing rather than editing files in LittleFS.

---

### Audit 2: Zero-Heap Static Relay Channel Actuator
1. **Feature Name**: Static Array GPIO Actuation Subsystem
2. **Purpose**: Drive dual or quad relay outputs without using `std::vector` dynamic heap memory, preventing heap fragmentation on the 1MB chip.
3. **Actual Behavior**: Allocates a fixed static array `GpioChannel _channels[MAX_GPIO_CHANNELS]` (where `MAX_GPIO_CHANNELS = 4`). Default configured channels: Channel 1 on GPIO 0 (Relay 1), Channel 2 on GPIO 2 (Relay 2).
4. **Internal Design**: Implemented in [`GpioManager`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/gpio_manager.cpp#L4-L8).
5. **Startup Dependencies**: `StorageManager::begin()`.
6. **Hardware Dependencies**: Direct ESP-01 GPIO 0 and GPIO 2 output pins.
7. **GPIO Mapping**:
   - Channel 1: `ESP01_GPIO0` (Pin 5 on 8-pin header).
   - Channel 2: `ESP01_GPIO2` (Pin 3 on 8-pin header / ESP-01S onboard Blue LED).
   - Channel 3 (Optional): `ESP01_GPIO3_RX` (Pin 8).
   - Channel 4 (Optional): `ESP01_GPIO1_TX` (Pin 1).
8. **Classes / Functions**: `GpioManager::getInstance()`, `setState()`, `toggle()`, `pulse()`, `applyPhysicalPin()`.
9. **Source Files**: [`esp01_1mb/src/gpio_manager.h`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/gpio_manager.h), [`esp01_1mb/src/gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/gpio_manager.cpp).
10. **Configuration Variables**: Stored in `/config/gpio.json`.
11. **Communication Interfaces**: Controlled via REST API (`/api/gpio/state`, `/api/command`) and Central Server TCP commands.
12. **Input / Output Data**: Boolean state; physical pin voltage transition.
13. **Persistence**: Saves state transitions to LittleFS.
14. **Error Handling**: Boundary check against `_channelCount` and valid pin numbers (< 17).
15. **Security Considerations**: Boot sensitivity of GPIO 0 and GPIO 2: Relay boards must not pull GPIO 0 to GND during boot, or chip enters flash download mode.
16. **Testing Status**: Verified active and functional.
17. **Known Limitations**: Maximum 4 channels due to physical pin constraints of the ESP-01 8-pin package.
