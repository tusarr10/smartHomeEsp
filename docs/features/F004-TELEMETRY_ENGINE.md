# F004 – DUAL-PROTOCOL FLEET TELEMETRY ENGINE

## 1. Feature Information
- **Feature ID**: F004
- **Feature Name**: Dual-Protocol Outbound Fleet Telemetry Engine
- **Version**: 1.6.0
- **Category**: Telemetry & Communications
- **Priority**: Critical
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Provides continuous, real-time health, diagnostic, and state streaming from distributed edge nodes to the Central Server using high-efficiency raw TCP sockets or HTTP REST POST.

## 3. Actual Functionality
Executes a non-blocking asynchronous state machine on the microcontroller. Transmits structured JSON payloads containing node identity, uptime, free heap, RSSI, Wi-Fi parameters, relay channel states, and command ACKs. Supports periodic heartbeats (default 10s) and debounced instant pushing on any relay state transition (400ms debounce).

## 4. Architecture
Asynchronous client on the edge (`ReceiverClient`) streaming JSON directly into a `WiFiClient` socket; multi-threaded/event-driven server (`tcpServer.js` on port 2000 and `legacyRouter.js` on port 9100).

## 5. Workflow
1. Timer expires or `onGpioStateChanged()` is triggered.
2. `ReceiverClient::loop()` transitions from `RC_STATE_IDLE` to `RC_STATE_SENDING`.
3. Opens TCP connection to `serverHost:2000`.
4. Streams JSON telemetry payload + `\n`.
5. Transitions to `RC_STATE_AWAITING_REPLY`.
6. Server processes telemetry in `nodeManager.processTelemetry()`, persists records, and sends response line + `\n`.
7. Client reads response within 1500ms, processes commands, and closes socket.

## 6. Hardware Requirements
Microcontroller with 802.11 b/g/n Wi-Fi and lwIP TCP/IP stack.

## 7. Device Implementation
- **ESP8266 (4MB)**: Implemented in [`ReceiverClient`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp).
- **ESP32**: Target specification (FreeRTOS telemetry task).
- **ESP-01 (1MB)**: Implemented with stack buffers in [`esp01_1mb/src/receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/receiver_client.cpp).

## 8. Central Server Implementation
- **Backend**: [`tcpServer.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/tcpServer.js) (Port 2000) and `legacyRouter.js` (`POST /api/telemetry`).
- **Frontend**: Telemetry view in `app.js` with live updates and JSON payload inspector.
- **Database**: SQLite `telemetry_logs` archive table.

## 9. API and Protocol
- Raw TCP Socket: `tcp://<server_host>:2000` (Newline-delimited JSON).
- HTTP POST: `http://<server_host>:9100/api/node/telemetry`.

## 10. Data Storage
Stored in SQLite `telemetry_logs` (`id`, `node_id`, `event_type`, `epoch`, `rssi`, `free_heap`, `uptime_sec`, `payload_json`).

## 11. Configuration
Settings in LittleFS `/config/receiver.json`: `enabled`, `serverHost`, `serverPort`, `protocol`, `reportIntervalSec`, `authToken`.

## 12. Error Handling
1500ms client timeout window; increments `_packetsFailed`; aborts socket with `client.stop(10)`.

## 13. Security
Transmits plaintext JSON across LAN; supports optional shared `token`.

## 14. Testing
Empirically stress-tested over 5 outbound socket cycles on physical hardware `192.168.1.105` with 0 memory leaks and complete heap recovery.

## 15. Source References
- Edge: [`esp8266_4mb/src/receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp#L49-L191)
- Server: [`central_server_js/src/tcpServer.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/tcpServer.js)

## 16. Known Limitations
TCP communication is unencrypted on LAN (no TLS due to ESP8266 RAM constraints).

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `ReceiverClient::pushTelemetry()` |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | IMPLEMENTED | `ReceiverClient::pushTelemetry()` |
| Central Server | IMPLEMENTED | `tcpServer.js`, `nodeManager.processTelemetry()` |
| Dashboard | IMPLEMENTED | Telemetry section in `app.js` |

## 18. Future Improvements
Implement binary Protobuf or CBOR encoding to reduce packet sizes by 60%.
