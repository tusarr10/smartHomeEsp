# DEVICE 01 COMMUNICATION INTERFACES: ESP8266 / NODEMCU (4MB)

**Audit Target**: Communication Protocols, Network Ports, and Message Schemas  
**Evidence Source**: [`esp8266_4mb/src/web_server.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp), [`esp8266_4mb/src/receiver_client.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/receiver_client.cpp)  

---

## 1. Exposed Network Ports & Listeners

| Port | Protocol | Listener Component | Direction | Security / Authentication | Purpose |
|---|---|---|---|---|---|
| **80** | HTTP / 1.1 | `ESP8266WebServer` | Inbound | Bearer Token / HTTP Basic Auth | REST API, Captive Portal, Web Dashboard SPA |
| **53** | DNS (UDP) | `DNSServer` | Inbound | Unauthenticated | Captive portal DNS redirection to `192.168.4.1` |
| **8266** | ArduinoOTA | `ArduinoOTA` | Inbound | Unauthenticated | Over-the-Air firmware upload via PlatformIO |
| **2000** | Raw TCP Socket | `ReceiverClient` | **Outbound Client** | Optional `token` in JSON payload | Streams telemetry and receives remote command JSON |
| **9100** | HTTP POST | `ReceiverClient` | **Outbound Client** | `Authorization: Bearer <token>` | Telemetry push alternative to raw TCP |
| **123** | NTP (UDP) | ESP8266 SNTP Client | **Outbound Client** | Unauthenticated | Network Time Protocol clock sync |

---

## 2. Inbound REST API Interface (Port 80)

Key endpoints exposed by the NodeMCU:

| Endpoint | Method | Purpose | Auth Required | Request Payload | Response Sample |
|---|---|---|---|---|---|
| `/api/status` | GET | Diagnostic telemetry & memory | Optional (Open for scanner) | None | `{"nodeId":"NODE-X","freeHeap":25400,"rssi":-54}` |
| `/api/all` | GET | Complete dump of status, pins, automations, receiver | No | None | Full JSON state dump |
| `/api/gpio` | GET | List configured GPIO channels | No | None | `[{"id":1,"pin":5,"state":false}]` |
| `/api/gpio/state` | POST | Switch relay state | Yes | `{"id":1,"state":true}` | `{"success":true,"id":1,"state":true}` |
| `/api/command` | POST | Command dispatch | Yes | `{"action":"setState","id":1,"state":true}` | `{"status":"ACKNOWLEDGED","success":true}` |
| `/api/commands/execute` | POST | Multi-action command execution | Yes | `{"action":"pulse","id":1,"duration":500}` | `{"commandId":"...","status":"ACKNOWLEDGED"}` |
| `/api/wifi/scan` | GET | Scan surrounding Wi-Fi APs | Yes | None | `[{"ssid":"HomeNet","rssi":-62}]` |
| `/api/wifi/connect`| POST | Configure & connect to router | Yes | `{"ssid":"...","pass":"..."}` | `{"success":true,"message":"Connecting..."}` |
| `/api/ota/upload` | POST | Flash firmware binary | Yes | Multipart form file `firmware.bin` | `{"success":true,"message":"Rebooting..."}` |
| `/api/backup/download` | GET | Download JSON config bundle | Yes | None | JSON file download |
| `/api/fs/list` | GET | List LittleFS files & sizes | Yes | None | `{"totalBytes":2097152,"files":[...]}` |

---

## 3. Outbound Telemetry Message Format (TCP Port 2000 / HTTP Port 9100)

When `ReceiverClient` transmits telemetry, it sends the following JSON string:

```json
{
  "nodeId": "NODE-BCDDC223386C",
  "nodeName": "ESP-SmartHome-01",
  "eventType": "heartbeat",
  "timestamp": "2026-11-07 00:25:00 (IST)",
  "epoch": 1793400900,
  "ip": "192.168.1.105",
  "gateway": "192.168.1.1",
  "mac": "BC:DD:C2:23:38:6C",
  "rssi": -52,
  "uptimeSec": 14280,
  "freeHeap": 26840,
  "firmwareVersion": "1.6.0",
  "token": "fleet_bearer_token_xyz",
  "channels": [
    {
      "id": 1,
      "pin": 5,
      "name": "Living Room Light",
      "room": "Living Room",
      "function": "Relay",
      "activeLow": true,
      "initialMode": 0,
      "enabled": true,
      "state": false
    }
  ],
  "acks": [
    {
      "command_uuid": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "success": true,
      "status": "ACKNOWLEDGED"
    }
  ]
}
```

---

## 4. Inbound Server Response / Command Format

The Central Server responds on the same socket (TCP) or in the HTTP response body:

```json
{
  "status": "ok",
  "epoch": 1793400901,
  "commands": [
    {
      "command_uuid": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "action": "setState",
      "id": 1,
      "state": true
    },
    {
      "command_uuid": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
      "action": "pulse",
      "id": 2,
      "duration": 750
    }
  ]
}
```
Supported remote actions: `setState` (or `set`), `toggle`, `pulse`, `reboot`.
