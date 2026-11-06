# CONFIGURATION STANDARD & SERIALIZATION FORMATS

**Scope**: Standardization Rules for Configuration Payloads Across Fleet  

---

## 1. Naming Convention Standard

Historically, slight naming divergences emerged between edge C++ camelCase conventions and server SQLite snake_case conventions.
The following authoritative mapping standard is established:

| Logical Attribute | Microcontroller LittleFS JSON | Central Server SQLite DDL | REST Wire Format (v1) |
|---|---|---|---|
| **Node Identifier** | `nodeId` | `node_id` | `nodeId` / `node_id` (accepted) |
| **Node Label** | `nodeName` / `name` | `name` | `name` / `nodeName` |
| **Hardware Platform** | `hardware` | `hardware_type` | `hardware` / `hardware_type` |
| **IP Address** | `ip` / `staIp` | `ip_address` | `ip` / `ip_address` |
| **MAC Address** | `mac` | `mac_address` | `mac` / `mac_address` |
| **Active Polarity** | `activeLow` | `active_low` (1/0) | `activeLow` (boolean) |
| **Initial Boot Mode** | `initialMode` | `initial_mode` (0/1/2) | `initialMode` (integer) |
| **Current State** | `state` / `currentState` | `current_state` (1/0) | `state` / `current_state` |
| **Uptime** | `uptimeSec` | `uptime_sec` | `uptimeSec` |
| **Free SRAM** | `freeHeap` | `free_heap` | `freeHeap` |

---

## 2. Configuration Validation Rules

1. **Pin Assignment**:
   - Must be a valid physical pin supported by the target microcontroller.
   - For NodeMCU ESP8266: Pins must be included in `PIN_SAFETY_MAP` and marked `isSafeRelay = true`.
   - For ESP-01: Restricted to GPIO 0, 2, 3, 1.
2. **Channel ID**:
   - Positive integer > 0. Must be unique per node (`UNIQUE(node_id, channel_id)`).
3. **Pulse Duration**:
   - Must be an integer between `50` ms and `86400000` ms (24 hours).
4. **Initial Mode**:
   - Must be one of `0` (Restore Last State), `1` (Force OFF), `2` (Force ON).
5. **Timezone Offset**:
   - Signed integer in seconds between `-43200` (-12h) and `50400` (+14h). Default: `19800` (+05:30 IST).
