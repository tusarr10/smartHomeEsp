# DEVICE 01 CONFIGURATION REFERENCE: ESP8266 / NODEMCU (4MB)

**Storage Engine**: LittleFS Filesystem  
**Configuration Directory**: `/config/`  
**Evidence Source**: [`esp8266_4mb/src/config.h`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/config.h#L30-L36)  

---

## 1. Persistent File Inventory

The firmware stores configuration in distinct JSON files on the LittleFS partition:

| Configuration Path | Purpose | Owning Manager |
|---|---|---|
| `/config/system.json` | Administrative credentials, password hash, device label | `AuthManager` / `StorageManager` |
| `/config/wifi.json` | Wi-Fi Station credentials, static IP configuration, Wi-Fi system mode | `WifiManager` |
| `/config/gpio.json` | Relay channel assignments, active polarity, initial boot modes, saved states | `GpioManager` |
| `/config/rules.json` | Local automation rules, timer thresholds, interlock mappings | `AutomationEngine` |
| `/config/receiver.json` | Central server IP, port, telemetry protocol, reporting interval, auth token | `ReceiverClient` |

---

## 2. Configuration Schemas & Examples

### 1. `/config/system.json`
```json
{
  "adminUser": "admin",
  "adminPass": "admin123",
  "adminPassHash": "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
  "deviceLabel": "Living-Room-Node"
}
```

### 2. `/config/wifi.json`
```json
{
  "mode": 2,
  "staSsid": "MyHomeWiFi",
  "staPass": "SecretPass123",
  "apSsid": "SmartHome-Setup",
  "apPass": "",
  "useStaticIp": false,
  "staticIp": "192.168.1.105",
  "gateway": "192.168.1.1",
  "subnet": "255.255.255.0",
  "dns1": "8.8.8.8",
  "dns2": "1.1.1.1"
}
```
- `mode`: `0` = `WIFI_MODE_AP_ONLY`, `1` = `WIFI_MODE_ROUTER_ONLY`, `2` = `WIFI_MODE_AP_ROUTER` (Default).

### 3. `/config/gpio.json`
```json
[
  {
    "id": 1,
    "pin": 5,
    "name": "Ceiling Light",
    "room": "Living Room",
    "function": "Light",
    "activeLow": true,
    "initialMode": 0,
    "enabled": true,
    "state": false
  },
  {
    "id": 2,
    "pin": 4,
    "name": "Exhaust Fan",
    "room": "Kitchen",
    "function": "Fan",
    "activeLow": true,
    "initialMode": 1,
    "enabled": true,
    "state": false
  }
]
```
- `initialMode`: `0` = Restore last state across reboots; `1` = Force OFF on boot; `2` = Force ON on boot.

### 4. `/config/rules.json`
```json
[
  {
    "id": 1,
    "name": "Exhaust Auto Off",
    "type": 0,
    "enabled": true,
    "sourceGpioId": 0,
    "targetGpioId": 2,
    "conditionState": false,
    "targetState": false,
    "param1": 600,
    "executionCount": 14
  }
]
```
- `type`: `0` = `RULE_TIMER_AUTO_OFF` (`param1` = seconds); `1` = `RULE_INTERLOCK` (mutual exclusion); `2` = `RULE_DAILY_SCHEDULE` (`param1` = minute of day 0–1439).

### 5. `/config/receiver.json`
```json
{
  "enabled": true,
  "serverHost": "192.168.1.10",
  "serverPort": 2000,
  "protocol": 1,
  "httpPath": "/api/node/telemetry",
  "reportIntervalSec": 10,
  "sendOnStateChange": true,
  "nodeId": "NODE-BCDDC223386C",
  "nodeName": "ESP-SmartHome-01",
  "authToken": "fleet_secure_token_abc123"
}
```
- `protocol`: `0` = HTTP POST (REST), `1` = Raw TCP Socket (Stream).
- `nodeId`: If left empty, auto-populates from MAC OTP eFuse (`NODE-XXXXXXXXXXXX`).
