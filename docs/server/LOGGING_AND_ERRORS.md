# CENTRAL SERVER LOGGING, AUDITING & ERROR RECOVERY

**Audit Target**: Log Retention, System Event Categories, and Fault Recovery  
**Source References**: [`central_server_js/src/database.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/database.js), [`central_server_js/src/nodeManager.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/nodeManager.js)  

---

## 1. Log Architecture & Tables

The Central Server segregates logs across three dedicated SQLite tables:

### A. `audit_logs` (Security & Administrative Trail)
- **Columns**: `id`, `timestamp_str`, `epoch`, `category`, `node_id`, `message`
- **Logged Events**:
  - `SERVER_START`: Daemon initialization and listening ports.
  - `AUTH_LOGIN` / `AUTH_FAIL`: User login attempts, IP addresses, and failure lockouts.
  - `NODE_REGISTERED`: Onboarding of new microcontroller nodes.
  - `NODE_OFFLINE`: Node timeout detected by offline watcher.
  - `OTA_DEPLOY_SUCCESS` / `OTA_FLASH_FAILED`: Firmware update attempts.
  - `CONFIG_SYNCED`: Authoritative configuration updates.
  - `USER_CREATED` / `USER_DELETED`: User account modifications.

### B. `system_events` (Operational Health & Lifecycle)
- **Columns**: `id`, `node_id`, `category`, `severity`, `description`, `execution_result`, `timestamp`
- **Severity Levels**:
  - `INFO`: Normal state transitions (e.g. relay switched by schedule).
  - `WARNING`: Node missed heartbeats, high heap fragmentation (>25%), or long round-trip latency (>1000ms).
  - `ERROR`: OTA flash stream interrupted, socket connection refused, or invalid command JSON.
  - `CRITICAL`: Database write failure, persistent node offline during active schedule.

### C. `telemetry_logs` (Raw Telemetry Archive)
- **Columns**: `id`, `node_id`, `event_type`, `timestamp_str`, `epoch`, `ip`, `rssi`, `free_heap`, `uptime_sec`, `payload_json`
- Stores exact incoming JSON payloads for analytical trend monitoring, signal degradation analysis, and heap leak debugging.

---

## 2. Error Recovery Strategies

1. **SQLite WAL Concurrency**:
   - Write-Ahead Logging allows simultaneous reader threads without blocking writes.
   - `PRAGMA busy_timeout = 5000;` prevents database lock errors under burst load.
2. **Graceful Daemon Shutdown**:
   - Traps `SIGINT` and `SIGTERM`.
   - Halts the offline watcher and status poller intervals.
   - Closes raw TCP listener on port 2000.
   - Closes HTTP server on port 9100 after active in-flight requests drain.
3. **Command Queue Fault Tolerance**:
   - If a node is offline when a command is issued, `device_commands` records `status = 'PENDING'`.
   - The moment the node reconnects (via TCP port 2000 or HTTP telemetry), all queued commands are automatically attached to the response payload.
   - Retries up to 3 times before transitioning command status to `FAILED`.
