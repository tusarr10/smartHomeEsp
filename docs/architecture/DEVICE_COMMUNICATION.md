# DEVICE & SYSTEM COMMUNICATION PATHS

**Scope**: Exhaustive Specification of all 8 Communication Trajectories  

---

## Path 1: ESP8266 (Device 01) $\rightarrow$ Central Server
- **Protocol**: Raw TCP Socket (Primary) or HTTP POST (Secondary)
- **Address / Endpoint**: `tcp://<server_host>:2000` or `http://<server_host>:9100/api/node/telemetry`
- **Authentication**: Optional Bearer token (`token` in JSON payload; `Authorization: Bearer <token>` for HTTP)
- **Payload**: Full JSON telemetry object (`nodeId`, `eventType`, `epoch`, `uptimeSec`, `freeHeap`, `rssi`, `channels`, `acks`)
- **Message Format**: UTF-8 string terminated by newline `\n` (TCP) or standard JSON POST (HTTP)
- **Acknowledgment**: Server replies on same socket with `{"status":"ok","epoch":...}`
- **Timeout**: 1500 ms client read timeout
- **Retry Behavior**: If TCP connection fails, increments `_packetsFailed` and reattempts on next cycle (10s)
- **Offline Behavior**: Retains channel states in LittleFS; queues command ACKs until next connection
- **Data Persistence**: Ingested by server into SQLite `telemetry_logs`, `nodes`, and `relays` tables
- **Error Handling**: Non-blocking state machine closes socket with `client.stop(10)` on error.

---

## Path 2: ESP32 (Device 02) $\rightarrow$ Central Server (Target / Specification)
- **Protocol**: Raw TCP Socket (Port 2000) or HTTPS POST (Port 9100)
- **Address / Endpoint**: `tcp://<server_host>:2000` or `https://<server_host>:9100/api/v1/telemetry`
- **Authentication**: Pre-shared token or TLS client certificate
- **Payload**: JSON telemetry object with 16-channel array + `sensors` array (temperature, humidity, current)
- **Message Format**: UTF-8 string terminated by `\n`
- **Acknowledgment**: Server returns `status: "ok"` and pending command array
- **Timeout**: 2000 ms FreeRTOS socket timeout
- **Retry Behavior**: Exponential backoff managed by dedicated FreeRTOS telemetry task
- **Offline Behavior**: Logs sensor averages to internal ring buffer in PSRAM/SRAM
- **Data Persistence**: Stored in SQLite `telemetry_logs` and `sensors` tables
- **Error Handling**: FreeRTOS socket error handler destroys socket and yields to scheduler.

---

## Path 3: ESP-01 (Device 03) $\rightarrow$ Central Server
- **Protocol**: Raw TCP Socket (Port 2000) or HTTP POST (Port 9100)
- **Address / Endpoint**: `tcp://<server_host>:2000` or `http://<server_host>:9100/api/node/telemetry`
- **Authentication**: Optional Bearer `token` in JSON payload
- **Payload**: Streamlined JSON telemetry object (2 channels: GPIO 0 & GPIO 2, simple uptime timestamp)
- **Message Format**: UTF-8 string terminated by `\n`
- **Acknowledgment**: Server returns status and pending commands
- **Timeout**: 1500 ms client read timeout
- **Retry Behavior**: Reattempts on next periodic cycle (10s)
- **Offline Behavior**: Continues driving direct relays without server dependency
- **Data Persistence**: Stored in SQLite `telemetry_logs`, `nodes`, and `relays` tables
- **Error Handling**: Fixed stack buffer parsing prevents heap allocation during error states.

---

## Path 4: Central Server $\rightarrow$ ESP8266 (Device 01)
- **Protocol**: Direct HTTP POST (Immediate) or TCP Socket Response (Piggybacked)
- **Address / Endpoint**: `http://<node_ip>:80/api/commands/execute` or reply on inbound TCP socket
- **Authentication**: HTTP Basic Auth (`admin:admin`) or Bearer Session Token
- **Payload**: `{"action":"setState","id":1,"state":true,"command_uuid":"..."}`
- **Message Format**: JSON object
- **Acknowledgment**: Microcontroller returns `{"commandId":"...","nodeId":"...","status":"ACKNOWLEDGED"}`
- **Timeout**: 2500 ms direct HTTP timeout (`direct_http_timeout_ms`)
- **Retry Behavior**: If direct HTTP fails (e.g. node unreachable), enqueues in `device_commands` table (retries 3 times)
- **Offline Behavior**: Command remains `PENDING` in database until node connects outbound
- **Data Persistence**: Stored in `device_commands` and updated in `command_results`
- **Error Handling**: Catches connection refused / timeout, marks status `FAILED`, and logs system warning.

---

## Path 5: Central Server $\rightarrow$ ESP32 (Device 02) (Target / Specification)
- **Protocol**: Direct HTTP / HTTPS POST or TCP Socket Response
- **Address / Endpoint**: `http://<node_ip>:80/api/commands/execute`
- **Authentication**: Bearer Session Token
- **Payload**: Command JSON with channel ID (1–16) and target state or PWM duty cycle
- **Message Format**: JSON object
- **Acknowledgment**: ESP32 returns application ACK with UUID
- **Timeout**: 2500 ms
- **Retry Behavior**: Server command queue retries across next 3 check-ins
- **Offline Behavior**: Stored in SQLite `device_commands`
- **Data Persistence**: Logged in `command_results` and `audit_logs`
- **Error Handling**: Logs timeout error and alerts operator in notification drawer.

---

## Path 6: Central Server $\rightarrow$ ESP-01 (Device 03)
- **Protocol**: Direct HTTP POST or TCP Socket Response
- **Address / Endpoint**: `http://<node_ip>:80/api/commands/execute`
- **Authentication**: HTTP Basic Auth or Bearer Session Token
- **Payload**: `{"action":"setState","id":1,"state":true,"command_uuid":"..."}`
- **Message Format**: JSON object
- **Acknowledgment**: ESP-01 returns `{"status":"ACKNOWLEDGED","success":true}`
- **Timeout**: 2500 ms
- **Retry Behavior**: Enqueues in `device_commands` for delivery on next TCP heartbeat
- **Offline Behavior**: Retains state in database until next successful check-in
- **Data Persistence**: Stored in `device_commands`
- **Error Handling**: Gracefully falls back to socket queue if direct HTTP port 80 fails.

---

## Path 7: Dashboard SPA $\rightarrow$ Central Server
- **Protocol**: HTTP/1.1 REST & WebSocket (WSS)
- **Address / Endpoint**: `http://<server_host>:9100/api/v1/*` and `ws://<server_host>:9100/api/v1/ws`
- **Authentication**: Bearer Session Token (`Authorization: Bearer <token>`)
- **Payload**: REST JSON bodies (e.g. user actions, relay toggles, schedule additions)
- **Message Format**: JSON
- **Acknowledgment**: HTTP 200 OK with `{ "success": true, ... }`
- **Timeout**: Browser default fetch timeout (~10s)
- **Retry Behavior**: Transparent auto-login recovery on 401; WebSocket reconnects every 2000ms
- **Offline Behavior**: Displays yellow "Connecting..." badge; blocks controls until reconnected
- **Data Persistence**: All modifications committed immediately to SQLite WAL database
- **Error Handling**: Error alerts surfaced to UI via red toast notifications.

---

## Path 8: Central Server $\rightarrow$ Dashboard SPA
- **Protocol**: WebSocket Frame (Primary) & Server-Sent Events SSE (Secondary)
- **Address / Endpoint**: `ws://<server_host>:9100/api/v1/ws` and `http://<server_host>:9100/api/events`
- **Authentication**: Established via initial connection handshake
- **Payload**: Asynchronous typed events: `initial_state`, `telemetry`, `relay_changed`, `node_status`, `notification`
- **Message Format**: JSON string: `{"type": "<event_type>", "data": { ... }}`
- **Acknowledgment**: Fire-and-forget transport over established TCP socket
- **Timeout**: None (Persistent duplex stream)
- **Retry Behavior**: Dead sockets removed from `wsClients` Set automatically
- **Offline Behavior**: Browser UI detects close event and attempts reconnect
- **Data Persistence**: Ephemeral in browser memory; updates DOM tree directly
- **Error Handling**: `try/catch` in `nodeManager.broadcast()` silently purges terminated sockets.
