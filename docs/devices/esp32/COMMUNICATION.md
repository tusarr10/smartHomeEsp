# DEVICE 02 COMMUNICATION SPECIFICATION (TARGET): ESP32

**Target**: ESP32 Network Interfaces & Protocol Specifications  

---

## 1. Network Interface Contracts

| Protocol | Port | Direction | Message Framing | Server Endpoint |
|---|---|---|---|---|
| **Raw TCP Socket** | 2000 | Outbound Client | Newline-delimited (`\n`) JSON | `tcp://<server_ip>:2000` |
| **HTTP POST** | 9100 | Outbound Client | Standard JSON POST | `http://<server_ip>:9100/api/node/telemetry` |
| **HTTP REST** | 80 | Inbound Server | Standard REST JSON | Inbound from LAN & Central Server |
| **WebSocket** | 81 (Optional) | Inbound Server | WebSocket frames | Inbound real-time LAN client feed |

---

## 2. Telemetry Payload Format with Sensor Telemetry

In addition to the standard ESP8266 telemetry payload, the ESP32 firmware should include an optional `sensors` array:

```json
{
  "nodeId": "NODE-A4C1389B42E0",
  "nodeName": "ESP32-SmartHome-02",
  "eventType": "heartbeat",
  "timestamp": "2026-11-07 00:25:00 (IST)",
  "epoch": 1793400900,
  "ip": "192.168.1.106",
  "gateway": "192.168.1.1",
  "mac": "A4:C1:38:9B:42:E0",
  "rssi": -48,
  "uptimeSec": 4200,
  "freeHeap": 284500,
  "firmwareVersion": "1.6.0",
  "channels": [
    { "id": 1, "pin": 4, "state": false },
    { "id": 2, "pin": 13, "state": true }
  ],
  "sensors": [
    { "sensor_type": "temperature", "name": "Utility Temp", "current_value": 26.4, "unit": "°C" },
    { "sensor_type": "humidity", "name": "Utility Humidity", "current_value": 58.2, "unit": "%" },
    { "sensor_type": "current", "name": "Total Load", "current_value": 14.8, "unit": "A" }
  ]
}
```
Central Server's `nodeManager.js` and `database.js` already possess the `sensors` table ready to ingest this data.
