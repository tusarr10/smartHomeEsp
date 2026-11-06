# CENTRAL SERVER FORENSIC AUDIT REPORT

**Server Target**: `central_server_js`  
**Runtime**: Node.js v20+ with built-in SQLite (`DatabaseSync`)  
**Audit Scope**: Backend Services, Frontend Views, Database Tables, Security  

---

## 1. Discovered Backend Subsystems

| Subsystem | Source Location | Status | Implementation Details |
|---|---|---|---|
| **Entry Point & Daemon** | [`server.js`](file:///d:/ai/Homeautomation_server/central_server_js/server.js) | **ACTIVE** | Initializes Express on port 9100, Net TCP on port 2000, WebSocket on `/api/v1/ws`, graceful shutdown. |
| **Fleet Node Manager** | [`src/nodeManager.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/nodeManager.js) | **ACTIVE** | Telemetry ingestion, offline watcher (4s check, 30s timeout), active health & pin poller (10s interval), WebSocket/SSE fanout. |
| **Raw TCP Telemetry Server**| [`src/tcpServer.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/tcpServer.js) | **ACTIVE** | Listens on port 2000, splits chunked streams on `\n`, processes telemetry, replies with pending commands. |
| **SQLite Database Layer** | [`src/database.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/database.js) | **ACTIVE** | 28 tables, WAL mode, automatic column migrations, pre-seeded admin user & permissions, 70+ prepared statements. |
| **Enterprise RBAC & Auth** | [`src/auth.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/auth.js) | **ACTIVE** | 6 roles, 26 permissions, PBKDF2 password hashing (100k rounds), 32-byte hex session tokens. |
| **Managed OTA Pipeline** | [`src/otaService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/otaService.js) | **ACTIVE** | Diagnostic check (`/api/status`), pre-flash backup (`/api/backup/download`), multipart upload (`/api/ota/upload`), post-flash verify. |
| **LittleFS Remote Explorer** | [`src/littlefsService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/littlefsService.js) | **ACTIVE** | Interacts with node `/api/fs/*` endpoints; downloads, uploads, deletes, renames, and snapshots filesystem archives. |
| **LAN Subnet Discovery** | [`src/discoveryService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/discoveryService.js) | **ACTIVE** | Enumerates network interfaces, probes IP addresses `.1` to `.254` concurrently (chunks of 24), checks `GET /api/status`. |
| **Authoritative Config Sync**| [`src/configSyncService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/configSyncService.js) | **ACTIVE** | Tracks JSON config versions, computes SHA-256 hashes, maintains rollback history, pushes updates to nodes. |
| **Modern REST API** | [`src/routes/v1Router.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/v1Router.js) | **ACTIVE** | 60+ endpoints under `/api/v1/*` with granular `requirePermission()` middleware. |
| **Legacy REST & SSE API** | [`src/routes/legacyRouter.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/legacyRouter.js) | **ACTIVE** | 12 endpoints under `/api/*`, including `/api/telemetry` and `/api/events` (Server-Sent Events). |
| **MQTT Broker / Client** | *(None)* | **NOT IMPLEMENTED** | Absent from codebase. (Was deleted during migration from FastAPI). |

---

## 2. Discovered Frontend UI Views (Vanilla SPA)

Source: [`central_server_js/public/index.html`](file:///d:/ai/Homeautomation_server/central_server_js/public/index.html) and [`central_server_js/public/assets/app.js`](file:///d:/ai/Homeautomation_server/central_server_js/public/assets/app.js)

1. **Overview**: Metric summary cards (Total Nodes, Online Count, Active Relays, Packets Received, Uptime), quick relay controls, live activity log.
2. **Nodes**: Fleet table with IP, MAC, signal RSSI badge, firmware version, LittleFS progress bar, quick reboot, settings modal, and device deletion.
3. **GPIO / Relays**: Grid of all discovered relay channels across all nodes with room badges, instant toggle switches, and pulse trigger buttons.
4. **Sensors**: Live sensor value tiles, unit badges, and min/max alert thresholds.
5. **Automation**: Rule creator and toggle switchboard for Central Server automation rules.
6. **Firmware / OTA**: Release catalog, binary file uploader, node compatibility validator, precheck diagnostics, and 1-click deployment modal with progress bar.
7. **LittleFS Manager**: Interactive remote file browser for microcontroller flash memory; upload files, download files, delete, rename, and create full filesystem backups.
8. **Config & Sync**: Authoritative JSON configuration editor, SHA-256 status indicator, version history list, and one-click rollback trigger.
9. **Command Center**: Audit trail of dispatched commands (`setState`, `toggle`, `pulse`, `reboot`, `syncConfig`), delivery status (`PENDING`, `DELIVERED`, `ACKNOWLEDGED`), and retry counts.
10. **Telemetry**: Live tabular stream of received telemetry packets with collapsible JSON payloads.
11. **Events**: System event log with severity filtering (`INFO`, `WARNING`, `ERROR`, `CRITICAL`).
12. **Notifications**: Slide-out notification center with unread count badge, mark-as-read, and dismiss options.
13. **Network**: Subnet scanner interface; automatically lists active IPv4 adapters, runs parallel IP sweeps, and allows 1-click node onboarding.
14. **RBAC & Users**: User administration (create user, deactivate, reset password, view active sessions, revoke tokens) and role permission inspector.
15. **Database**: Raw database stats (table row counts, WAL file size, last checkpoint) and manual database vacuum trigger.
16. **Settings**: Polling interval adjustment (e.g. 5s to 60s), offline timeout threshold, server auth token configuration, and instant poll trigger.
17. **System Logs**: Audit trail of administrative actions, authentication attempts, and server startup events.
