# VERSION COMPATIBILITY & MIGRATION MATRIX

**Current Release**: `v1.6.0`  
**Scope**: Compatibility Rules Between Firmware Generations and Central Server Releases  

---

## 1. Compatibility Matrix

| Component Version | Compatible Central Server | Compatible Nodes | Breaking Changes / Notes |
|---|---|---|---|
| **Firmware v1.6.0** (`esp8266_4mb`) | `central_server_js` v1.6.0 | NodeMCU / ESP-12E/F | Standard release. Introduces PROGMEM fallback dashboard. |
| **Firmware v1.6.0** (`esp01_1mb`) | `central_server_js` v1.6.0 | ESP-01 / ESP-01S | Thin satellite release. Automation offloaded to server. |
| **Firmware v1.5.0** (`app2` legacy) | `central_server_js` v1.6.0 | NodeMCU | Backward compatible. Operates via legacy `/api/node/telemetry`. |
| **Python FastAPI Server** (Deleted) | Incompatible with `v1.6.0` | None | **DEPRECATED**: Completely removed from repo in commit `9ada843`. |

---

## 2. Upgrade Guidelines

When upgrading edge nodes from `v1.5.0` to `v1.6.0`:
1. Use the Central Server "Firmware / OTA" view.
2. Select target firmware `firmware-v1.6.0-esp8266.bin`.
3. Enable `autoBackup: true`.
4. The deployment pipeline will automatically backup existing LittleFS `/config/*.json` files before streaming the update.
5. If the node reboots and cannot find web assets in LittleFS, the embedded PROGMEM dashboard (`dashboard_html.h`) automatically takes over to ensure zero device downtime.
