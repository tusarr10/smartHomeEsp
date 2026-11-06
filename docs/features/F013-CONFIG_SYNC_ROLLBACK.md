# F013 – AUTHORITATIVE CONFIGURATION VERSIONING & ROLLBACK

## 1. Feature Information
- **Feature ID**: F013
- **Feature Name**: Authoritative Device Configuration Versioning & One-Click Rollback
- **Version**: 1.6.0
- **Category**: Configuration & Device Management
- **Priority**: High
- **Implementation Status**: PARTIAL (Architectural Discrepancy Identified)
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Maintains centralized, version-controlled configuration manifests for every edge node, enabling atomic configuration pushes and rollback to prior verified configurations.

## 3. Actual Functionality
The Central Server maintains authoritative configuration trees in SQLite `device_configurations` and historical snapshots in `configuration_versions`. Each revision computes a SHA-256 checksum. Operators can edit configuration JSON, trigger synchronization, and rollback to prior version numbers.

## 4. Architecture
Server-authoritative configuration model where the Central Server acts as the source of truth, synchronizing configuration trees down to microcontrollers.

## 5. Workflow
1. Operator modifies configuration in "Config & Sync" view.
2. Server increments `config_version`, computes SHA-256 hash, and saves snapshot to `configuration_versions`.
3. Server attempts direct push to node: `http://${ip}/api/commands/execute` with action `syncConfig`.
4. If node is offline, queues command in `device_commands`.
5. On rollback, operator selects prior version; server copies snapshot back to active configuration.

## 6. Hardware Requirements
Microcontroller LittleFS filesystem.

## 7. Device Implementation
- **ESP8266 (4MB)**: **PARTIAL**: Device implements configuration loading from `/config/*.json` and `/api/gpio/save`, but `web_server.cpp` `handleCommand()` does **not** recognize the `syncConfig` action dispatched by the server!
- **ESP32**: Target specification.
- **ESP-01 (1MB)**: Partial.

## 8. Central Server Implementation
- **Backend**: Implemented in [`central_server_js/src/configSyncService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/configSyncService.js).
- **Frontend**: Config & Sync section in `app.js`.
- **Database**: `device_configurations`, `configuration_versions`, `sync_jobs`.

## 9. API and Protocol
- Server REST: `GET /api/v1/nodes/:nodeId/config`, `PUT /api/v1/nodes/:nodeId/config`, `POST /api/v1/nodes/:nodeId/config/sync`, `POST /api/v1/nodes/:nodeId/config/rollback/:version`.
- Dispatched Action: `{"action":"syncConfig","version":3,"config":{...}}`.

## 10. Data Storage
- SQLite `device_configurations` (`node_id`, `config_version`, `config_json`, `sha256_checksum`, `sync_status`).
- SQLite `configuration_versions` (`node_id`, `version`, `config_json`, `sha256_checksum`).

## 11. Configuration
Full device configuration tree: `node_id`, `name`, `room`, `wifi`, `network`, `channels`.

## 12. Error Handling
Server sets `sync_status = 'FAILED'` if node fails to acknowledge update within 5000ms.

## 13. Security
Modifying configurations requires permission `config:manage`; rollbacks require `config:rollback`.

## 14. Testing
Server-side versioning and rollback logic verified in `test_rbac_commands_sync.js`. Edge integration exposed action mismatch.

## 15. Source References
- Server: [`central_server_js/src/configSyncService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/configSyncService.js)
- Edge: [`esp8266_4mb/src/web_server.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L310-L338)

## 16. Known Limitations
Action `syncConfig` is rejected by current firmware `handleCommand()` with `Unknown command action`. Firmware must be updated to process full configuration JSONs under this action.

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | PARTIAL | Lacks `syncConfig` handler in `handleCommand()` |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | PARTIAL | Lacks `syncConfig` handler |
| Central Server | IMPLEMENTED | `configSyncService.js` |
| Dashboard | IMPLEMENTED | Config & Sync view in `app.js` |

## 18. Future Improvements
Add diff preview in dashboard before applying configuration rollbacks.
