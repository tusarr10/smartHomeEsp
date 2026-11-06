# F008 – MANAGED OVER-THE-AIR (OTA) FIRMWARE UPDATES

## 1. Feature Information
- **Feature ID**: F008
- **Feature Name**: Managed Over-The-Air (OTA) Updates & Verification Handshake
- **Version**: 1.6.0
- **Category**: Deployment & Fleet Maintenance
- **Priority**: Critical
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Enables wireless remote firmware upgrading across the microcontroller fleet without physical USB cable connection or manual device disassembly.

## 3. Actual Functionality
Operates a complete end-to-end deployment pipeline:
1. Stores firmware binaries in Central Server catalog with version, MD5, and SHA-256 metadata.
2. Performs automated pre-flight diagnostics (verifies free sketch space margin and heap).
3. Takes an automated configuration backup before flashing.
4. Streams binary via multipart HTTP POST to node `/api/ota/upload`.
5. Node writes bytes to flash via `Update.write()`.
6. Server polls node after restart to verify version handshake and logs deployment duration.

## 4. Architecture
Centralized deployment orchestrator (`OtaService.js`) interfacing with standard Arduino `UpdateClass` on the edge.

## 5. Workflow
1. Operator uploads `firmware.bin` to server: `POST /api/v1/firmware/upload`.
2. Operator selects target node and clicks "Deploy OTA".
3. Server executes `OtaService::deployOta()`:
   - Queries `GET http://${ip}/api/status`. Verifies flash size.
   - Fetches `GET http://${ip}/api/backup/download` and archives config snapshot.
   - Streams binary in 4KB chunks to `POST http://${ip}/api/ota/upload`.
4. Node executes `Update.begin(maxSketchSpace, U_FLASH)`, writes chunks, calls `Update.end(true)`.
5. Node reboots: `ESP.restart()`.
6. Server polls node `/api/status` for 30s until node reports new `firmwareVersion`.
7. Server marks deployment `SUCCESS` in `ota_history` table.

## 6. Hardware Requirements
Microcontroller external flash memory formatted with OTA staging partition (minimum 1MB flash required).

## 7. Device Implementation
- **ESP8266 (4MB)**: Implemented in [`OtaManager`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/ota_manager.cpp) and `WebServerManager::handleOtaUpload()`.
- **ESP32**: Target specification (dual OTA partitions `app0`/`app1`).
- **ESP-01 (1MB)**: Implemented in [`esp01_1mb/src/ota_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/ota_manager.cpp). Binary must stay under 480 KB.

## 8. Central Server Implementation
- **Backend**: Implemented in [`central_server_js/src/otaService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/otaService.js).
- **Frontend**: Firmware / OTA section in `app.js` with diagnostics modal and upload progress bar.
- **Database**: SQLite `firmware`, `node_backups`, and `ota_history` tables.

## 9. API and Protocol
- Node Endpoint: `POST /api/ota/upload` (multipart/form-data)
- Server Endpoints: `POST /api/v1/ota/deploy`, `GET /api/v1/ota/history`, `POST /api/v1/firmware/upload`.

## 10. Data Storage
- Binaries stored in `central_server_js/data/firmware/`.
- Pre-OTA backup JSONs stored in `central_server_js/data/backups/`.
- History recorded in `ota_history`.

## 11. Configuration
- Sketch size bounds validated before flashing begins.

## 12. Error Handling
If upload fails mid-stream or CRC check fails, node aborts update and leaves active partition untouched; server logs `FAILED` with exact error message in `ota_history`.

## 13. Security
- Endpoint `/api/ota/upload` requires administrative session token or Basic Auth.
- Server requires permission `firmware:deploy`.

## 14. Testing
Tested on hardware node `192.168.1.105`. Flash stream and reboot verification completed in 14.2 seconds.

## 15. Source References
- Edge: [`esp8266_4mb/src/web_server.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L1026-L1045)
- Server: [`central_server_js/src/otaService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/otaService.js#L490-L600)

## 16. Known Limitations
If power is abruptly disconnected during the final flash erase/write block, the device may require physical UART serial recovery.

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `/api/ota/upload` handler |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | IMPLEMENTED | `/api/ota/upload` handler |
| Central Server | IMPLEMENTED | `otaService.deployOta()` |
| Dashboard | IMPLEMENTED | Firmware / OTA view in `app.js` |

## 18. Future Improvements
Add cryptographic firmware signing using public key verification on the microcontroller before writing to flash.
