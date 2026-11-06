# DEVICE 02 CONFIGURATION STANDARD (TARGET): ESP32

**Target Hardware**: ESP32 / ESP32-WROOM-32  
**Storage Architecture**: Hybrid LittleFS + NVS (Non-Volatile Storage)  

---

## 1. Target Storage Allocation

The ESP32 firmware should partition settings between NVS and LittleFS:

1. **Non-Volatile Storage (NVS)**:
   - High-endurance key-value store in dedicated NVS partition.
   - Ideal for Wi-Fi credentials (`sta_ssid`, `sta_pass`), admin password hash, and boot counter.
   - Immune to filesystem corruption.
2. **LittleFS Partition (1.37 MB)**:
   - File-based JSON configuration (`/config/gpio.json`, `/config/rules.json`, `/config/receiver.json`).
   - Web UI assets (`/index.html`, `/app.js`, `/style.css`).

---

## 2. Configuration Schema Compatibility

The ESP32 firmware must maintain 100% schema parity with Device 01 to allow identical configuration backups and restoration by Central Server's `ConfigSyncService`:

```json
{
  "nodeId": "NODE-A4C1389B42E0",
  "name": "Distribution-Box-ESP32",
  "room": "Utility Room",
  "hardware": "ESP32",
  "channels": [
    { "id": 1, "pin": 4,  "name": "Main Geyser",     "activeLow": true, "initialMode": 1, "enabled": true },
    { "id": 2, "pin": 13, "name": "AC Living Room",  "activeLow": true, "initialMode": 0, "enabled": true },
    { "id": 3, "pin": 14, "name": "AC Bedroom",      "activeLow": true, "initialMode": 0, "enabled": true },
    { "id": 4, "pin": 16, "name": "Kitchen Oven",    "activeLow": true, "initialMode": 1, "enabled": true },
    { "id": 5, "pin": 17, "name": "Water Pump",      "activeLow": true, "initialMode": 1, "enabled": true },
    { "id": 6, "pin": 18, "name": "Garden Lights",   "activeLow": true, "initialMode": 0, "enabled": true },
    { "id": 7, "pin": 19, "name": "Security Flood",  "activeLow": true, "initialMode": 0, "enabled": true },
    { "id": 8, "pin": 23, "name": "EV Charger Plug", "activeLow": true, "initialMode": 1, "enabled": true }
  ],
  "receiverServer": "192.168.1.10:2000"
}
```
