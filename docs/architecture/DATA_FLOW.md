# END-TO-END DATA FLOW SEQUENCES

**Scope**: Step-by-Step Data Sequences for Critical System Use-Cases  

---

## 1. Flow 1: High-Frequency Relay Actuation Flow

When an operator clicks a relay toggle on the Web Dashboard:

```mermaid
sequenceDiagram
    autonumber
    actor User as Operator (Browser)
    participant UI as Web Dashboard SPA
    participant Server as Central Server (v1Router)
    participant Node as Microcontroller (ESP8266 / ESP-01)
    participant DB as SQLite Database
    participant WS as Connected Browsers

    User->>UI: Clicks "Toggle" on Living Room Light
    UI->>Server: POST /api/v1/relays/NODE-01/1/command {"action":"toggle"}
    Note over Server: Check user permission (devices:control)
    Server->>Node: Direct HTTP POST /api/commands/execute
    Note over Node: GpioManager::toggle(1)<br/>applyPhysicalPin()<br/>Saves state to LittleFS
    Node-->>Server: HTTP 200 {"status":"ACKNOWLEDGED","success":true,"state":true}
    Server->>DB: UPDATE relays SET current_state = 1
    Server->>DB: INSERT INTO relay_events (node_id, channel_id, new_state)
    Server->>WS: Broadcast WebSocket 'relay_changed'
    Server-->>UI: HTTP 200 {"success":true,"state":true}
    WS-->>UI: Update toggle switch DOM instantly
```

---

## 2. Flow 2: Offline Command Queueing & Heartbeat Delivery

When a command is dispatched while the node is temporarily offline:

```mermaid
sequenceDiagram
    autonumber
    actor User as Operator (Browser)
    participant Server as Central Server
    participant DB as SQLite Database
    participant Node as Microcontroller (Offline)

    User->>Server: POST /api/v1/relays/NODE-01/1/command {"action":"setState","state":false}
    Server->>Node: Direct HTTP POST (Port 80)
    Note over Server: Connection Refused / Timeout (Node is Offline)
    Server->>DB: INSERT INTO device_commands (command_uuid, status='PENDING')
    Server-->>User: HTTP 200 {"success":true,"dispatched":"QUEUED_OFFLINE"}

    Note over Node: Power restored! Wi-Fi connects.
    Node->>Server: Connect to TCP Port 2000 (Sends Telemetry Frame)
    Note over Server: NodeManager::processTelemetry()<br/>Queries device_commands for NODE-01
    Server->>Node: TCP Response {"status":"ok","commands":[{"command_uuid":"...","action":"setState","state":false}]}
    Note over Node: ReceiverClient processes command<br/>Executes setState(1, false)<br/>Records ACK with UUID
    Node->>Server: Next TCP Telemetry Frame includes 'acks' array
    Server->>DB: UPDATE device_commands SET status = 'ACKNOWLEDGED'
```

---

## 3. Flow 3: Managed Over-The-Air (OTA) Deployment Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Administrator
    participant Server as Central Server (OtaService)
    participant Node as NodeMCU ESP8266
    participant DB as SQLite Database

    User->>Server: POST /api/v1/ota/deploy {"nodeId":"NODE-01","firmwareId":1}
    Server->>DB: INSERT INTO ota_history (status='PENDING')
    Server->>Node: GET /api/status (Pre-check Diagnostics)
    Node-->>Server: Return freeSketchSpace, freeHeap, flashSize
    Note over Server: Verify freeSketchSpace > binary size & freeHeap > 18KB
    Server->>Node: GET /api/backup/download (Pre-flash Backup)
    Node-->>Server: Stream JSON configuration bundle
    Server->>Server: Save to data/backups/backup_NODE-01_timestamp.json
    Server->>Node: POST /api/ota/upload (Stream firmware.bin via multipart)
    Note over Node: Update.begin() -> Update.write() -> Update.end(true)
    Node-->>Server: HTTP 200 {"success":true,"message":"Rebooting..."}
    Note over Node: ESP.restart()
    Note over Server: Wait 5s, then poll GET /api/status every 2s (Handshake)
    Node-->>Server: HTTP 200 {"nodeId":"NODE-01","firmwareVersion":"1.6.0"}
    Server->>DB: UPDATE ota_history SET status='SUCCESS', duration_ms=14200
    Server->>DB: INSERT INTO audit_logs ('OTA_DEPLOY_SUCCESS')
```
