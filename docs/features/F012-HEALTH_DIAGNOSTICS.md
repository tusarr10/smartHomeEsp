# F012 – DEVICE HEALTH, MEMORY DIAGNOSTICS & OFFLINE TRACKING

## 1. Feature Information
- **Feature ID**: F012
- **Feature Name**: Device Health, Memory Diagnostics & Offline State Tracking
- **Version**: 1.6.0
- **Category**: Diagnostics & Observability
- **Priority**: High
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Provides real-time visibility into microcontroller physical stability, heap fragmentation, Wi-Fi link quality, and detects unresponsive nodes across the fleet.

## 3. Actual Functionality
- **Edge Diagnostics**: Node continuously tracks current free heap, historic minimum free heap (`ESP.getFreeHeap()`), max contiguous allocatable block, heap fragmentation percentage, Wi-Fi RSSI (dBm), boot counter, and hardware reset reason string.
- **Server Offline Watcher**: Evaluates node heartbeats every 4 seconds. If a node is silent for longer than `offline_timeout_sec` (30s), flags the node as `Offline`, logs audit events, pushes an alert notification, and broadcasts state change to operator dashboards.

## 4. Architecture
Edge metric collectors aggregated into telemetry frames; server-side sliding window timeout engine in `NodeManager`.

## 5. Workflow
1. Node gathers metrics in `ReceiverClient::fillTelemetryDoc()`.
2. Telemetry packet arrives at Central Server.
3. Server records `last_seen_epoch = Date.now() / 1000`.
4. If node was previously offline, sets `is_online = 1` and logs `NODE_ONLINE`.
5. Background worker `startOfflineWatcher()` checks all nodes every 4s:
   - If `now - last_seen > 30s`, transitions `is_online = 0`.
   - Broadcasts `node_status` via WebSocket.

## 6. Hardware Requirements
ESP8266 internal heap monitoring functions (`ESP.getFreeHeap()`, `ESP.getMaxFreeBlockSize()`).

## 7. Device Implementation
- **ESP8266 (4MB)**: Implemented in [`WebServerManager::handleStatus()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L165-L283).
- **ESP32**: Target specification (`esp_get_free_heap_size()`).
- **ESP-01 (1MB)**: Streamlined implementation in [`esp01_1mb/src/web_server.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/web_server.cpp).

## 8. Central Server Implementation
- **Backend**: Implemented in [`central_server_js/src/nodeManager.js: startOfflineWatcher()`](file:///d:/ai/Homeautomation_server/central_server_js/src/nodeManager.js#L32-L71).
- **Frontend**: Health metrics badges in `app.js` (heap meter, RSSI indicator, uptime counter).
- **Database**: SQLite `nodes`, `system_events`, `notifications`.

## 9. API and Protocol
- Node: `GET /api/status`
- Server: `GET /api/v1/system/overview`, `GET /api/v1/nodes/:nodeId`

## 10. Data Storage
- SQLite `nodes` table columns: `rssi`, `uptime_sec`, `free_heap`, `is_online`, `last_seen_epoch`.

## 11. Configuration
Parameter `offline_timeout_sec` in `config.json` (default: 30 seconds).

## 12. Error Handling
Nodes that miss heartbeats are safely marked `Offline` without terminating server listener sockets.

## 13. Security
Diagnostic endpoint `GET /api/status` is open on edge nodes to allow local network discovery.

## 14. Testing
Tested on hardware node `192.168.1.105`. Disconnecting power triggered offline transition exactly at 30 seconds.

## 15. Source References
- Edge: [`esp8266_4mb/src/web_server.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L165-L283)
- Server: [`central_server_js/src/nodeManager.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/nodeManager.js#L32-L71)

## 16. Known Limitations
If an edge node enters a tight loop without yielding, it will freeze until the hardware watchdog triggers a reset.

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `GET /api/status` metrics |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | IMPLEMENTED | `GET /api/status` metrics |
| Central Server | IMPLEMENTED | `nodeManager.startOfflineWatcher()` |
| Dashboard | IMPLEMENTED | Overview and node cards in `app.js` |

## 18. Future Improvements
Add CPU utilization tracking and LittleFS write endurance wear percentage meters.
