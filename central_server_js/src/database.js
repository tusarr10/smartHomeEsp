const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

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
    try {
      this.db.exec("ALTER TABLE notifications ADD COLUMN category TEXT DEFAULT 'SYSTEM'");
    } catch (e) {}

    // 9. Automations Table (Upgraded schema with conditions and actions)
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

    // 12. OTA Deployment History (LTS Audit Trail)
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

    // Schema Migrations (in case table was created with older schema)
    try {
      this.db.exec(`ALTER TABLE automations ADD COLUMN description TEXT DEFAULT ''`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE automations ADD COLUMN trigger_type TEXT DEFAULT 'GPIO State Change'`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE automations ADD COLUMN condition_logic TEXT DEFAULT 'ALL'`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE automations ADD COLUMN conditions_json TEXT DEFAULT '[]'`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE automations ADD COLUMN actions_json TEXT DEFAULT '[]'`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE automations ADD COLUMN execution_count INTEGER DEFAULT 0`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE automations ADD COLUMN created_at TEXT DEFAULT ''`);
    } catch {}

    try {
      this.db.exec(`ALTER TABLE firmware ADD COLUMN hardware_type TEXT DEFAULT 'ESP8266'`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE firmware ADD COLUMN file_size_bytes INTEGER DEFAULT 0`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE firmware ADD COLUMN checksum_md5 TEXT DEFAULT ''`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE firmware ADD COLUMN file_path TEXT DEFAULT ''`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE firmware ADD COLUMN uploaded_at TEXT DEFAULT ''`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE firmware ADD COLUMN release_channel TEXT DEFAULT 'LTS'`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE firmware ADD COLUMN notes TEXT DEFAULT ''`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE firmware ADD COLUMN checksum_sha256 TEXT DEFAULT ''`);
    } catch {}

    this.seedDefaults();
  }

  seedDefaults() {
    // Seed initial startup audit log if table is empty
    const auditCount = this.db.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count;
    if (auditCount === 0) {
      this.logAudit('SERVER_START', 'System', 'Central Fleet Server started on port 9100');
      this.logAudit('TCP_INIT', 'System', 'TCP Telemetry listener initialized on port 2000');
    }

    // Seed default automation rule if empty
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

    // Seed default firmware metadata entry if empty
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
  }

  // === NODE METHODS ===

  upsertNode(data) {
    const nodeId = data.nodeId || data.node_id;
    if (!nodeId) return false;

    const nowEpoch = Date.now() / 1000;
    const nowStr = new Date().toISOString();
    const channelsJson = JSON.stringify(data.channels || []);
    const name = data.nodeName || data.name || nodeId;
    const ip = data.ip || data.ip_address || '';
    const mac = data.mac || data.mac_address || '';
    const fw = data.firmwareVersion || data.firmware_version || '1.6.0';
    const hw = data.hardware || data.hardware_type || 'ESP8266';
    const rssi = Number(data.rssi) || 0;
    const uptime = Number(data.uptimeSec || data.uptime_sec) || 0;
    const heap = Number(data.freeHeap || data.free_heap) || 0;
    const gateway = data.gateway || '';

    const checkStmt = this.db.prepare('SELECT node_id FROM nodes WHERE node_id = ?');
    const existing = checkStmt.get(nodeId);

    if (existing) {
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
          channels_json = ?
        WHERE node_id = ?
      `);
      updateStmt.run(name, hw, fw, ip, mac, mac, gateway, rssi, uptime, heap, nowEpoch, nowStr, channelsJson, nodeId);
    } else {
      const insertStmt = this.db.prepare(`
        INSERT INTO nodes (
          node_id, name, hardware_type, firmware_version, ip_address, mac_address, gateway,
          rssi, uptime_sec, free_heap, is_online, status, room, location, category,
          last_seen_epoch, last_seen_str, channels_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Online', 'General', 'Home', 'Controller', ?, ?, ?, ?)
      `);
      insertStmt.run(nodeId, name, hw, fw, ip, mac, gateway, rssi, uptime, heap, nowEpoch, nowStr, channelsJson, nowEpoch);
    }

    const stateChanges = [];
    if (Array.isArray(data.channels)) {
      const activeChannelIds = [];
      for (const ch of data.channels) {
        const chId = Number(ch.id ?? ch.channel_id);
        if (!isNaN(chId) && chId > 0) {
          activeChannelIds.push(chId);
          const chRes = this.upsertRelayFromChannel(nodeId, ch);
          if (chRes && chRes.changed) {
            stateChanges.push(chRes);
          }
        }
      }

      // Automatically prune / delete any relays for this node that are NOT on the node
      if (activeChannelIds.length > 0) {
        const placeholders = activeChannelIds.map(() => '?').join(',');
        this.db.prepare(`
          DELETE FROM relays 
          WHERE node_id = ? AND channel_id NOT IN (${placeholders})
        `).run(nodeId, ...activeChannelIds);
      } else {
        this.db.prepare('DELETE FROM relays WHERE node_id = ?').run(nodeId);
      }
    }

    return { success: true, stateChanges };
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
    let sql = 'SELECT * FROM nodes WHERE 1=1';
    const params = [];

    if (filters.room) {
      sql += ' AND room = ?';
      params.push(filters.room);
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.hardware) {
      sql += ' AND hardware_type = ?';
      params.push(filters.hardware);
    }
    if (filters.search) {
      sql += ' AND (name LIKE ? OR node_id LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    sql += ' ORDER BY is_online DESC, last_seen_epoch DESC';
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
        room: n.room,
        location: n.location,
        category: n.category,
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
    const row = this.db.prepare('SELECT * FROM nodes WHERE node_id = ?').get(nodeId);
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
      room: row.room,
      location: row.location,
      category: row.category,
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

  getFirmwareList() {
    const rows = this.db.prepare('SELECT * FROM firmware ORDER BY id DESC').all();
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
      uploaded_at: r.uploaded_at
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
      uploaded_at: r.uploaded_at
    };
  }

  addFirmwareRecord(fw) {
    const nowStr = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO firmware (
        filename, version, hardware_type, release_channel, notes, file_size_bytes, checksum_md5, checksum_sha256, file_path, uploaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      nowStr
    );
    return res.lastInsertRowid;
  }

  deleteFirmware(id) {
    const res = this.db.prepare('DELETE FROM firmware WHERE id = ?').run(Number(id));
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
}

module.exports = FleetDatabase;
