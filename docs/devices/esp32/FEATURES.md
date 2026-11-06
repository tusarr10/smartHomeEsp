# DEVICE 02 FEATURES SPECIFICATION (TARGET): ESP32

**Target**: ESP32 Smart Home Controller  
**Status**: Architecture & Feature Requirements Contract  

---

## 1. Required Feature Parity with Central Server

To seamlessly integrate into the existing SmartHome Central Management Platform (`central_server_js`), any newly implemented ESP32 firmware must satisfy the following feature contracts:

| Feature ID | Feature Name | Protocol Contract | Central Server Integration |
|---|---|---|---|
| **F-01** | Hardware Node ID | Format: `NODE-` + MAC address without colons (e.g. `NODE-A4C1389B42E0`) | Auto-registered in `nodes` table |
| **F-02** | Telemetry Ingestion | Outbound TCP socket stream to port 2000 (newline JSON) or HTTP POST | Ingested via `nodeManager.processTelemetry()` |
| **F-03** | Command Acknowledgement | Return `acks: [{ command_uuid, success, status: "ACKNOWLEDGED" }]` | Clears command queue in `device_commands` |
| **F-04** | Remote Actuation | Execute `setState`, `toggle`, `pulse`, `reboot` | Issued via `/api/v1/commands/dispatch` |
| **F-05** | Diagnostic Endpoint | Expose `GET /api/status` with `freeHeap`, `rssi`, `firmwareVersion` | Scanned by `discoveryService.js` |
| **F-06** | Local Web Dashboard | Port 80 HTTP server serving LittleFS web UI or fallback HTML | Direct LAN browser management |
| **F-07** | OTA Binary Upload | Expose `POST /api/ota/upload` accepting multipart firmware binary | Deployed via `OtaService.streamFirmwareToNode()` |
| **F-08** | Power-Loss Restoration | Persist channel states in LittleFS/NVS; restore on boot according to `initialMode` | Prevents load drop during power cycles |
| **F-09** | Multi-Sensor Support | Collect analog (ADC1) and I2C environmental sensor data | Stored in SQLite `sensors` table |

---

## 2. Advanced ESP32 Capabilities (Beyond ESP8266)

When developing the ESP32 firmware, the following capabilities should be added:
1. **Hardware HTTPS / TLS**: Utilize hardware SHA-256 and AES engines to run MbedTLS, securing telemetry transmission across the public internet.
2. **BLE Device Commissioning**: Use Bluetooth Low Energy (BLE) to configure Wi-Fi credentials from a mobile phone app without disconnecting from the home router.
3. **16-Channel Relay Support**: Expand from 8 channels to 16 channels, using ESP32's abundant GPIO pins.
4. **Energy Monitoring**: Integrate ADE7953 or PZEM-004T energy monitoring chips over hardware UART for real-time voltage, current, power factor, and kWh tracking.
