const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { hashPassword, generateSessionToken, DEFAULT_ROLES_PERMISSIONS, ALL_PERMISSIONS } = require('./auth');

class FleetDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '..', 'data', 'fleet.db');
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch {}
    this.init();
  }

  init() {
    // 1. Nodes Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
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
        created_at REAL
      )
    `);

    // 2. Relays Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relays (
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
      )
    `);

    // 3. Relay Events History
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relay_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        channel_id INTEGER NOT NULL,
        old_state INTEGER,
        new_state INTEGER,
        trigger_source TEXT,
        timestamp TEXT,
        epoch REAL
      )
    `);

    // 4. Sensors Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sensors (
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
      )
    `);

    // 5. Telemetry Logs
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_logs (
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
      )
    `);

    // 6. Audit Logs
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp_str TEXT,
        epoch REAL,
        category TEXT,
        node_id TEXT,
        message TEXT
      )
    `);

    // 7. System Events
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT,
        category TEXT,
        severity TEXT DEFAULT 'INFO',
        description TEXT,
        execution_result TEXT DEFAULT 'SUCCESS',
        timestamp TEXT
      )
    `);

    // 8. Notifications
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        message TEXT,
        severity TEXT DEFAULT 'INFO',
        category TEXT DEFAULT 'SYSTEM',
        read INTEGER DEFAULT 0,
        timestamp TEXT
      )
    `);

    // 9. Automations Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS automations (
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
      )
    `);

    // 10. Firmware Catalog
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS firmware (
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
      )
    `);

    // 11. Node Configuration & State Backups
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS node_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        node_name TEXT,
        firmware_version TEXT,
        backup_type TEXT DEFAULT 'PRE_OTA',
        backup_path TEXT NOT NULL,
        file_size_bytes INTEGER DEFAULT 0,
        snapshot_json TEXT,
        created_at TEXT
      )
    `);

    // 12. OTA Deployment History
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ota_history (
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
      )
    `);

    // 13. Roles Table (RBAC)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        is_system INTEGER DEFAULT 0,
        created_at TEXT
      )
    `);

    // 14. Permissions Table (RBAC)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT
      )
    `);

    // 15. Role Permissions Junction
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER NOT NULL,
        permission_id INTEGER NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
      )
    `);

    // 16. Users Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        email TEXT,
        is_active INTEGER DEFAULT 1,
        is_superuser INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      )
    `);

    // 17. User Roles Junction
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id INTEGER NOT NULL,
        role_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
      )
    `);

    // 18. Scopes Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scopes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_type TEXT NOT NULL,
        scope_identifier TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        UNIQUE(scope_type, scope_identifier)
      )
    `);

    // 19. User Scopes Junction
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_scopes (
        user_id INTEGER NOT NULL,
        scope_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, scope_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (scope_id) REFERENCES scopes(id) ON DELETE CASCADE
      )
    `);

    // 20. User Sessions Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT,
        last_active_at TEXT,
        expires_at TEXT,
        is_revoked INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 21. Device Capabilities Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_capabilities (
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
      )
    `);

    // 22. Persistent Device Commands Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_commands (
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
      )
    `);

    // 23. Command Results Table (Device Application ACKs)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS command_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_uuid TEXT NOT NULL,
        node_id TEXT NOT NULL,
        status TEXT,
        success INTEGER DEFAULT 1,
        response_payload_json TEXT,
        error_message TEXT,
        execution_time_ms INTEGER DEFAULT 0,
        received_at TEXT
      )
    `);

    // 24. LittleFS Filesystem Files Catalog
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS filesystem_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size_bytes INTEGER DEFAULT 0,
        sha256_checksum TEXT,
        last_modified_epoch REAL,
        synced_at TEXT,
        UNIQUE(node_id, file_path)
      )
    `);

    // 25. LittleFS Backups Catalog
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS filesystem_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        backup_type TEXT DEFAULT 'MANUAL',
        backup_path TEXT NOT NULL,
        file_count INTEGER DEFAULT 0,
        total_bytes INTEGER DEFAULT 0,
        sha256_checksum TEXT,
        snapshot_manifest_json TEXT,
        created_at TEXT
      )
    `);

    // 26. Authoritative Device Configurations Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_configurations (
        node_id TEXT PRIMARY KEY,
        config_version INTEGER DEFAULT 1,
        config_json TEXT NOT NULL,
        sha256_checksum TEXT,
        sync_status TEXT DEFAULT 'SYNCED',
        last_synced_at TEXT,
        updated_at TEXT
      )
    `);

    // 27. Configuration Version History (Rollback Support)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS configuration_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        sha256_checksum TEXT,
        change_summary TEXT,
        created_by_user_id INTEGER,
        created_at TEXT,
        UNIQUE(node_id, version)
      )
    `);

    // 28. Sync Jobs
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        job_type TEXT DEFAULT 'CONFIG_SYNC',
        status TEXT DEFAULT 'PENDING',
        target_version INTEGER,
        details_json TEXT,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT
      )
    `);

    // 29. Homes Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS homes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        timezone TEXT DEFAULT 'UTC',
        address TEXT DEFAULT '',
        owner_user_id INTEGER DEFAULT NULL,
        created_by INTEGER DEFAULT NULL,
        is_archived INTEGER DEFAULT 0,
        created_at REAL DEFAULT (unixepoch('now', 'subsec')),
        updated_at REAL DEFAULT (unixepoch('now', 'subsec')),
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // 30. Home Members Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS home_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        home_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'VIEWER' CHECK (role IN ('HOME_OWNER', 'HOME_ADMIN', 'FAMILY_MEMBER', 'GUEST', 'VIEWER')),
        joined_at REAL DEFAULT (unixepoch('now', 'subsec')),
        created_at REAL DEFAULT (unixepoch('now', 'subsec')),
        UNIQUE(home_id, user_id),
        FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 31. Rooms Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        home_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        floor TEXT DEFAULT 'Ground',
        icon TEXT DEFAULT 'room',
        created_at REAL DEFAULT (unixepoch('now', 'subsec')),
        updated_at REAL DEFAULT (unixepoch('now', 'subsec')),
        UNIQUE(home_id, name),
        FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
      )
    `);

    // 32. Room Members Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS room_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'FAMILY_MEMBER' CHECK (role IN ('HOME_ADMIN', 'FAMILY_MEMBER', 'GUEST', 'VIEWER')),
        assigned_at REAL DEFAULT (unixepoch('now', 'subsec')),
        UNIQUE(room_id, user_id),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 33. Device Permissions Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        can_control INTEGER DEFAULT 1,
        can_view_telemetry INTEGER DEFAULT 1,
        can_configure INTEGER DEFAULT 0,
        created_at REAL DEFAULT (unixepoch('now', 'subsec')),
        UNIQUE(device_id, user_id),
        FOREIGN KEY (device_id) REFERENCES nodes(node_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Schema Migrations (backward-compatibility safe)
    try { this.db.exec(`ALTER TABLE automations ADD COLUMN description TEXT DEFAULT ''`); } catch {}
    try { this.db.exec(`ALTER TABLE automations ADD COLUMN trigger_type TEXT DEFAULT 'GPIO State Change'`); } catch {}
    try { this.db.exec(`ALTER TABLE automations ADD COLUMN condition_logic TEXT DEFAULT 'ALL'`); } catch {}
    try { this.db.exec(`ALTER TABLE automations ADD COLUMN conditions_json TEXT DEFAULT '[]'`); } catch {}
    try { this.db.exec(`ALTER TABLE automations ADD COLUMN actions_json TEXT DEFAULT '[]'`); } catch {}
    try { this.db.exec(`ALTER TABLE automations ADD COLUMN execution_count INTEGER DEFAULT 0`); } catch {}
    try { this.db.exec(`ALTER TABLE automations ADD COLUMN created_at TEXT DEFAULT ''`); } catch {}

    try { this.db.exec(`ALTER TABLE firmware ADD COLUMN hardware_type TEXT DEFAULT 'ESP8266'`); } catch {}
    try { this.db.exec(`ALTER TABLE firmware ADD COLUMN file_size_bytes INTEGER DEFAULT 0`); } catch {}
    try { this.db.exec(`ALTER TABLE firmware ADD COLUMN checksum_md5 TEXT DEFAULT ''`); } catch {}
    try { this.db.exec(`ALTER TABLE firmware ADD COLUMN file_path TEXT DEFAULT ''`); } catch {}
    try { this.db.exec(`ALTER TABLE firmware ADD COLUMN uploaded_at TEXT DEFAULT ''`); } catch {}
    try { this.db.exec(`ALTER TABLE firmware ADD COLUMN release_channel TEXT DEFAULT 'LTS'`); } catch {}
    try { this.db.exec(`ALTER TABLE firmware ADD COLUMN notes TEXT DEFAULT ''`); } catch {}
    try { this.db.exec(`ALTER TABLE firmware ADD COLUMN checksum_sha256 TEXT DEFAULT ''`); } catch {}
    try { this.db.exec(`ALTER TABLE firmware ADD COLUMN is_latest INTEGER DEFAULT 0`); } catch {}

    try { this.db.exec(`ALTER TABLE notifications ADD COLUMN category TEXT DEFAULT 'SYSTEM'`); } catch {}

    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN device_group TEXT DEFAULT 'DEFAULT'`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN mcu_type TEXT DEFAULT 'ESP8266'`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN flash_capacity INTEGER DEFAULT 4194304`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN littlefs_total INTEGER DEFAULT 0`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN littlefs_used INTEGER DEFAULT 0`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN littlefs_available INTEGER DEFAULT 0`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN wifi_ssid TEXT DEFAULT ''`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN auth_username TEXT DEFAULT 'admin'`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN auth_password TEXT DEFAULT 'admin'`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN home_id INTEGER DEFAULT NULL`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN room_id INTEGER DEFAULT NULL`); } catch {}
    try { this.db.exec(`ALTER TABLE nodes ADD COLUMN assigned_at REAL DEFAULT NULL`); } catch {}

    this.seedDefaults();
    this.deduplicateFleetNodes();
    try { this.updateLatestFirmwareFlags(); } catch {}
  }

  seedDefaults() {
    // 1. Audit log seeds
    const auditCount = this.db.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count;
    if (auditCount === 0) {
      this.logAudit('SERVER_START', 'System', 'Central Fleet Server started on port 9100');
      this.logAudit('TCP_INIT', 'System', 'TCP Telemetry listener initialized on port 2000');
    }

    // 2. Automations default rule
    const autoCount = this.db.prepare('SELECT COUNT(*) as count FROM automations').get().count;
    if (autoCount === 0) {
      const defaultRule = {
        name: 'Auto Off Gate Light at Dawn',
        description: 'Automatically switch off Gate Light when heartbeat event is received in the morning',
        trigger_type: 'Heartbeat Check',
        condition_logic: 'ALL',
        conditions: [{ target: 'Time', operator: 'Between', value: '06:00 - 08:00' }],
        actions: [{ action: 'setState', target: 'Gate Light', state: false }],
        execution_count: 0,
        enabled: 1
      };
      this.addAutomation(defaultRule);
    }

    // 3. Firmware default entry
    const fwCount = this.db.prepare('SELECT COUNT(*) as count FROM firmware').get().count;
    if (fwCount === 0) {
      this.addFirmwareRecord({
        filename: 'firmware-v1.6.0-esp8266.bin',
        version: '1.6.0',
        hardware_type: 'ESP8266',
        file_size_bytes: 576080,
        checksum_md5: 'a4b87e2190cd5612ef44917a2283cb91',
        file_path: 'data/firmware/firmware-v1.6.0-esp8266.bin'
      });
    }

    // 4. Seed Permissions
    const permCount = this.db.prepare('SELECT COUNT(*) as count FROM permissions').get().count;
    if (permCount === 0) {
      const insertPerm = this.db.prepare(`
        INSERT INTO permissions (code, name, category, description)
        VALUES (?, ?, ?, ?)
      `);
      for (const p of ALL_PERMISSIONS) {
        insertPerm.run(p.code, p.name, p.category, p.description);
      }
    }

    // 5. Seed Default Roles and Role Permissions
    const roleCount = this.db.prepare('SELECT COUNT(*) as count FROM roles').get().count;
    if (roleCount === 0) {
      const insertRole = this.db.prepare(`
        INSERT INTO roles (name, description, is_system, created_at)
        VALUES (?, ?, 1, ?)
      `);
      const insertRolePerm = this.db.prepare(`
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
        VALUES (?, ?)
      `);
      const getPermId = this.db.prepare('SELECT id FROM permissions WHERE code = ?');
      const nowStr = new Date().toISOString();

      const roleDescriptions = {
        SUPER_ADMIN: 'Complete central server authority with unrestricted configuration, users and backups',
        ADMIN: 'Fleet administration, assigned users, devices, firmware and LittleFS management',
        DEVICE_MANAGER: 'Device registration, configuration, approved firmware deployment and LittleFS',
        OPERATOR: 'Device monitoring, relay control, live telemetry and sensor reading',
        VIEWER: 'Read-only access to devices, telemetry, logs and dashboards',
        DEVELOPER: 'Access development devices, upload test firmware and inspect logs'
      };

      for (const [roleName, permCodes] of Object.entries(DEFAULT_ROLES_PERMISSIONS)) {
        const desc = roleDescriptions[roleName] || roleName;
        const res = insertRole.run(roleName, desc, nowStr);
        const roleId = Number(res.lastInsertRowid);

        for (const code of permCodes) {
          const permRow = getPermId.get(code);
          if (permRow) {
            insertRolePerm.run(roleId, permRow.id);
          }
        }
      }
    }

    // 6. Seed Root Scope
    const scopeCount = this.db.prepare('SELECT COUNT(*) as count FROM scopes').get().count;
    if (scopeCount === 0) {
      this.db.prepare(`
        INSERT INTO scopes (scope_type, scope_identifier, name, description)
        VALUES ('GLOBAL', 'global', 'Global Scope', 'Full fleet and location access')
      `).run();
    }

    // 7. Seed Initial Administrator User
    const userCount = this.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount === 0) {
      const nowStr = new Date().toISOString();
      const adminPassHash = hashPassword('admin123');
      const userRes = this.db.prepare(`
        INSERT INTO users (username, password_hash, full_name, email, is_active, is_superuser, created_at, updated_at)
        VALUES ('admin', ?, 'System Administrator', 'admin@smarthome.local', 1, 1, ?, ?)
      `).run(adminPassHash, nowStr, nowStr);

      const userId = Number(userRes.lastInsertRowid);
      const superAdminRole = this.db.prepare("SELECT id FROM roles WHERE name = 'SUPER_ADMIN'").get();
      if (superAdminRole) {
        this.db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, superAdminRole.id);
      }

      const globalScope = this.db.prepare("SELECT id FROM scopes WHERE scope_identifier = 'global'").get();
      if (globalScope) {
        this.db.prepare('INSERT INTO user_scopes (user_id, scope_id) VALUES (?, ?)').run(userId, globalScope.id);
      }

      this.logAudit('USER_CREATED', 'System', 'Initial superuser admin initialized with SUPER_ADMIN role & GLOBAL scope');
    }

    // 8. Seed Default Home and Room (if empty)
    const homeCount = this.db.prepare('SELECT COUNT(*) as count FROM homes').get().count;
    if (homeCount === 0) {
      this.db.prepare(`
        INSERT INTO homes (name, description, timezone, owner_user_id, created_by)
        VALUES ('Primary Residence', 'Default Primary Home for Central Microcontroller Fleet', 'UTC', NULL, 1)
      `).run();
      const defaultHome = this.db.prepare("SELECT id FROM homes WHERE name = 'Primary Residence'").get();
      if (defaultHome) {
        this.db.prepare(`
          INSERT INTO rooms (home_id, name, floor, icon)
          VALUES (?, 'Master Bedroom', 'Ground', 'bed')
        `).run(defaultHome.id);
      }
    }
  }

  // === NODE METHODS ===

  deduplicateFleetNodes() {
    try {
      const allNodes = this.db.prepare('SELECT node_id, name, ip_address, mac_address, room, auth_password FROM nodes').all();
      const byMac = new Map();
      const byIp = new Map();

      for (const node of allNodes) {
        const mac = (node.mac_address || '').trim().toUpperCase();
        const ip = (node.ip_address || '').trim();

        let primary = null;
        if (mac && mac.length >= 8) {
          primary = byMac.get(mac);
        } else if (ip && ip.length >= 7 && ip !== '0.0.0.0' && ip !== '127.0.0.1') {
          primary = byIp.get(ip);
        }

        if (!primary) {
          if (mac && mac.length >= 8) byMac.set(mac, node);
          if (ip && ip.length >= 7 && ip !== '0.0.0.0' && ip !== '127.0.0.1') byIp.set(ip, node);
        } else {
          const primaryIsHardwareMac = /^NODE-[A-F0-9]{12}$/i.test(primary.node_id);
          const currentIsHardwareMac = /^NODE-[A-F0-9]{12}$/i.test(node.node_id);

          let winner = primary;
          let loser = node;

          if (!primaryIsHardwareMac && currentIsHardwareMac) {
            winner = node;
            loser = primary;
          }

          if ((!winner.room || winner.room === 'General') && loser.room && loser.room !== 'General') {
            this.db.prepare('UPDATE nodes SET room = ? WHERE node_id = ?').run(loser.room, winner.node_id);
          }
          if ((!winner.auth_password || winner.auth_password === 'admin') && loser.auth_password && loser.auth_password !== 'admin') {
            this.db.prepare('UPDATE nodes SET auth_password = ? WHERE node_id = ?').run(loser.auth_password, winner.node_id);
          }

          const winnerRelays = this.db.prepare('SELECT count(*) as c FROM relays WHERE node_id = ?').get(winner.node_id);
          if (!winnerRelays || winnerRelays.c === 0) {
            this.db.prepare('UPDATE relays SET node_id = ? WHERE node_id = ?').run(winner.node_id, loser.node_id);
          } else {
            this.db.prepare('DELETE FROM relays WHERE node_id = ?').run(loser.node_id);
          }

          this.db.prepare('DELETE FROM telemetry_logs WHERE node_id = ?').run(loser.node_id);
          this.db.prepare('DELETE FROM commands WHERE node_id = ?').run(loser.node_id);
          this.db.prepare('DELETE FROM system_events WHERE node_id = ?').run(loser.node_id);
          this.db.prepare('DELETE FROM nodes WHERE node_id = ?').run(loser.node_id);

          if (mac) byMac.set(mac, winner);
          if (ip) byIp.set(ip, winner);
        }
      }
    } catch (e) {
      console.warn('Deduplication check error:', e.message);
    }
  }

  upsertNode(data) {
    const rawNodeId = data.nodeId || data.node_id;
    if (!rawNodeId) return false;

    const nowEpoch = Date.now() / 1000;
    const nowStr = new Date().toISOString();
    const channelsJson = JSON.stringify(data.channels || []);
    const name = data.nodeName || data.name || rawNodeId;
    const ip = (data.ip || data.ip_address || '').trim();
    const mac = (data.mac || data.mac_address || '').trim();
    const incomingFw = (data.firmwareVersion || data.firmware_version || '').trim();
    const incomingHw = (data.hardware || data.hardware_type || '').trim();
    const hasPcfPins = Array.isArray(data.channels) && data.channels.some(ch => {
      const p = Number(ch.pin);
      return Number.isFinite(p) && p >= 100 && p <= 107;
    });
    const rssi = Number(data.rssi) || 0;
    const uptime = Number(data.uptimeSec || data.uptime_sec) || 0;
    const heap = Number(data.freeHeap || data.free_heap) || 0;
    const gateway = data.gateway || '';
    const group = data.device_group || data.group || 'DEFAULT';

    // 1. Check if node exists by exact node_id
    let existing = this.db.prepare('SELECT * FROM nodes WHERE node_id = ?').get(rawNodeId);

    // 2. If not found by node_id, check by physical MAC address
    if (!existing && mac.length >= 8) {
      existing = this.db.prepare('SELECT * FROM nodes WHERE UPPER(mac_address) = UPPER(?)').get(mac);
    }

    // 3. If still not found by MAC, check by IP address
    if (!existing && ip.length >= 7 && ip !== '0.0.0.0' && ip !== '127.0.0.1') {
      existing = this.db.prepare('SELECT * FROM nodes WHERE ip_address = ?').get(ip);
    }

    let targetNodeId = rawNodeId;
    if (existing) {
      const existingIsHardwareMac = /^NODE-[A-F0-9]{12}$/i.test(existing.node_id);
      const incomingIsHardwareMac = /^NODE-[A-F0-9]{12}$/i.test(rawNodeId);

      if (!existingIsHardwareMac && incomingIsHardwareMac) {
        targetNodeId = rawNodeId;
        this.db.prepare('UPDATE relays SET node_id = ? WHERE node_id = ?').run(targetNodeId, existing.node_id);
        this.db.prepare('UPDATE commands SET node_id = ? WHERE node_id = ?').run(targetNodeId, existing.node_id);
        this.db.prepare('UPDATE telemetry_logs SET node_id = ? WHERE node_id = ?').run(targetNodeId, existing.node_id);
        this.db.prepare('UPDATE system_events SET node_id = ? WHERE node_id = ?').run(targetNodeId, existing.node_id);
        this.db.prepare('UPDATE nodes SET node_id = ? WHERE node_id = ?').run(targetNodeId, existing.node_id);
      } else {
        targetNodeId = existing.node_id;
      }
    }

    // Prune any lingering duplicate rows sharing the exact same MAC or LAN IP
    if (mac.length >= 8) {
      const dups = this.db.prepare('SELECT node_id FROM nodes WHERE UPPER(mac_address) = UPPER(?) AND node_id != ?').all(mac, targetNodeId);
      for (const d of dups) {
        this.db.prepare('DELETE FROM relays WHERE node_id = ?').run(d.node_id);
        this.db.prepare('DELETE FROM telemetry_logs WHERE node_id = ?').run(d.node_id);
        this.db.prepare('DELETE FROM commands WHERE node_id = ?').run(d.node_id);
        this.db.prepare('DELETE FROM system_events WHERE node_id = ?').run(d.node_id);
        this.db.prepare('DELETE FROM nodes WHERE node_id = ?').run(d.node_id);
      }
    } else if (ip.length >= 7 && ip !== '0.0.0.0' && ip !== '127.0.0.1') {
      const dups = this.db.prepare('SELECT node_id FROM nodes WHERE ip_address = ? AND node_id != ?').all(ip, targetNodeId);
      for (const d of dups) {
        this.db.prepare('DELETE FROM relays WHERE node_id = ?').run(d.node_id);
        this.db.prepare('DELETE FROM telemetry_logs WHERE node_id = ?').run(d.node_id);
        this.db.prepare('DELETE FROM commands WHERE node_id = ?').run(d.node_id);
        this.db.prepare('DELETE FROM system_events WHERE node_id = ?').run(d.node_id);
        this.db.prepare('DELETE FROM nodes WHERE node_id = ?').run(d.node_id);
      }
    }

    if (existing) {
      const existingHw = (existing.hardware_type || '').trim();
      const resolvedHw = incomingHw ||
        (hasPcfPins && !existingHw.toUpperCase().includes('PCF8574') ? 'ESP8266 ESP-01 + PCF8574T (1MB)' : (existingHw || 'ESP8266'));
      const resolvedFw = incomingFw || existing.firmware_version || '1.6.0';
      const updateStmt = this.db.prepare(`
        UPDATE nodes SET
          name = COALESCE(?, name),
          hardware_type = ?,
          firmware_version = ?,
          ip_address = ?,
          mac_address = CASE WHEN ? != '' THEN ? ELSE mac_address END,
          gateway = ?,
          rssi = ?,
          uptime_sec = ?,
          free_heap = ?,
          is_online = 1,
          status = 'Online',
          last_seen_epoch = ?,
          last_seen_str = ?,
          channels_json = ?,
          device_group = COALESCE(?, device_group)
        WHERE node_id = ?
      `);
      updateStmt.run(name, resolvedHw, resolvedFw, ip, mac, mac, gateway, rssi, uptime, heap, nowEpoch, nowStr, channelsJson, group, targetNodeId);
    } else {
      const resolvedHw = incomingHw || (hasPcfPins ? 'ESP8266 ESP-01 + PCF8574T (1MB)' : 'ESP8266');
      const resolvedFw = incomingFw || '1.6.0';
      const insertStmt = this.db.prepare(`
        INSERT INTO nodes (
          node_id, name, hardware_type, firmware_version, ip_address, mac_address, gateway,
          rssi, uptime_sec, free_heap, is_online, status, room, location, category,
          last_seen_epoch, last_seen_str, channels_json, created_at, device_group
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Online', 'General', 'Home', 'Controller', ?, ?, ?, ?, ?)
      `);
      insertStmt.run(targetNodeId, name, resolvedHw, resolvedFw, ip, mac, gateway, rssi, uptime, heap, nowEpoch, nowStr, channelsJson, nowEpoch, group);
    }

    const stateChanges = [];
    if (Array.isArray(data.channels)) {
      const activeChannelIds = [];
      for (const ch of data.channels) {
        const chId = Number(ch.id ?? ch.channel_id);
        if (!isNaN(chId) && chId > 0) {
          activeChannelIds.push(chId);
          const chRes = this.upsertRelayFromChannel(targetNodeId, ch);
          if (chRes && chRes.changed) {
            stateChanges.push(chRes);
          }
        }
      }

      if (activeChannelIds.length > 0) {
        const placeholders = activeChannelIds.map(() => '?').join(',');
        this.db.prepare(`
          DELETE FROM relays 
          WHERE node_id = ? AND channel_id NOT IN (${placeholders})
        `).run(targetNodeId, ...activeChannelIds);
      } else {
        this.db.prepare('DELETE FROM relays WHERE node_id = ?').run(targetNodeId);
      }
    }

    return { success: true, stateChanges, nodeId: targetNodeId };
  }

    syncNodeRelays(nodeId, channels) {
    if (!Array.isArray(channels)) return 0;
    const activeChannelIds = [];
    for (const ch of channels) {
      const chId = Number(ch.id ?? ch.channel_id);
      if (!isNaN(chId) && chId > 0) {
        activeChannelIds.push(chId);
        this.upsertRelayFromChannel(nodeId, ch);
      }
    }

    if (activeChannelIds.length > 0) {
      const placeholders = activeChannelIds.map(() => '?').join(',');
      this.db.prepare(`
        DELETE FROM relays 
        WHERE node_id = ? AND channel_id NOT IN (${placeholders})
      `).run(nodeId, ...activeChannelIds);
    } else {
      this.db.prepare('DELETE FROM relays WHERE node_id = ?').run(nodeId);
    }
    return activeChannelIds.length;
  }

  touchNode(nodeId) {
    const nowEpoch = Date.now() / 1000;
    const nowStr = new Date().toISOString();
    try {
      this.db.prepare('UPDATE nodes SET last_seen_epoch = ?, last_seen_str = ? WHERE node_id = ?').run(nowEpoch, nowStr, nodeId);
    } catch (e) {
      console.error('Error touching node:', e);
    }
  }

  upsertRelayFromChannel(nodeId, ch) {
    const chId = Number(ch.id ?? ch.channel_id);
    if (isNaN(chId)) return;

    const pin = Number(ch.pin) || 0;
    const name = ch.name || `Output ${chId}`;
    const room = ch.room || 'General';
    const func = ch.function || 'Relay';
    const activeLow = ch.activeLow === false ? 0 : 1;
    const initialMode = Number(ch.initialMode) || 0;
    const enabled = ch.enabled === false ? 0 : 1;
    const state = ch.state ? 1 : 0;
    const nowStr = new Date().toISOString();

    const existingRelay = this.db.prepare('SELECT current_state, name, pin FROM relays WHERE node_id = ? AND channel_id = ?').get(nodeId, chId);

    let changed = false;
    let oldState = 0;

    if (existingRelay) {
      oldState = existingRelay.current_state;
      if (existingRelay.current_state !== state) {
        changed = true;
        this.logRelayEvent(nodeId, chId, existingRelay.current_state, state, 'TELEMETRY_SYNC');
      }
      const updateStmt = this.db.prepare(`
        UPDATE relays SET
          pin = ?, name = ?, room = ?, function = ?, active_low = ?, initial_mode = ?,
          enabled = ?, current_state = ?, requested_state = ?, is_syncing = 0, last_changed_at = ?
        WHERE node_id = ? AND channel_id = ?
      `);
      updateStmt.run(pin, name, room, func, activeLow, initialMode, enabled, state, state, nowStr, nodeId, chId);
    } else {
      const insertStmt = this.db.prepare(`
        INSERT INTO relays (
          node_id, channel_id, pin, name, room, function, active_low, initial_mode,
          enabled, current_state, requested_state, is_syncing, last_changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `);
      insertStmt.run(nodeId, chId, pin, name, room, func, activeLow, initialMode, enabled, state, state, nowStr);
    }

    return {
      changed,
      channelId: chId,
      pin,
      name,
      oldState,
      newState: state
    };
  }

  getNodes(filters = {}) {
    let sql = `
      SELECT n.*, 
             h.name AS home_name, 
             r.name AS room_name 
      FROM nodes n
      LEFT JOIN homes h ON n.home_id = h.id
      LEFT JOIN rooms r ON n.room_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.home_id !== undefined && filters.home_id !== null && filters.home_id !== '') {
      if (filters.home_id === 'unassigned' || filters.home_id === 0) {
        sql += ' AND n.home_id IS NULL';
      } else {
        sql += ' AND n.home_id = ?';
        params.push(Number(filters.home_id));
      }
    }
    if (filters.room_id !== undefined && filters.room_id !== null && filters.room_id !== '') {
      sql += ' AND n.room_id = ?';
      params.push(Number(filters.room_id));
    }
    if (filters.room) {
      sql += ' AND (n.room = ? OR r.name = ?)';
      params.push(filters.room, filters.room);
    }
    if (filters.status) {
      sql += ' AND n.status = ?';
      params.push(filters.status);
    }
    if (filters.hardware) {
      sql += ' AND n.hardware_type = ?';
      params.push(filters.hardware);
    }
    if (filters.search) {
      sql += ' AND (n.name LIKE ? OR n.node_id LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    sql += ' ORDER BY n.is_online DESC, n.last_seen_epoch DESC';
    const rows = this.db.prepare(sql).all(...params);

    return rows.map(n => {
      let channels = [];
      try {
        channels = JSON.parse(n.channels_json || '[]');
      } catch {
        channels = [];
      }
      const relays = this.getRelays({ node_id: n.node_id });
      return {
        id: n.node_id,
        node_id: n.node_id,
        nodeId: n.node_id,
        name: n.name,
        node_name: n.name,
        hardware_type: n.hardware_type,
        firmware_version: n.firmware_version,
        ip: n.ip_address,
        ip_address: n.ip_address,
        mac: n.mac_address,
        mac_address: n.mac_address,
        gateway: n.gateway,
        rssi: n.rssi,
        uptime_sec: n.uptime_sec,
        free_heap: n.free_heap,
        is_online: Boolean(n.is_online),
        status: Boolean(n.is_online) ? 'Online' : 'Offline',
        auth_username: n.auth_username || 'admin',
        auth_password: n.auth_password || 'admin',
        home_id: n.home_id ?? null,
        home_name: n.home_name || null,
        room_id: n.room_id ?? null,
        room_name: n.room_name || n.room || 'General',
        room: n.room_name || n.room || 'General',
        assigned_at: n.assigned_at ?? null,
        is_assigned: Boolean(n.home_id && n.room_id),
        location: n.location,
        category: n.category,
        device_group: n.device_group || 'DEFAULT',
        last_seen_epoch: n.last_seen_epoch,
        last_seen_str: n.last_seen_str,
        last_seen_at: n.last_seen_str,
        relays_count: relays.length,
        sensors_count: 0,
        relays: relays,
        channels: channels
      };
    });
  }

  getNode(nodeId) {
    const row = this.db.prepare(`
      SELECT n.*, 
             h.name AS home_name, 
             r.name AS room_name 
      FROM nodes n
      LEFT JOIN homes h ON n.home_id = h.id
      LEFT JOIN rooms r ON n.room_id = r.id
      WHERE n.node_id = ?
    `).get(nodeId);
    if (!row) return null;
    let channels = [];
    try {
      channels = JSON.parse(row.channels_json || '[]');
    } catch {
      channels = [];
    }
    const relays = this.getRelays({ node_id: nodeId });
    return {
      id: row.node_id,
      node_id: row.node_id,
      nodeId: row.node_id,
      name: row.name,
      node_name: row.name,
      hardware_type: row.hardware_type,
      firmware_version: row.firmware_version,
      ip: row.ip_address,
      ip_address: row.ip_address,
      mac: row.mac_address,
      mac_address: row.mac_address,
      gateway: row.gateway,
      rssi: row.rssi,
      uptime_sec: row.uptime_sec,
      free_heap: row.free_heap,
      is_online: Boolean(row.is_online),
      status: Boolean(row.is_online) ? 'Online' : 'Offline',
      auth_username: row.auth_username || 'admin',
      auth_password: row.auth_password || 'admin',
      home_id: row.home_id ?? null,
      home_name: row.home_name || null,
      room_id: row.room_id ?? null,
      room_name: row.room_name || row.room || 'General',
      room: row.room_name || row.room || 'General',
      assigned_at: row.assigned_at ?? null,
      is_assigned: Boolean(row.home_id && row.room_id),
      location: row.location,
      category: row.category,
      device_group: row.device_group || 'DEFAULT',
      last_seen_epoch: row.last_seen_epoch,
      last_seen_str: row.last_seen_str,
      last_seen_at: row.last_seen_str,
      relays_count: relays.length,
      sensors_count: 0,
      relays: relays,
      channels: channels
    };
  }

  deleteNode(nodeId) {
    this.db.prepare('DELETE FROM nodes WHERE node_id = ?').run(nodeId);
    this.db.prepare('DELETE FROM relays WHERE node_id = ?').run(nodeId);
    return true;
  }

  renameNode(nodeId, newName) {
    const res = this.db.prepare('UPDATE nodes SET name = ? WHERE node_id = ?').run(newName, nodeId);
    return res.changes > 0;
  }

  getNodeByIp(ip) {
    if (!ip) return null;
    const row = this.db.prepare('SELECT node_id FROM nodes WHERE ip_address = ?').get(ip);
    if (!row) return null;
    return this.getNode(row.node_id);
  }

  updateNodeSettings(nodeId, settings = {}) {
    const existing = this.getNode(nodeId);
    if (!existing) return null;

    const name = settings.name !== undefined ? settings.name.trim() : existing.name;
    const room = settings.room !== undefined ? settings.room.trim() : existing.room;
    const category = settings.category !== undefined ? settings.category.trim() : existing.category;
    const location = settings.location !== undefined ? settings.location.trim() : existing.location;
    const ip = settings.ip_address !== undefined ? settings.ip_address.trim() : (settings.ip !== undefined ? settings.ip.trim() : existing.ip_address);
    const hw = settings.hardware_type !== undefined ? settings.hardware_type.trim() : existing.hardware_type;
    const fw = settings.firmware_version !== undefined ? settings.firmware_version.trim() : existing.firmware_version;
    const authUser = settings.auth_username !== undefined ? settings.auth_username.trim() : (existing.auth_username || 'admin');
    const authPass = settings.auth_password !== undefined ? settings.auth_password : (existing.auth_password || 'admin');

    this.db.prepare(`
      UPDATE nodes SET
        name = ?,
        room = ?,
        category = ?,
        location = ?,
        ip_address = ?,
        hardware_type = ?,
        firmware_version = ?,
        auth_username = ?,
        auth_password = ?
      WHERE node_id = ?
    `).run(name, room, category, location, ip, hw, fw, authUser, authPass, nodeId);

    return this.getNode(nodeId);
  }

  addOrUpdateRelay(nodeId, relayData = {}) {
    let rawId = relayData.channel_id ?? relayData.id;
    if (typeof rawId === 'string') {
      const match = rawId.match(/\d+/);
      if (match) rawId = parseInt(match[0], 10);
    }
    const channelId = Number(rawId);
    if (isNaN(channelId) || channelId <= 0) {
      throw new Error('Valid numeric channel_id (e.g. 1, 2, 3 or ch1) is required');
    }

    const pin = Number(relayData.pin ?? 0);
    const name = (relayData.name || `Relay ${channelId}`).trim();
    const room = (relayData.room || 'General').trim();
    const func = (relayData.function || 'Relay').trim();
    const activeLow = (relayData.active_low === false || relayData.activeLow === false) ? 0 : 1;
    const initialMode = Number(relayData.initial_mode ?? relayData.initialMode ?? 0);
    const enabled = (relayData.enabled === false) ? 0 : 1;
    const nowStr = new Date().toISOString();

    const existing = this.db.prepare('SELECT id FROM relays WHERE node_id = ? AND channel_id = ?').get(nodeId, channelId);

    if (existing) {
      this.db.prepare(`
        UPDATE relays SET
          pin = ?, name = ?, room = ?, function = ?, active_low = ?, initial_mode = ?, enabled = ?, last_changed_at = ?
        WHERE node_id = ? AND channel_id = ?
      `).run(pin, name, room, func, activeLow, initialMode, enabled, nowStr, nodeId, channelId);
    } else {
      this.db.prepare(`
        INSERT INTO relays (
          node_id, channel_id, pin, name, room, function, active_low, initial_mode, enabled, current_state, requested_state, is_syncing, last_changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
      `).run(nodeId, channelId, pin, name, room, func, activeLow, initialMode, enabled, nowStr);
    }

    // Keep channels_json in nodes table in sync
    const allRelays = this.getRelays({ node_id: nodeId });
    const channels = allRelays.map(r => ({
      id: r.channel_id,
      pin: r.pin,
      name: r.name,
      room: r.room,
      function: r.function,
      activeLow: r.active_low,
      initialMode: r.initial_mode,
      enabled: r.enabled,
      state: r.current_state
    }));
    this.db.prepare('UPDATE nodes SET channels_json = ? WHERE node_id = ?').run(JSON.stringify(channels), nodeId);

    return this.getRelay(nodeId, channelId);
  }

  deleteRelay(nodeId, channelId) {
    let numericId = channelId;
    if (typeof channelId === 'string') {
      const match = channelId.match(/\d+/);
      if (match) numericId = parseInt(match[0], 10);
    }
    this.db.prepare('DELETE FROM relays WHERE node_id = ? AND channel_id = ?').run(nodeId, numericId);
    
    // Refresh channels_json in nodes table
    const allRelays = this.getRelays({ node_id: nodeId });
    const channels = allRelays.map(r => ({
      id: r.channel_id,
      pin: r.pin,
      name: r.name,
      room: r.room,
      function: r.function,
      activeLow: r.active_low,
      initialMode: r.initial_mode,
      enabled: r.enabled,
      state: r.current_state
    }));
    this.db.prepare('UPDATE nodes SET channels_json = ? WHERE node_id = ?').run(JSON.stringify(channels), nodeId);
    return true;
  }

  setNodeOnline(nodeId, isOnline) {
    const status = isOnline ? 'Online' : 'Offline';
    this.db.prepare('UPDATE nodes SET is_online = ?, status = ? WHERE node_id = ?').run(isOnline ? 1 : 0, status, nodeId);
  }

  // === RELAY METHODS ===

  getRelays(filters = {}) {
    let sql = `
      SELECT r.*, n.name AS node_name, n.is_online AS node_online, n.ip_address AS node_ip
      FROM relays r
      JOIN nodes n ON r.node_id = n.node_id
      WHERE 1=1
    `;
    const params = [];

    if (filters.room) {
      sql += ' AND r.room = ?';
      params.push(filters.room);
    }
    if (filters.node_id) {
      sql += ' AND r.node_id = ?';
      params.push(filters.node_id);
    }
    if (filters.state !== undefined) {
      sql += ' AND r.current_state = ?';
      params.push(filters.state ? 1 : 0);
    }

    sql += ' ORDER BY r.node_id ASC, r.channel_id ASC';
    const rows = this.db.prepare(sql).all(...params);

    return rows.map(r => ({
      id: r.id,
      node_id: r.node_id,
      nodeId: r.node_id,
      node_name: r.node_name,
      node_online: Boolean(r.node_online),
      node_ip: r.node_ip,
      channel_id: r.channel_id,
      id_channel: r.channel_id,
      pin: r.pin,
      name: r.name,
      room: r.room,
      function: r.function,
      active_low: Boolean(r.active_low),
      activeLow: Boolean(r.active_low),
      initial_mode: r.initial_mode,
      enabled: Boolean(r.enabled),
      current_state: Boolean(r.current_state),
      state: Boolean(r.current_state),
      requested_state: Boolean(r.requested_state),
      is_syncing: Boolean(r.is_syncing),
      last_changed_at: r.last_changed_at
    }));
  }

  getRelay(nodeId, channelId) {
    const row = this.db.prepare(`
      SELECT r.*, n.name AS node_name, n.is_online AS node_online, n.ip_address AS node_ip
      FROM relays r
      JOIN nodes n ON r.node_id = n.node_id
      WHERE r.node_id = ? AND r.channel_id = ?
    `).get(nodeId, Number(channelId));

    if (!row) return null;
    return {
      id: row.id,
      node_id: row.node_id,
      nodeId: row.node_id,
      node_name: row.node_name,
      node_online: Boolean(row.node_online),
      node_ip: row.node_ip,
      channel_id: row.channel_id,
      pin: row.pin,
      name: row.name,
      room: row.room,
      function: row.function,
      active_low: Boolean(row.active_low),
      enabled: Boolean(row.enabled),
      current_state: Boolean(row.current_state),
      state: Boolean(row.current_state),
      requested_state: Boolean(row.requested_state),
      is_syncing: Boolean(row.is_syncing),
      last_changed_at: row.last_changed_at
    };
  }

  updateRelayState(nodeId, channelId, state) {
    const chId = Number(channelId);
    const stateVal = state ? 1 : 0;
    const nowStr = new Date().toISOString();
    this.db.prepare(`
      UPDATE relays SET current_state = ?, requested_state = ?, is_syncing = 0, last_changed_at = ?
      WHERE node_id = ? AND channel_id = ?
    `).run(stateVal, stateVal, nowStr, nodeId, chId);

    const node = this.getNode(nodeId);
    if (node && Array.isArray(node.channels)) {
      for (const ch of node.channels) {
        if (Number(ch.id) === chId) {
          ch.state = Boolean(state);
        }
      }
      this.db.prepare('UPDATE nodes SET channels_json = ? WHERE node_id = ?').run(JSON.stringify(node.channels), nodeId);
    }
  }

  logRelayEvent(nodeId, channelId, oldState, newState, triggerSource) {
    const nowStr = new Date().toISOString();
    const nowEpoch = Date.now() / 1000;
    this.db.prepare(`
      INSERT INTO relay_events (node_id, channel_id, old_state, new_state, trigger_source, timestamp, epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nodeId, Number(channelId), oldState ? 1 : 0, newState ? 1 : 0, triggerSource || 'MANUAL', nowStr, nowEpoch);
  }

  getRelayHistory(nodeId, channelId, limit = 50) {
    return this.db.prepare(`
      SELECT * FROM relay_events WHERE node_id = ? AND channel_id = ? ORDER BY id DESC LIMIT ?
    `).all(nodeId, Number(channelId), limit);
  }

  // === SENSORS ===

  getSensors() {
    return this.db.prepare('SELECT * FROM sensors ORDER BY id DESC').all();
  }

  // === TELEMETRY & AUDIT LOGS ===

  logTelemetry(nodeId, eventType, data) {
    const nowEpoch = Date.now() / 1000;
    const nowStr = new Date().toISOString();
    const ip = data.ip || '';
    const rssi = Number(data.rssi) || 0;
    const heap = Number(data.freeHeap) || 0;
    const uptime = Number(data.uptimeSec) || 0;
    const payloadJson = JSON.stringify(data);

    this.db.prepare(`
      INSERT INTO telemetry_logs (node_id, event_type, timestamp_str, epoch, ip, rssi, free_heap, uptime_sec, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nodeId, eventType, nowStr, nowEpoch, ip, rssi, heap, uptime, payloadJson);
  }

  getRecentTelemetry(limit = 50) {
    const rows = this.db.prepare('SELECT * FROM telemetry_logs ORDER BY id DESC LIMIT ?').all(limit);
    return rows.map(r => ({
      id: r.id,
      node_id: r.node_id,
      nodeId: r.node_id,
      event_type: r.event_type,
      eventType: r.event_type,
      timestamp: r.timestamp_str || new Date(r.epoch * 1000).toISOString(),
      epoch: r.epoch,
      ip: r.ip,
      rssi: r.rssi,
      free_heap: r.free_heap,
      uptime_sec: r.uptime_sec,
      payload: JSON.parse(r.payload_json || '{}')
    }));
  }

  getTelemetryHistory(nodeId, limit = 20) {
    const rows = this.db.prepare('SELECT * FROM telemetry_logs WHERE node_id = ? ORDER BY id DESC LIMIT ?').all(nodeId, limit);
    return rows.map(r => ({
      ...r,
      payload: JSON.parse(r.payload_json || '{}')
    }));
  }

  logAudit(category, nodeId, message) {
    const nowEpoch = Date.now() / 1000;
    const nowStr = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO audit_logs (timestamp_str, epoch, category, node_id, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(nowStr, nowEpoch, category, nodeId || '', message);
  }

  getAuditLogs(limit = 100, category = null) {
    let rows;
    if (category && category !== 'ALL') {
      rows = this.db.prepare('SELECT * FROM audit_logs WHERE category = ? ORDER BY id DESC LIMIT ?').all(category, limit);
    } else {
      rows = this.db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
    }
    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp_str || new Date(r.epoch * 1000).toISOString(),
      timestamp_str: r.timestamp_str,
      user: 'Administrator',
      username: 'admin',
      action: r.category || 'SYSTEM',
      category: r.category || 'SYSTEM',
      target: r.node_id || 'System',
      node_id: r.node_id,
      details: r.message || '',
      message: r.message
    }));
  }

  // === SYSTEM EVENTS & NOTIFICATIONS ===

  logSystemEvent(nodeId, category, severity, description, executionResult = 'SUCCESS') {
    const nowStr = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO system_events (node_id, category, severity, description, execution_result, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(nodeId || '', category, severity, description, executionResult, nowStr);
  }

  getSystemEvents(limit = 100) {
    return this.db.prepare('SELECT * FROM system_events ORDER BY id DESC LIMIT ?').all(limit);
  }

  addNotification(title, message, severity = 'INFO', category = 'SYSTEM') {
    const nowStr = new Date().toISOString();
    let res;
    try {
      res = this.db.prepare(`
        INSERT INTO notifications (title, message, severity, category, read, timestamp)
        VALUES (?, ?, ?, ?, 0, ?)
      `).run(title, message, severity, category, nowStr);
    } catch (e) {
      res = this.db.prepare(`
        INSERT INTO notifications (title, message, severity, read, timestamp)
        VALUES (?, ?, ?, 0, ?)
      `).run(title, message, severity, nowStr);
    }
    return {
      id: Number(res.lastInsertRowid),
      title,
      message,
      severity,
      category,
      read: 0,
      timestamp: nowStr
    };
  }

  getNotifications(limit = 50) {
    return this.db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(limit);
  }

  getUnreadNotificationCount() {
    try {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get();
      return row ? Number(row.count) : 0;
    } catch (e) {
      return 0;
    }
  }

  deleteNotification(id) {
    return this.db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
  }

  clearAllNotifications() {
    return this.db.prepare('DELETE FROM notifications').run();
  }

  markNotificationsRead() {
    this.db.prepare('UPDATE notifications SET read = 1').run();
  }

  // === AUTOMATIONS ===

  getAutomations() {
    const rows = this.db.prepare('SELECT * FROM automations ORDER BY id DESC').all();
    return rows.map(r => {
      let conditions = [];
      let actions = [];
      try { conditions = JSON.parse(r.conditions_json || '[]'); } catch {}
      try { actions = JSON.parse(r.actions_json || '[]'); } catch {}

      return {
        id: r.id,
        name: r.name || 'Untitled Rule',
        description: r.description || 'Automated smart rule',
        trigger_type: r.trigger_type || 'GPIO State Change',
        condition_logic: r.condition_logic || 'ALL',
        conditions: Array.isArray(conditions) ? conditions : [],
        actions: Array.isArray(actions) ? actions : [],
        execution_count: Number(r.execution_count) || 0,
        enabled: Boolean(r.enabled),
        created_at: r.created_at
      };
    });
  }

  addAutomation(auto) {
    const nowStr = new Date().toISOString();
    const condJson = JSON.stringify(auto.conditions || (auto.condState !== undefined ? [{ state: auto.condState }] : []));
    const actJson = JSON.stringify(auto.actions || (auto.targetGpioId !== undefined ? [{ targetGpioId: auto.targetGpioId, state: auto.targetState }] : []));

    const stmt = this.db.prepare(`
      INSERT INTO automations (
        name, description, trigger_type, condition_logic, conditions_json, actions_json, execution_count, enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);
    const res = stmt.run(
      auto.name || 'Custom Automation Rule',
      auto.description || 'Automated rule action',
      auto.trigger_type || auto.triggerType || 'GPIO State Change',
      auto.condition_logic || 'ALL',
      condJson,
      actJson,
      auto.enabled === false ? 0 : 1,
      nowStr
    );
    return res.lastInsertRowid;
  }

  toggleAutomation(id) {
    const rule = this.db.prepare('SELECT enabled FROM automations WHERE id = ?').get(Number(id));
    if (!rule) return false;
    const next = rule.enabled ? 0 : 1;
    this.db.prepare('UPDATE automations SET enabled = ? WHERE id = ?').run(next, Number(id));
    return Boolean(next);
  }

  deleteAutomation(id) {
    const res = this.db.prepare('DELETE FROM automations WHERE id = ?').run(Number(id));
    return res.changes > 0;
  }

  incrementAutomationExecutions(id) {
    this.db.prepare('UPDATE automations SET execution_count = execution_count + 1 WHERE id = ?').run(Number(id));
  }

  // === FIRMWARE ===

  updateLatestFirmwareFlags(targetHardware = null) {
    try {
      const rows = this.db.prepare('SELECT id, version, hardware_type FROM firmware').all();
      const groups = {};
      for (const r of rows) {
        const hw = r.hardware_type || 'ESP8266';
        if (!groups[hw]) groups[hw] = [];
        groups[hw].push(r);
      }

      const parseSemver = (v) => {
        const clean = String(v || '').replace(/^v/i, '').split('-')[0];
        const parts = clean.split('.').map(n => parseInt(n, 10) || 0);
        while (parts.length < 3) parts.push(0);
        return parts;
      };

      const compareSemver = (a, b) => {
        const pa = parseSemver(a.version);
        const pb = parseSemver(b.version);
        for (let i = 0; i < 3; i++) {
          if (pa[i] > pb[i]) return 1;
          if (pa[i] < pb[i]) return -1;
        }
        return (a.id || 0) - (b.id || 0);
      };

      const updateStmt = this.db.prepare('UPDATE firmware SET is_latest = ? WHERE id = ?');
      for (const hw in groups) {
        if (targetHardware && hw !== targetHardware) continue;
        const sorted = groups[hw].sort(compareSemver); // ascending order
        const latestItem = sorted[sorted.length - 1]; // highest version
        for (const item of sorted) {
          const isLatest = (item.id === latestItem.id) ? 1 : 0;
          updateStmt.run(isLatest, item.id);
        }
      }
    } catch (err) {
      console.warn('[DB] Error updating latest firmware flags:', err.message);
    }
  }

  getFirmwareList() {
    const rows = this.db.prepare('SELECT * FROM firmware ORDER BY is_latest DESC, id DESC').all();
    return rows.map(r => ({
      id: r.id,
      filename: r.filename,
      version: r.version,
      hardware_type: r.hardware_type,
      release_channel: r.release_channel || 'LTS',
      notes: r.notes || '',
      file_size_bytes: r.file_size_bytes,
      checksum_md5: r.checksum_md5 || 'N/A',
      checksum_sha256: r.checksum_sha256 || 'N/A',
      file_path: r.file_path,
      uploaded_at: r.uploaded_at,
      is_latest: Boolean(r.is_latest)
    }));
  }

  getFirmware(id) {
    const r = this.db.prepare('SELECT * FROM firmware WHERE id = ?').get(Number(id));
    if (!r) return null;
    return {
      id: r.id,
      filename: r.filename,
      version: r.version,
      hardware_type: r.hardware_type,
      release_channel: r.release_channel || 'LTS',
      notes: r.notes || '',
      file_size_bytes: r.file_size_bytes,
      checksum_md5: r.checksum_md5 || 'N/A',
      checksum_sha256: r.checksum_sha256 || 'N/A',
      file_path: r.file_path,
      uploaded_at: r.uploaded_at,
      is_latest: Boolean(r.is_latest)
    };
  }

  addFirmwareRecord(fw) {
    const nowStr = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO firmware (
        filename, version, hardware_type, release_channel, notes, file_size_bytes, checksum_md5, checksum_sha256, file_path, uploaded_at, is_latest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      fw.filename,
      fw.version || '1.6.0',
      fw.hardware_type || 'ESP8266',
      fw.release_channel || 'LTS',
      fw.notes || '',
      Number(fw.file_size_bytes) || 0,
      fw.checksum_md5 || '',
      fw.checksum_sha256 || '',
      fw.file_path || '',
      nowStr,
      0
    );
    const newId = res.lastInsertRowid;
    this.updateLatestFirmwareFlags(fw.hardware_type);
    return newId;
  }

  deleteFirmware(id) {
    const res = this.db.prepare('DELETE FROM firmware WHERE id = ?').run(Number(id));
    this.updateLatestFirmwareFlags();
    return res.changes > 0;
  }

  // === NODE BACKUPS ===

  addNodeBackup(b) {
    const nowStr = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO node_backups (
        node_id, node_name, firmware_version, backup_type, backup_path, file_size_bytes, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      b.node_id,
      b.node_name || 'SmartHome-Node',
      b.firmware_version || '1.6.0',
      b.backup_type || 'PRE_OTA',
      b.backup_path || '',
      Number(b.file_size_bytes) || 0,
      typeof b.snapshot_json === 'string' ? b.snapshot_json : JSON.stringify(b.snapshot_json || {}),
      nowStr
    );
    return res.lastInsertRowid;
  }

  getNodeBackups(nodeId = null) {
    let rows;
    if (nodeId) {
      rows = this.db.prepare('SELECT * FROM node_backups WHERE node_id = ? ORDER BY id DESC').all(nodeId);
    } else {
      rows = this.db.prepare('SELECT * FROM node_backups ORDER BY id DESC').all();
    }
    return rows.map(r => ({
      id: r.id,
      node_id: r.node_id,
      node_name: r.node_name,
      firmware_version: r.firmware_version,
      backup_type: r.backup_type,
      backup_path: r.backup_path,
      file_size_bytes: r.file_size_bytes,
      created_at: r.created_at
    }));
  }

  getNodeBackup(id) {
    const r = this.db.prepare('SELECT * FROM node_backups WHERE id = ?').get(Number(id));
    if (!r) return null;
    return {
      id: r.id,
      node_id: r.node_id,
      node_name: r.node_name,
      firmware_version: r.firmware_version,
      backup_type: r.backup_type,
      backup_path: r.backup_path,
      file_size_bytes: r.file_size_bytes,
      snapshot_json: r.snapshot_json,
      created_at: r.created_at
    };
  }

  deleteNodeBackup(id) {
    const res = this.db.prepare('DELETE FROM node_backups WHERE id = ?').run(Number(id));
    return res.changes > 0;
  }

  // === OTA DEPLOYMENT HISTORY (LTS AUDIT TRAIL) ===

  addOtaHistory(rec) {
    const nowStr = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO ota_history (
        node_id, node_name, firmware_id, firmware_filename, version_from, version_to, status, backup_id, duration_ms, details, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      rec.node_id,
      rec.node_name || 'SmartHome-Node',
      rec.firmware_id ? Number(rec.firmware_id) : null,
      rec.firmware_filename || '',
      rec.version_from || '1.6.0',
      rec.version_to || '1.6.0',
      rec.status || 'PENDING',
      rec.backup_id ? Number(rec.backup_id) : null,
      Number(rec.duration_ms) || 0,
      typeof rec.details === 'string' ? rec.details : JSON.stringify(rec.details || {}),
      rec.error_message || '',
      nowStr
    );
    return res.lastInsertRowid;
  }

  updateOtaHistory(id, updates) {
    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.duration_ms !== undefined) {
      fields.push('duration_ms = ?');
      values.push(Number(updates.duration_ms));
    }
    if (updates.details !== undefined) {
      fields.push('details = ?');
      values.push(typeof updates.details === 'string' ? updates.details : JSON.stringify(updates.details));
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }
    if (updates.backup_id !== undefined) {
      fields.push('backup_id = ?');
      values.push(Number(updates.backup_id));
    }

    if (fields.length === 0) return false;

    values.push(Number(id));
    const sql = `UPDATE ota_history SET ${fields.join(', ')} WHERE id = ?`;
    const res = this.db.prepare(sql).run(...values);
    return res.changes > 0;
  }

  getOtaHistory(limit = 50) {
    const rows = this.db.prepare('SELECT * FROM ota_history ORDER BY id DESC LIMIT ?').all(Number(limit));
    return rows.map(r => ({
      id: r.id,
      node_id: r.node_id,
      node_name: r.node_name,
      firmware_id: r.firmware_id,
      firmware_filename: r.firmware_filename,
      version_from: r.version_from,
      version_to: r.version_to,
      status: r.status,
      backup_id: r.backup_id,
      duration_ms: r.duration_ms,
      details: r.details,
      error_message: r.error_message,
      created_at: r.created_at
    }));
  }

  // ==========================================
  // === RBAC & USER MANAGEMENT METHODS ===
  // ==========================================

  createUser({ username, password, full_name, email, is_superuser = 0, role_names = [], scope_ids = [] }) {
    const nowStr = new Date().toISOString();
    const passHash = hashPassword(password);

    const res = this.db.prepare(`
      INSERT INTO users (username, password_hash, full_name, email, is_active, is_superuser, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `).run(username.trim(), passHash, full_name || '', email || '', is_superuser ? 1 : 0, nowStr, nowStr);

    const userId = Number(res.lastInsertRowid);

    if (role_names && role_names.length > 0) {
      this.assignUserRoles(userId, role_names);
    }
    if (scope_ids && scope_ids.length > 0) {
      this.assignUserScopes(userId, scope_ids);
    }

    this.logAudit('USER_CREATED', 'System', `Created user account '${username}'`);
    return this.getUserById(userId);
  }

  updateUser(id, updates) {
    const existing = this.getUserById(id);
    if (!existing) return null;

    const fields = ['updated_at = ?'];
    const values = [new Date().toISOString()];

    if (updates.full_name !== undefined) {
      fields.push('full_name = ?');
      values.push(updates.full_name);
    }
    if (updates.email !== undefined) {
      fields.push('email = ?');
      values.push(updates.email);
    }
    if (updates.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.is_active ? 1 : 0);
      if (!updates.is_active) {
        this.revokeUserSessions(id);
      }
    }
    if (updates.is_superuser !== undefined) {
      fields.push('is_superuser = ?');
      values.push(updates.is_superuser ? 1 : 0);
    }

    values.push(Number(id));
    this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    if (Array.isArray(updates.role_names)) {
      this.assignUserRoles(id, updates.role_names);
    }
    if (Array.isArray(updates.scope_ids)) {
      this.assignUserScopes(id, updates.scope_ids);
    }

    this.logAudit('USER_UPDATED', 'System', `Updated user account '${existing.username}' (ID: ${id})`);
    return this.getUserById(id);
  }

  getUserById(id) {
    const row = this.db.prepare('SELECT id, username, full_name, email, is_active, is_superuser, created_at, updated_at FROM users WHERE id = ?').get(Number(id));
    if (!row) return null;

    return {
      id: row.id,
      username: row.username,
      full_name: row.full_name,
      email: row.email,
      is_active: Boolean(row.is_active),
      is_superuser: Boolean(row.is_superuser),
      created_at: row.created_at,
      updated_at: row.updated_at,
      roles: this.getUserRoles(row.id),
      scopes: this.getUserScopes(row.id)
    };
  }

  getUserByUsername(username) {
    if (!username || typeof username !== 'string') return null;
    return this.db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
  }

  getUsers() {
    const rows = this.db.prepare('SELECT id, username, full_name, email, is_active, is_superuser, created_at, updated_at FROM users ORDER BY id ASC').all();
    return rows.map(r => ({
      id: r.id,
      username: r.username,
      full_name: r.full_name,
      email: r.email,
      is_active: Boolean(r.is_active),
      is_superuser: Boolean(r.is_superuser),
      created_at: r.created_at,
      updated_at: r.updated_at,
      roles: this.getUserRoles(r.id),
      scopes: this.getUserScopes(r.id)
    }));
  }

  deleteUser(id) {
    const user = this.getUserById(id);
    if (!user) return false;
    if (user.is_superuser && user.username === 'admin') {
      throw new Error('Cannot delete primary root superuser account');
    }
    this.revokeUserSessions(id);
    this.db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(Number(id));
    this.db.prepare('DELETE FROM user_scopes WHERE user_id = ?').run(Number(id));
    const res = this.db.prepare('DELETE FROM users WHERE id = ?').run(Number(id));
    this.logAudit('USER_DELETED', 'System', `Deleted user account '${user.username}' (ID: ${id})`);
    return res.changes > 0;
  }

  setUserActive(id, isActive) {
    const act = isActive ? 1 : 0;
    this.db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(act, new Date().toISOString(), Number(id));
    if (!act) {
      this.revokeUserSessions(id);
    }
    return true;
  }

  setUserPassword(id, newPassword) {
    const passHash = hashPassword(newPassword);
    this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passHash, new Date().toISOString(), Number(id));
    this.revokeUserSessions(id);
    this.logAudit('USER_PASSWORD_RESET', 'System', `Password reset for user ID ${id}`);
    return true;
  }

  assignUserRoles(userId, roleNames) {
    const uid = Number(userId);
    this.db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(uid);
    const getRole = this.db.prepare('SELECT id FROM roles WHERE name = ?');
    const insert = this.db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');

    for (const rName of roleNames) {
      const r = getRole.get(rName);
      if (r) {
        insert.run(uid, r.id);
      }
    }
  }

  assignUserScopes(userId, scopeIds) {
    const uid = Number(userId);
    this.db.prepare('DELETE FROM user_scopes WHERE user_id = ?').run(uid);
    const insert = this.db.prepare('INSERT INTO user_scopes (user_id, scope_id) VALUES (?, ?)');

    for (const scId of scopeIds) {
      insert.run(uid, Number(scId));
    }
  }

  getUserRoles(userId) {
    const rows = this.db.prepare(`
      SELECT r.name FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
    `).all(Number(userId));
    return rows.map(r => r.name);
  }

  getUserPermissions(userId) {
    const user = this.db.prepare('SELECT is_superuser FROM users WHERE id = ?').get(Number(userId));
    if (user && user.is_superuser) {
      return ALL_PERMISSIONS.map(p => p.code);
    }

    const rows = this.db.prepare(`
      SELECT DISTINCT p.code FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.user_id = ?
    `).all(Number(userId));
    return rows.map(r => r.code);
  }

  getUserScopes(userId) {
    const rows = this.db.prepare(`
      SELECT s.id, s.scope_type, s.scope_identifier, s.name, s.description
      FROM scopes s
      JOIN user_scopes us ON s.id = us.scope_id
      WHERE us.user_id = ?
    `).all(Number(userId));
    return rows;
  }

  // === SESSION MANAGEMENT ===

  createSession(userId, ip = '', userAgent = '', expiresInDays = 30) {
    const token = generateSessionToken();
    const now = new Date();
    const expires = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

    this.db.prepare(`
      INSERT INTO user_sessions (token, user_id, ip_address, user_agent, created_at, last_active_at, expires_at, is_revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(token, Number(userId), ip, userAgent, now.toISOString(), now.toISOString(), expires.toISOString());

    return { token, user_id: Number(userId), expires_at: expires.toISOString() };
  }

  getSession(token) {
    if (!token) return null;
    return this.db.prepare('SELECT * FROM user_sessions WHERE token = ?').get(token);
  }

  touchSession(token) {
    try {
      this.db.prepare('UPDATE user_sessions SET last_active_at = ? WHERE token = ?').run(new Date().toISOString(), token);
    } catch {}
  }

  revokeSession(token) {
    const res = this.db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE token = ?').run(token);
    return res.changes > 0;
  }

  revokeUserSessions(userId) {
    this.db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ?').run(Number(userId));
  }

  getUserSessions(userId) {
    return this.db.prepare('SELECT token, ip_address, user_agent, created_at, last_active_at, expires_at, is_revoked FROM user_sessions WHERE user_id = ? AND is_revoked = 0 ORDER BY last_active_at DESC').all(Number(userId));
  }

  // === ROLES, PERMISSIONS & SCOPES ===

  getRoles() {
    const roles = this.db.prepare('SELECT * FROM roles ORDER BY id ASC').all();
    return roles.map(r => {
      const perms = this.db.prepare(`
        SELECT p.code FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        WHERE rp.role_id = ?
      `).all(r.id);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        is_system: Boolean(r.is_system),
        created_at: r.created_at,
        permissions: perms.map(p => p.code)
      };
    });
  }

  getRole(idOrName) {
    let r = null;
    if (typeof idOrName === 'number' || !isNaN(Number(idOrName))) {
      r = this.db.prepare('SELECT * FROM roles WHERE id = ?').get(Number(idOrName));
    } else {
      r = this.db.prepare('SELECT * FROM roles WHERE name = ?').get(String(idOrName));
    }
    if (!r) return null;
    const perms = this.db.prepare(`
      SELECT p.code FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id = ?
    `).all(r.id);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      is_system: Boolean(r.is_system),
      created_at: r.created_at,
      permissions: perms.map(p => p.code)
    };
  }

  getPermissions() {
    return this.db.prepare('SELECT * FROM permissions ORDER BY category ASC, code ASC').all();
  }

  getScopes() {
    return this.db.prepare('SELECT * FROM scopes ORDER BY scope_type ASC, name ASC').all();
  }

  createScope({ scope_type, scope_identifier, name, description }) {
    const res = this.db.prepare(`
      INSERT INTO scopes (scope_type, scope_identifier, name, description)
      VALUES (?, ?, ?, ?)
    `).run(scope_type.toUpperCase().trim(), scope_identifier.trim(), name.trim(), description || '');
    return Number(res.lastInsertRowid);
  }

  deleteScope(id) {
    const s = this.db.prepare('SELECT * FROM scopes WHERE id = ?').get(Number(id));
    if (!s) return false;
    if (s.scope_identifier === 'global') {
      throw new Error('Cannot delete default GLOBAL scope');
    }
    this.db.prepare('DELETE FROM user_scopes WHERE scope_id = ?').run(Number(id));
    const res = this.db.prepare('DELETE FROM scopes WHERE id = ?').run(Number(id));
    return res.changes > 0;
  }

  // ==========================================
  // === DEVICE CAPABILITIES METHODS ===
  // ==========================================

  upsertDeviceCapabilities(nodeId, caps) {
    const nowStr = new Date().toISOString();
    const existing = this.db.prepare('SELECT node_id FROM device_capabilities WHERE node_id = ?').get(nodeId);

    if (existing) {
      this.db.prepare(`
        UPDATE device_capabilities SET
          mcu_type = COALESCE(?, mcu_type),
          flash_size_bytes = COALESCE(?, flash_size_bytes),
          ram_size_bytes = COALESCE(?, ram_size_bytes),
          littlefs_total_bytes = COALESCE(?, littlefs_total_bytes),
          littlefs_used_bytes = COALESCE(?, littlefs_used_bytes),
          littlefs_free_bytes = COALESCE(?, littlefs_free_bytes),
          ota_supported = COALESCE(?, ota_supported),
          max_ota_sketch_size = COALESCE(?, max_ota_sketch_size),
          littlefs_supported = COALESCE(?, littlefs_supported),
          updated_at = ?
        WHERE node_id = ?
      `).run(
        caps.mcu_type ?? null,
        caps.flash_size_bytes ?? null,
        caps.ram_size_bytes ?? null,
        caps.littlefs_total_bytes ?? null,
        caps.littlefs_used_bytes ?? null,
        caps.littlefs_free_bytes ?? null,
        caps.ota_supported ?? null,
        caps.max_ota_sketch_size ?? null,
        caps.littlefs_supported ?? null,
        nowStr,
        nodeId
      );
    } else {
      this.db.prepare(`
        INSERT INTO device_capabilities (
          node_id, mcu_type, flash_size_bytes, ram_size_bytes, littlefs_total_bytes,
          littlefs_used_bytes, littlefs_free_bytes, ota_supported, max_ota_sketch_size,
          littlefs_supported, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nodeId,
        caps.mcu_type || 'ESP8266',
        caps.flash_size_bytes || 4194304,
        caps.ram_size_bytes || 81920,
        caps.littlefs_total_bytes || 0,
        caps.littlefs_used_bytes || 0,
        caps.littlefs_free_bytes || 0,
        caps.ota_supported !== undefined ? caps.ota_supported : 1,
        caps.max_ota_sketch_size || 0,
        caps.littlefs_supported !== undefined ? caps.littlefs_supported : 1,
        nowStr
      );
    }

    // Also update storage metrics in nodes table
    if (caps.littlefs_total_bytes !== undefined) {
      this.db.prepare(`
        UPDATE nodes SET
          littlefs_total = ?,
          littlefs_used = ?,
          littlefs_available = ?
        WHERE node_id = ?
      `).run(caps.littlefs_total_bytes || 0, caps.littlefs_used_bytes || 0, caps.littlefs_free_bytes || 0, nodeId);
    }
  }

  getDeviceCapabilities(nodeId) {
    return this.db.prepare('SELECT * FROM device_capabilities WHERE node_id = ?').get(nodeId);
  }

  // ==========================================
  // === PERSISTENT DEVICE COMMANDS & ACKS ===
  // ==========================================

  createCommand({ command_uuid, node_id, user_id = null, command_type, payload = {}, expires_in_sec = 86400 }) {
    const uuid = command_uuid || crypto.randomUUID();
    const now = new Date();
    const expires = new Date(now.getTime() + expires_in_sec * 1000);
    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload);

    this.db.prepare(`
      INSERT INTO device_commands (
        command_uuid, node_id, user_id, command_type, payload_json, status, created_at, expires_at, attempts
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, 0)
    `).run(uuid, node_id, user_id, command_type, payloadJson, now.toISOString(), expires.toISOString());

    return this.getCommandByUuid(uuid);
  }

  getCommandByUuid(uuid) {
    const row = this.db.prepare('SELECT * FROM device_commands WHERE command_uuid = ?').get(uuid);
    if (!row) return null;
    return {
      ...row,
      payload: JSON.parse(row.payload_json || '{}')
    };
  }

  getPendingCommandsForNode(nodeId, limit = 5) {
    const rows = this.db.prepare(`
      SELECT * FROM device_commands
      WHERE node_id = ? AND status = 'PENDING'
      ORDER BY id ASC LIMIT ?
    `).all(nodeId, Number(limit));

    return rows.map(r => ({
      command_uuid: r.command_uuid,
      commandId: r.command_uuid,
      id: r.id,
      node_id: r.node_id,
      type: r.command_type,
      command_type: r.command_type,
      created_at: r.created_at,
      ...JSON.parse(r.payload_json || '{}')
    }));
  }

  markCommandDelivered(uuid) {
    const nowStr = new Date().toISOString();
    this.db.prepare(`
      UPDATE device_commands SET status = 'DELIVERED', delivered_at = ?, attempts = attempts + 1
      WHERE command_uuid = ? AND status = 'PENDING'
    `).run(nowStr, uuid);
  }

  markCommandAcknowledged(uuid, result = {}) {
    const nowStr = new Date().toISOString();
    const status = (result.success !== false) ? 'ACKNOWLEDGED' : 'FAILED';
    this.db.prepare(`
      UPDATE device_commands SET status = ?, acknowledged_at = ?
      WHERE command_uuid = ?
    `).run(status, nowStr, uuid);

    const cmd = this.getCommandByUuid(uuid);
    if (cmd) {
      this.recordCommandResult({
        command_uuid: uuid,
        node_id: cmd.node_id,
        status,
        success: result.success !== false ? 1 : 0,
        response_payload: result,
        error_message: result.error || '',
        execution_time_ms: Number(result.execution_time_ms || result.executionTimeMs || 0)
      });
    }
  }

  recordCommandResult({ command_uuid, node_id, status, success = 1, response_payload = {}, error_message = '', execution_time_ms = 0 }) {
    const nowStr = new Date().toISOString();
    const payloadJson = typeof response_payload === 'string' ? response_payload : JSON.stringify(response_payload);

    this.db.prepare(`
      INSERT INTO command_results (
        command_uuid, node_id, status, success, response_payload_json, error_message, execution_time_ms, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(command_uuid, node_id, status || 'ACKNOWLEDGED', success ? 1 : 0, payloadJson, error_message, execution_time_ms, nowStr);
  }

  getCommands(filters = {}) {
    let sql = 'SELECT * FROM device_commands WHERE 1=1';
    const params = [];

    if (filters.node_id) {
      sql += ' AND node_id = ?';
      params.push(filters.node_id);
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    const limit = Number(filters.limit) || 100;
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => ({
      ...r,
      payload: JSON.parse(r.payload_json || '{}')
    }));
  }

  getCommandResults(commandUuid) {
    return this.db.prepare('SELECT * FROM command_results WHERE command_uuid = ? ORDER BY id DESC').all(commandUuid);
  }

  // ==========================================
  // === LITTLEFS FILESYSTEM METHODS ===
  // ==========================================

  syncFilesystemFiles(nodeId, fileList = []) {
    const nowEpoch = Date.now() / 1000;
    const nowStr = new Date().toISOString();
    const currentPaths = [];

    const upsert = this.db.prepare(`
      INSERT INTO filesystem_files (node_id, file_path, file_size_bytes, sha256_checksum, last_modified_epoch, synced_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id, file_path) DO UPDATE SET
        file_size_bytes = excluded.file_size_bytes,
        sha256_checksum = COALESCE(excluded.sha256_checksum, filesystem_files.sha256_checksum),
        last_modified_epoch = excluded.last_modified_epoch,
        synced_at = excluded.synced_at
    `);

    for (const f of fileList) {
      const p = f.path || f.name || f.filename;
      if (!p) continue;
      currentPaths.push(p);
      upsert.run(nodeId, p, Number(f.size || f.file_size_bytes) || 0, f.sha256 || f.checksum || null, nowEpoch, nowStr);
    }

    // Prune removed files
    if (currentPaths.length > 0) {
      const placeholders = currentPaths.map(() => '?').join(',');
      this.db.prepare(`
        DELETE FROM filesystem_files
        WHERE node_id = ? AND file_path NOT IN (${placeholders})
      `).run(nodeId, ...currentPaths);
    } else if (fileList.length === 0) {
      this.db.prepare('DELETE FROM filesystem_files WHERE node_id = ?').run(nodeId);
    }

    return this.getFilesystemFiles(nodeId);
  }

  getFilesystemFiles(nodeId) {
    return this.db.prepare('SELECT * FROM filesystem_files WHERE node_id = ? ORDER BY file_path ASC').all(nodeId);
  }

  deleteFilesystemFileRecord(nodeId, filePath) {
    const res = this.db.prepare('DELETE FROM filesystem_files WHERE node_id = ? AND file_path = ?').run(nodeId, filePath);
    return res.changes > 0;
  }

  addFilesystemBackup({ node_id, backup_type = 'MANUAL', backup_path, file_count = 0, total_bytes = 0, sha256_checksum = '', snapshot_manifest = {} }) {
    const nowStr = new Date().toISOString();
    const manifestJson = typeof snapshot_manifest === 'string' ? snapshot_manifest : JSON.stringify(snapshot_manifest);

    const res = this.db.prepare(`
      INSERT INTO filesystem_backups (
        node_id, backup_type, backup_path, file_count, total_bytes, sha256_checksum, snapshot_manifest_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(node_id, backup_type, backup_path, file_count, total_bytes, sha256_checksum, manifestJson, nowStr);

    this.logAudit('LITTLEFS_BACKUP', node_id, `Created LittleFS backup archive (${file_count} files, ${total_bytes} bytes)`);
    return Number(res.lastInsertRowid);
  }

  getFilesystemBackups(nodeId = null) {
    if (nodeId) {
      return this.db.prepare('SELECT * FROM filesystem_backups WHERE node_id = ? ORDER BY id DESC').all(nodeId);
    }
    return this.db.prepare('SELECT * FROM filesystem_backups ORDER BY id DESC').all();
  }

  getFilesystemBackup(id) {
    const r = this.db.prepare('SELECT * FROM filesystem_backups WHERE id = ?').get(Number(id));
    if (!r) return null;
    return {
      ...r,
      snapshot_manifest: JSON.parse(r.snapshot_manifest_json || '{}')
    };
  }

  // ==========================================
  // === CONFIGURATION SYNCHRONIZATION METHODS ===
  // ==========================================

  getDeviceConfiguration(nodeId) {
    const row = this.db.prepare('SELECT * FROM device_configurations WHERE node_id = ?').get(nodeId);
    if (!row) return null;
    return {
      node_id: row.node_id,
      config_version: row.config_version,
      config: JSON.parse(row.config_json || '{}'),
      sha256_checksum: row.sha256_checksum,
      sync_status: row.sync_status,
      last_synced_at: row.last_synced_at,
      updated_at: row.updated_at
    };
  }

  saveDeviceConfiguration(nodeId, configObj, userId = null, changeSummary = 'Configuration update') {
    const nowStr = new Date().toISOString();
    const configStr = typeof configObj === 'string' ? configObj : JSON.stringify(configObj, null, 2);
    const checksum = crypto.createHash('sha256').update(configStr).digest('hex');

    const existing = this.db.prepare('SELECT config_version FROM device_configurations WHERE node_id = ?').get(nodeId);
    const nextVersion = existing ? existing.config_version + 1 : 1;

    if (existing) {
      this.db.prepare(`
        UPDATE device_configurations SET
          config_version = ?,
          config_json = ?,
          sha256_checksum = ?,
          sync_status = 'PENDING',
          updated_at = ?
        WHERE node_id = ?
      `).run(nextVersion, configStr, checksum, nowStr, nodeId);
    } else {
      this.db.prepare(`
        INSERT INTO device_configurations (
          node_id, config_version, config_json, sha256_checksum, sync_status, updated_at
        ) VALUES (?, ?, ?, ?, 'PENDING', ?)
      `).run(nodeId, nextVersion, configStr, checksum, nowStr);
    }

    // Record immutable version entry for rollback support
    this.db.prepare(`
      INSERT INTO configuration_versions (
        node_id, version, config_json, sha256_checksum, change_summary, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nodeId, nextVersion, configStr, checksum, changeSummary, userId, nowStr);

    this.logAudit('CONFIG_UPDATED', nodeId, `Authoritative config updated to v${nextVersion} (Pending Sync)`);
    return {
      node_id: nodeId,
      config_version: nextVersion,
      sha256_checksum: checksum,
      sync_status: 'PENDING',
      updated_at: nowStr
    };
  }

  updateDeviceConfigSyncStatus(nodeId, status, lastSyncedAt = null) {
    const nowStr = lastSyncedAt || new Date().toISOString();
    this.db.prepare(`
      UPDATE device_configurations SET sync_status = ?, last_synced_at = ?
      WHERE node_id = ?
    `).run(status, nowStr, nodeId);
  }

  getConfigurationVersions(nodeId) {
    const rows = this.db.prepare('SELECT id, node_id, version, sha256_checksum, change_summary, created_by_user_id, created_at FROM configuration_versions WHERE node_id = ? ORDER BY version DESC').all(nodeId);
    return rows;
  }

  rollbackConfiguration(nodeId, targetVersion, userId = null) {
    const row = this.db.prepare('SELECT config_json FROM configuration_versions WHERE node_id = ? AND version = ?').get(nodeId, Number(targetVersion));
    if (!row) {
      throw new Error(`Configuration version ${targetVersion} not found for node '${nodeId}'`);
    }

    const config = JSON.parse(row.config_json);
    return this.saveDeviceConfiguration(nodeId, config, userId, `Rollback to configuration v${targetVersion}`);
  }

  // ==========================================
  // HOME-CENTRIC FLEET MANAGEMENT METHODS
  // ==========================================

  createHome({ name, description = '', timezone = 'UTC', address = '', owner_user_id = null, created_by = null }) {
    if (!name || !name.trim()) throw new Error('Home name is required');
    const cleanName = name.trim();
    const nowEpoch = Date.now() / 1000;
    const res = this.db.prepare(`
      INSERT INTO homes (name, description, timezone, address, owner_user_id, created_by, is_archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      cleanName,
      (description || '').trim(),
      timezone || 'UTC',
      (address || '').trim(),
      owner_user_id ?? null,
      created_by ?? null,
      nowEpoch,
      nowEpoch
    );
    const homeId = Number(res.lastInsertRowid);
    if (owner_user_id) {
      this.db.prepare(`
        INSERT OR IGNORE INTO home_members (home_id, user_id, role, joined_at, created_at)
        VALUES (?, ?, 'HOME_OWNER', ?, ?)
      `).run(homeId, owner_user_id, nowEpoch, nowEpoch);
    }
    return this.getHomeById(homeId);
  }

  getHomes(userId = null, isSuperUser = false) {
    let sql = `
      SELECT h.*, 
             u.username AS owner_username, 
             u.email AS owner_email,
             c.username AS creator_username,
             (SELECT COUNT(*) FROM rooms r WHERE r.home_id = h.id) AS rooms_count,
             (SELECT COUNT(*) FROM nodes n WHERE n.home_id = h.id) AS nodes_count,
             (SELECT COUNT(*) FROM home_members hm WHERE hm.home_id = h.id) AS members_count
      FROM homes h
      LEFT JOIN users u ON h.owner_user_id = u.id
      LEFT JOIN users c ON h.created_by = c.id
      WHERE h.is_archived = 0
    `;
    const params = [];
    if (!isSuperUser && userId) {
      sql += ` AND (h.owner_user_id = ? OR h.id IN (SELECT home_id FROM home_members WHERE user_id = ?))`;
      params.push(userId, userId);
    }
    sql += ' ORDER BY h.id ASC';
    return this.db.prepare(sql).all(...params);
  }

  getHomeById(homeId) {
    if (!homeId) return null;
    const row = this.db.prepare(`
      SELECT h.*, 
             u.username AS owner_username, 
             u.email AS owner_email,
             c.username AS creator_username,
             (SELECT COUNT(*) FROM rooms r WHERE r.home_id = h.id) AS rooms_count,
             (SELECT COUNT(*) FROM nodes n WHERE n.home_id = h.id) AS nodes_count,
             (SELECT COUNT(*) FROM home_members hm WHERE hm.home_id = h.id) AS members_count
      FROM homes h
      LEFT JOIN users u ON h.owner_user_id = u.id
      LEFT JOIN users c ON h.created_by = c.id
      WHERE h.id = ? AND h.is_archived = 0
    `).get(Number(homeId));
    return row || null;
  }

  updateHome(homeId, updates = {}) {
    const existing = this.getHomeById(homeId);
    if (!existing) throw new Error(`Home ${homeId} not found`);
    const name = updates.name !== undefined ? updates.name.trim() : existing.name;
    const desc = updates.description !== undefined ? updates.description.trim() : existing.description;
    const tz = updates.timezone !== undefined ? updates.timezone.trim() : existing.timezone;
    const addr = updates.address !== undefined ? updates.address.trim() : existing.address;
    const nowEpoch = Date.now() / 1000;

    this.db.prepare(`
      UPDATE homes 
      SET name = ?, description = ?, timezone = ?, address = ?, updated_at = ?
      WHERE id = ?
    `).run(name, desc, tz, addr, nowEpoch, Number(homeId));

    return this.getHomeById(homeId);
  }

  deleteHome(homeId) {
    const existing = this.getHomeById(homeId);
    if (!existing) throw new Error(`Home ${homeId} not found`);
    // Soft delete / archive
    this.db.prepare('UPDATE homes SET is_archived = 1, updated_at = unixepoch(\'now\', \'subsec\') WHERE id = ?').run(Number(homeId));
    // Unassign nodes from this home
    this.db.prepare('UPDATE nodes SET home_id = NULL, room_id = NULL, assigned_at = NULL WHERE home_id = ?').run(Number(homeId));
    return true;
  }

  appointHomeOwner(homeId, newOwnerUserId, appointedByUserId = null) {
    const home = this.getHomeById(homeId);
    if (!home) throw new Error(`Home ${homeId} not found`);
    const targetUser = this.getUserById(newOwnerUserId);
    if (!targetUser) throw new Error(`Target user ${newOwnerUserId} not found`);

    const nowEpoch = Date.now() / 1000;
    // Transactional appointment
    this.db.exec('BEGIN TRANSACTION;');
    try {
      this.db.prepare(`
        UPDATE homes SET owner_user_id = ?, updated_at = ? WHERE id = ?
      `).run(Number(newOwnerUserId), nowEpoch, Number(homeId));

      this.db.prepare(`
        INSERT INTO home_members (home_id, user_id, role, joined_at, created_at)
        VALUES (?, ?, 'HOME_OWNER', ?, ?)
        ON CONFLICT(home_id, user_id) DO UPDATE SET role = 'HOME_OWNER'
      `).run(Number(homeId), Number(newOwnerUserId), nowEpoch, nowEpoch);

      this.logAudit(
        'HOME_OWNER_APPOINTED',
        'SECURITY',
        `User '${targetUser.username}' (id: ${newOwnerUserId}) appointed as HOME_OWNER of '${home.name}' (id: ${homeId}) by user id ${appointedByUserId ?? 'SYSTEM'}`
      );
      this.db.exec('COMMIT;');
    } catch (err) {
      try { this.db.exec('ROLLBACK;'); } catch {}
      throw err;
    }

    return this.getHomeById(homeId);
  }

  getHomeMembers(homeId) {
    return this.db.prepare(`
      SELECT hm.id, hm.home_id, hm.user_id, hm.role, hm.joined_at,
             u.username, u.full_name, u.email
      FROM home_members hm
      JOIN users u ON hm.user_id = u.id
      WHERE hm.home_id = ?
      ORDER BY hm.id ASC
    `).all(Number(homeId));
  }

  getHomeMember(homeId, userId) {
    return this.db.prepare(`
      SELECT hm.id, hm.home_id, hm.user_id, hm.role, hm.joined_at,
             u.username, u.full_name, u.email
      FROM home_members hm
      JOIN users u ON hm.user_id = u.id
      WHERE hm.home_id = ? AND hm.user_id = ?
    `).get(Number(homeId), Number(userId)) || null;
  }

  addHomeMember(homeId, userId, role = 'FAMILY_MEMBER') {
    const home = this.getHomeById(homeId);
    if (!home) throw new Error(`Home ${homeId} not found`);
    const validRoles = ['HOME_OWNER', 'HOME_ADMIN', 'FAMILY_MEMBER', 'GUEST', 'VIEWER'];
    if (!validRoles.includes(role)) throw new Error(`Invalid role '${role}'`);

    const nowEpoch = Date.now() / 1000;
    this.db.prepare(`
      INSERT INTO home_members (home_id, user_id, role, joined_at, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(home_id, user_id) DO UPDATE SET role = ?
    `).run(Number(homeId), Number(userId), role, nowEpoch, nowEpoch, role);

    return this.getHomeMember(homeId, userId);
  }

  updateHomeMemberRole(homeId, userId, newRole) {
    const validRoles = ['HOME_OWNER', 'HOME_ADMIN', 'FAMILY_MEMBER', 'GUEST', 'VIEWER'];
    if (!validRoles.includes(newRole)) throw new Error(`Invalid role '${newRole}'`);

    this.db.prepare(`
      UPDATE home_members SET role = ? WHERE home_id = ? AND user_id = ?
    `).run(newRole, Number(homeId), Number(userId));

    return this.getHomeMember(homeId, userId);
  }

  removeHomeMember(homeId, userId) {
    const member = this.getHomeMember(homeId, userId);
    if (!member) return false;
    this.db.prepare('DELETE FROM home_members WHERE home_id = ? AND user_id = ?').run(Number(homeId), Number(userId));
    // Clean up room assignments in this home
    this.db.prepare(`
      DELETE FROM room_members 
      WHERE user_id = ? AND room_id IN (SELECT id FROM rooms WHERE home_id = ?)
    `).run(Number(userId), Number(homeId));
    return true;
  }

  // ==========================================
  // ROOMS CRUD METHODS
  // ==========================================

  createRoom({ home_id, name, floor = 'Ground', icon = 'room' }) {
    if (!home_id) throw new Error('home_id is required');
    if (!name || !name.trim()) throw new Error('Room name is required');
    const home = this.getHomeById(home_id);
    if (!home) throw new Error(`Home ${home_id} not found`);

    const cleanName = name.trim();
    const nowEpoch = Date.now() / 1000;

    const res = this.db.prepare(`
      INSERT INTO rooms (home_id, name, floor, icon, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(home_id), cleanName, floor || 'Ground', icon || 'room', nowEpoch, nowEpoch);

    return this.getRoomById(Number(res.lastInsertRowid));
  }

  getRooms(homeId, userId = null, isSuperUser = false) {
    let sql = `
      SELECT r.*,
             h.name AS home_name,
             (SELECT COUNT(*) FROM nodes n WHERE n.room_id = r.id) AS nodes_count,
             (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id) AS members_count
      FROM rooms r
      JOIN homes h ON r.home_id = h.id
      WHERE r.home_id = ?
    `;
    const params = [Number(homeId)];

    if (!isSuperUser && userId) {
      const member = this.getHomeMember(homeId, userId);
      if (member && (member.role === 'FAMILY_MEMBER' || member.role === 'GUEST' || member.role === 'VIEWER')) {
        const userRooms = this.getUserRoomsInHome(homeId, userId);
        if (userRooms && userRooms.length > 0) {
          const roomIds = userRooms.map(rm => rm.room_id || rm.id);
          sql += ` AND r.id IN (${roomIds.join(',')})`;
        }
      }
    }

    sql += ' ORDER BY r.floor ASC, r.name ASC';
    return this.db.prepare(sql).all(...params);
  }

  getRoomById(roomId) {
    if (!roomId) return null;
    return this.db.prepare(`
      SELECT r.*,
             h.name AS home_name,
             (SELECT COUNT(*) FROM nodes n WHERE n.room_id = r.id) AS nodes_count,
             (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id) AS members_count
      FROM rooms r
      JOIN homes h ON r.home_id = h.id
      WHERE r.id = ?
    `).get(Number(roomId)) || null;
  }

  updateRoom(roomId, updates = {}) {
    const existing = this.getRoomById(roomId);
    if (!existing) throw new Error(`Room ${roomId} not found`);

    const name = updates.name !== undefined ? updates.name.trim() : existing.name;
    const floor = updates.floor !== undefined ? updates.floor.trim() : existing.floor;
    const icon = updates.icon !== undefined ? updates.icon.trim() : existing.icon;
    const nowEpoch = Date.now() / 1000;

    this.db.prepare(`
      UPDATE rooms SET name = ?, floor = ?, icon = ?, updated_at = ? WHERE id = ?
    `).run(name, floor, icon, nowEpoch, Number(roomId));

    // Update node room names if room name changed
    if (name !== existing.name) {
      this.db.prepare('UPDATE nodes SET room = ? WHERE room_id = ?').run(name, Number(roomId));
    }

    return this.getRoomById(roomId);
  }

  deleteRoom(roomId) {
    const existing = this.getRoomById(roomId);
    if (!existing) throw new Error(`Room ${roomId} not found`);

    // CRITICAL REQUIREMENT: Prevent deletion if nodes are assigned!
    const assignedCount = this.db.prepare('SELECT COUNT(*) as c FROM nodes WHERE room_id = ?').get(Number(roomId)).c;
    if (assignedCount > 0) {
      throw new Error(`Cannot delete room '${existing.name}' because ${assignedCount} node(s) are currently assigned to it. Move or unassign all nodes first.`);
    }

    this.db.prepare('DELETE FROM room_members WHERE room_id = ?').run(Number(roomId));
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(Number(roomId));
    return true;
  }

  getRoomMembers(roomId) {
    return this.db.prepare(`
      SELECT rm.id, rm.room_id, rm.user_id, rm.role, rm.assigned_at,
             u.username, u.full_name, u.email
      FROM room_members rm
      JOIN users u ON rm.user_id = u.id
      WHERE rm.room_id = ?
    `).all(Number(roomId));
  }

  assignRoomMember(roomId, userId, role = 'FAMILY_MEMBER') {
    const room = this.getRoomById(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    const validRoles = ['HOME_ADMIN', 'FAMILY_MEMBER', 'GUEST', 'VIEWER'];
    if (!validRoles.includes(role)) throw new Error(`Invalid room role '${role}'`);

    const nowEpoch = Date.now() / 1000;
    this.db.prepare(`
      INSERT INTO room_members (room_id, user_id, role, assigned_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(room_id, user_id) DO UPDATE SET role = ?
    `).run(Number(roomId), Number(userId), role, nowEpoch, role);

    return true;
  }

  removeRoomMember(roomId, userId) {
    this.db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(Number(roomId), Number(userId));
    return true;
  }

  getUserRoomsInHome(homeId, userId) {
    return this.db.prepare(`
      SELECT r.*, rm.role as room_role
      FROM rooms r
      JOIN room_members rm ON r.id = rm.room_id
      WHERE r.home_id = ? AND rm.user_id = ?
    `).all(Number(homeId), Number(userId));
  }

  // ==========================================
  // NODE ASSIGNMENT & MOVING METHODS
  // ==========================================

  assignNodeToRoom(nodeId, homeId, roomId) {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node '${nodeId}' not found`);

    const home = this.getHomeById(homeId);
    if (!home) throw new Error(`Home ${homeId} not found`);

    const room = this.getRoomById(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    // Strict validation: Room must belong to Home
    if (Number(room.home_id) !== Number(homeId)) {
      throw new Error(`Room '${room.name}' (id: ${roomId}) does not belong to Home '${home.name}' (id: ${homeId})`);
    }

    const nowEpoch = Date.now() / 1000;
    this.db.prepare(`
      UPDATE nodes 
      SET home_id = ?, room_id = ?, room = ?, assigned_at = ?
      WHERE node_id = ?
    `).run(Number(homeId), Number(roomId), room.name, nowEpoch, nodeId);

    this.logAudit(
      'NODE_ASSIGNED',
      'SYSTEM',
      `Node '${nodeId}' assigned to Home '${home.name}' -> Room '${room.name}'`
    );

    return this.getNode(nodeId);
  }

  moveNode(nodeId, newHomeId, newRoomId) {
    return this.assignNodeToRoom(nodeId, newHomeId, newRoomId);
  }

  unassignNode(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node '${nodeId}' not found`);

    this.db.prepare(`
      UPDATE nodes 
      SET home_id = NULL, room_id = NULL, assigned_at = NULL
      WHERE node_id = ?
    `).run(nodeId);

    this.logAudit(
      'NODE_UNASSIGNED',
      'SYSTEM',
      `Node '${nodeId}' unassigned from Home and moved to Unassigned Nodes queue`
    );

    return this.getNode(nodeId);
  }

  getUnassignedNodes() {
    return this.getNodes({ home_id: 'unassigned' });
  }

  getDevicePermission(nodeId, userId) {
    return this.db.prepare(`
      SELECT * FROM device_permissions WHERE device_id = ? AND user_id = ?
    `).get(nodeId, Number(userId)) || null;
  }

  setDevicePermission(nodeId, userId, perms = {}) {
    const canControl = perms.can_control !== undefined ? (perms.can_control ? 1 : 0) : 1;
    const canViewTelemetry = perms.can_view_telemetry !== undefined ? (perms.can_view_telemetry ? 1 : 0) : 1;
    const canConfigure = perms.can_configure !== undefined ? (perms.can_configure ? 1 : 0) : 0;
    const nowEpoch = Date.now() / 1000;

    this.db.prepare(`
      INSERT INTO device_permissions (device_id, user_id, can_control, can_view_telemetry, can_configure, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id, user_id) DO UPDATE SET
        can_control = excluded.can_control,
        can_view_telemetry = excluded.can_view_telemetry,
        can_configure = excluded.can_configure
    `).run(nodeId, Number(userId), canControl, canViewTelemetry, canConfigure, nowEpoch);

    return this.getDevicePermission(nodeId, userId);
  }

  removeDevicePermission(nodeId, userId) {
    this.db.prepare('DELETE FROM device_permissions WHERE device_id = ? AND user_id = ?').run(nodeId, Number(userId));
    return true;
  }
}

module.exports = FleetDatabase;
