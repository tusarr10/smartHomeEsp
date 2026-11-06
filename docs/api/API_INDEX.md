# API & COMMUNICATION PROTOCOL MASTER INDEX

**Ecosystem**: Smart Home Multi-Node Fleet Controller  
**Audit Scope**: REST Endpoints (Server & Devices), Raw TCP Socket, WebSockets, SSE  

---

## 1. Protocols Overview

| Protocol | Transport | Port / Path | Source Implementation | Status |
|---|---|---|---|---|
| **Central REST API v1** | HTTP / JSON | Port 9100 (`/api/v1/*`) | [`central_server_js/src/routes/v1Router.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/v1Router.js) | **IMPLEMENTED** (60+ Endpoints) |
| **Central Legacy REST** | HTTP / JSON | Port 9100 (`/api/*`) | [`central_server_js/src/routes/legacyRouter.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/legacyRouter.js) | **IMPLEMENTED** (12 Endpoints) |
| **Device REST API (ESP8266)**| HTTP / JSON | Port 80 (`/api/*`) | [`esp8266_4mb/src/web_server.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp) | **IMPLEMENTED** (35+ Endpoints) |
| **Device REST API (ESP-01)** | HTTP / JSON | Port 80 (`/api/*`) | [`esp01_1mb/src/web_server.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/web_server.cpp) | **IMPLEMENTED** (11 Endpoints) |
| **Raw TCP Telemetry Socket** | TCP Stream | Port 2000 | [`central_server_js/src/tcpServer.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/tcpServer.js) | **IMPLEMENTED** (Newline JSON) |
| **Central WebSockets** | WS / WSS | Port 9100 (`/api/v1/ws`, `/ws`)| [`central_server_js/server.js`](file:///d:/ai/Homeautomation_server/central_server_js/server.js#L68-L92) | **IMPLEMENTED** (Live Event Stream) |
| **Server-Sent Events (SSE)** | HTTP / SSE | Port 9100 (`/api/events`) | [`central_server_js/src/routes/legacyRouter.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/legacyRouter.js#L34-L46) | **IMPLEMENTED** (Broadcast Fallback) |
| **MQTT Protocol** | TCP / MQTT | *(None)* | *(None)* | **NOT IMPLEMENTED** |

---

## 2. API Documentation Catalog

| Document | Purpose |
|---|---|
| [**REST_API_REFERENCE.md**](file:///d:/ai/Homeautomation_server/docs/api/REST_API_REFERENCE.md) | Exhaustive REST endpoint specifications with HTTP methods, auth, payloads, headers, parameters, and responses. |
| [**AUTHENTICATION_API.md**](file:///d:/ai/Homeautomation_server/docs/api/AUTHENTICATION_API.md) | Detailed specifications for login, logout, password change, and token validation endpoints. |
| [**TCP_PROTOCOL.md**](file:///d:/ai/Homeautomation_server/docs/api/TCP_PROTOCOL.md) | Port 2000 raw TCP socket framing, message encoding, telemetry format, and bi-directional command delivery. |
| [**WEBSOCKET_PROTOCOL.md**](file:///d:/ai/Homeautomation_server/docs/api/WEBSOCKET_PROTOCOL.md) | Real-time WebSocket connection lifecycle, handshake, event schemas, and reconnect logic. |
| [**MQTT_PROTOCOL.md**](file:///d:/ai/Homeautomation_server/docs/api/MQTT_PROTOCOL.md) | Verification that MQTT is not implemented in the current active codebase, and proposed future specification. |
| [**ERROR_CODES.md**](file:///d:/ai/Homeautomation_server/docs/api/ERROR_CODES.md) | Standardized error formats, HTTP status codes, and device fault codes across the ecosystem. |
