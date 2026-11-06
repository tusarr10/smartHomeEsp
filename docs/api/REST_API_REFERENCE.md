# REST API REFERENCE MANUAL

**Server Port**: `9100` (`/api/v1/*` and `/api/*`)  
**Microcontroller Port**: `80` (`/api/*`)  
**Data Format**: JSON (`Content-Type: application/json`)  
**Evidence Source**: Direct inspection of `v1Router.js`, `legacyRouter.js`, and `web_server.cpp`  

---

## 1. Central Server Core REST Endpoints (`/api/v1/*`)

### 1.1 Ingest Telemetry (`POST /api/telemetry` or `POST /api/node/telemetry`)
- **Method**: `POST`
- **Purpose**: Microcontroller telemetry transmission (HTTP alternative to raw TCP socket).
- **Authentication**: Optional Bearer token or pre-shared `token` field in payload.
- **Required Headers**: `Content-Type: application/json`, `X-Node-ID: <nodeId>` (optional).
- **Server Handler**: [`legacyRouter.js: handleTelemetry()`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/legacyRouter.js#L14-L28)
- **Database Tables**: `nodes`, `relays`, `relay_events`, `telemetry_logs`, `audit_logs`
- **Request JSON**:
  ```json
  {
    "nodeId": "NODE-BCDDC223386C",
    "nodeName": "Living Room Node",
    "eventType": "heartbeat",
    "timestamp": "2026-11-07 00:25:00",
    "epoch": 1793400900,
    "ip": "192.168.1.105",
    "rssi": -54,
    "uptimeSec": 12480,
    "freeHeap": 26840,
    "channels": [
      { "id": 1, "pin": 5, "name": "Main Light", "state": true }
    ],
    "acks": []
  }
  ```
- **Response JSON (HTTP 200)**:
  ```json
  {
    "status": "ok",
    "epoch": 1793400901,
    "commands": []
  }
  ```

---

### 1.2 Get Fleet Overview (`GET /api/v1/system/overview`)
- **Method**: `GET`
- **Purpose**: High-level telemetry statistics for topbar and overview dashboard.
- **Authentication**: Unauthenticated / Open.
- **Server Handler**: [`v1Router.js: line 251`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/v1Router.js#L251)
- **Calling Frontend**: `updateOverviewMetrics()` in `app.js`
- **Response JSON (HTTP 200)**:
  ```json
  {
    "success": true,
    "totalNodes": 3,
    "onlineNodes": 2,
    "offlineNodes": 1,
    "totalRelays": 10,
    "activeRelays": 4,
    "packetsReceived": 14205,
    "serverUptimeSec": 86400,
    "dbSizeKb": 1240
  }
  ```

---

### 1.3 List All Nodes (`GET /api/v1/nodes`)
- **Method**: `GET`
- **Purpose**: Returns complete fleet inventory with real-time status and channels.
- **Authentication**: Requires valid user session token (`authenticateUser`).
- **Headers**: `Authorization: Bearer <session_token>`
- **Server Handler**: [`v1Router.js: line 255`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/v1Router.js#L255)
- **Database Tables**: `nodes`, `relays`
- **Response JSON (HTTP 200)**:
  ```json
  {
    "success": true,
    "nodes": [
      {
        "node_id": "NODE-BCDDC223386C",
        "name": "NodeMCU-01",
        "hardware_type": "ESP8266",
        "ip_address": "192.168.1.105",
        "mac_address": "BC:DD:C2:23:38:6C",
        "rssi": -52,
        "uptime_sec": 12480,
        "free_heap": 26840,
        "is_online": 1,
        "status": "Online",
        "channels": [
          { "id": 1, "pin": 5, "name": "Light", "current_state": 1 }
        ]
      }
    ]
  }
  ```

---

### 1.4 Switch Relay / Execute Command (`POST /api/v1/relays/:nodeId/:channelId/command`)
- **Method**: `POST`
- **Purpose**: Controls relay state, toggle, or pulse on a target microcontroller.
- **Authentication**: Required permission `devices:control`.
- **Path Parameters**: `nodeId` (string), `channelId` (integer).
- **Request JSON**:
  ```json
  {
    "action": "setState",
    "state": true
  }
  ```
  *(Or `action: "toggle"`, or `action: "pulse", "duration": 500`)*
- **Server Execution Sequence**:
  1. Validates user permission (`devices:control`).
  2. Queries target node IP from `nodes` table.
  3. Dispatches immediate direct HTTP call to node at `http://${ip}/api/commands/execute`.
  4. If direct call succeeds, updates `relays` table state, logs `relay_events`, and broadcasts `relay_changed` via WebSocket.
  5. If direct call fails or node is offline, enqueues persistent command in `device_commands` table for delivery on next check-in.
- **Response JSON (HTTP 200)**:
  ```json
  {
    "success": true,
    "dispatched": "DIRECT_HTTP",
    "nodeId": "NODE-BCDDC223386C",
    "channelId": 1,
    "state": true,
    "executionTimeMs": 42
  }
  ```

---

### 1.5 Scan Subnet for IoT Devices (`POST /api/v1/nodes/discovery/scan`)
- **Method**: `POST`
- **Purpose**: Sweeps local IPv4 subnet to discover unmanaged ESP8266/ESP32 nodes.
- **Authentication**: Required permission `devices:manage`.
- **Request JSON**:
  ```json
  {
    "subnet": "192.168.1",
    "startIp": 1,
    "endIp": 254,
    "concurrency": 24,
    "timeoutMs": 1200
  }
  ```
- **Server Handler**: [`discoveryService.js: probeIp()`](file:///d:/ai/Homeautomation_server/central_server_js/src/discoveryService.js#L52-L100)
- **Response JSON (HTTP 200)**:
  ```json
  {
    "success": true,
    "scannedCount": 254,
    "discoveredDevices": [
      {
        "found": true,
        "ip": "192.168.1.105",
        "statusCode": 200,
        "deviceName": "SmartHome-NodeMCU",
        "hardware": "ESP8266",
        "firmwareVersion": "1.6.0",
        "mac": "BC:DD:C2:23:38:6C",
        "rssi": -52,
        "freeHeap": 26840
      }
    ]
  }
  ```

---

### 1.6 Managed OTA Firmware Deployment (`POST /api/v1/ota/deploy`)
- **Method**: `POST`
- **Purpose**: Complete end-to-end OTA flashing with pre-flight check, backup, and post-verify.
- **Authentication**: Required permission `firmware:deploy`.
- **Request JSON**:
  ```json
  {
    "nodeId": "NODE-BCDDC223386C",
    "firmwareId": 1,
    "autoBackup": true,
    "postVerify": true
  }
  ```
- **Server Execution Pipeline**:
  1. Queries node diagnostics (`GET http://${ip}/api/status`). Verifies `freeSketchSpace >= fw.file_size_bytes` and `freeHeap >= 18000`.
  2. If `autoBackup` is true, fetches current config snapshot (`GET http://${ip}/api/backup/download`) and saves to `data/backups/`.
  3. Streams firmware binary via multipart/form-data POST to `http://${ip}/api/ota/upload`.
  4. Waits 5 seconds for node reboot, then polls `/api/status` for up to 30 seconds to verify handshake.
- **Response JSON (HTTP 200)**:
  ```json
  {
    "success": true,
    "nodeId": "NODE-BCDDC223386C",
    "durationMs": 14200,
    "versionFrom": "1.5.0",
    "versionTo": "1.6.0",
    "handshake": { "online": true, "versionMatch": true },
    "backupId": 12
  }
  ```

---

## 2. Microcontroller Inbound REST Endpoints (Port 80)

Implemented by `WebServerManager` in `web_server.cpp`:

| Endpoint | Method | Purpose | Authentication | Request Body | Response Body |
|---|---|---|---|---|---|
| `/api/status` | GET | Diagnostic telemetry | Optional Basic/Bearer | None | `{"nodeId":"...","freeHeap":25400,"rssi":-54}` |
| `/api/all` | GET | Complete state dump | None | None | Comprehensive system state JSON |
| `/api/gpio` | GET | List channels | None | None | `[{"id":1,"pin":5,"state":false}]` |
| `/api/gpio/state` | POST | Switch relay | Basic / Token | `{"id":1,"state":true}` | `{"success":true,"id":1,"state":true}` |
| `/api/command` | POST | Remote command | Basic / Token | `{"action":"setState","id":1,"state":true}` | `{"status":"ACKNOWLEDGED","success":true}` |
| `/api/commands/execute` | POST | Multi-action command | Basic / Token | `{"action":"pulse","id":1,"duration":500}` | `{"commandId":"...","status":"ACKNOWLEDGED"}` |
| `/api/wifi/connect` | POST | Set Wi-Fi credentials | Basic / Token | `{"ssid":"...","pass":"..."}` | `{"success":true,"message":"Connecting..."}` |
| `/api/wifi/scan` | GET | Scan Wi-Fi APs | Basic / Token | None | `[{"ssid":"Home","rssi":-54}]` |
| `/api/system/reboot`| POST | Soft reboot | Basic / Token | None | `{"success":true,"message":"Rebooting..."}` |
| `/api/ota/upload` | POST | Firmware binary upload | Basic / Token | Multipart file | `{"success":true,"message":"Rebooting..."}` |
| `/api/fs/list` | GET | List LittleFS files | Basic / Token | None | `{"totalBytes":2097152,"files":[...]}` |
| `/api/backup/download`| GET | Download backup JSON | Basic / Token | None | Streamed JSON config bundle |
| `/index.html` | GET | Web SPA UI | None | None | HTML web page (LittleFS or PROGMEM) |
