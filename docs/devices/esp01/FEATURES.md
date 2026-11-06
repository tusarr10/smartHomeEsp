# DEVICE 03 FEATURES BREAKDOWN: ESP-01 / ESP-01S (1MB)

**Device**: ESP-01 / ESP-01S (1MB Flash)  
**Audit Source**: Complete inspection of `esp01_1mb/src/`  

---

## 1. Feature Implementation Matrix

| Feature | Status | Source Location | Implementation Details |
|---|---|---|---|
| **Direct Relay Switching** | **IMPLEMENTED** | [`gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/gpio_manager.cpp#L106-L138) | `setState(id, state)`, `toggle(id)`, `pulse(id, ms)` for GPIO 0 & GPIO 2. |
| **Relay State Restoration** | **IMPLEMENTED** | [`gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/gpio_manager.cpp#L48-L64) | Restores saved state from `/config/gpio.json` on power recovery. |
| **Outbound TCP Telemetry** | **IMPLEMENTED** | [`receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/receiver_client.cpp) | Periodic and debounced state change push to port 2000. |
| **Remote Commands & ACKs** | **IMPLEMENTED** | [`receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/receiver_client.cpp#L340-L380) | Parses `{ "commands": [...] }`, executes, and returns command UUID ACKs. |
| **PROGMEM Web Dashboard** | **IMPLEMENTED** | [`web_server.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/web_server.cpp#L48-L62) | Gzip compressed HTML SPA served directly from flash ROM. |
| **SoftAP & Captive Portal** | **IMPLEMENTED** | [`wifi_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/wifi_manager.cpp) | AP mode `SmartHome-ESP01` (IP `192.168.4.1`) with port 53 DNS captive portal. |
| **Web OTA Flashing** | **IMPLEMENTED** | [`ota_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/ota_manager.cpp) | Endpoint `/api/ota/upload` accepts binary firmware uploads. |
| **Local Rule Automations** | **OFFLOADED** | [`automation.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/automation.cpp#L51-L60) | Complex rules offloaded to Central Server; stub returns error notice. |
| **LittleFS File Manager** | **STRIPPED** | `web_server.cpp` | File upload/delete/list APIs stripped to preserve code space. |
| **64-Round SHA-256 Table** | **STRIPPED** | [`auth_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/auth_manager.cpp#L8-L11) | Replaced by lightweight string matching to save ~4 KB flash. |
