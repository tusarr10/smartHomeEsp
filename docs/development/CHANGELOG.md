# ECOSYSTEM CHANGELOG

All notable changes to the Smart Home Ecosystem are documented in this file.

---

## [v1.6.0] - 2026-11-07

### Added
- **PROGMEM Fallback Dashboard**: Added `dashboard_html.h` in `esp8266_4mb` to serve embedded compressed HTML if LittleFS files are missing or unformatted.
- **Hardware Node ID Generation**: Added `ReceiverClient::getHardwareNodeId()` deriving canonical node IDs from MAC OTP eFuse (`NODE-XXXXXXXXXXXX`).
- **Application Command ACKs**: Added `acks` array to outbound telemetry frames to verify execution of remote commands.
- **Node.js Central Server**: Migrated central server from Python FastAPI to Node.js `central_server_js` with built-in SQLite WAL database.
- **Lean Satellite ESP-01 Build**: Created dedicated `esp01_1mb` PlatformIO project with stripped floats and offloaded automations.
- **17-Section SPA Dashboard**: Implemented zero-dependency dark-mode web dashboard in vanilla JavaScript.

### Changed
- Refactored `auth_manager.cpp` with SHA-256 password hash comparison and session tokens.
- Refactored `web_server.cpp` with modernized REST API routing and CORS headers.
- Replaced synchronous TCP telemetry push with non-blocking 3-state machine in `receiver_client.cpp`.

### Deprecated / Removed
- Deprecated and removed legacy Python FastAPI backend (`central_server/backend`) and Mosquitto broker in commit `9ada843`.
- Removed 64-round SHA-256 table from ESP-01 firmware to maximize flash headroom.

---

## [v1.5.0] - 2026-10-31

### Added
- Initial Central Telemetry Receiver integration with raw TCP socket streaming (Port 2000).
- Power-loss relay state persistence via LittleFS JSON configuration.
- Local rules engine with NTP time synchronization (IST UTC+05:30).
- ArduinoOTA wireless firmware updating on port 8266.
