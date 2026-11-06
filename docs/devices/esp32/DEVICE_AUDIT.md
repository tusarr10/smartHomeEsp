# DEVICE 02 FORENSIC AUDIT: ESP32 PLATFORM

**Target**: Device 02 – ESP32 Smart Home Controller  
**Status**: **ABSENT FROM REPOSITORY / UNIMPLEMENTED**  
**Evidence Source**: Full workspace static analysis  

---

## 1. Forensic Verification of Non-Existence

A systematic file scan across all extensions (`.ino`, `.cpp`, `.h`, `.c`, `.ini`, `.json`) returned zero source files dedicated to an ESP32 firmware build.

```powershell
Get-ChildItem -Path . -Recurse -File | Select-String -Pattern "esp32|ESP32"
```

The resulting matches are confined exclusively to:
1. `central_server_js/src/discoveryService.js`: Line 71 fallback string.
2. `central_server_js/public/assets/app.js`: Line 2424 UI selector option.
3. `scratch/patch_app_js.py`: Line 67 test string mirror.

**Audit Conclusion**: Device 02 has not yet been implemented in code. The existing firmware projects (`esp8266_4mb` and `esp01_1mb`) specifically target the ESP8266 architecture.

---

## 2. Expected Ecosystem Role for Device 02

Based on the Central Server data models and protocol implementations in `central_server_js`, Device 02 is intended as a high-density relay controller and sensor aggregator with the following expected capabilities:

| Expected Capability | Implementation Status | Evidence / Requirement |
|---|---|---|
| **Multi-Channel Relays** | **NOT IMPLEMENTED** | Central Server supports up to 16 channels per node; ESP32 has 20+ usable GPIOs. |
| **Analog / Sensor ADC** | **NOT IMPLEMENTED** | `sensors` table in SQLite schema (`node_id`, `sensor_type`, `current_value`, `unit`). |
| **Dual Protocols** | **NOT IMPLEMENTED** | Must implement raw TCP (Port 2000) and HTTP POST to `/api/node/telemetry`. |
| **Bi-Directional Commands** | **NOT IMPLEMENTED** | Must parse `{ "commands": [...] }` and issue command UUID ACKs. |
| **Non-Volatile Persistence** | **NOT IMPLEMENTED** | Requires NVS (Non-Volatile Storage) or LittleFS partition. |
| **OTA Updates** | **NOT IMPLEMENTED** | Central Server `OtaService` expects `/api/ota/upload` multipart endpoint. |
| **Web Server / REST API** | **NOT IMPLEMENTED** | Must expose `/api/status`, `/api/gpio`, `/api/command` for LAN probing. |

---

## 3. Detailed Audit Template Breakdown (Protocol Gap Analysis)

1. **Feature Name**: Device 02 (ESP32 High-Density Multi-Channel Controller)
2. **Purpose**: Expand smart home automation capabilities to larger electrical distribution boxes requiring 8 to 16 relays and multi-sensor telemetry (temperature, humidity, energy monitoring via CT clamps).
3. **Actual Behavior**: Currently unbuilt; nonexistent in disk storage.
4. **Internal Design Needed**: FreeRTOS multi-threaded architecture allocating network telemetry to Core 0 (PRO_CPU) and GPIO actuation/sensor ADC sampling to Core 1 (APP_CPU).
5. **Startup Dependencies**: FreeRTOS scheduler, NVS flash partition mount, lwIP Wi-Fi stack.
6. **Hardware Dependencies**: ESP32-WROOM-32 or ESP32-S3 module, optocoupler relay board, external 3.3V 1A switching regulator (due to ESP32 Wi-Fi TX current spikes up to 380 mA).
7. **GPIO Pin Mapping**: Must avoid boot strapping pins (GPIO 0, 2, 5, 12, 15) and input-only pins (GPIO 34, 35, 36, 39).
8. **Classes / Functions**: To be ported from `esp8266_4mb` singleton architecture into ESP32 Arduino / ESP-IDF C++.
9. **Source File Paths**: Target directory to be created: `esp32/` or `esp32_wroom/`.
10. **Configuration Variables**: Must mirror `/config/system.json`, `/config/wifi.json`, `/config/gpio.json`, `/config/receiver.json`.
11. **Communication Interfaces**: Must implement TCP Socket to port 2000 and HTTP server on port 80.
12. **Input / Output Data**: Input remote commands; output multi-channel relay signals + sensor readings.
13. **Persistent Storage**: Should use NVS or ESP32 LittleFS (`littlefs.h`).
14. **Error Handling**: Hardware brownout detector resets must be logged and reported in telemetry.
15. **Security Considerations**: ESP32 supports hardware cryptographic acceleration (AES, SHA-256, RSA); can support HTTPS/TLS which ESP8266 cannot.
16. **Testing Status**: **UNTESTED / NON-EXISTENT**.
17. **Known Limitations**: Not yet developed.
