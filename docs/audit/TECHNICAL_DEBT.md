# TECHNICAL DEBT & ARCHITECTURAL INCONSISTENCIES

**Audit Date**: 2026-11-07  
**Scope**: Code Smells, Duplicate Implementations, and Maintenance Hotspots  

---

## 1. Technical Debt Register

| Debt ID | Component | Description | Impact | Refactoring Recommendation |
|---|---|---|---|---|
| **DEBT-001** | Documentation / Root | Root `README.md` documents a deleted Python FastAPI backend and deleted Mosquitto MQTT broker. | High confusion for new developers joining the project. | Update root `README.md` to reflect `central_server_js` (Node.js/SQLite). |
| **DEBT-002** | Device 02 (ESP32) | ESP32 platform is completely absent from the codebase despite being treated as an active device in ecosystem specs. | Blocks deployment of high-density 16-channel controllers. | Implement `esp32_wroom` PlatformIO project adhering to protocol standards. |
| **DEBT-003** | Server & Firmware | Action `syncConfig` dispatched by `configSyncService.js` is not recognized by `web_server.cpp` `handleCommand()`. | Full configuration push fails with "Unknown command action". | Add `syncConfig` action handler in firmware `handleCommand()`. |
| **DEBT-004** | Firmware Dual Codebases | `app2/` and `esp8266_4mb/` contain 90% duplicated C++ code. | Divergent bug fixes; maintenance overhead. | Archive or delete `app2/` and designate `esp8266_4mb/` as the single canonical source. |
| **DEBT-005** | Firmware Web Dashboard | Firmware contains both LittleFS files (`data/app.js`, `index.html`) and hardcoded C-header strings (`dashboard_html.h`). | Changes to HTML/JS in `data/` are not automatically reflected in `dashboard_html.h`. | Implement an automated build script (`compress_dashboard.py`) for ESP8266 4MB as done in ESP-01. |
| **DEBT-006** | Scratch Development Files | Unused scratch files (`scratch/patch_app_js.py`, `scratch/update_app_props.py`) present in workspace. | Clutters repository root. | Move scratch scripts into dedicated internal tooling folder. |
