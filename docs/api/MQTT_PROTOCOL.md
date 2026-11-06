# MQTT PROTOCOL SPECIFICATION & FORENSIC STATUS

**Implementation Status**: **NOT IMPLEMENTED IN ACTIVE CODEBASE**  
**Forensic Classification**: Deprecated Legacy Architectural Artifact  
**Evidence Source**: Full repository static analysis; Git commit history (`9ada843`)  

---

## 1. Forensic Audit Finding

A forensic audit confirms that **MQTT is not implemented in any running component of the active ecosystem**:
1. **Central Server (`central_server_js`)**: Contains zero references to `mqtt`, `aedes`, or MQTT client libraries in `package.json` or source files.
2. **ESP8266 Firmware (`esp8266_4mb`)**: Contains zero MQTT libraries (`PubSubClient` or `async-mqtt-client` are absent from `platformio.ini` and C++ source files).
3. **ESP-01 Firmware (`esp01_1mb`)**: Contains zero MQTT libraries.

### Historical Context:
Git commit history reveals that an earlier Python FastAPI backend (`central_server/backend/app/protocols/mqtt_client.py`) included Mosquitto broker integration. In commit `9ada843`, that backend was deleted in favor of `central_server_js`, which standardizes on **Raw TCP Socket Streaming (Port 2000)** and **HTTP REST (Port 9100 / Port 80)**.

---

## 2. Proposed MQTT Topic Hierarchy (If Re-Implemented)

Should the project team decide to introduce MQTT in a future release, the following topic taxonomy is recommended to match the existing database schemas:

| Topic Pattern | Publisher | Subscriber | QoS | Retained | Purpose |
|---|---|---|---|---|---|
| `smarthome/telemetry/{nodeId}` | Node | Central Server | 1 | No | Microcontroller periodic health & metrics |
| `smarthome/state/{nodeId}/{channelId}` | Node | Server / UI | 1 | **Yes** | Real-time relay state changes |
| `smarthome/command/{nodeId}` | Server | Node | 1 | No | Bi-directional remote execution commands |
| `smarthome/status/{nodeId}` | Node (LWT) | Server | 1 | **Yes** | Last Will and Testament (`Online` / `Offline`) |
