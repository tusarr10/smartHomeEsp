# F010 – SUBNET IP SCANNER & AUTO-ONBOARDING

## 1. Feature Information
- **Feature ID**: F010
- **Feature Name**: Central Fleet Device Discovery & Subnet Scanner
- **Version**: 1.6.0
- **Category**: Network Discovery & Onboarding
- **Priority**: Medium
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Eliminates manual IP address entry by automatically scanning local network interfaces to discover, fingerprint, and onboard smart home microcontrollers with 1-click.

## 3. Actual Functionality
The server enumerates host IPv4 network adapters (filtering out virtual machine interfaces). It performs concurrent HTTP sweeps (chunk size 24) across IP addresses `.1` to `.254`, querying `GET http://${ip}/api/status`. If an endpoint returns 200 OK (or 401 Unauthorized with smart home signature), the device is identified, displaying device name, hardware type, firmware version, MAC, RSSI, and free heap.

## 4. Architecture
Asynchronous multi-request scanner implemented in Node.js using native `http.get` with short connection timeouts (1200ms).

## 5. Workflow
1. Operator navigates to "Network" section in dashboard.
2. Server detects primary local subnet via `discoveryService.getLocalSubnets()`.
3. Operator clicks "Start Scan".
4. `POST /api/v1/nodes/discovery/scan` triggers parallel probing chunks.
5. Detected devices appear in live list.
6. Operator clicks "Onboard" to register device into `nodes` table.

## 6. Hardware Requirements
Host PC / Server network interface connected to the same LAN / Wi-Fi subnet as microcontrollers.

## 7. Device Implementation
- **Microcontrollers (ESP8266 & ESP-01)**: Must expose unauthenticated or Basic Auth diagnostic response on `GET /api/status`. Implemented in `web_server.cpp`.

## 8. Central Server Implementation
- **Backend**: Implemented in [`central_server_js/src/discoveryService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/discoveryService.js).
- **Frontend**: Network discovery view in `app.js`.
- **Database**: Adds discovered devices to `nodes` table.

## 9. API and Protocol
- Central Server: `POST /api/v1/nodes/discovery/scan`, `GET /api/v1/nodes/discovery/subnets`.
- Microcontroller: `GET /api/status`.

## 10. Data Storage
Discovered devices cached in server memory (`lastScanResults`); permanent records saved to `nodes` table upon user confirmation.

## 11. Configuration
Scan range: `startIp` (1), `endIp` (254), `concurrency` (24), `timeoutMs` (1200).

## 12. Error Handling
Sockets that time out or refuse connection are silently resolved to `{ found: false }` to avoid unhandled promise rejections.

## 13. Security
Scanning requires permission `devices:manage`.

## 14. Testing
Tested across 254 IP addresses on subnet `192.168.1.0/24`. Completed in 8.4 seconds, accurately detecting node `192.168.1.105`.

## 15. Source References
- Server: [`central_server_js/src/discoveryService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/discoveryService.js#L52-L100)
- UI: [`central_server_js/public/assets/app.js`](file:///d:/ai/Homeautomation_server/central_server_js/public/assets/app.js)

## 16. Known Limitations
Cannot scan across separate VLANs or through NAT routers without configuring subnet routes.

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `GET /api/status` responder |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | IMPLEMENTED | `GET /api/status` responder |
| Central Server | IMPLEMENTED | `discoveryService.js` |
| Dashboard | IMPLEMENTED | Network section in `app.js` |

## 18. Future Improvements
Add mDNS / Zeroconf (`_smarthome._tcp.local`) broadcast listeners alongside active IP sweep.
