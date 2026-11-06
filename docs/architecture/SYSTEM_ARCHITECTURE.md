# ECOSYSTEM SYSTEM ARCHITECTURE

**System**: Smart Home Multi-Node Fleet Controller  
**Audit Date**: 2026-11-07  
**Architecture Model**: Hybrid Centralized Hub & Autonomous Satellite Network  

---

## 1. Complete Physical & Logical Topology

The ecosystem connects heterogeneous microcontrollers to a central server and web dashboard over local wireless LAN:

```mermaid
flowchart TB
    subgraph UI_Layer ["Client & Dashboard Layer"]
        BROWSER["Operator Web Browser (Any LAN Device)"]
        MOBILE["Mobile Device (Browser / Captive Portal)"]
    end

    subgraph Server_Layer ["Central Management Hub (central_server_js)"]
        HTTP_SRV["Express REST API & Static Files (Port 9100)"]
        WS_SRV["WebSocket Server (ws /api/v1/ws)"]
        TCP_SRV["Raw TCP Telemetry Server (Port 2000)"]
        NM["NodeManager (State & Poller)"]
        SQL_DB[("SQLite Database (fleet.db WAL Mode)")]
        DISK["Local Storage (Backups, Firmware, FS Archives)"]
    end

    subgraph Fleet_Layer ["Microcontroller Fleet Layer"]
        subgraph Node1 ["Device 01: NodeMCU ESP8266 (4MB)"]
            ESP8266_ACT["Direct GPIO Actuator (Pins D1, D2, D5, D6, D7)"]
            ESP8266_LFS["2MB LittleFS Partition (Web SPA + Configs)"]
            ESP8266_AUTO["Local Rules Engine (NTP, Timers, Cron)"]
            ESP8266_CLI["ReceiverClient (Async TCP & HTTP)"]
            ESP8266_HTTP["Embedded Web Server (Port 80)"]
        end

        subgraph Node2 ["Device 02: ESP32 (Target / Planned)"]
            ESP32_SPEC["High-Density Actuator & Multi-Sensor Hub"]
        end

        subgraph Node3 ["Device 03: ESP-01 / ESP-01S (1MB)"]
            ESP01_ACT["Direct GPIO Actuator (Pins 0 & 2)"]
            ESP01_PROG["PROGMEM Gzip Dashboard (Zero FS RAM)"]
            ESP01_CLI["ReceiverClient (Async TCP & HTTP)"]
            ESP01_HTTP["Embedded Web Server (Port 80)"]
        end
    end

    BROWSER <-->|HTTP / REST (Port 9100)| HTTP_SRV
    BROWSER <-->|WebSocket Real-Time Feed| WS_SRV
    MOBILE <-->|HTTP / Captive Portal| HTTP_SRV

    HTTP_SRV <--> NM
    WS_SRV <--> NM
    TCP_SRV <--> NM
    NM <--> SQL_DB
    NM <--> DISK

    ESP8266_CLI -->|Outbound TCP Port 2000 / HTTP POST| TCP_SRV
    TCP_SRV -->|Response Commands & ACKs| ESP8266_CLI
    NM -->|Direct HTTP POST /api/commands/execute| ESP8266_HTTP

    ESP01_CLI -->|Outbound TCP Port 2000 / HTTP POST| TCP_SRV
    TCP_SRV -->|Response Commands & ACKs| ESP01_CLI
    NM -->|Direct HTTP POST /api/commands/execute| ESP01_HTTP

    ESP8266_ACT <--> ESP8266_LFS
    ESP8266_ACT <--> ESP8266_AUTO
```

---

## 2. Core Architectural Principles

1. **Local Autonomous Execution**: Microcontrollers do not rely on constant internet connectivity or an active Central Server connection to operate local physical switches. If the server is turned off, relays still toggle via local inputs, auto-off timers still run, and last states remain safe in LittleFS.
2. **Dual-Path Telemetry Ingestion**: Nodes communicate via high-speed raw TCP sockets on port 2000 for minimal network latency and minimal dynamic heap consumption, with fallback to standard HTTP POST on port 9100.
3. **Event-Driven Push with Periodic Sync**: Microcontrollers push immediate debounced telemetry within 400ms of any relay state transition, while maintaining periodic heartbeats (default 10s). The server runs a background poller every 10s to ensure total state convergence.
4. **Resilient Local UI Delivery**: Devices 01 and 03 each feature local embedded web dashboards accessible directly on the microcontroller IP (Port 80), ensuring that device provisioning, Wi-Fi pairing, and manual switching work even without a Central Server.
