# PROJECT STRUCTURE & ARCHITECTURAL TAXONOMY

**Audit Date**: 2026-11-07  
**Scope**: Workspace Layout, File Responsibilities, and Module Boundaries  

---

## 1. Directory Structure

```text
D:\ai\Homeautomation_server\
│
├── .gitignore                          # Standard git exclusion rules
├── LICENSE                             # MIT Open Source License
├── README.md                           # Legacy project documentation
│
├── esp8266_4mb\                        # [ACTIVE] NodeMCU / ESP-12E/F 4MB Firmware
│   ├── platformio.ini                  # PIO config: nodemcuv2, 4m2m layout, LWIP2 low memory
│   ├── README.md                       # Device documentation
│   ├── data\                           # Web assets stored in LittleFS Flash Partition
│   │   ├── app.js                      # Browser UI logic (fetch API, WebSocket, dynamic DOM)
│   │   ├── index.html                  # Dark-mode dashboard layout
│   │   └── style.css                   # Custom responsive styling (no CDN dependencies)
│   └── src\                            # C++ Firmware Implementation
│       ├── config.h                    # System pins, defaults, safety map, flash paths
│       ├── main.cpp                    # Setup bootstrap, loop dispatcher, factory reset pin check
│       ├── auth_manager.h / .cpp       # SHA-256 session token management, Basic Auth fallback
│       ├── automation.h / .cpp         # NTP client, daily cron rules, auto-off timers, interlocks
│       ├── dashboard_html.h            # PROGMEM compressed fallback dashboard (served if FS missing)
│       ├── gpio_manager.h / .cpp       # Multi-channel relay control, pulse timer, LittleFS state saving
│       ├── ota_manager.h / .cpp        # ArduinoOTA listener + web upload firmware updater
│       ├── receiver_client.h / .cpp    # Asynchronous TCP & HTTP telemetry client, command executor
│       ├── storage_manager.h / .cpp    # LittleFS lifecycle manager, JSON serialization helpers
│       ├── web_server.h / .cpp         # Port 80 HTTP server, REST endpoints, Captive Portal DNS
│       └── wifi_manager.h / .cpp       # Dual-mode Wi-Fi (AP+STA), DNS captive server, auto-reconnect
│
├── esp01_1mb\                          # [ACTIVE] ESP-01 / ESP-01S 1MB Flash Firmware
│   ├── platformio.ini                  # PIO config: esp01_1m, 1MB layout, size optimization flags
│   ├── README.md                       # ESP-01 device documentation
│   ├── compress_dashboard.py           # Pre-build script: compresses minimal HTML into PROGMEM header
│   ├── strip_floats.py                 # Post-build script: strips unused symbols from elf/bin
│   └── src\                            # Streamlined C++ Implementation
│       ├── config.h                    # Pin definitions (GPIO0, GPIO2, RX, TX), 4-channel max limit
│       ├── main.cpp                    # Minimal setup & loop, disabled reset button (pin 255)
│       ├── auth_manager.h / .cpp       # Lean auth without 64-round SHA-256 table
│       ├── automation.h / .cpp         # Stub automation engine (offloaded to central server)
│       ├── dashboard_html.h            # In-memory gzip compressed web dashboard
│       ├── gpio_manager.h / .cpp       # Static array allocation (zero heap vector allocation)
│       ├── ota_manager.h / .cpp        # Flash-constrained OTA web receiver
│       ├── receiver_client.h / .cpp    # Async TCP telemetry client with stack JSON buffers
│       ├── storage_manager.h / .cpp    # Flash wear-leveling LittleFS wrapper
│       ├── web_server.h / .cpp         # Minimal REST API without file manager routes
│       └── wifi_manager.h / .cpp       # Lean Wi-Fi station & captive portal manager
│
├── central_server_js\                  # [ACTIVE] Central Fleet Management Platform
│   ├── config.json                     # Runtime settings (TCP/HTTP ports, poll intervals, auth token)
│   ├── package.json                    # Node.js dependencies (express, cors, multer, ws)
│   ├── package-lock.json               # Locked dependency tree
│   ├── README.md                       # Central server documentation
│   ├── run.bat / run.sh                # Automation launch scripts for Windows and Linux
│   ├── server.js                       # Primary daemon bootstrap (Express, TCP, WebSocket, DB init)
│   ├── test_rbac_commands_sync.js      # Internal integration test suite
│   ├── data\                           # Data Storage & Persistent State
│   │   ├── fleet.db                    # Primary SQLite database (WAL journal mode)
│   │   ├── fleet.db-shm / -wal         # SQLite shared memory and write-ahead log files
│   │   ├── backups\                    # Automated pre-OTA node configuration snapshots (JSON)
│   │   ├── firmware\                   # Stored firmware binary catalog (.bin)
│   │   └── fs_backups\                 # Complete LittleFS backup archives
│   ├── public\                         # Zero-build Static Single Page Application (SPA)
│   │   ├── index.html                  # 17-section sidebar dashboard
│   │   └── assets\
│   │       ├── app.js                  # Frontend client (WebSocket feed, REST API calls, state store)
│   │       ├── logo.svg                # Brand icon vector
│   │       └── style.css               # Modern dark-mode UI stylesheet
│   └── src\                            # Backend Architecture
│       ├── auth.js                     # RBAC rules, PBKDF2 password hashing, session tokens
│       ├── configSyncService.js        # Authoritative device configuration versioning & push
│       ├── database.js                 # SQLite schema (28 tables), migration logic, query methods
│       ├── discoveryService.js         # Subnet discovery engine (LAN scan across active interfaces)
│       ├── littlefsService.js          # Remote LittleFS file browser, downloader, and backup manager
│       ├── nodeManager.js              # Telemetry receiver, offline watcher, periodic health poller
│       ├── otaService.js               # Managed OTA flash pipeline (diagnostics, backup, upload, verify)
│       ├── tcpServer.js                # Raw TCP server on port 2000 (newline-delimited JSON stream)
│       └── routes\
│           ├── v1Router.js             # Modern REST API (`/api/v1/*`) with RBAC permission enforcement
│           └── legacyRouter.js         # Backward-compatible REST API (`/api/*`) and SSE endpoint
│
├── app2\                               # [LEGACY BASELINE] Earlier ESP8266 Firmware Codebase
│   ├── platformio.ini                  # Prior PIO configuration
│   ├── README.md                       # Earlier documentation
│   ├── data\                           # Prior LittleFS assets
│   └── src\                            # Prior C++ source tree
│
├── app2_backup_v1.6.0\                 # [ARCHIVE] Historical Snapshot of app2
│   ├── platformio.ini                  # Prior build flags
│   └── src\                            # Prior source code
│
├── doc\                                # [BENCHMARKS] Empirical Hardware Test Reports & Scan Logs
│   ├── api_inventory.json              # Live network scan of all endpoints on node `192.168.1.105`
│   ├── memory_audit.py                 # Empirical memory stress test script
│   ├── memory_audit_report.md          # Full heap fragmentation and memory recovery report
│   ├── memory_readings.csv / .json     # Raw recorded memory samples
│   ├── stress_test_report.md           # Stress test findings and latency breakdown
│   ├── combined_stress_report.md       # Concurrency and TCP protocol audit report
│   ├── event_heap_audit_report.md      # Event push memory audit report
│   └── *.png                           # Generated latency, heap, and fragmentation graphs
│
├── event_audit\                        # [BENCHMARKS] High-Frequency Event Heap Testing
│   ├── event_heap_audit.py             # Event trigger benchmark script
│   ├── event_heap_audit_report.md      # Event memory report
│   └── *.png / *.csv / *.json          # Event benchmark datasets and visualizations
│
├── stress_test\                        # [BENCHMARKS] Concurrency & Protocol Benchmark Suite
│   ├── stress_test.py                  # Baseline load test runner
│   ├── phase3_phase4_stress.py         # Multi-client concurrent load runner
│   └── *.png / *.csv / *.json          # Recorded performance metrics and plots
│
└── scratch\                            # [DEV SCRIPTS] Scratchpad Scripts
    ├── patch_app_js.py                 # Script to update frontend bundle properties
    ├── test_api_suite.py               # Functional API test harness
    └── update_app_props.py             # Scratchpad script
```

---

## 2. Component Responsibility Matrix

| Component | Inbound Interfaces | Outbound Interfaces | Storage / State | Primary Responsibility |
|---|---|---|---|---|
| **`esp8266_4mb`** | HTTP:80, DNS:53, OTA:8266 | TCP:2000, HTTP:9100, NTP:123 | LittleFS (2MB), RTC RAM, Hardware Registers | High-capability IoT relay controller with local scheduling, full LittleFS management, and dual-layer Web UI. |
| **`esp01_1mb`** | HTTP:80, DNS:53, OTA:8266 | TCP:2000, HTTP:9100 | LittleFS (64KB), Hardware Registers | Ultra-compact 2-to-4 channel relay actuator designed for space- and power-constrained enclosures. |
| **`central_server_js`** | TCP:2000, HTTP:9100, WS:9100 | HTTP:80 (Direct Node REST API), Local Subnet ICMP/HTTP | SQLite (`fleet.db`), Local Disk (`data/firmware`, `data/backups`) | Authoritative fleet coordinator, telemetry collector, command queue manager, OTA deployer, and UI web server. |
| **Browser SPA** | WebSocket, SSE, HTTP REST | HTTP REST, WebSocket | LocalStorage (`smarthome_token`), In-Memory DOM | Single-pane-of-glass operator dashboard for fleet control, configuration, and monitoring. |
