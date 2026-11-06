# F006 – DUAL WI-FI MANAGEMENT & CAPTIVE PORTAL PROVISIONING

## 1. Feature Information
- **Feature ID**: F006
- **Feature Name**: Dual Wi-Fi Modes (Station + SoftAP) & Captive Portal Provisioning
- **Version**: 1.6.0
- **Category**: Networking & Setup
- **Priority**: Critical
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Provides seamless initial out-of-the-box network provisioning without requiring hardcoded Wi-Fi credentials or serial console access, while supporting automatic reconnects and static IP assignment.

## 3. Actual Functionality
Operates in three modes:
- `WIFI_MODE_AP_ONLY`: Broadcasts unencrypted SoftAP (default: `SmartHome-Setup` or `SmartHome-ESP01` @ `192.168.4.1`).
- `WIFI_MODE_ROUTER_ONLY`: Operates purely as a Station connected to home router.
- `WIFI_MODE_AP_ROUTER` (Default): Maintains SoftAP while concurrently connecting to home router.
Runs an internal DNS server on port 53. When a phone/laptop connects to the SoftAP, all DNS requests are redirected to `192.168.4.1`. Operating system captive portal detection URLs (`generate_204`, `hotspot-detect.html`) return HTTP 302 redirects to `http://192.168.4.1/index.html`.

## 4. Architecture
Stateful `WifiManager` singleton managing ESP8266 Wi-Fi stack events, non-blocking reconnect timers, and captive DNS redirection.

## 5. Workflow
1. Device boots: `WifiManager::begin()` loads `/config/wifi.json`.
2. Starts SoftAP on `192.168.4.1`.
3. Starts DNS server: `_dnsServer.start(53, "*", _apIp)`.
4. If router credentials exist, attempts Station connection with 20s timeout (`STA_CONNECT_TIMEOUT_MS`).
5. User connects phone to `SmartHome-Setup`.
6. Phone opens captive browser modal automatically.
7. User selects home Wi-Fi SSID, enters password, and submits.
8. `POST /api/wifi/connect` saves credentials to `/config/wifi.json` and connects.

## 6. Hardware Requirements
ESP8266 2.4 GHz 802.11 b/g/n radio.

## 7. Device Implementation
- **ESP8266 (4MB)**: Implemented in [`WifiManager`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/wifi_manager.cpp).
- **ESP32**: Target specification.
- **ESP-01 (1MB)**: Implemented in [`esp01_1mb/src/wifi_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/wifi_manager.cpp).

## 8. Central Server Implementation
- Central Server does not manage Wi-Fi directly; discovers configured devices via `discoveryService.js` once on LAN.

## 9. API and Protocol
- Inbound Node REST:
  - `GET /api/wifi/scan`: Scans surrounding Wi-Fi networks and returns RSSI.
  - `POST /api/wifi/connect`: Sets target SSID and password.
  - `POST /api/wifi/ip`: Configures Static IP, Gateway, Subnet, and DNS.
  - `POST /api/wifi/mode`: Changes mode (`AP_ONLY`, `ROUTER_ONLY`, `AP_ROUTER`).

## 10. Data Storage
Saved in LittleFS `/config/wifi.json`.

## 11. Configuration
Variables in `/config/wifi.json`: `mode`, `staSsid`, `staPass`, `apSsid`, `apPass`, `useStaticIp`, `staticIp`, `gateway`, `subnet`, `dns1`, `dns2`.

## 12. Error Handling
If Station connection drops, `WifiManager::loop()` reattempts connection every 10 seconds without blocking running relays or web server.

## 13. Security
- Default SoftAP has no password (blank) to facilitate initial captive onboarding.
- Password can be configured by user post-setup.

## 14. Testing
Empirically tested captive redirection on Android, iOS, and Windows clients on physical hardware.

## 15. Source References
- Edge: [`esp8266_4mb/src/wifi_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/wifi_manager.cpp#L48-L150)
- Endpoints: [`esp8266_4mb/src/web_server.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L417-L425)

## 16. Known Limitations
2.4 GHz only; does not support 5 GHz Wi-Fi networks (hardware limitation of ESP8266).

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `WifiManager::setupAP()`, `setupSTA()` |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | IMPLEMENTED | `WifiManager::setupAP()`, `setupSTA()` |
| Central Server | NOT APPLICABLE | Server runs on host LAN |
| Dashboard | IMPLEMENTED | Network modal in `app.js` |

## 18. Future Improvements
Add WPA3 Enterprise Wi-Fi authentication on ESP32 platform.
