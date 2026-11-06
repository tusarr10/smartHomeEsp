# DATA MODELS & SCHEMA SPECIFICATION

**Audit Target**: Data Models, Entity Schemas, and Wire Envelopes  

---

## 1. Node Identity Model (`Node`)

Used in SQLite `nodes` table, REST responses, and telemetry ingestion:

```typescript
interface Node {
  node_id: string;             // Unique identifier, e.g. "NODE-BCDDC223386C"
  name: string;                // User-defined label, e.g. "Living Room Node"
  hardware_type: string;       // "ESP8266" | "ESP32" | "ESP-01"
  firmware_version: string;    // Semantic version string, e.g. "1.6.0"
  ip_address: string;          // Current LAN IPv4 address
  mac_address: string;         // Factory MAC address, e.g. "BC:DD:C2:23:38:6C"
  gateway: string;             // Subnet router gateway IP
  rssi: number;                // Wi-Fi signal strength in dBm (-30 to -90)
  uptime_sec: number;          // Microcontroller uptime in seconds
  free_heap: number;           // Allocatable SRAM in bytes
  is_online: 0 | 1;            // Boolean online flag
  status: "Online" | "Offline";// Computed human status
  room: string;                // Home room zone, e.g. "Living Room", "Kitchen"
  location: string;            // Physical site, e.g. "Main House", "Garage"
  category: string;            // Functional class, e.g. "Controller", "Sensor Hub"
  last_seen_epoch: number;     // Unix epoch timestamp of last heartbeat
  last_seen_str: string;       // ISO 8601 or formatted date string
  device_group: string;        // Logical group, default "DEFAULT"
  mcu_type: string;            // "ESP8266" | "ESP32"
  flash_capacity: number;      // Flash memory size in bytes (e.g. 4194304)
  littlefs_total: number;      // Total LittleFS filesystem space in bytes
  littlefs_used: number;       // Used filesystem space in bytes
  littlefs_available: number;  // Free filesystem space in bytes
  wifi_ssid: string;           // Currently connected Wi-Fi SSID
  auth_username: string;       // HTTP Basic Auth username (default: "admin")
  auth_password: string;       // HTTP Basic Auth password (default: "admin")
  channels?: RelayChannel[];   // Array of attached GPIO channels
}
```

---

## 2. Relay Channel Model (`RelayChannel`)

Used in SQLite `relays` table and edge `GpioManager`:

```typescript
interface RelayChannel {
  id: number;                  // Channel identifier (1 to 8 on NodeMCU, 1 to 2 on ESP-01)
  node_id?: string;            // Parent node ID
  pin: number;                 // Physical GPIO pin number (e.g. 5, 4, 14, 12, 13)
  name: string;                // Label, e.g. "Ceiling Fan", "Balcony Light"
  room: string;                // Room tag
  function: string;            // "Relay" | "Light" | "Fan" | "Heater" | "Pump"
  active_low: 0 | 1;           // Inverted logic: 1 = active LOW (standard relay)
  initial_mode: 0 | 1 | 2;     // 0 = Restore Last State; 1 = Force OFF; 2 = Force ON
  enabled: 0 | 1;              // 1 = Active channel; 0 = Disabled
  current_state: 0 | 1;        // Logical state: 1 = ON (energized), 0 = OFF (de-energized)
  requested_state?: 0 | 1;     // In-flight requested state during async transitions
  is_syncing?: 0 | 1;          // Flag indicating pending synchronization
  last_changed_at?: string;    // Timestamp of last state change
}
```

---

## 3. Persistent Command Model (`DeviceCommand`)

Used in SQLite `device_commands` table for asynchronous bi-directional delivery:

```typescript
interface DeviceCommand {
  id?: number;
  command_uuid: string;        // UUID v4 identifier, e.g. "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
  node_id: string;             // Target microcontroller node ID
  user_id?: number;            // Dispatching user ID
  command_type: string;        // "setState" | "toggle" | "pulse" | "reboot" | "syncConfig"
  payload_json: string;        // Serialized parameters, e.g. {"state": true, "duration": 500}
  status: "PENDING" | "DELIVERED" | "ACKNOWLEDGED" | "FAILED";
  created_at: string;          // ISO 8601 creation timestamp
  expires_at?: string;         // Expiry deadline
  delivered_at?: string;       // Socket transmission timestamp
  acknowledged_at?: string;    // Application ACK timestamp
  attempts: number;            // Number of delivery reattempts
  max_retries: number;         // Default 3
}
```

---

## 4. Telemetry Frame Model (`TelemetryPacket`)

Wire payload transmitted over TCP port 2000 and HTTP port 9100:

```typescript
interface TelemetryPacket {
  nodeId: string;
  nodeName: string;
  eventType: "heartbeat" | "gpio_change" | "boot" | "test_ping" | "manual_push";
  timestamp: string;           // "2026-11-07 00:25:00 (IST)" or "Up 340 s"
  epoch: number;               // Unix epoch seconds
  ip: string;                  // Node LAN IPv4
  gateway: string;             // Default gateway IP
  mac: string;                 // Hardware MAC address
  rssi: number;                // Wi-Fi signal in dBm
  uptimeSec: number;           // Boot uptime in seconds
  freeHeap: number;            // Allocatable RAM in bytes
  firmwareVersion: string;     // e.g. "1.6.0"
  token?: string;              // Optional pre-shared bearer token
  channels: RelayChannel[];    // Array of active channel objects
  acks?: Array<{               // Application-level command acknowledgements
    command_uuid: string;
    success: boolean;
    status: "ACKNOWLEDGED";
  }>;
}
```
