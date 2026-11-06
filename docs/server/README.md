# CENTRAL SERVER ARCHITECTURE & OPERATIONAL GUIDE

**Application**: SmartHome Central Fleet Management Platform  
**Runtime**: Node.js v20+ / CommonJS (`--experimental-sqlite`)  
**Source Directory**: [`central_server_js/`](file:///d:/ai/Homeautomation_server/central_server_js)  
**Version**: `1.6.0`  

---

## 1. Executive Summary

The Central Server is the authoritative management and telemetry collection hub for all distributed IoT microcontrollers in the smart home ecosystem.

Engineered in Node.js, the server eliminates heavy third-party database dependencies by utilizing Node.js built-in `node:sqlite` in high-concurrency Write-Ahead Logging (WAL) mode.

### Core Capabilities:
1. **Multi-Protocol Telemetry Ingestion**:
   - **Port 2000 (Raw TCP Socket)**: High-speed newline-delimited JSON telemetry stream for industrial microcontroller hubs.
   - **Port 9100 (HTTP REST)**: Standard HTTP POST endpoints (`/api/v1/telemetry`, `/api/node/telemetry`).
2. **Bi-Directional Command Center**:
   - Queues remote actuation commands (`setState`, `toggle`, `pulse`, `reboot`, `syncConfig`).
   - Dispatches commands immediately via direct HTTP or returns them in socket responses.
   - Tracks application-level acknowledgements (ACKs) with unique UUIDs.
3. **Managed Over-The-Air (OTA) Pipeline**:
   - Firmware binary catalog with MD5/SHA-256 checksums.
   - Pre-flash diagnostics (free heap, free sketch space, RTT check).
   - Automated pre-OTA configuration backups and post-flash verification handshakes.
4. **Remote LittleFS Filesystem Explorer**:
   - Inspects remote files, file sizes, and storage metrics on microcontroller flash memory.
   - Remote upload, download, deletion, renaming, and snapshot backup creation.
5. **Authoritative Device Configuration & Rollback**:
   - Versioned device configurations with SHA-256 checksum validation.
   - One-click rollback to prior configuration revisions.
6. **Enterprise Role-Based Access Control (RBAC)**:
   - 6 System Roles (`SUPER_ADMIN`, `ADMIN`, `DEVICE_MANAGER`, `OPERATOR`, `VIEWER`, `DEVELOPER`).
   - 26 Granular Permissions across System, Users, Devices, Firmware, Filesystem, Config, Commands, Telemetry, and Audit.
   - Salted PBKDF2 (SHA-512, 100,000 iterations) password hashing.
7. **Zero-Build Single Page Application (SPA)**:
   - 17-section operator dashboard in dark mode, built with pure HTML5, CSS3, and vanilla JavaScript without external CDN or Node build dependencies.
   - Real-time updates delivered via dual WebSockets (`/api/v1/ws`) and Server-Sent Events (`/api/events`).

---

## 2. Server Documentation Map

| Document | Purpose |
|---|---|
| [**SERVER_AUDIT.md**](file:///d:/ai/Homeautomation_server/docs/server/SERVER_AUDIT.md) | Forensic audit of backend services, frontend views, and database models. |
| [**BACKEND_ARCHITECTURE.md**](file:///d:/ai/Homeautomation_server/docs/server/BACKEND_ARCHITECTURE.md) | Node.js processes, socket lifecycle, command queuing, poller threads, and services. |
| [**FRONTEND_ARCHITECTURE.md**](file:///d:/ai/Homeautomation_server/docs/server/FRONTEND_ARCHITECTURE.md) | 17-section SPA navigation, WebSocket client, state store, and modal controllers. |
| [**DATABASE_SCHEMA.md**](file:///d:/ai/Homeautomation_server/docs/server/DATABASE_SCHEMA.md) | Exhaustive DDL reference for all 28 SQLite tables, foreign keys, and indexes. |
| [**AUTHENTICATION.md**](file:///d:/ai/Homeautomation_server/docs/server/AUTHENTICATION.md) | RBAC hierarchy, permissions matrix, session tokens, and security audits. |
| [**DEPLOYMENT.md**](file:///d:/ai/Homeautomation_server/docs/server/DEPLOYMENT.md) | Windows and Linux system service setup, PM2, Docker, firewall ports, and scripts. |
| [**CONFIGURATION.md**](file:///d:/ai/Homeautomation_server/docs/server/CONFIGURATION.md) | `config.json` schema, environment overrides, port mappings, and timeouts. |
| [**LOGGING_AND_ERRORS.md**](file:///d:/ai/Homeautomation_server/docs/server/LOGGING_AND_ERRORS.md) | SQLite audit logs, system event severity levels, error handling, and recovery. |
