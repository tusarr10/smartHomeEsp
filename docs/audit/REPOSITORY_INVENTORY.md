# REPOSITORY INVENTORY & FORENSIC CATALOG

**Audit Date**: 2026-11-07  
**Scope**: Complete Workspace Analysis (`d:\ai\Homeautomation_server`)  
**Ecosystem**: Smart Home Multi-Node Fleet Controller & Central Telemetry Platform  

---

## 1. Project Inventory Table

| Project | Directory | Language | Framework / Runtime | Build System | Status / Purpose |
|---|---|---|---|---|---|
| **ESP8266 4MB Firmware** | [`esp8266_4mb/`](file:///d:/ai/Homeautomation_server/esp8266_4mb) | C++ / C (Arduino Core) | Arduino ESP8266 Core v3.1.2 | PlatformIO (`nodemcuv2`, `eagle.flash.4m2m.ld`) | **ACTIVE PRODUCTION**: Primary 4MB multi-channel relay node with LittleFS web UI, local automation engine, and dual PROGMEM fallback. |
| **ESP-01 1MB Firmware** | [`esp01_1mb/`](file:///d:/ai/Homeautomation_server/esp01_1mb) | C++ / C (Arduino Core) | Arduino ESP8266 Core (SDK 2.2.1) | PlatformIO (`esp01_1m`, `eagle.flash.1m.ld`, `-Os`, `strip_floats.py`) | **ACTIVE PRODUCTION**: Flash-constrained 1MB satellite node; embedded compressed gzip dashboard in PROGMEM; stripped float telemetry and offloaded automation engine. |
| **ESP8266 Baseline (app2)** | [`app2/`](file:///d:/ai/Homeautomation_server/app2) | C++ / C (Arduino Core) | Arduino ESP8266 Core | PlatformIO (`nodemcuv2`) | **LEGACY BASELINE**: Earlier development baseline of ESP8266 firmware prior to dual dashboard fallback and eFuse hardware node ID generation. |
| **ESP8266 Snapshot v1.6.0** | [`app2_backup_v1.6.0/`](file:///d:/ai/Homeautomation_server/app2_backup_v1.6.0) | C++ / C (Arduino Core) | Arduino ESP8266 Core | PlatformIO (`nodemcuv2`) | **ARCHIVED BACKUP**: Historical freeze point before asynchronous TCP client state machine integration. |
| **ESP32 Firmware** | *(None)* | N/A | N/A | N/A | **ABSENT / NOT IMPLEMENTED**: No ESP32 firmware exists in codebase; referenced only as an option in server discovery and UI dropdowns. |
| **Central Fleet Server** | [`central_server_js/`](file:///d:/ai/Homeautomation_server/central_server_js) | JavaScript (Node.js CommonJS) | Express v4.21.2, WebSocket (`ws` v8.18.0), `node:sqlite` (DatabaseSync) | Node.js (`package.json`, `node --experimental-sqlite`) | **ACTIVE PRODUCTION**: Central fleet management platform providing raw TCP telemetry receiver (port 2000), HTTP REST API (port 9100), WebSockets, and 17-section SPA dashboard. |
| **Empirical Benchmark Suite** | [`doc/`](file:///d:/ai/Homeautomation_server/doc) | Python / Markdown / CSV / JSON / PNG | Matplotlib, Requests, Urllib3 | Standalone Python Scripts | **TEST SUITE & BENCHMARKS**: Empirical hardware stress test reports, latency charts, memory heap logs, and live REST API scans against node `192.168.1.105`. |
| **Event Heap Audit** | [`event_audit/`](file:///d:/ai/Homeautomation_server/event_audit) | Python | Matplotlib, Requests | Standalone Python Scripts | **TEST SUITE**: Benchmarks memory reclamation, fragmentation, and recovery during high-frequency event pushes. |
| **Stress Testing Hub** | [`stress_test/`](file:///d:/ai/Homeautomation_server/stress_test) | Python | Matplotlib, Requests | Standalone Python Scripts | **TEST SUITE**: Multithreaded concurrency stress testing (2, 3, 5 concurrent clients) and raw TCP telemetry socket benchmarking. |
| **Scratch Development Scripts** | [`scratch/`](file:///d:/ai/Homeautomation_server/scratch) | Python | Standard Library | Standalone Python Scripts | **DEVELOPER UTILITIES**: Scratch test scripts (`test_api_suite.py`) and UI bundle patching scripts (`patch_app_js.py`). |

---

## 2. Directory Breakdown & File Metrics

```
D:\ai\Homeautomation_server
├── app2/                       # 16 files, ~185 KB source
│   ├── data/                   # LittleFS assets (app.js, index.html, style.css)
│   ├── src/                    # C++ modules (auth, gpio, wifi, ota, storage, web, receiver, auto)
│   └── platformio.ini          # PIO config for nodemcuv2
├── app2_backup_v1.6.0/         # 10 files (src only, no data dir)
├── esp8266_4mb/                # 17 files, ~220 KB source
│   ├── data/                   # LittleFS assets (app.js, index.html, style.css)
│   ├── src/                    # C++ modules + PROGMEM fallback (dashboard_html.h)
│   └── platformio.ini          # PIO config with 4M2M LittleFS layout
├── esp01_1mb/                  # 16 files, ~110 KB source
│   ├── src/                    # C++ modules + embedded compressed HTML (dashboard_html.h)
│   ├── compress_dashboard.py   # Build script: converts HTML to gzip C-array
│   ├── strip_floats.py         # Post-build script: strips unused symbols
│   └── platformio.ini          # PIO config with 1M layout & max size optimizations
├── central_server_js/          # Node.js backend & frontend
│   ├── data/                   # SQLite database (fleet.db, fleet.db-wal), firmware store, backups
│   ├── public/                 # Vanilla JS SPA dashboard (index.html, app.js, style.css)
│   ├── src/                    # Node.js backend modules (auth, db, discovery, ota, littlefs, tcp, routes)
│   ├── config.json             # Server runtime settings (ports, poll interval, tokens)
│   ├── package.json            # Node.js dependency manifest
│   ├── server.js               # Application bootstrap entry point
│   ├── run.bat / run.sh        # Windows and Linux process launchers
├── doc/                        # Hardware audit reports, CSV telemetry logs, PNG graphs
├── event_audit/                # Python heap and latency audit scripts & PNGs
├── stress_test/                # Python concurrency stress tools & PNGs
├── scratch/                    # Temporary patch scripts & API verification runner
├── README.md                   # Repository README (historical FastAPI documentation)
├── LICENSE                     # MIT License
└── .gitignore                  # Git ignore rules
```

---

## 3. Discrepancy Between README and Real Repository State

Forensic examination of Git commit history (specifically commit `9ada843` and commit `65a682c`) reveals a major architectural migration:
1. **Deleted FastAPI Central Server**: The original Python FastAPI backend (`central_server/backend`) and React frontend (`central_server/frontend`) described in the root `README.md` were completely removed in commit `9ada843`.
2. **Current Active Central Server**: The active server is `central_server_js/`, a lightweight, dependency-minimal Node.js application utilizing built-in `node:sqlite` (SQLite WAL mode), raw Node `net` sockets for TCP port 2000, and a zero-build-step vanilla JavaScript frontend.
3. **Firmware Bifurcation**: The single `app2` firmware directory was bifurcated into:
   - `esp8266_4mb/`: Full-featured firmware for ESP-12E/F NodeMCU with 4MB flash (2MB LittleFS).
   - `esp01_1mb/`: Streamlined firmware for ESP-01 with 1MB flash, stripped of heavy crypto, floating-point metrics, and local cron automation.
4. **Absent ESP32 Firmware**: Despite architectural planning for an ESP32 node, no ESP32 PlatformIO environment, source files, or partition tables exist in this workspace.
