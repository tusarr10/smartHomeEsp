# SYSTEM ERROR CODES & DIAGNOSTIC DIRECTORY

**Audit Scope**: Central Server REST Errors, Device HTTP Errors, and Internal Client Fault Codes  

---

## 1. Central Server Standard Error Format

All modern REST APIs (`/api/v1/*`) return standardized JSON error objects:

```json
{
  "success": false,
  "error": "Descriptive human-readable error message",
  "code": "ERROR_CODE_STRING",
  "details": {}
}
```

---

## 2. Server-Side HTTP Status Codes

| HTTP Status | Trigger Condition | Code String | Example Root Cause |
|---|---|---|---|
| **400 Bad Request** | Missing required parameters or malformed JSON | `INVALID_PAYLOAD` | Missing `nodeId` in registration payload |
| **401 Unauthorized** | Missing or invalid session token / password | `UNAUTHORIZED` | Expired Bearer session token |
| **403 Forbidden** | User lacks required RBAC permission | `FORBIDDEN` | VIEWER role attempting `POST /relays/.../command` |
| **404 Not Found** | Node ID, User ID, or Firmware ID does not exist | `NOT_FOUND` | Node `NODE-UNKNOWN` not found in database |
| **409 Conflict** | Duplicate resource identifier | `DUPLICATE_ENTRY`| Registering a `nodeId` that already exists |
| **422 Unprocessable** | Semantic validation failure | `VALIDATION_FAILED`| Relay channel pin not marked safe in safety matrix |
| **500 Internal Error**| SQLite database lock, unhandled exception | `SERVER_ERROR` | Database disk I/O failure |
| **504 Gateway Timeout**| Direct node HTTP call exceeded 2500ms | `NODE_TIMEOUT` | Physical node powered off during direct REST call |

---

## 3. Microcontroller Client Internal Fault Codes (`ReceiverClient`)

Recorded in `_lastStatusCode` on the microcontroller:

| Internal Code | Status String | Meaning / Diagnostics |
|---|---|---|
| **200** | `OK (Code 200)` | Normal telemetry delivery and ACK reception |
| **-1** | `HTTP client init failed` | ESP8266 HTTPClient memory allocation failure |
| **-2** | `TCP Connection failed` | Port 2000 closed, host unreachable, or network firewall drop |
| **-3** | `Wi-Fi not connected` | Node is in SoftAP mode or router disconnected |
| **-4** | `Server Host/IP is empty` | `/config/receiver.json` has blank `serverHost` |
