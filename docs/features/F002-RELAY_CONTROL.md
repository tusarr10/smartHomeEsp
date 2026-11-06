# F002 – MULTI-CHANNEL RELAY ACTUATION & PULSING

## 1. Feature Information
- **Feature ID**: F002
- **Feature Name**: Multi-Channel GPIO Relay Actuation & Non-Blocking Pulse Switching
- **Version**: 1.6.0
- **Category**: Hardware Actuation & Control
- **Priority**: Critical
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Provides deterministic electrical switching of physical household appliances (lights, fans, geysers, pumps) with customizable polarity (active-high/active-low) and non-blocking pulse timers.

## 3. Actual Functionality
Manages multiple discrete GPIO channels. Supports:
- Logical `setState(id, bool)`: Writes output voltage mapped to channel polarity.
- `toggle(id)`: Inverts state.
- `pulse(id, durationMs)`: Energizes relay for specified milliseconds, restoring initial state upon timer completion without halting the processor loop.

## 4. Architecture
Singleton `GpioManager` class managing channel state vectors or static arrays, calling `digitalWrite()` directly, and publishing state change events to automation and telemetry callbacks.

## 5. Workflow
1. Client triggers toggle via REST (`POST /api/v1/relays/:nodeId/:channelId/command`) or remote TCP command.
2. Server dispatches HTTP call to node `/api/commands/execute`.
3. Node `GpioManager::toggle()` executes:
   - Inverts `currentState`.
   - Calls `applyPhysicalPin()` (`digitalWrite(pin, level)`).
   - Flushes updated state to LittleFS `/config/gpio.json`.
   - Triggers `_stateCallback` (notifying `ReceiverClient` and `AutomationEngine`).
4. Microcontroller returns HTTP 200 with new state.
5. Server updates SQLite `relays` and broadcasts WebSocket `relay_changed`.

## 6. Hardware Requirements
Optocoupler-isolated relay module connected to safe microcontroller GPIO outputs.

## 7. Device Implementation
- **ESP8266 (4MB)**: Dynamic vector `std::vector<GpioChannel>` up to 8 channels. [`gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp)
- **ESP32**: Target specification (up to 16 channels).
- **ESP-01 (1MB)**: Static array `GpioChannel _channels[4]` (GPIO 0 & 2 default). [`esp01_1mb/src/gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/gpio_manager.cpp)

## 8. Central Server Implementation
- **Backend**: `v1Router.js` (`/api/v1/relays/*`), `nodeManager.js`
- **Frontend**: GPIO / Relays section in `app.js` with instant switches and pulse buttons.
- **Database**: `relays` table and `relay_events` historical log.

## 9. API and Protocol
- Microcontroller: `POST /api/gpio/state` (`{"id":1,"state":true}`), `POST /api/commands/execute`.
- Server: `POST /api/v1/relays/:nodeId/:channelId/command`.

## 10. Data Storage
- Microcontroller: LittleFS `/config/gpio.json`.
- Central Server: SQLite `relays` and `relay_events`.

## 11. Configuration
Channel attributes: `id`, `pin`, `name`, `room`, `function`, `activeLow`, `initialMode`, `enabled`.

## 12. Error Handling
Rejects unmapped pins; logs errors if pulse duration < 10ms or channel disabled.

## 13. Security
Requires permission `devices:control` on server; Basic Auth / session token on node.

## 14. Testing
Verified on hardware node `192.168.1.105` with sub-50ms round-trip switching latency.

## 15. Source References
- Microcontroller: [`esp8266_4mb/src/gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp#L140-L208)
- Server: [`central_server_js/src/routes/v1Router.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/v1Router.js#L645-L666)

## 16. Known Limitations
Relay contacts experience physical arcing over inductive loads (motors/coils); requires external snubber circuits for AC inductive loads.

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `GpioManager::setState()`, `pulse()` |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | IMPLEMENTED | `GpioManager::setState()`, `pulse()` |
| Central Server | IMPLEMENTED | `v1Router.js: command handler` |
| Dashboard | IMPLEMENTED | Relays grid in `app.js` |

## 18. Future Improvements
Add software current limiting and zero-crossing TRIAC triggering for flicker-free AC dimming.
