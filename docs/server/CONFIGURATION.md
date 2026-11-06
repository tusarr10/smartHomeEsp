# CENTRAL SERVER CONFIGURATION REFERENCE

**Configuration File**: [`central_server_js/config.json`](file:///d:/ai/Homeautomation_server/central_server_js/config.json)  
**Schema Implementation**: [`central_server_js/server.js`](file:///d:/ai/Homeautomation_server/central_server_js/server.js#L14-L36)  

---

## 1. Complete `config.json` Parameter Reference

```json
{
  "bind_host": "0.0.0.0",
  "http_port": 9100,
  "tcp_port": 2000,
  "offline_timeout_sec": 30,
  "poll_enabled": true,
  "poll_interval_sec": 10,
  "direct_http_timeout_ms": 2500,
  "auth_token": "",
  "node_auth": {
    "username": "admin",
    "password": "admin"
  }
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `bind_host` | string | `"0.0.0.0"` | Network interface to bind HTTP, TCP, and WebSocket listeners. Set to `"0.0.0.0"` for all LAN interfaces. |
| `http_port` | integer | `9100` | Port for Express REST API, WebSockets, and Web SPA Dashboard. |
| `tcp_port` | integer | `2000` | Port for the raw TCP socket telemetry listener. |
| `offline_timeout_sec` | integer | `30` | Inactivity window in seconds before `NodeManager` marks an unresponsive node as `Offline`. |
| `poll_enabled` | boolean | `true` | Enables or disables background active HTTP health and relay status polling. |
| `poll_interval_sec` | integer | `10` | Interval in seconds between active polling cycles across all registered online nodes. |
| `direct_http_timeout_ms`| integer | `2500` | Socket timeout in milliseconds when making direct outbound HTTP calls to nodes. |
| `auth_token` | string | `""` | Optional pre-shared bearer token required in telemetry payloads. If non-empty, unauthenticated telemetry packets are rejected. |
| `node_auth.username` | string | `"admin"` | Default HTTP Basic Auth username used by server when issuing direct commands to nodes. |
| `node_auth.password` | string | `"admin"` | Default HTTP Basic Auth password used by server when issuing direct commands to nodes. |
