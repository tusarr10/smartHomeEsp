# DEVICE 03 COMMUNICATION INTERFACES: ESP-01 / ESP-01S (1MB)

**Audit Target**: Network Endpoints and Protocol Framing  
**Evidence Source**: [`esp01_1mb/src/web_server.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/web_server.cpp), [`esp01_1mb/src/receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/receiver_client.cpp)  

---

## 1. Network Interface Inventory

| Port | Protocol | Listener Component | Direction | Purpose |
|---|---|---|---|---|
| **80** | HTTP / 1.1 | `ESP8266WebServer` | Inbound | Embedded Gzip Dashboard, REST API |
| **53** | DNS (UDP) | `DNSServer` | Inbound | Captive Portal redirection (`192.168.4.1`) |
| **8266** | ArduinoOTA | `ArduinoOTA` | Inbound | Background wireless OTA listener |
| **2000** | Raw TCP Socket | `ReceiverClient` | **Outbound Client** | Telemetry stream & server command reception |

---

## 2. Inbound REST API Routes (Port 80)

Unlike Device 01 (which registers 35+ routes), Device 03 exposes only essential routes:

| Route | Method | Purpose | Auth Required |
|---|---|---|---|
| `/` & `/index.html` | GET | Serves embedded gzip HTML dashboard from PROGMEM | No |
| `/api/status` | GET | Diagnostic telemetry & memory status | No |
| `/api/gpio` | GET | List configured GPIO channels | No |
| `/api/gpio/state` | POST | Switch relay state (`{"id":1,"state":true}`) | Yes |
| `/api/command` | POST | Single command dispatch | Yes |
| `/api/commands/execute` | POST | Multi-action command dispatch | Yes |
| `/api/wifi/scan` | GET | Scan available Wi-Fi access points | Yes |
| `/api/wifi/connect`| POST | Connect to home router | Yes |
| `/api/receiver` | GET/POST | Read/update Central Server receiver target | Yes |
| `/api/system/reboot`| POST | Soft reboot microcontroller | Yes |
| `/api/ota/upload` | POST | Upload and flash binary firmware | Yes |

---

## 3. Outbound Telemetry Message Format

```json
{
  "nodeId": "NODE-5CCF7F123456",
  "nodeName": "SmartHome-ESP01",
  "eventType": "heartbeat",
  "timestamp": "Up 340 s",
  "epoch": 1793400900,
  "ip": "192.168.1.107",
  "gateway": "192.168.1.1",
  "mac": "5C:CF:7F:12:34:56",
  "rssi": -58,
  "uptimeSec": 340,
  "freeHeap": 28120,
  "firmwareVersion": "1.6.0",
  "channels": [
    { "id": 1, "pin": 0, "name": "Relay 1", "state": false },
    { "id": 2, "pin": 2, "name": "Relay 2", "state": false }
  ]
}
```
*Note: Timestamp uses simple uptime seconds (`Up 340 s`) because NTP time synchronization is offloaded to the Central Server.*
