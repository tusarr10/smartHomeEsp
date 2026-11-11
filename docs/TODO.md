# SmartHome System Architecture: Changelog, Root Causes & Implementation Guide (TODO.md)

**Generated Date & Time**: `2026-11-10 22:38:00 IST` (UTC +5:30)  
**Target Hardware Context**: ESP8266 NodeMCU (ESP-12E / ESP-12F, 4MB Flash), ESP-01 (1MB), and Future ESP32 modules.

---

## 1. Executive Summary

This document serves as an engineering record and implementation blueprint. It details recent critical bug fixes, memory optimizations, and hardware pin expansion performed on the **ESP8266 4MB (NodeMCU)** module, explains **why** each file was affected, and provides a **porting guide** so these features and protections can be replicated across other microcontrollers (such as ESP-01 1MB or ESP32 variants).

---

## 2. Problem Audits, Root Causes & Code Modifications

### 2.1 Issue 1: Assigned Pins Disappearing After Reset or Power Failure

#### Symptom:
When 3 or more GPIO channels were added via the Web Dashboard or Central Server, everything worked in memory. However, upon hardware reset, button reset, or power failure, **all newly assigned pins disappeared**, leaving only the 2 default channels (`D1` - Living Room Light and `D2` - Bedroom Fan).

#### Root Cause:
1. **JSON Deserialization Buffer Overflow**:
   - In [`esp8266_4mb/src/gpio_manager.cpp`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/gpio_manager.cpp), both `loadFromStorage()` and `saveToStorage()` used a hardcoded `DynamicJsonDocument doc(1024)`.
   - Each channel object serializes attributes: `id`, `pin`, `name`, `room`, `function`, `activeLow`, `initialMode`, `enabled`, `state`, `label`, `note`, `bootSensitive`.
   - In ArduinoJson 6, one channel occupies ~250–300 bytes of memory pool. For 3 channels, the document exceeded 850 bytes; for 4 or more channels, it exceeded 1,200 bytes.
   - When the microcontroller rebooted, `StorageManager::loadJsonFile()` executed `deserializeJson(doc, file)`. Because the document buffer was capped at 1,024 bytes, parsing failed with `DeserializationError::NoMemory`.
2. **Destructive Default Overwrite**:
   - When `loadFromStorage()` failed, it returned immediately without populating `_channels`, leaving `_channels` empty.
   - In `GpioManager::begin()`, the initialization check was:
     ```cpp
     // OLD BUGGY LOGIC
     loadFromStorage();
     if (_channels.empty()) {
         addChannel(D1, "Living Room Light", ...);
         addChannel(D2, "Bedroom Fan", ...);
     }
     ```
   - Because `_channels.empty()` was true, the system assumed this was a pristine first boot. It re-created the two default channels (`D1` and `D2`) and immediately invoked `saveToStorage()`, permanently wiping out the user's real configuration from `/config/gpio.json` on LittleFS flash.

#### Changes Made & Files Affected:
* **[`esp8266_4mb/src/gpio_manager.cpp`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/gpio_manager.cpp)**:
  * Increased `DynamicJsonDocument doc(4096)` in `loadFromStorage()` and `saveToStorage()`.
  * Added filesystem existence guard in `GpioManager::begin()`:
    ```cpp
    loadFromStorage();
    if (_channels.empty()) {
        // Only create initial defaults if the config file does NOT exist on flash
        if (!LittleFS.exists(FILE_GPIO_CONFIG)) {
            String err;
            addChannel(D1, F("Living Room Light"), F("Living Room"), F("Light"), true, INITIAL_MODE_RESTORE_LAST, err);
            addChannel(D2, F("Bedroom Fan"), F("Bedroom"), F("Fan"), true, INITIAL_MODE_RESTORE_LAST, err);
        } else {
            Serial.println(F("[GPIO] Existing gpio.json file found but 0 channels loaded. Preserving file."));
        }
    }
    ```
* **[`esp8266_4mb/src/web_server.cpp`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/web_server.cpp)**:
  * In `GET /api/gpio`, increased `DynamicJsonDocument doc(3072)` (previously 1536) to comfortably serialize all channels without truncation.
  * In `POST /api/commands/execute`, increased `DynamicJsonDocument doc(3072)` (previously 1024) to accept multi-channel bulk configuration syncs (`syncConfig`) dispatched by Central Server.
* **[`esp8266_4mb/src/receiver_client.cpp`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/receiver_client.cpp)**:
  * In `sendTcpSync()`, `sendHttp()`, and `startAsyncPush()`, increased telemetry document buffer to `DynamicJsonDocument doc(3072)` (previously 1536) so all channels and acknowledgement vectors fit into one telemetry payload.
  * In `processServerCommands()`, upgraded JSON parser to `DynamicJsonDocument doc(2048)` (previously 384-byte static document).
* **[`esp8266_4mb/src/automation.cpp`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/automation.cpp)**:
  * In `loadFromStorage()` and `saveToStorage()`, increased rule document buffer from 1024 to 2048 bytes.

---

### 2.2 Issue 2: Only 8 Pins Showing & Remaining Hardware Pins Missing

#### Symptom:
Users were unable to add more than 8 channels (`Maximum GPIO channels reached (limit: 8)` error). Furthermore, only 9 pins appeared in the dropdown; physical pins available on the NodeMCU board headers—such as **RX (GPIO 3)**, **TX (GPIO 1)**, **SD2 (GPIO 9)**, and **SD3 (GPIO 10)**—were completely missing or rejected with `"Pin is reserved by ESP8266 system/SPI-flash/UART"`.

#### Root Cause:
1. **Hardcoded Channel Ceiling**:
   - `config.h` defined `#define MAX_GPIO_CHANNELS 8`.
2. **Incomplete Pin Safety Matrix**:
   - `PIN_SAFETY_MAP` in `config.h` only contained D0, D1, D2, D3, D4, D5, D6, D7, and D8. Any pin outside this table was rejected by `GpioManager::isPinSafe()`.
3. **Hardcoded Web UI `<select>`**:
   - `index.html` only hardcoded the initial 9 options in the dropdown.
4. **Physical Factory Reset Button Conflict**:
   - The factory reset routine in `main.cpp` monitored `FACTORY_RESET_PIN` (`D3` / GPIO 0). If a user configured an active-low relay on `D3`, activating the relay would pull `D3` LOW, which after 5 seconds inadvertently triggered a factory wipe.

#### Changes Made & Files Affected:
* **[`esp8266_4mb/src/config.h`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/config.h)**:
  * Increased `#define MAX_GPIO_CHANNELS 16`.
  * Added definitions for `RX (3)`, `TX (1)`, `SD2 (9)`, and `SD3 (10)`.
  * Expanded `PIN_SAFETY_MAP` to all 13 GPIO pins:
    ```cpp
    static const PinSafetyInfo PIN_SAFETY_MAP[] = {
        { D1,  "D1 (GPIO5)",   true,  false, "Safe I2C SCL, boot-neutral" },
        { D2,  "D2 (GPIO4)",   true,  false, "Safe I2C SDA, boot-neutral" },
        { D5,  "D5 (GPIO14)",  true,  false, "Safe SPI CLK, boot-neutral" },
        { D6,  "D6 (GPIO12)",  true,  false, "Safe SPI MISO, boot-neutral" },
        { D7,  "D7 (GPIO13)",  true,  false, "Safe SPI MOSI, boot-neutral" },
        { D0,  "D0 (GPIO16)",  true,  true,  "WAKE pin, HIGH at boot" },
        { D8,  "D8 (GPIO15)",  true,  true,  "Boot config (pulled LOW), must be LOW at boot" },
        { D3,  "D3 (GPIO0)",   true,  true,  "Boot config (Flash button), must be HIGH at boot" },
        { D4,  "D4 (GPIO2)",   true,  true,  "Boot config (TXD1/LED), must be HIGH at boot" },
        { RX,  "RX (GPIO3)",   true,  true,  "UART0 RX, serial debug input" },
        { TX,  "TX (GPIO1)",   true,  true,  "UART0 TX, serial debug output (HIGH at boot)" },
        { SD2, "SD2 (GPIO9)",  true,  true,  "Flash IO SD2 (usable in DIO/DOUT mode)" },
        { SD3, "SD3 (GPIO10)", true,  true,  "Flash IO SD3 (usable in DIO/DOUT mode)" }
    };
    ```
* **[`esp8266_4mb/src/gpio_manager.cpp`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/gpio_manager.cpp)**:
  * Updated limit validation: `String(F("Maximum GPIO channels reached (limit: ")) + String(MAX_GPIO_CHANNELS) + F(")")`.
* **[`esp8266_4mb/src/main.cpp`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/main.cpp)**:
  * Protected factory reset check:
    ```cpp
    void checkResetButton() {
        // Only monitor physical factory reset if D3 is NOT assigned as a relay channel
        if (GpioManager::getInstance().isPinAssigned(FACTORY_RESET_PIN)) {
            return;
        }
        ...
    }
    ```
* **[`esp8266_4mb/data/index.html`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/data/index.html)**:
  * Added `RX (GPIO 3)`, `TX (GPIO 1)`, `SD2 (GPIO 9)`, and `SD3 (GPIO 10)` to `<select id="gpio-pin-select">`.
* **[`esp8266_4mb/data/app.js`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/data/app.js)**:
  * In `openAddGpioModal()`, iterates over dropdown options: assigned pins are disabled and tagged with `(In Use)`. The select automatically defaults to the first available unassigned pin.

---

### 2.3 Issue 3: SoftAP Wi-Fi Association Drops (Channel Hopping Conflict)

#### Symptom:
When booting in default mode (`WIFI_MODE_AP_ROUTER`), connecting a smartphone or laptop to `SmartHome-NodeMCU` (or `SmartHome-Setup`) resulted in `"Failed to obtain IP address"` or rapid disconnections.

#### Root Cause:
The ESP8266 has a **single physical RF synthesizer**. When Station mode (`STA`) is actively trying to connect or reconnect to an unreachable router, the radio hops across channels 1–13. During channel hopping, SoftAP beacons on Channel 1 are interrupted, and client DHCP discovery packets are dropped. Furthermore, the watchdog was executing `WiFi.begin()` every 10 seconds.

#### Changes Made & Files Affected:
* **[`esp8266_4mb/src/wifi_manager.cpp`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/wifi_manager.cpp)**:
  * Added `WiFi.setAutoConnect(false)` and `WiFi.setAutoReconnect(false)` to prevent erratic background scanning by the Espressif SDK.
  * On connection timeout (`STA_CONNECT_TIMEOUT_MS`), added `WiFi.disconnect(false)` to stop scanning and park the radio stably on Channel 1.
  * Added SoftAP client awareness: if `WiFi.softAPgetStationNum() > 0`, router reconnection attempts are deferred so users can configure the device smoothly.
  * Watchdog backoff relaxed from 10s to 30s.
* **[`esp8266_4mb/src/wifi_manager.h`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/wifi_manager.h)**:
  * Added `bool isConfigured() const { return _config.isConfigured; }`.
* **[`esp8266_4mb/src/web_server.cpp`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb/src/web_server.cpp)**:
  * In `checkAuthOrReject()`, permitted `/api/wifi/connect`, `/api/wifi/scan`, and `/api/status` without prior auth if the node is unconfigured (`!isConfigured()`) or in pure AP mode (`WIFI_MODE_AP_ONLY`).
  * In `onNotFound`, intercepted `/` and `/index.html` to prevent 302 redirect loops.

---

## 3. Porting Checklist for Other Modules (ESP-01 1MB & ESP32)

When applying these features or fixes to another device module, follow this standard checklist:

### A. ArduinoJson Document Sizing Rules
| Subsystem / Endpoint | Recommended Buffer Size | Notes |
|---|---|---|
| `FILE_GPIO_CONFIG` Load/Save | `DynamicJsonDocument(4096)` | Supports up to 16 channels with full strings |
| `FILE_RULES_CONFIG` Load/Save | `DynamicJsonDocument(2048)` | Supports up to 10 automation rules |
| `GET /api/gpio` Response | `DynamicJsonDocument(3072)` | Avoids truncated responses |
| `POST /api/commands/execute` | `DynamicJsonDocument(3072)` | Required for Central Server `syncConfig` |
| `ReceiverClient` Telemetry Push | `DynamicJsonDocument(3072)` | Encapsulates system info, pins, and ACKs |
| `ReceiverClient` Command Parse | `DynamicJsonDocument(2048)` | Replaces tight 384-byte static buffers |

### B. Pin Safety Table Definition (ESP-01 vs ESP32)
* **ESP-01 (1MB Flash)**:
  * Pins: `GPIO 0` (Relay 1 / Flash), `GPIO 2` (Relay 2 / TXD1), `GPIO 1` (TX), `GPIO 3` (RX).
  * `MAX_GPIO_CHANNELS`: `4`.
* **ESP32 (4MB / 8MB / 16MB)**:
  * Pins: Has independent hardware peripherals (multiple ADCs, DACs, hardware UARTs, separate Wi-Fi hardware channels).
  * Safe relay pins: GPIO 4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33.
  * Strapping pins to document with `bootSensitive = true`: GPIO 0, 2, 5, 12, 15.
  * `MAX_GPIO_CHANNELS`: `16` or `32`.

### C. Reset Protection Pattern
Always verify whether the hardware reset pin is assigned as a GPIO output before executing factory wipe logic:
```cpp
if (GpioManager::getInstance().isPinAssigned(FACTORY_RESET_PIN)) {
    return; // Pin is utilized as a relay output; bypass button monitor
}
```

### D. Single-Radio Wi-Fi SoftAP Stability Pattern
1. On `begin()`, disable SDK auto-reconnect:
   ```cpp
   WiFi.persistent(false);
   WiFi.setAutoConnect(false);
   WiFi.setAutoReconnect(false);
   ```
2. When station connection fails or times out, immediately call `WiFi.disconnect(false)` to halt channel hopping.
3. Before initiating any background reconnection attempt, check `WiFi.softAPgetStationNum() > 0`. If clients are connected, defer the reconnect attempt.

---

## 4. Summary of Modified Files

```text
esp8266_4mb/
├── data/
│   ├── app.js               # Dynamic "(In Use)" pin labeling, auto-select free pin
│   └── index.html           # Added RX, TX, SD2, SD3 to hardware pin selector
└── src/
    ├── automation.cpp       # Increased rules JSON buffer to 2048 bytes
    ├── config.h             # MAX_GPIO_CHANNELS = 16, PIN_SAFETY_MAP expanded to 13 pins
    ├── gpio_manager.cpp     # doc(4096) for storage, guarded against empty-state overwrite
    ├── main.cpp             # Guarded factory reset pin check against assigned relay pin
    ├── receiver_client.cpp  # doc(3072) for telemetry, doc(2048) for command processing
    ├── web_server.cpp       # doc(3072) for /api/gpio and /api/commands/execute
    └── wifi_manager.cpp     # Radio channel stabilization, client-aware reconnect suppression
```

*Build Artifacts Verified:*
* **Firmware**: `.pio/build/nodemcuv2/firmware.bin`
* **Filesystem Image**: `.pio/build/nodemcuv2/littlefs.bin`
