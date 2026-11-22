# OpenWrt Edge Broker & Distributed SmartHome Architecture Plan

## 1. Executive Summary

This architecture establishes the **OpenWrt Router as the Central Local Communication Hub & Edge Data Broker**. 

All hardware nodes (ESP8266 relays, PCF8574 expansion boards, environment sensors, and Wi-Fi smart circuit breakers) communicate directly through the OpenWrt router. The router maintains real-time in-memory device states, handles incoming telemetry, and dispatches outgoing relay commands. 

The **Central Management Server** (`central_server_js`) serves as the long-term database, analytics engine, and **Identity / Scope Authority**. If the Central Server machine is offline or shut down, local smart home operations continue uninterrupted. Authorized client applications—such as a custom **Android Mobile App**—can log in via the Central Server to obtain scoped access, and then interface directly with the OpenWrt router for zero-latency, local-network control.

---

## 2. End-to-End System Topology

```mermaid
flowchart TD
    subgraph Nodes ["Hardware Edge Nodes"]
        N1["ESP8266 Relay Node 1<br/>(Living Room / Kitchen)"]
        N2["ESP8266 Relay Node 2<br/>(Bedrooms / Fans)"]
        CB["Wi-Fi Smart Circuit Breaker<br/>(Voltage, Current, Leakage, Contact)"]
    end

    subgraph OpenWrt ["OpenWrt Router (Always ON - MTK 830 / 512MB RAM)"]
        Broker["Edge Traffic & Data Broker<br/>(TCP :2000 / HTTP / WebSocket)"]
        StateCache["In-Memory Live Node Cache<br/>(RAM State: Relay status, Sensors)"]
        ScopeGuard["Scope & Auth Validator<br/>(Enforces user access boundaries)"]
        Broker <--> StateCache
        Broker <--> ScopeGuard
    end

    subgraph CentralServer ["Central Server (Main PC / Local Server)"]
        CSAuth["Auth & Scope Authority<br/>(RBAC, Scopes, JWT Issuance)"]
        FleetDB["SQLite Fleet Database<br/>(fleet.db: History, Audits, Analytics)"]
        CSAuth <--> FleetDB
    end

    subgraph MobileApp ["Consumer Clients"]
        Android["Android Mobile App / Third-Party Client"]
    end

    %% Node traffic to OpenWrt
    N1 -->|1a. Telemetry (TCP :2000)| Broker
    N2 -->|1b. Telemetry (TCP :2000)| Broker
    CB -->|1c. LAN Telemetry (:8085 / Tuya LAN)| Broker
    Broker -.->|Dispatches Relay Commands| N1
    Broker -.->|Dispatches Relay Commands| N2
    Broker -.->|Trips / Closes Contact| CB

    %% OpenWrt feed to Central Server
    Broker -->|2. Feeds Live Stream (When PC is ON)| FleetDB
    CSAuth -.->|Syncs Users & Scopes| ScopeGuard

    %% Mobile App Flows
    Android -->|Step A: Login & Receive Assigned Node Scopes| CSAuth
    Android <-->|Step B: Direct Live Stream & Local Control| Broker
```

---

## 3. The Three Architectural Pillars

### Pillar 1: OpenWrt Router as the Live Edge Traffic & State Broker
* **Traffic Ingestion:**
  * Runs an ultra-lightweight broker process on the OpenWrt router.
  * Ingests ESP8266 telemetry via standard TCP port `2000` (or HTTP POST) without altering the existing `app2` node firmware protocol.
  * Polls or accepts local Tuya Smart Breaker telemetry.
* **In-Memory State Cache:**
  * Maintains the active state of all channels (ON/OFF), sensor readings (temperature, power, voltage), and device online/offline statuses in RAM.
  * Ensures sub-millisecond responses to local client queries.
* **Store-and-Forward to Central Server:**
  * When the Central Server is reachable, the router proxies telemetry packets to the Central Server's ingestion API (`/api/telemetry`).
  * If the Central Server is unreachable, packets are processed locally with zero error propagation to nodes or clients.
* **Embedded Resource Constraints:**
  * Target platform: MediaTek MTK 830 (or MT7621 / MT7628) running OpenWrt with 512 MB RAM.
  * Memory footprint pinned to $\le$ 30 MB RAM. Pure, non-compiled, zero-native dependencies.

---

### Pillar 2: Central Server as the Identity, Scope Authority & Analytics Core
* **Role-Based Access Control (RBAC):**
  * Existing RBAC engine in `central_server_js/src/auth.js` manages users, roles (`super_admin`, `admin`, `family_member`, `guest`), and fine-grained resource permissions.
* **Resource Scoping & Node Assignment:**
  * Users are assigned specific scopes and allowed nodes:
    * **Admin:** Full access to all nodes, smart breaker, automation rules, and firmware updates.
    * **Family Member:** Access restricted to specific rooms or specific node IDs (`assigned_nodes: ["NODE-BEDROOM-1", "NODE-KITCHEN-1"]`).
    * **Guest:** Access limited to specific relay channels only (e.g., Living Room lamp).
* **Token Issuance:**
  * Central Server authenticates users and issues a scoped access token (JWT or cryptographic session token) embedding the user's `assigned_nodes` list and permission bits.

---

### Pillar 3: Android App & External Clients
* **Initial Bootstrap & Scope Fetch:**
  1. User opens the Android App.
  2. The App authenticates against the Central Server (e.g. `POST /api/v1/auth/mobile-login`).
  3. The Central Server returns:
     ```json
     {
       "userId": "usr_902",
       "username": "tushar",
       "role": "family_member",
       "assigned_nodes": [
         "NODE-30487DE85D5C",
         "NODE-A4CFA3F8120B"
       ],
       "permissions": ["devices:view", "devices:control"],
       "router_endpoint": "http://192.168.1.1:9200",
       "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
     }
     ```
  4. The Android App saves this manifest securely in local Android EncryptedSharedPreferences.
* **Direct Local Control via Router:**
  * The Android App connects directly to the OpenWrt router (`http://192.168.1.1:9200` or WebSocket `ws://192.168.1.1:9200/ws`).
  * The router checks the token and allows the phone to:
    * Stream live telemetry for its assigned nodes only.
    * Issue instant relay toggles (`POST /api/nodes/:nodeId/channels/:channelId/set`).
  * Works 100% locally with zero cloud or central server latency.

---

## 4. Operational Scenarios & Data Flows

### Scenario A: Normal Operation (Central Server is ONLINE)

```
[Node] ---> (Telemetry) ---> [OpenWrt Router] ---> (Proxy Stream) ---> [Central Server]
                                    |                                         |
                                    v                                         v
                         [Local RAM State Update]                   [Persist to SQLite]
                                    |                               [Audit Trail & Graphs]
                                    v
                         [Live Stream to App]
```

1. ESP node sends heartbeat / relay change over TCP port 2000 to the OpenWrt router.
2. OpenWrt broker updates its in-memory status and responds to the node with any queued commands.
3. OpenWrt broker asynchronously pushes the telemetry packet to Central Server (`POST /api/telemetry`).
4. Central Server saves the telemetry in SQLite (`fleet.db`), updates audit logs, and triggers automation engines.
5. Android App receives the real-time update via WebSocket or SSE directly from OpenWrt.

---

### Scenario B: Fallback Operation (Central Server is OFFLINE / PC Shut Down)

```
[Node] ---> (Telemetry) ---> [OpenWrt Router] (Detects Central OFFLINE)
                                    |
                                    v
                         [Local RAM State Update]
                         [Local Command Queueing]
                                    |
                                    v
                         [Direct Live Stream to Android App]
                                    |
             (App sends toggle) <---|---> (Router dispatches to Node)
```

1. Central Server PC is turned off or restarting.
2. ESP node sends telemetry to OpenWrt router as normal.
3. OpenWrt broker detects Central Server health-check timeout; flags Central state as `OFFLINE`.
4. OpenWrt broker continues servicing the Android App and node commands locally.
5. User toggles a light switch from the Android App:
   - App calls `POST http://192.168.1.1:9200/api/nodes/NODE-1/channels/1/set`.
   - Router delivers the command to the node immediately (via HTTP or next TCP heartbeat).
   - Light toggles instantly without interruption.

---

### Scenario C: Recovery & Re-synchronization (Central Server Powers Back ON)

1. Central Server PC boots up and starts `central_server_js`.
2. OpenWrt broker's background health poller detects the Central Server is alive again (`isOnline = true`).
3. OpenWrt broker flushes its active state snapshot to Central Server to synchronize any states changed during the outage.
4. Normal dual-streaming resumes seamlessly.

---

## 5. Security & Scope Verification

To ensure users cannot control hardware outside their permissions:

1. **Shared Secret / Public Key:** 
   * Central Server signs client tokens using a shared secret or HMAC key also known to the OpenWrt router (or simple symmetric key configured in both `config.json` files).
2. **Node-Level Filtering on Router:**
   * When an app requests data or sends a command:
     ```http
     POST /api/nodes/NODE-KITCHEN-1/channels/2/set
     Authorization: Bearer <token>
     ```
   * The OpenWrt broker verifies:
     $$\text{Target Node ID} \in \text{Token.assigned\_nodes}$$
   * If the node is not in the user's assigned scope, the router rejects the request with `HTTP 403 Forbidden`.

---

## 6. Implementation Roadmap

### Phase 1: OpenWrt Router Broker Package
- [ ] Configure ultra-lightweight broker service on OpenWrt listening on:
  - TCP port `2000` (ESP fleet line protocol).
  - HTTP port `9200` (REST API & WebSockets for clients).
- [ ] Implement in-memory state table with debounced flash persistence.
- [ ] Implement central forwarder with non-blocking failover logic.

### Phase 2: Central Server Mobile Auth & Scope API
- [ ] Implement mobile-dedicated login endpoint in `central_server_js`:
  - `POST /api/v1/auth/mobile-login`
  - Validates credentials against SQLite `users` table.
  - Queries `user_scopes` and `node_assignments`.
  - Returns JWT containing `userId`, `role`, and `assigned_nodes`.

### Phase 3: OpenWrt Token Validation
- [ ] Add JWT / Bearer token parser to OpenWrt router broker.
- [ ] Enforce node-level whitelist before relaying commands.

### Phase 4: Android Application Interface Specification
- [ ] Finalize standard REST and WebSocket JSON protocol for Android consumption:
  - `GET /api/nodes/scoped` (Returns only allowed devices)
  - `POST /api/nodes/:id/channels/:ch/set` (Executes instant relay switch)
  - `GET /api/breaker` (Live circuit breaker telemetry)
  - `WS /api/live` (Real-time telemetry stream)
