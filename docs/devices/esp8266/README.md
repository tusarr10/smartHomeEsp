# DEVICE 01: ESP8266 / NODEMCU (4MB FLASH)

**Firmware Name**: `SmartHome-NodeMCU`  
**Firmware Version**: `1.6.0`  
**Target Hardware**: ESP8266 (ESP-12E / ESP-12F) NodeMCU v2  
**Source Directory**: [`esp8266_4mb/`](file:///d:/ai/Homeautomation_server/esp8266_4mb)  

---

## 1. Executive Summary

Device 01 is the flagship multi-channel smart home relay controller and fleet telemetry node. It operates on an ESP8266 microcontroller with 4MB of external SPI flash memory configured with a 2MB LittleFS filesystem partition.

It features:
- Up to 8 configurable GPIO relay channels with active-high/active-low polarity and pulse switching.
- Automatic power-loss state persistence and restoration across reboots via LittleFS.
- Dual Wi-Fi modes: Station (DHCP / Static IP) and SoftAP Captive Portal.
- Outbound industrial telemetry engine supporting both raw TCP socket streaming (port 2000) and HTTP/REST POST.
- Bi-directional remote command execution (`setState`, `toggle`, `pulse`, `reboot`) with application-level ACKs.
- Embedded autonomous rules engine with NTP time synchronization (IST UTC+05:30), daily schedules, timers, and relay interlocks.
- Dual-tier Web Dashboard: Full rich SPA hosted on LittleFS, with automatic fallback to a PROGMEM-compressed dashboard in flash memory if the filesystem is unformatted or corrupted.
- Built-in Over-The-Air (OTA) updates via ArduinoOTA and web-based multipart binary upload.

---

## 2. Documentation Directory Map

| Document | Contents |
|---|---|
| [**DEVICE_AUDIT.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/DEVICE_AUDIT.md) | Exhaustive forensic audit of all discovered firmware capabilities, behaviors, and limitations. |
| [**HARDWARE.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/HARDWARE.md) | SoC specifications, flash partitioning, power requirements, and physical wiring. |
| [**GPIO_MAPPING.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/GPIO_MAPPING.md) | Complete pin mapping table, strapping pins, boot states, and safety matrix. |
| [**FIRMWARE_ARCHITECTURE.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/FIRMWARE_ARCHITECTURE.md) | Internal module structure, execution loop, callback chains, and memory lifecycle. |
| [**FEATURES.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/FEATURES.md) | Feature-by-feature implementation breakdown with source code citations. |
| [**CONFIGURATION.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/CONFIGURATION.md) | LittleFS JSON configuration schemas, default values, and parameter limits. |
| [**COMMUNICATION.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/COMMUNICATION.md) | Inbound REST endpoints, outbound TCP/HTTP telemetry payloads, and command framing. |
| [**MEMORY_AND_PERFORMANCE.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/MEMORY_AND_PERFORMANCE.md) | Empirical heap benchmarks, fragmentation analysis, stack allocation, and stress results. |
| [**BUILD_AND_FLASH.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/BUILD_AND_FLASH.md) | PlatformIO compilation, LittleFS image flashing, serial monitoring, and fuses. |
| [**TROUBLESHOOTING.md**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/TROUBLESHOOTING.md) | Hardware reset button recovery, boot failure codes, Wi-Fi fallback, and diagnostics. |
