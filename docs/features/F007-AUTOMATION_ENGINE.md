# F007 – AUTONOMOUS AUTOMATION & SCHEDULING ENGINE

## 1. Feature Information
- **Feature ID**: F007
- **Feature Name**: Autonomous Rule Engine (Timers, Cron Schedules, Interlocks)
- **Version**: 1.6.0
- **Category**: Automation & Intelligence
- **Priority**: High
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Enables automatic switching of household devices based on real-time clock schedules, countdown durations (e.g. bathroom fan auto-off), and mutual exclusion interlocks (e.g. motorized curtains).

## 3. Actual Functionality
- **Node-Side Engine (ESP8266 4MB)**:
  - Synchronizes time with NTP pools (`time.google.com`, `in.pool.ntp.org`) using Indian Standard Time (IST UTC+05:30).
  - Evaluates rules:
    - `RULE_TIMER_AUTO_OFF`: Turns relay OFF after `param1` seconds.
    - `RULE_INTERLOCK`: Forces target relay state when source relay matches condition state.
    - `RULE_DAILY_SCHEDULE`: Triggers relay action at target minute of the day (`hour * 60 + min`).
- **Satellite Engine (ESP-01 1MB)**:
  - Rules offloaded to Central Server to save flash space. Forwards events.
- **Server-Side Engine (`central_server_js`)**:
  - `automations` table stores complex rules with condition logic (`ALL`/`ANY`) and multiple trigger types.

## 4. Architecture
Hierarchical automation model: Simple safety rules (auto-off timers, interlocks) execute autonomously on the edge (Device 01), while fleet-wide routines execute on the Central Server.

## 5. Workflow
1. Device boots and connects to Wi-Fi.
2. `AutomationEngine::begin()` starts NTP synchronization.
3. Every 1000ms in `loop()`, evaluates active schedule rules against `time(nullptr)`.
4. If minute-of-day matches and rule has not fired today (`lastTriggeredDay != tm_yday`), executes action via `GpioManager::setState()`.
5. When a relay turns ON, starts any associated `RULE_TIMER_AUTO_OFF` countdown.

## 6. Hardware Requirements
RTC crystal or network NTP access for real-time daily schedules.

## 7. Device Implementation
- **ESP8266 (4MB)**: Fully implemented in [`AutomationEngine`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/automation.cpp).
- **ESP32**: Target specification.
- **ESP-01 (1MB)**: Offloaded to Central Server in [`esp01_1mb/src/automation.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/automation.cpp).

## 8. Central Server Implementation
- **Backend**: Implemented in [`database.js: automations table`](file:///d:/ai/Homeautomation_server/central_server_js/src/database.js#L155-L168) and evaluated in `nodeManager.processTelemetry()`.
- **Frontend**: Automation rule builder in `app.js`.
- **Database**: SQLite `automations` table.

## 9. API and Protocol
- Node REST: `GET /api/automation`, `POST /api/automation`, `POST /api/automation/toggle`, `POST /api/automation/delete`.
- Server REST: `GET /api/v1/automations`, `POST /api/v1/automations`, `POST /api/v1/automations/:id/toggle`.

## 10. Data Storage
- Microcontroller: LittleFS `/config/rules.json`.
- Central Server: SQLite `automations` table.

## 11. Configuration
- Max rules: `MAX_AUTOMATION_RULES = 10` on ESP8266.
- Timezone offset: `_tzOffsetSec = 19800` (IST).

## 12. Error Handling
- Validates that source and target GPIOs are not identical in interlock rules to prevent recursion.
- Rejects new rules when maximum limit (10) is reached.

## 13. Security
Modifying automation rules requires authenticated administrative session.

## 14. Testing
Verified timer countdowns and daily schedule triggers on physical node `192.168.1.105`.

## 15. Source References
- Edge: [`esp8266_4mb/src/automation.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/automation.cpp#L54-L131)
- Server: [`central_server_js/src/database.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/database.js#L155-L168)

## 16. Known Limitations
If internet connection is absent at boot, NTP synchronization cannot resolve pool domains, preventing `RULE_DAILY_SCHEDULE` from firing until time syncs.

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `AutomationEngine::loop()` |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | OFFLOADED | `automation.cpp` stub |
| Central Server | IMPLEMENTED | `automations` table & evaluation |
| Dashboard | IMPLEMENTED | Automation view in `app.js` |

## 18. Future Improvements
Add support for external DS3231 I2C real-time clock modules on physical GPIO pins.
