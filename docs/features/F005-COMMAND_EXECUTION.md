# F005 – BI-DIRECTIONAL REMOTE COMMAND EXECUTION & ACKS

## 1. Feature Information
- **Feature ID**: F005
- **Feature Name**: Bi-Directional Remote Command Execution & Application ACKs
- **Version**: 1.6.0
- **Category**: Command & Control
- **Priority**: Critical
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Enables operators and central automation routines to dispatch authoritative control instructions to microcontrollers with guaranteed delivery and application-level verification.

## 3. Actual Functionality
The Central Server can dispatch commands via immediate direct HTTP call or attach them to outbound TCP socket telemetry responses. Microcontrollers parse the command JSON, execute the requested action (`setState`, `toggle`, `pulse`, `reboot`), and record an application-level acknowledgement containing the command UUID and success boolean, which is returned to the server.

## 4. Architecture
Dual-path dispatch engine: Low-latency Direct HTTP (`/api/commands/execute`) combined with an Offline Persistent Command Queue (`device_commands` table) delivered via TCP socket responses.

## 5. Workflow
1. User or schedule issues command on server.
2. Server attempts immediate direct HTTP POST to `http://${node_ip}/api/commands/execute`.
3. If node is reachable, node executes action and returns JSON ACK.
4. If node is unreachable, server records command in SQLite `device_commands` with status `PENDING`.
5. When node connects on TCP port 2000, server appends pending commands to socket response.
6. Node `ReceiverClient::processServerCommands()` executes actions and buffers UUID in `_pendingAcks`.
7. Node returns ACKs in next telemetry packet; server marks command `ACKNOWLEDGED`.

## 6. Hardware Requirements
Microcontroller GPIO outputs and persistent storage.

## 7. Device Implementation
- **ESP8266 (4MB)**: Implemented in [`ReceiverClient::processServerCommands()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp#L367-L416) and `WebServerManager::handleCommand()`.
- **ESP32**: Target specification.
- **ESP-01 (1MB)**: Implemented in [`esp01_1mb/src/receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/receiver_client.cpp#L340-L380).

## 8. Central Server Implementation
- **Backend**: `v1Router.js` (`POST /api/v1/commands/dispatch`), `nodeManager.js`, `database.js`.
- **Frontend**: Command Center section in `app.js`.
- **Database**: `device_commands` and `command_results` tables.

## 9. API and Protocol
- Inbound Node REST: `POST /api/commands/execute`
- Inbound Node Command Payload:
  ```json
  { "command_uuid": "...", "action": "setState", "id": 1, "state": true }
  ```
- Application ACK Payload:
  ```json
  { "command_uuid": "...", "success": true, "status": "ACKNOWLEDGED" }
  ```

## 10. Data Storage
- SQLite `device_commands` (`command_uuid`, `node_id`, `command_type`, `payload_json`, `status`, `attempts`).
- SQLite `command_results` (`command_uuid`, `node_id`, `success`, `execution_time_ms`).

## 11. Configuration
Parameter `max_retries` (default: 3) in `device_commands`.

## 12. Error Handling
If command parsing fails or action is unknown, node returns `success: false` with error message. Server marks command failed after 3 retries.

## 13. Security
Requires permission `commands:execute` on server.

## 14. Testing
Verified direct execution and socket response piggybacking on hardware node `192.168.1.105`.

## 15. Source References
- Edge: [`esp8266_4mb/src/receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp#L367-L416)
- Server: [`central_server_js/src/routes/v1Router.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/v1Router.js#L807-L822)

## 16. Known Limitations
Action `syncConfig` dispatched by `configSyncService.js` is not recognized by `web_server.cpp` `handleCommand()` (identified architectural gap).

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `ReceiverClient::processServerCommands()` |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | IMPLEMENTED | `ReceiverClient::processServerCommands()` |
| Central Server | IMPLEMENTED | `device_commands` dispatch pipeline |
| Dashboard | IMPLEMENTED | Command Center in `app.js` |

## 18. Future Improvements
Add cryptographic nonce and timestamp validation to prevent command replay attacks.
