# CENTRAL SERVER DATABASE SCHEMA DDL REFERENCE

**Engine**: SQLite via Node.js built-in `node:sqlite` (`DatabaseSync`)  
**Journal Mode**: Write-Ahead Logging (`PRAGMA journal_mode = WAL;`)  
**Busy Timeout**: 5,000 ms (`PRAGMA busy_timeout = 5000;`)  
**Database File**: [`central_server_js/data/fleet.db`](file:///d:/ai/Homeautomation_server/central_server_js/data/fleet.db)  
**Schema Implementation**: [`central_server_js/src/database.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/database.js#L22-L470)  

---

## 1. Complete Table Catalog (28 Tables)

```text
1.  nodes                    15. role_permissions
2.  relays                   16. users
3.  relay_events             17. user_roles
4.  sensors                  18. scopes
5.  telemetry_logs           19. user_scopes
6.  audit_logs               20. user_sessions
7.  system_events            21. device_capabilities
8.  notifications            22. device_commands
9.  automations              23. command_results
10. firmware                 24. filesystem_files
11. node_backups             25. filesystem_backups
12. ota_history              26. device_configurations
13. roles                    27. configuration_versions
14. permissions              28. sync_jobs
```

---

## 2. Table DDL Definitions

### 1. `nodes` (Registered Microcontroller Fleet)
```sql
CREATE TABLE nodes (
  node_id TEXT PRIMARY KEY,
  name TEXT,
  hardware_type TEXT DEFAULT 'ESP8266',
  firmware_version TEXT DEFAULT '1.6.0',
  ip_address TEXT,
  mac_address TEXT,
  gateway TEXT,
  rssi INTEGER DEFAULT 0,
  uptime_sec INTEGER DEFAULT 0,
  free_heap INTEGER DEFAULT 0,
  is_online INTEGER DEFAULT 1,
  status TEXT DEFAULT 'Online',
  room TEXT DEFAULT 'General',
  location TEXT DEFAULT 'Home',
  category TEXT DEFAULT 'Controller',
  last_seen_epoch REAL,
  last_seen_str TEXT,
  channels_json TEXT,
  created_at REAL,
  device_group TEXT DEFAULT 'DEFAULT',
  mcu_type TEXT DEFAULT 'ESP8266',
  flash_capacity INTEGER DEFAULT 4194304,
  littlefs_total INTEGER DEFAULT 0,
  littlefs_used INTEGER DEFAULT 0,
  littlefs_available INTEGER DEFAULT 0,
  wifi_ssid TEXT DEFAULT '',
  auth_username TEXT DEFAULT 'admin',
  auth_password TEXT DEFAULT 'admin'
);
```

### 2. `relays` (Multi-Channel Relay Inventory)
```sql
CREATE TABLE relays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  channel_id INTEGER NOT NULL,
  pin INTEGER NOT NULL,
  name TEXT,
  room TEXT DEFAULT 'General',
  function TEXT DEFAULT 'Relay',
  active_low INTEGER DEFAULT 1,
  initial_mode INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  current_state INTEGER DEFAULT 0,
  requested_state INTEGER DEFAULT 0,
  is_syncing INTEGER DEFAULT 0,
  last_changed_at TEXT,
  UNIQUE(node_id, channel_id)
);
```

### 3. `relay_events` (Historical State Transitions)
```sql
CREATE TABLE relay_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  channel_id INTEGER NOT NULL,
  old_state INTEGER,
  new_state INTEGER,
  trigger_source TEXT,
  timestamp TEXT,
  epoch REAL
);
```

### 4. `sensors` (Environmental & Electrical Telemetry)
```sql
CREATE TABLE sensors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  sensor_type TEXT,
  name TEXT,
  room TEXT DEFAULT 'General',
  current_value REAL DEFAULT 0,
  unit TEXT,
  min_threshold REAL,
  max_threshold REAL,
  last_read_at TEXT,
  UNIQUE(node_id, sensor_type)
);
```

### 5. `telemetry_logs` (Raw Telemetry Archive)
```sql
CREATE TABLE telemetry_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  event_type TEXT,
  timestamp_str TEXT,
  epoch REAL,
  ip TEXT,
  rssi INTEGER,
  free_heap INTEGER,
  uptime_sec INTEGER,
  payload_json TEXT
);
```

### 6. `audit_logs` (Security & Administrative Log)
```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_str TEXT,
  epoch REAL,
  category TEXT,
  node_id TEXT,
  message TEXT
);
```

### 7. `system_events` (System Warnings & Lifecycle Events)
```sql
CREATE TABLE system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT,
  category TEXT,
  severity TEXT DEFAULT 'INFO',
  description TEXT,
  execution_result TEXT DEFAULT 'SUCCESS',
  timestamp TEXT
);
```

### 8. `notifications` (User Alert Drawer)
```sql
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  message TEXT,
  severity TEXT DEFAULT 'INFO',
  category TEXT DEFAULT 'SYSTEM',
  read INTEGER DEFAULT 0,
  timestamp TEXT
);
```

### 9. `automations` (Central Automation Rules)
```sql
CREATE TABLE automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  description TEXT,
  trigger_type TEXT DEFAULT 'GPIO State Change',
  condition_logic TEXT DEFAULT 'ALL',
  conditions_json TEXT DEFAULT '[]',
  actions_json TEXT DEFAULT '[]',
  execution_count INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT
);
```

### 10. `firmware` (Firmware Release Catalog)
```sql
CREATE TABLE firmware (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  version TEXT NOT NULL,
  hardware_type TEXT DEFAULT 'ESP8266',
  release_channel TEXT DEFAULT 'LTS',
  notes TEXT DEFAULT '',
  file_size_bytes INTEGER DEFAULT 0,
  checksum_md5 TEXT,
  checksum_sha256 TEXT,
  file_path TEXT,
  uploaded_at TEXT
);
```

### 11. `node_backups` (Pre-OTA Configuration Snapshots)
```sql
CREATE TABLE node_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  node_name TEXT,
  firmware_version TEXT,
  backup_type TEXT DEFAULT 'PRE_OTA',
  backup_path TEXT NOT NULL,
  file_size_bytes INTEGER DEFAULT 0,
  snapshot_json TEXT,
  created_at TEXT
);
```

### 12. `ota_history` (Firmware Deployment Audit Log)
```sql
CREATE TABLE ota_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  node_name TEXT,
  firmware_id INTEGER,
  firmware_filename TEXT,
  version_from TEXT,
  version_to TEXT,
  status TEXT DEFAULT 'PENDING',
  backup_id INTEGER,
  duration_ms INTEGER DEFAULT 0,
  details TEXT,
  error_message TEXT,
  created_at TEXT
);
```

### 13–20. RBAC & Identity Tables
```sql
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  is_system INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  email TEXT,
  is_active INTEGER DEFAULT 1,
  is_superuser INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE user_roles (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE scopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type TEXT NOT NULL,
  scope_identifier TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  UNIQUE(scope_type, scope_identifier)
);

CREATE TABLE user_scopes (
  user_id INTEGER NOT NULL,
  scope_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id) REFERENCES scopes(id) ON DELETE CASCADE
);

CREATE TABLE user_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT,
  last_active_at TEXT,
  expires_at TEXT,
  is_revoked INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### 21–23. Device Capabilities & Persistent Commands
```sql
CREATE TABLE device_capabilities (
  node_id TEXT PRIMARY KEY,
  mcu_type TEXT,
  flash_size_bytes INTEGER DEFAULT 0,
  ram_size_bytes INTEGER DEFAULT 0,
  littlefs_total_bytes INTEGER DEFAULT 0,
  littlefs_used_bytes INTEGER DEFAULT 0,
  littlefs_free_bytes INTEGER DEFAULT 0,
  ota_supported INTEGER DEFAULT 1,
  max_ota_sketch_size INTEGER DEFAULT 0,
  littlefs_supported INTEGER DEFAULT 1,
  updated_at TEXT
);

CREATE TABLE device_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_uuid TEXT UNIQUE NOT NULL,
  node_id TEXT NOT NULL,
  user_id INTEGER,
  command_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING',
  created_at TEXT,
  expires_at TEXT,
  delivered_at TEXT,
  acknowledged_at TEXT,
  attempts INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3
);

CREATE TABLE command_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_uuid TEXT NOT NULL,
  node_id TEXT NOT NULL,
  status TEXT,
  success INTEGER DEFAULT 1,
  response_payload_json TEXT,
  error_message TEXT,
  execution_time_ms INTEGER DEFAULT 0,
  received_at TEXT
);
```

### 24–28. Filesystem, Authoritative Config & Sync Jobs
```sql
CREATE TABLE filesystem_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER DEFAULT 0,
  sha256_checksum TEXT,
  last_modified_epoch REAL,
  synced_at TEXT,
  UNIQUE(node_id, file_path)
);

CREATE TABLE filesystem_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  backup_type TEXT DEFAULT 'MANUAL',
  backup_path TEXT NOT NULL,
  file_count INTEGER DEFAULT 0,
  total_bytes INTEGER DEFAULT 0,
  sha256_checksum TEXT,
  snapshot_manifest_json TEXT,
  created_at TEXT
);

CREATE TABLE device_configurations (
  node_id TEXT PRIMARY KEY,
  config_version INTEGER DEFAULT 1,
  config_json TEXT NOT NULL,
  sha256_checksum TEXT,
  sync_status TEXT DEFAULT 'SYNCED',
  last_synced_at TEXT,
  updated_at TEXT
);

CREATE TABLE configuration_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  sha256_checksum TEXT,
  change_summary TEXT,
  created_by_user_id INTEGER,
  created_at TEXT,
  UNIQUE(node_id, version)
);

CREATE TABLE sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  job_type TEXT DEFAULT 'CONFIG_SYNC',
  status TEXT DEFAULT 'PENDING',
  target_version INTEGER,
  details_json TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT
);
```
