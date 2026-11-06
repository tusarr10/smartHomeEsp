# DEVICE 03 CONFIGURATION REFERENCE: ESP-01 / ESP-01S (1MB)

**Storage Engine**: LittleFS Filesystem (64KB Partition)  
**Configuration Directory**: `/config/`  
**Evidence Source**: [`esp01_1mb/src/config.h`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/config.h#L30-L36)  

---

## 1. Storage Layout

Because LittleFS is sized to 64KB on 1MB flash, configuration files are kept concise:

| File | Purpose | Default State |
|---|---|---|
| `/config/system.json` | Admin user & credentials | `adminUser: "admin"`, `adminPass: "admin"` |
| `/config/wifi.json` | Wi-Fi Station & AP credentials | AP SSID: `"SmartHome-ESP01"`, AP Pass: `""` |
| `/config/gpio.json` | Dual relay channel configurations & states | Channel 1 on GPIO 0, Channel 2 on GPIO 2 |
| `/config/receiver.json`| Central telemetry receiver target | Port 2000, report interval: 10s |

---

## 2. Configuration Sample (`/config/gpio.json`)

```json
[
  {
    "id": 1,
    "pin": 0,
    "name": "Relay 1",
    "room": "General",
    "function": "Relay",
    "activeLow": true,
    "initialMode": 0,
    "enabled": true,
    "state": false
  },
  {
    "id": 2,
    "pin": 2,
    "name": "Relay 2",
    "room": "General",
    "function": "Relay",
    "activeLow": true,
    "initialMode": 0,
    "enabled": true,
    "state": false
  }
]
```
