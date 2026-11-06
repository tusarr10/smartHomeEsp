# WEBSOCKET REAL-TIME STREAMING PROTOCOL

**Endpoint**: `ws://<server_ip>:9100/api/v1/ws` (and fallback alias `/ws`)  
**Transport**: WebSocket (RFC 6455)  
**Implementation**: [`central_server_js/server.js`](file:///d:/ai/Homeautomation_server/central_server_js/server.js#L68-L92), [`nodeManager.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/nodeManager.js#L214-L236)  

---

## 1. Connection Lifecycle & Initial Handshake

1. **HTTP Upgrade**: Browser client connects to `ws://${window.location.host}/api/v1/ws`.
2. **Registration**: Socket is added to `nodeManager.wsClients` Set.
3. **Initial State Push**: Immediately upon connection, the server pushes an `initial_state` frame containing the full state of the fleet:

```json
{
  "type": "initial_state",
  "data": {
    "overview": {
      "totalNodes": 3,
      "onlineNodes": 2,
      "activeRelays": 4,
      "packetsReceived": 14205,
      "serverUptimeSec": 86400
    },
    "stats": { ... },
    "nodes": [ ... ]
  }
}
```

---

## 2. Server-to-Client Broadcast Events

The server broadcasts asynchronous events as they occur:

### Event 1: `telemetry` (Node Telemetry Arrival)
Pushed whenever any node transmits a telemetry packet (TCP or HTTP):
```json
{
  "type": "telemetry",
  "data": {
    "nodeId": "NODE-BCDDC223386C",
    "name": "NodeMCU-01",
    "freeHeap": 26840,
    "rssi": -52,
    "uptimeSec": 12480,
    "lastSeenEpoch": 1793400900,
    "channels": [ ... ]
  }
}
```

### Event 2: `relay_changed` (Relay State Transition)
Pushed whenever a relay is toggled, pulsed, or restored:
```json
{
  "type": "relay_changed",
  "data": {
    "nodeId": "NODE-BCDDC223386C",
    "channelId": 1,
    "state": true,
    "triggerSource": "WEB_UI"
  }
}
```

### Event 3: `node_status` (Online / Offline State Change)
Pushed when a node checks in or when the offline watcher marks it offline:
```json
{
  "type": "node_status",
  "data": {
    "nodeId": "NODE-BCDDC223386C",
    "isOnline": false,
    "status": "Offline",
    "name": "Living Room Node"
  }
}
```

### Event 4: `config_updated` / `config_synced` (Configuration Status)
Pushed when authoritative configurations are modified or pushed to devices:
```json
{
  "type": "config_synced",
  "data": {
    "node_id": "NODE-BCDDC223386C",
    "version": 3,
    "sync_status": "SYNCED"
  }
}
```

### Event 5: `notification` (System Alert Toast)
Pushed when a system alert or security warning is generated:
```json
{
  "type": "notification",
  "data": {
    "id": 42,
    "title": "Node Offline",
    "message": "Node 'NodeMCU-01' missed heartbeats and went OFFLINE.",
    "severity": "WARNING",
    "category": "NODE"
  }
}
```

---

## 3. Client Heartbeat & Reconnection Logic

In [`central_server_js/public/assets/app.js`](file:///d:/ai/Homeautomation_server/central_server_js/public/assets/app.js#L220-L280):
- If the WebSocket closes, the UI updates the topbar badge to `Connecting...` (yellow).
- Reconnects automatically using a 2000ms retry interval.
- Upon reconnect, requests an updated state snapshot to catch up on any missed transitions.
