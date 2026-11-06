# DEVICE 03: ESP-01 / ESP-01S (1MB FLASH)

**Firmware Name**: `SmartHome-ESP01`  
**Firmware Version**: `1.6.0`  
**Target Hardware**: ESP8266 ESP-01 / ESP-01S (1MB Flash)  
**Source Directory**: [`esp01_1mb/`](file:///d:/ai/Homeautomation_server/esp01_1mb)  

---

## 1. Executive Summary

Device 03 is an ultra-compact smart home relay actuator and satellite telemetry node specifically engineered for the severely resource-constrained ESP8266 ESP-01 and ESP-01S microcontrollers featuring only **1MB (8 MBit) of external SPI flash memory**.

Unlike Device 01, which operates a full local rules engine, 2MB LittleFS partition, and file manager explorer, Device 03 operates on a **Lean Satellite Architecture**:
- **Direct Dual-Channel Relay Control**: Controls GPIO 0 (Relay 1) and GPIO 2 (Relay 2 / Onboard Blue LED), with optional GPIO 3 (RX) and GPIO 1 (TX) expansion (up to 4 channels).
- **No Shift Register**: Direct pin driving via `digitalWrite()`; 74HC595 shift registers are not utilized.
- **Embedded In-Memory Dashboard**: Web assets are not stored in LittleFS; a pre-compressed gzip HTML single-page application is compiled directly into flash PROGMEM via `compress_dashboard.py` and served from `dashboard_html.h`.
- **Offloaded Automation**: Complex cron schedules, daily timers, and rules are offloaded entirely to the Central Server (`central_server_js`). The ESP-01 acts as a responsive real-time hardware actuator.
- **Extreme Memory Optimizations**:
  - SHA-256 64-round crypto tables stripped to save flash.
  - Floating-point formatting stripped via `strip_floats.py` and compiler flags (`ARDUINOJSON_USE_DOUBLE=0`).
  - Static array allocation for GPIO channels (`GpioChannel _channels[MAX_GPIO_CHANNELS]`), eliminating heap fragmentation.
  - Minimal LittleFS footprint reserved exclusively for JSON configurations.

---

## 2. Documentation Directory Map

| Document | Contents |
|---|---|
| [**DEVICE_AUDIT.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/DEVICE_AUDIT.md) | Exhaustive forensic audit of all discovered ESP-01 firmware capabilities, behaviors, and memory optimizations. |
| [**HARDWARE.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/HARDWARE.md) | 1MB flash geometry, ESP-01 8-pin header pinout, power requirements, and relay modules. |
| [**GPIO_MAPPING.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/GPIO_MAPPING.md) | Pin mapping (GPIO0, GPIO2, RX, TX), strapping constraints, active-low logic, disabled reset pin. |
| [**FIRMWARE_ARCHITECTURE.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/FIRMWARE_ARCHITECTURE.md) | Satellite architecture, static array allocations, PROGMEM serving, and server offloading. |
| [**FEATURES.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/FEATURES.md) | Feature-by-feature implementation breakdown with source code citations. |
| [**CONFIGURATION.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/CONFIGURATION.md) | LittleFS JSON configuration schemas and defaults. |
| [**COMMUNICATION.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/COMMUNICATION.md) | Inbound REST endpoints, outbound TCP/HTTP telemetry payloads, and command framing. |
| [**MEMORY_AND_PERFORMANCE.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/MEMORY_AND_PERFORMANCE.md) | Flash footprint breakdown (<450 KB binary), heap utilization, and stack safety. |
| [**BUILD_AND_FLASH.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/BUILD_AND_FLASH.md) | PlatformIO compilation with `strip_floats.py` and `compress_dashboard.py`, USB programmer flashing. |
| [**TROUBLESHOOTING.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/TROUBLESHOOTING.md) | Boot failures, UART programming mode, relay chatter at power-on, and Wi-Fi recovery. |
