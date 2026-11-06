# MASTER ECOSYSTEM FORENSIC AUDIT & ARCHITECTURE REPORT

**Document ID**: AUDIT-SMARTHOME-2026-FINAL  
**Audit Date**: 2026-11-07  
**Scope**: Complete Ecosystem Static Code Analysis, Forensic Workspace Review, API Cataloging, and Architectural Synthesis  
**Target Repository**: `d:\ai\Homeautomation_server`  
**Auditor**: Senior Embedded Systems Architect, IoT Backend Architect & Lead Software Auditor  

---

## 1. Executive Summary

A forensic software audit and architectural discovery were conducted on the Smart Home Ecosystem codebase. 

The ecosystem is designed as a distributed, multi-node IoT smart home control and telemetry platform. The audit verified:
1. **The Active Edge Fleet**:
   - **Device 01 (ESP8266 4MB)**: Fully implemented in [`esp8266_4mb/`](file:///d:/ai/Homeautomation_server/esp8266_4mb) as a high-capability multi-channel relay controller with power-loss state persistence, local NTP rules engine, LittleFS web server, and dual PROGMEM fallback.
   - **Device 03 (ESP-01 1MB)**: Fully implemented in [`esp01_1mb/`](file:///d:/ai/Homeautomation_server/esp01_1mb) as a flash-optimized, thin-satellite actuator with pre-compressed gzip PROGMEM dashboard serving, stripped floating-point operations, and offloaded automations.
   - **Device 02 (ESP32)**: **ABSENT FROM REPOSITORY**. Despite ecosystem documentation referencing an ESP32 device, no firmware source code, PlatformIO configuration, or partition tables exist for the ESP32 in this codebase.
2. **The Authoritative Central Server**:
   - The active central management platform is [`central_server_js/`](file:///d:/ai/Homeautomation_server/central_server_js), an asynchronous Node.js daemon utilizing built-in `node:sqlite` in Write-Ahead Logging (WAL) mode, a raw TCP telemetry socket listener on port 2000, an Express REST API on port 9100, and a zero-dependency 17-section Single Page Application (SPA) dashboard.
   - A previously documented Python FastAPI and Mosquitto backend (`central_server`) was deprecated and removed in commit `9ada843`.
3. **Communication & Protocols**:
   - Primary telemetry and bi-directional command delivery occur over **Raw TCP Sockets on Port 2000** (line-delimited JSON) and **HTTP REST on Port 9100**.
   - Live dashboard updates are streamed via **WebSockets (`/api/v1/ws`)** with Server-Sent Events (`/api/events`) fallback.
   - **MQTT is NOT IMPLEMENTED** in current active firmware or server code.

The audit discovered critical security vulnerabilities (plaintext password storage in flash memory, hardcoded default backdoors, IP-based auth bypass) and an architectural command discrepancy in configuration synchronization. A prioritized development roadmap has been established to resolve these findings.

---

## 2. Repository Inventory

| Project Identifier | Directory | Language | Framework / Runtime | Build System | Status / Purpose |
|---|---|---|---|---|---|
| **Device 01 (ESP8266 4MB)** | [`esp8266_4mb/`](file:///d:/ai/Homeautomation_server/esp8266_4mb) | C++ / C | Arduino ESP8266 Core v3.1.2 | PlatformIO (`nodemcuv2`, `eagle.flash.4m2m.ld`) | **ACTIVE PRODUCTION**: 4MB flagship controller with 2MB LittleFS partition, local cron automation, dual dashboard fallback. |
| **Device 03 (ESP-01 1MB)** | [`esp01_1mb/`](file:///d:/ai/Homeautomation_server/esp01_1mb) | C++ / C | Arduino ESP8266 Core (SDK 2.2.1) | PlatformIO (`esp01_1m`, `eagle.flash.1m.ld`, `-Os`, `strip_floats.py`) | **ACTIVE PRODUCTION**: 1MB satellite node, PROGMEM gzip dashboard, stripped floats, offloaded automation. |
| **Device 02 (ESP32)** | *(None)* | N/A | N/A | N/A | **ABSENT / UNIMPLEMENTED**: No firmware exists in repository. Architectural blueprint documented. |
| **ESP8266 Baseline (app2)** | [`app2/`](file:///d:/ai/Homeautomation_server/app2) | C++ / C | Arduino ESP8266 Core | PlatformIO (`nodemcuv2`) | **LEGACY BASELINE**: Earlier development iteration of ESP8266 firmware prior to dual PROGMEM dashboard fallback. |
| **ESP8266 Archive v1.6.0** | [`app2_backup_v1.6.0/`](file:///d:/ai/Homeautomation_server/app2_backup_v1.6.0) | C++ / C | Arduino ESP8266 Core | PlatformIO (`nodemcuv2`) | **ARCHIVED BACKUP**: Historical freeze point prior to async TCP state machine integration. |
| **Central Fleet Server** | [`central_server_js/`](file:///d:/ai/Homeautomation_server/central_server_js) | JavaScript (Node.js CommonJS) | Express v4.21.2, WebSocket (`ws` v8.18.0), `node:sqlite` | Node.js (`package.json`, `node --experimental-sqlite`) | **ACTIVE PRODUCTION**: Authoritative fleet server with raw TCP port 2000, HTTP port 9100, 28-table SQLite database, and 17-section SPA dashboard. |
| **Hardware Benchmark Suite** | [`doc/`](file:///d:/ai/Homeautomation_server/doc) | Python / Markdown / CSV / JSON | Matplotlib, Requests | Standalone Python Scripts | **BENCHMARK DATA**: Empirical memory readings, heap fragmentation logs, and live REST scans from physical node `192.168.1.105`. |
| **Event Heap Audit** | [`event_audit/`](file:///d:/ai/Homeautomation_server/event_audit) | Python | Matplotlib, Requests | Standalone Python Scripts | **BENCHMARK DATA**: Memory recovery analysis under rapid event-driven telemetry bursts. |
| **Concurrency Stress Suite** | [`stress_test/`](file:///d:/ai/Homeautomation_server/stress_test) | Python | Matplotlib, Requests | Standalone Python Scripts | **BENCHMARK DATA**: Concurrency stress benchmarks (2, 3, 5 concurrent clients) and raw TCP socket analysis. |
| **Developer Scratchpad** | [`scratch/`](file:///d:/ai/Homeautomation_server/scratch) | Python | Standard Library | Standalone Python Scripts | **INTERNAL SCRIPTS**: Scratchpad test harness (`test_api_suite.py`) and UI bundle patching scripts. |

---

## 3. Device Audit Summary

### Device 01: NodeMCU ESP8266 (4MB Flash)
- **Microcontroller**: Tensilica Xtensa L106 @ 80 MHz, 80 KB SRAM (~25 KB free heap), 4MB SPI Flash.
- **Partition Layout**: 2MB Program Binary / 2MB LittleFS Filesystem (`eagle.flash.4m2m.ld`).
- **Relay Actuation**: Up to 8 channels direct GPIO control (`digitalWrite`). Validated against `PIN_SAFETY_MAP` in `config.h`. Safe pins: D1 (GPIO5), D2 (GPIO4), D5 (GPIO14), D6 (GPIO12), D7 (GPIO13). Boot sensitive: D0, D3, D4, D8.
- **State Persistence**: Power-loss states persisted to `/config/gpio.json`; exact states restored on boot according to `initialMode`.
- **Local Automation**: NTP client (IST UTC+05:30), daily cron schedules (`RULE_DAILY_SCHEDULE`), auto-off countdown timers (`RULE_TIMER_AUTO_OFF`), and mutual exclusion interlocks (`RULE_INTERLOCK`).
- **Web UI & OTA**: Serves full SPA from LittleFS with automatic fallback to PROGMEM compressed dashboard (`dashboard_html.h`) if LittleFS is missing. ArduinoOTA on port 8266 and web multipart upload on `/api/ota/upload`.

### Device 02: ESP32 (Absent / Target Specification)
- **Status**: **ABSENT FROM CODEBASE**.
- **Architectural Role**: Designed for high-density electrical panels (16 relays) and analog multi-sensor data acquisition.
- **Target Specification**: Dual-core Tensilica Xtensa LX6 @ 240 MHz, 520 KB SRAM (~320 KB free heap), FreeRTOS SMP task separation (Core 0 for Wi-Fi/TCP, Core 1 for real-time relay actuation and ADC1 sensor sampling).

### Device 03: ESP-01 / ESP-01S (1MB Flash)
- **Microcontroller**: Tensilica Xtensa L106 @ 80 MHz, 1MB SPI Flash (`eagle.flash.1m.ld`, `dout` flash mode).
- **Physical Header**: 8-pin package. Direct relay control on GPIO 0 (Relay 1) and GPIO 2 (Relay 2 / Blue LED).
- **No Shift Register**: Direct pin driving; 74HC595 shift registers are not implemented.
- **Reset Pin Safety**: Factory reset button explicitly disabled (`#define FACTORY_RESET_PIN 255`) to prevent relay activation on GPIO 0 from triggering credential erasure.
- **Lean Satellite Model**: In-memory gzip compressed dashboard in PROGMEM (`dashboard_html.h`), zero web assets in LittleFS, 64KB LittleFS partition reserved for JSON configs, floating-point operations stripped via `strip_floats.py`, local cron automations offloaded to Central Server.

---

## 4. Central Server Audit Summary

### Backend Daemon
- **Architecture**: Service-oriented event-driven Node.js application (`server.js`).
- **Listeners**: Raw TCP server on port 2000 (`tcpServer.js`), Express HTTP server on port 9100, WebSocket server on `/api/v1/ws`.
- **Workers**: `startOfflineWatcher()` (4s cycle, 30s timeout) and `startPeriodicStatusPoller()` (10s active health and pin poll).
- **Services**:
  - `otaService.js`: Managed OTA deployment pipeline (pre-check diagnostics, auto-backup, stream flashing, post-verify handshake).
  - `littlefsService.js`: Remote LittleFS filesystem explorer, file uploader, downloader, and archiver.
  - `discoveryService.js`: Subnet IP sweeper with concurrent chunked HTTP probes.
  - `configSyncService.js`: Authoritative device configuration versioning with SHA-256 validation.

### Database Layer
- **Engine**: SQLite via built-in `node:sqlite` (`DatabaseSync`) in Write-Ahead Logging (WAL) mode with 5000ms busy timeout.
- **Schema**: 28 fully normalized relational tables covering Nodes, Relays, Relay Events, Sensors, Telemetry Logs, Audit Logs, System Events, Notifications, Automations, Firmware, Node Backups, OTA History, RBAC (Users, Roles, Permissions, Scopes, Sessions), Capabilities, Commands, Command Results, Filesystem Files, Filesystem Backups, and Configurations.

### Frontend Dashboard
- **Technology**: Zero-dependency vanilla HTML5/CSS3/JavaScript SPA (no Node build step or external CDN links).
- **Navigation**: 17 dedicated operational sections: Overview, Nodes, GPIO/Relays, Sensors, Automation, Firmware/OTA, LittleFS Manager, Config & Sync, Command Center, Telemetry, Events, Notifications, Network, RBAC & Users, Database, Settings, and System Logs.
- **Real-Time Data**: Bi-directional WebSocket (`connectWebSocket()`) with Server-Sent Events (`initSSE()`) fallback.

---

## 5. Feature Implementation Summary

| Total Features Identified | Implemented | Partial | Offloaded | Not Implemented |
|:---:|:---:|:---:|:---:|:---:|
| **14** | **11** (78.6%) | **2** (14.3%) | **1** (7.1%) | **0** (0.0% on Server) |

- **F001: Device Registration**: IMPLEMENTED on ESP8266, ESP-01, Server, Dashboard.
- **F002: Relay Control**: IMPLEMENTED on ESP8266, ESP-01, Server, Dashboard.
- **F003: State Persistence**: IMPLEMENTED on ESP8266, ESP-01, Server, Dashboard.
- **F004: Telemetry Engine**: IMPLEMENTED on ESP8266, ESP-01, Server, Dashboard.
- **F005: Command Execution**: IMPLEMENTED on ESP8266, ESP-01, Server, Dashboard.
- **F006: Wi-Fi Management**: IMPLEMENTED on ESP8266, ESP-01.
- **F007: Automation Engine**: IMPLEMENTED on ESP8266 and Server; OFFLOADED on ESP-01.
- **F008: OTA Updates**: IMPLEMENTED on ESP8266, ESP-01, Server, Dashboard.
- **F009: LittleFS Filesystem**: IMPLEMENTED on ESP8266 and Server; PARTIAL on ESP-01.
- **F010: Device Discovery**: IMPLEMENTED on Server and Dashboard.
- **F011: RBAC & User Management**: IMPLEMENTED on Server; PARTIAL on edge nodes.
- **F012: Health Diagnostics**: IMPLEMENTED on ESP8266, ESP-01, Server, Dashboard.
- **F013: Config Sync & Rollback**: IMPLEMENTED on Server; PARTIAL on edge nodes (action mismatch).
- **F014: Real-Time Streaming**: IMPLEMENTED on Server and Dashboard.

---

## 6. API & Protocol Summary

- **Central Server REST Endpoints**: 72 endpoints total (60 modern `/api/v1/*` endpoints + 12 legacy `/api/*` endpoints).
- **Edge Microcontroller REST Endpoints**: 35+ endpoints on ESP8266 4MB; 11 endpoints on ESP-01 1MB.
- **Raw TCP Socket Streaming**: Port 2000 newline-delimited (`\n`) UTF-8 JSON stream. Ingests telemetry and dispatches queued commands in reply frames.
- **WebSocket Events**: 5 typed broadcast events (`initial_state`, `telemetry`, `relay_changed`, `node_status`, `notification`).
- **Server-Sent Events (SSE)**: Streamed at `GET /api/events`.
- **MQTT Status**: **NOT IMPLEMENTED**.

---

## 7. Cross-Device Compatibility & Gap Analysis

1. **`syncConfig` Action Discrepancy**: Central Server `configSyncService.js` dispatches `{ "action": "syncConfig", ... }` to `POST /api/commands/execute`. Firmware `web_server.cpp` only recognizes `reboot`, `setState`, `toggle`, `pulse`, and `readInfo`, causing full configuration pushes to fail with HTTP 400.
2. **Codebase Bifurcation**: Firmware was bifurcated into `esp8266_4mb` and `esp01_1mb`, leaving `app2` as an unmaintained legacy baseline with 90% duplicate code.
3. **ESP32 Absence**: ESP32 is referenced in the Central Server UI and subnet scanner, but firmware is completely absent from the repository.

---

## 8. Security Findings Summary

| ID | Severity | Finding Summary | Impact |
|---|---|---|---|
| **SEC-001** | **CRITICAL** | Plaintext Admin Password in LittleFS Flash ([`auth_manager.cpp:122`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/auth_manager.cpp#L122)) | Cleartext password readable via `/api/fs/download` or backup JSON. |
| **SEC-002** | **CRITICAL** | Hardcoded Backdoor Passwords in Firmware Auth ([`auth_manager.cpp:187`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/auth_manager.cpp#L187)) | Default passwords remain valid even after user sets a custom password. |
| **SEC-003** | **HIGH** | Source IP Authentication Bypass ([`web_server.cpp:125-130`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L125-L130)) | Any device assuming Central Server IP bypasses all authentication checks. |
| **SEC-004** | **HIGH** | Hardcoded Credentials in Transparent Fetch ([`app.js:37`](file:///d:/ai/Homeautomation_server/central_server_js/public/assets/app.js#L37)) | Hardcoded `admin:admin123` in client JS; loops on session expiration. |
| **SEC-005** | **MEDIUM** | Unencrypted Plaintext Communication on LAN | Telemetry and commands subject to eavesdropping on untrusted Wi-Fi. |
| **SEC-006** | **LOW** | Dummy SHA-256 Stub on ESP-01 ([`esp01_1mb/src/auth_manager.cpp:10`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/auth_manager.cpp#L10)) | ESP-01 compares plaintext strings rather than SHA-256 hashes. |

---

## 9. Reliability & Performance Findings Summary

- **Xtensa Core Event Loop**: Zero crashes, zero reboots, boot counter verified constant across extensive concurrency benchmarks.
- **Free Heap Stability**: Retained **> 24.5 KB free heap** throughout peak concurrency bursts (standing > 14.5 KB above the 10 KB safety floor).
- **Memory Reclamation**: **100% memory reclaimed** following concurrent request bursts.
- **Fragmentation**: Peak heap fragmentation peaked at **21.95%** (safe threshold: < 30%).
- **TCP Protocol Cleanliness**: Zero socket leaks; deterministic socket destruction with `client.stop(10)`.

---

## 10. Prioritized Development Roadmap

### Priority 1: Critical Bugs & Security Corrections
1. **Patch SEC-001 & SEC-002**: Remove `doc["adminPass"] = _adminPass;` from `auth_manager.cpp`. Remove all hardcoded default password bypasses. Store and validate strictly via one-way hash.
2. **Patch SEC-003**: Delete IP-based auth bypass in `web_server.cpp`. Require Bearer `authToken` validation for server-to-node requests.
3. **Patch SEC-004**: Remove hardcoded credentials from `app.js`. Replace auto-login fallback with an interactive session login modal.

### Priority 2: Device / Server Integration
4. **Resolve `syncConfig` Command Gap (DEBT-003)**: Add `action.equalsIgnoreCase("syncConfig")` handler to `web_server.cpp` `handleCommand()`, allowing authoritative configuration pushes from Central Server to succeed.
5. **Update Root README (DEBT-001)**: Rewrite root `README.md` to document the active Node.js server (`central_server_js`) and current firmware directories, eliminating outdated references to the deleted FastAPI/Mosquitto backend.

### Priority 3: Protocol & Architecture Consistency
6. **Consolidate Firmware Repositories (DEBT-004)**: Archive legacy `app2/` and `app2_backup_v1.6.0/`. Designate `esp8266_4mb/` and `esp01_1mb/` as the canonical firmware directories.
7. **Automate ESP8266 Dashboard Compression (DEBT-005)**: Implement automated build-time gzip compression for `dashboard_html.h` in `esp8266_4mb`, ensuring parity with `esp01_1mb`.

### Priority 4: Missing Functionality Implementation
8. **Develop Device 02 (ESP32 Firmware)**: Initialize `esp32_wroom/` PlatformIO project using FreeRTOS dual-core task architecture, implementing telemetry streaming to port 2000, 16-channel relay actuation, and analog sensor sampling on ADC1.

---

## 11. Audit Limitations

1. **Physical Hardware Scope**: Empirical runtime benchmarks and live REST scans were recorded from hardware node `192.168.1.105` (ESP8266 NodeMCU). ESP-01 and ESP32 runtime behaviors were audited statically from source code and architecture specifications.
2. **No Live External Internet Testing**: Tests were performed in local offline development network; external cloud NTP synchronization latency over cellular WAN was not measured.
3. **Static Security Review**: Vulnerability assessments are based on static code analysis; physical glitching and side-channel power analysis were not conducted.
