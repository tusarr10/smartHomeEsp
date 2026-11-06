# F001 – HARDWARE NODE ID GENERATION & DEVICE REGISTRATION

## 1. Feature Information
- **Feature ID**: F001
- **Feature Name**: Hardware Node ID Generation & Automatic Registration
- **Version**: 1.6.0
- **Category**: Identity & Fleet Management
- **Priority**: Critical
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Establishes a permanent, collision-free unique identifier for every physical microcontroller in the fleet derived from silicon hardware registers, enabling automated zero-touch onboarding into the central management platform.

## 3. Actual Functionality
On boot, each microcontroller reads its Wi-Fi MAC address from hardware OTP eFuse, converts it to uppercase without colons, and prefixes it with `NODE-` (e.g. `NODE-BCDDC223386C`). When telemetry is transmitted to the Central Server (via TCP port 2000 or HTTP), `NodeManager` ingests the packet and automatically creates or updates the device record in the SQLite `nodes` table.

## 4. Architecture
A distributed identifier extraction model where the edge device generates its canonical hardware ID and the central server maintains authoritative fleet records with auto-discovery and manual metadata overrides (name, room, location, category).

## 5. Workflow
1. Microcontroller boots: `ReceiverClient::begin()` calls `getHardwareNodeId()`.
2. Reads hardware MAC: `WiFi.macAddress()`.
3. Checks `/config/receiver.json`: If `nodeId` is empty or a placeholder, applies the generated hardware ID.
4. Transmits telemetry containing `nodeId` to Central Server.
5. Server executes `NodeManager::processTelemetry()`:
   - If node is unseen, inserts new row into `nodes` table.
   - If node is known, updates `last_seen_epoch`, `ip_address`, and `is_online = 1`.
6. Server broadcasts `node_status` event via WebSocket to the dashboard.

## 6. Hardware Requirements
Microcontroller with unique hardware MAC address burned into silicon (standard on all Espressif SoCs).

## 7. Device Implementation
- **ESP8266 (4MB)**: Implemented in [`ReceiverClient::getHardwareNodeId()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp#L32-L37).
- **ESP32**: Target specification (call `esp_efuse_mac_get_default()`).
- **ESP-01 (1MB)**: Implemented identically in [`esp01_1mb/src/receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/receiver_client.cpp#L32-L37).

## 8. Central Server Implementation
- **Backend**: Implemented in [`central_server_js/src/nodeManager.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/nodeManager.js#L251-L320) and [`database.js: upsertNode()`](file:///d:/ai/Homeautomation_server/central_server_js/src/database.js).
- **Frontend**: Nodes table in `public/assets/app.js` with manual rename and room tagging modal.
- **Database**: `nodes` table with primary key `node_id TEXT PRIMARY KEY`.

## 9. API and Protocol
- Outbound TCP: `{"nodeId": "NODE-BCDDC223386C", ...}` to port 2000.
- Outbound HTTP: `POST /api/node/telemetry` with header `X-Node-ID: NODE-BCDDC223386C`.
- Management REST: `GET /api/v1/nodes`, `POST /api/v1/nodes/add`, `DELETE /api/v1/nodes/:nodeId`.

## 10. Data Storage
- Microcontroller: Cached in LittleFS `/config/receiver.json`.
- Central Server: Primary key in SQLite `nodes` table; foreign key in `relays`, `telemetry_logs`, `device_commands`.

## 11. Configuration
- Key `nodeId` in `/config/receiver.json`. Defaults to hardware MAC ID if empty.

## 12. Error Handling
If MAC read fails (e.g. Wi-Fi radio not ready), falls back to temporary ID `NODE-DEFAULT` until Wi-Fi initializes.

## 13. Security
Node IDs are public identifiers. Access control and command execution require Bearer tokens or HTTP Basic Auth credentials.

## 14. Testing
Tested on physical NodeMCU `192.168.1.105` generating ID `NODE-BCDDC223386C`.

## 15. Source References
- Microcontroller: [`esp8266_4mb/src/receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp#L32-L43)
- Server: [`central_server_js/src/nodeManager.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/nodeManager.js#L251-L320)

## 16. Known Limitations
MAC address spoofing could allow an unauthorized device on the local network to transmit telemetry under another node's ID if `auth_token` is not configured.

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `ReceiverClient::getHardwareNodeId()` |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | IMPLEMENTED | `ReceiverClient::getHardwareNodeId()` |
| Central Server | IMPLEMENTED | `nodeManager.processTelemetry()` |
| Dashboard | IMPLEMENTED | Nodes section in `app.js` |

## 18. Future Improvements
Cryptographically sign telemetry payloads using hardware elliptic curve keys (Ed25519) on ESP32.
