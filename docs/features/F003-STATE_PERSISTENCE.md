# F003 – RELAY STATE PERSISTENCE & POWER-LOSS RECOVERY

## 1. Feature Information
- **Feature ID**: F003
- **Feature Name**: Power-Loss Relay State Persistence & Boot Restoration
- **Version**: 1.6.0
- **Category**: Reliability & Hardware Safety
- **Priority**: High
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Prevents unintended load shedding and preserves user comfort by saving relay states across power blackouts and restoring exact states immediately upon power restoration.

## 3. Actual Functionality
Whenever a relay state changes, the updated logical state is written to flash LittleFS `/config/gpio.json`. On reboot, the firmware parses `initialMode` for each channel:
- `0` (`INITIAL_MODE_RESTORE_LAST`): Re-applies the saved state.
- `1` (`INITIAL_MODE_OFF`): Forces relay OFF.
- `2` (`INITIAL_MODE_ON`): Forces relay ON.
Physical pin voltage is applied before calling `pinMode(pin, OUTPUT)` to eliminate relay clicking during power-on.

## 4. Architecture
Embedded storage serialization layer integrated with `StorageManager` (LittleFS) and called synchronously during relay state transitions.

## 5. Workflow
1. Relay state changes via switch or command.
2. `GpioManager::setState()` writes new state.
3. Calls `saveToStorage()` which serializes channel array to `/config/gpio.json`.
4. Power is cut.
5. Power returns: Microcontroller boots.
6. `main.cpp` calls `StorageManager::begin()` followed by `GpioManager::begin()`.
7. `GpioManager::begin()` loads `/config/gpio.json`, reads `initialMode`, and sets pin voltage.

## 6. Hardware Requirements
Non-volatile flash memory partition supported by LittleFS.

## 7. Device Implementation
- **ESP8266 (4MB)**: Implemented in [`GpioManager::begin()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp#L48-L82).
- **ESP32**: Target specification (NVS or LittleFS).
- **ESP-01 (1MB)**: Implemented in [`esp01_1mb/src/gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/gpio_manager.cpp#L27-L74).

## 8. Central Server Implementation
- Server maintains redundant state in SQLite `relays` table and tracks `last_changed_at`.
- When node reconnects, server verifies that reported states match database expectations.

## 9. API and Protocol
- Node: Internal LittleFS read/write.
- Server: `POST /api/v1/nodes/:nodeId/push-config`.

## 10. Data Storage
- LittleFS file `/config/gpio.json` on microcontroller.
- SQLite `relays` table on Central Server.

## 11. Configuration
Parameter `initialMode` per channel: `0` (Restore), `1` (Force OFF), `2` (Force ON).

## 12. Error Handling
If `/config/gpio.json` is missing or corrupted, channels initialize to default OFF state (safe state).

## 13. Security
Config file is stored in internal LittleFS; accessible only via authenticated `/api/fs/download` or backup endpoints.

## 14. Testing
Tested across simulated power cuts on hardware node `192.168.1.105`. States restored 100% accurately.

## 15. Source References
- Microcontroller: [`esp8266_4mb/src/gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp#L48-L135)
- Server: [`central_server_js/src/nodeManager.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/nodeManager.js)

## 16. Known Limitations
Flash sector wear-leveling protects memory, but toggling relays thousands of times per hour could degrade flash sectors over years.

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `GpioManager::begin()`, `saveToStorage()` |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | IMPLEMENTED | `GpioManager::begin()`, `saveStates()` |
| Central Server | IMPLEMENTED | `nodeManager.processTelemetry()` |
| Dashboard | IMPLEMENTED | Relay state badges in `app.js` |

## 18. Future Improvements
Use ESP8266 RTC user memory (512 bytes preserved during deep sleep and software resets) to avoid flash writes during frequent software reboots.
