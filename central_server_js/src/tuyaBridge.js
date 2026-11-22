const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

class TuyaBreakerBridge {
  constructor(nodeManager, db, config = {}) {
    this.nodeManager = nodeManager;
    this.db = db;
    this.config = config;

    this.portalPort = Number(config.tuya_portal_port || 8085);
    this.portalHost = config.tuya_portal_host || '127.0.0.1';
    this.portalUrl = `http://${this.portalHost}:${this.portalPort}`;

    this.nodeId = 'NODE-30487DE85D5C';
    this.macAddress = '30:48:7d:e8:5d:5c';
    this.defaultIp = '192.168.1.164';

    this.pollIntervalMs = Number(config.tuya_poll_interval_ms || 2500);
    this.timer = null;
    this.isPolling = false;
    this.childProcess = null;
    this.lastReading = null;
    this.lastConfig = null;
    this.failedAttempts = 0;
    this.startTime = Date.now();
    this.serialLogs = [];
    this.serialCounter = 0;

    // Attach reference to nodeManager
    if (this.nodeManager) {
      this.nodeManager.tuyaBridge = this;
    }
  }

  start() {
    console.log(`[TuyaBridge] Starting Tuya Smart Breaker Bridge (Portal: ${this.portalUrl}, Poll: ${this.pollIntervalMs}ms)`);
    this.initDevices();
    this.ensurePollerServiceRunning();
    
    // First poll after 1s
    setTimeout(() => this.poll(), 1000);

    // Periodic poll
    this.timer = setInterval(() => {
      this.poll().catch(err => {
        // silent catch
      });
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.childProcess) {
      try {
        this.childProcess.kill();
      } catch (e) {}
      this.childProcess = null;
    }
    console.log('[TuyaBridge] Stopped Tuya Smart Breaker Bridge.');
  }

  async ensurePollerServiceRunning() {
    try {
      const isAlive = await this.pingPortal();
      if (!isAlive) {
        this.spawnPollerService();
      }
    } catch (e) {
      this.spawnPollerService();
    }
  }

  pingPortal() {
    return new Promise((resolve) => {
      const req = http.get(`${this.portalUrl}/api/status`, { timeout: 1500 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  spawnPollerService() {
    const pythonScript = path.join(__dirname, '..', '..', 'smart_breaker_portal', 'server.py');
    if (!fs.existsSync(pythonScript)) {
      console.warn(`[TuyaBridge] Python poller script not found at ${pythonScript}`);
      return;
    }

    try {
      console.log(`[TuyaBridge] Spawning background Python poller server: ${pythonScript}`);
      this.childProcess = spawn('python', [pythonScript], {
        detached: true,
        stdio: 'ignore'
      });
      this.childProcess.unref();
    } catch (err) {
      console.error(`[TuyaBridge] Failed to spawn poller service: ${err.message}`);
    }
  }

  async poll() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const data = await this.httpGet('/api/status');
      if (data && data.reading) {
        this.failedAttempts = 0;
        this.lastReading = data.reading;
        this.lastConfig = data.config || {};
        await this.syncToFleet(data);
      }
    } catch (err) {
      this.failedAttempts++;
      if (this.failedAttempts >= 4) {
        // Mark node offline if repeatedly unreachable
        this.db.setNodeOnline(this.nodeId, false);
      }
      if (this.failedAttempts % 10 === 0) {
        this.ensurePollerServiceRunning();
      }
    } finally {
      this.isPolling = false;
    }
  }

  async syncToFleet(statusData) {
    const { config = {}, reading = {} } = statusData;
    const decoded = reading.decoded || {};
    const dps = reading.dps || {};
    const isLive = Boolean(reading.online);
    const ip = config.ip_address || this.defaultIp;
    const deviceName = config.device_name || 'Wi-Fi Smart Circuit Breaker';

    const switchState = Boolean(decoded.switch_state);
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);

    // 1. Upsert into Nodes table
    const channels = [
      {
        id: 1,
        pin: 103,
        name: 'Main Circuit Breaker',
        room: 'Main DB',
        function: 'Circuit Breaker',
        activeLow: false,
        state: switchState ? 1 : 0
      }
    ];

    const nodeData = {
      nodeId: this.nodeId,
      name: deviceName,
      hardware: 'Tuya Smart Breaker (Single Phase + Earth Leakage)',
      firmwareVersion: `v${config.protocol_version || '3.5'}`,
      ip: ip,
      mac: this.macAddress,
      rssi: -55,
      uptimeSec: uptimeSec,
      freeHeap: 48120,
      channels: channels,
      device_group: 'PROTECTION',
      room: 'Main DB',
      category: 'Power & Breakers'
    };

    this.db.upsertNode(nodeData);

    if (isLive) {
      this.db.setNodeOnline(this.nodeId, true);
      this.db.touchNode(this.nodeId);
    } else {
      this.db.setNodeOnline(this.nodeId, false);
    }

    // 2. Upsert Sensors into sensors table
    const sensorReadings = [
      { sensorType: 'VOLTAGE', name: 'Mains Voltage', value: Number(decoded.voltage_v) || 0, unit: 'V' },
      { sensorType: 'CURRENT', name: 'Load Current', value: Number(decoded.current_a) || 0, unit: 'A' },
      { sensorType: 'POWER', name: 'Active Power', value: Number(decoded.power_w) || 0, unit: 'W' },
      { sensorType: 'ENERGY', name: 'Total Energy', value: Number(decoded.total_energy_kwh) || 0, unit: 'kWh' },
      { sensorType: 'FREQUENCY', name: 'Line Frequency', value: Number(decoded.frequency_hz) || 50.0, unit: 'Hz' },
      { sensorType: 'TEMPERATURE', name: 'Internal Temp', value: Number(decoded.temperature_c) || 0, unit: '°C' },
      { sensorType: 'LEAKAGE_CURRENT', name: 'Earth Leakage Current', value: Number(decoded.leakage_current_ma) || 0, unit: 'mA' }
    ];

    for (const s of sensorReadings) {
      if (typeof this.db.upsertSensor === 'function') {
        this.db.upsertSensor({
          nodeId: this.nodeId,
          sensorType: s.sensorType,
          name: s.name,
          room: 'Main DB',
          value: s.value,
          unit: s.unit
        });
      }
    }

    // 3. Serial Packet Stream Logging
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    
    // Log frame summary
    this.logSerial('RX', 'FRAME', `[LAN ${ip}:6668] Protocol v${config.protocol_version || '3.5'} AES-128 Socket Frame Received (${Object.keys(dps).length} DPs)`);
    if (dps['102']) {
      this.logSerial('RX', 'DP102', `Stream: "${dps['102']}" -> V=${decoded.voltage_v}V | I=${decoded.current_a}A | P=${decoded.power_w}W | PF=${decoded.power_factor || '0.99'}`);
    }
    this.logSerial('RX', 'STATUS', `Contact=${decoded.switch_state ? 'ON (Closed)' : 'OFF (Tripped)'} | Lock=${decoded.child_lock ? 'LOCKED' : 'Unlocked'} | Temp=${decoded.temperature_c}°C (Limit DP 115=${decoded.high_temp_threshold_c || 94}°C)`);
    this.logSerial('RX', 'PROTECT', `EarthLeakage=${decoded.leakage_current_ma}mA (Trip DP 132=${decoded.leakage_threshold_ma}mA) | Overcurrent=${decoded.overcurrent_limit_a || 30}A | Overvol DP 121=${dps['121'] || 14144}`);
    this.logSerial('RX', 'RAW_DPS', JSON.stringify(dps));

    // 4. Broadcast real-time WebSocket event
    if (this.nodeManager && typeof this.nodeManager.broadcast === 'function') {
      this.nodeManager.broadcast('breaker_telemetry', {
        nodeId: this.nodeId,
        isOnline: isLive,
        timestamp: reading.timestamp || new Date().toISOString(),
        config: config,
        decoded: decoded,
        dps: dps,
        source: reading.source
      });

      this.nodeManager.broadcast('telemetry_update', {
        node_id: this.nodeId,
        nodeId: this.nodeId,
        name: deviceName,
        ip: ip,
        rssi: -55,
        uptime_sec: uptimeSec,
        free_heap: 48120,
        channels: channels,
        eventType: 'tuya_telemetry',
        timestamp: Date.now()
      });
    }
  }

  logSerial(direction, type, message, raw = null) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const entry = {
      id: ++this.serialCounter,
      time: timeStr,
      direction, // 'RX', 'TX', 'SYS', 'ERR'
      type,      // 'FRAME', 'DP102', 'STATUS', 'PROTECT', 'RAW_DPS', 'COMMAND', 'ACK'
      message,
      raw
    };

    this.serialLogs.push(entry);
    if (this.serialLogs.length > 400) {
      this.serialLogs.shift();
    }

    if (this.nodeManager && typeof this.nodeManager.broadcast === 'function') {
      this.nodeManager.broadcast('breaker_serial_log', entry);
    }
    return entry;
  }

  getSerialLogs(limit = 100) {
    return this.serialLogs.slice(-Math.min(limit, 400));
  }

  clearSerialLogs() {
    this.serialLogs = [];
    this.logSerial('SYS', 'CLEAR', 'Serial Monitor buffer cleared by operator');
    return { success: true };
  }

  async executeSerialCommand(cmdStr) {
    if (!cmdStr || typeof cmdStr !== 'string') {
      return { success: false, error: 'Empty command' };
    }

    const trimmed = cmdStr.trim();
    this.logSerial('TX', 'COMMAND', `> ${trimmed}`);

    const parts = trimmed.split(/\s+/);
    const verb = parts[0].toLowerCase();

    try {
      if (verb === 'clear') {
        return this.clearSerialLogs();
      }

      if (verb === 'refresh' || verb === 'poll') {
        const res = await this.refresh();
        this.logSerial('RX', 'ACK', `< Poll completed successfully. Device status: ${res.reading?.online ? 'ONLINE' : 'OFFLINE'}`);
        return { success: true, message: 'Polled', result: res };
      }

      if (verb === 'status' || verb === 'info') {
        const st = this.getStatus();
        this.logSerial('RX', 'ACK', `< Device: ${st.config?.device_name || 'Breaker'} | IP: ${st.config?.ip_address} | Status: ${st.reading?.online ? 'LIVE' : 'OFFLINE'}`);
        return { success: true, status: st };
      }

      if (verb === 'get') {
        const dp = parts[1];
        if (!dp) return { success: false, error: 'Usage: get <dpId>' };
        const val = this.lastReading?.dps?.[dp];
        this.logSerial('RX', 'ACK', `< DP ${dp} = ${JSON.stringify(val)}`);
        return { success: true, dp, value: val };
      }

      if (verb === 'set') {
        const dp = parts[1];
        let val = parts.slice(2).join(' ');
        if (!dp || val === undefined || val === '') {
          return { success: false, error: 'Usage: set <dpId> <value>' };
        }

        // Auto-cast booleans and numbers
        if (val.toLowerCase() === 'true' || val.toLowerCase() === 'on') val = true;
        else if (val.toLowerCase() === 'false' || val.toLowerCase() === 'off') val = false;
        else if (!isNaN(Number(val)) && !val.includes('.')) val = parseInt(val, 10);
        else if (!isNaN(Number(val))) val = parseFloat(val);

        if (dp === '103') {
          const res = await this.toggleSwitch(Boolean(val));
          this.logSerial('RX', 'ACK', `< Contact switch (DP 103) -> ${val ? 'ON' : 'OFF'}: ${JSON.stringify(res)}`);
          return res;
        }

        const res = await this.setDp(dp, val);
        this.logSerial('RX', 'ACK', `< Set DP ${dp} to ${JSON.stringify(val)} -> Result: ${JSON.stringify(res)}`);
        return res;
      }

      if (verb === 'raw') {
        const jsonStr = trimmed.slice(4).trim();
        const parsed = JSON.parse(jsonStr);
        if (parsed.dp !== undefined && parsed.value !== undefined) {
          const res = await this.setDp(String(parsed.dp), parsed.value);
          this.logSerial('RX', 'ACK', `< Raw set DP ${parsed.dp} -> ${JSON.stringify(res)}`);
          return res;
        }
        return { success: false, error: 'Raw format requires {"dp":"...", "value":...}' };
      }

      this.logSerial('ERR', 'SYNTAX', `Unknown command: '${trimmed}'. Supported: set <dp> <val>, get <dp>, refresh, status, clear`);
      return { success: false, error: `Unknown command '${verb}'` };
    } catch (err) {
      this.logSerial('ERR', 'EXCEPTION', `Error executing '${trimmed}': ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // --- ACTIONS ---

  async toggleSwitch(targetState = null) {
    try {
      const body = {};
      if (targetState !== null && targetState !== undefined) {
        body.state = Boolean(targetState);
      }
      this.logSerial('TX', 'COMMAND', `> Breaker Contact Switch -> ${targetState ? 'CLOSED (ON)' : 'TRIPPED (OFF)'}`);
      const res = await this.httpPost('/api/toggle', body);
      this.logSerial('RX', 'ACK', `< Breaker Contact Response: ${JSON.stringify(res)}`);
      await this.poll(); // Trigger immediate sync
      return { success: true, ...res };
    } catch (err) {
      this.logSerial('ERR', 'COMMAND_FAIL', `Failed to switch contact: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async setDp(dp, value) {
    try {
      this.logSerial('TX', 'COMMAND', `> LAN Socket set_value(DP ${dp}, ${JSON.stringify(value)})`);
      const res = await this.httpPost('/api/control', { dp, value });
      this.logSerial('RX', 'ACK', `< ACK DP ${dp} = ${JSON.stringify(value)} -> ${JSON.stringify(res)}`);
      await this.poll(); // Trigger immediate sync
      return { success: true, ...res };
    } catch (err) {
      this.logSerial('ERR', 'COMMAND_FAIL', `Failed to set DP ${dp}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async refresh() {
    try {
      const res = await this.httpPost('/api/refresh', {});
      if (res && res.reading) {
        this.lastReading = res.reading;
        await this.syncToFleet({ config: this.lastConfig, reading: res.reading });
      }
      return { success: true, reading: this.lastReading };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getHistory() {
    try {
      return await this.httpGet('/api/history');
    } catch (err) {
      return { count: 0, samples: [] };
    }
  }

  getStatus() {
    return {
      nodeId: this.nodeId,
      macAddress: this.macAddress,
      portalUrl: this.portalUrl,
      config: this.lastConfig,
      reading: this.lastReading
    };
  }

  // --- MULTI-DEVICE MANAGEMENT ---

  initDevices() {
    try {
      const devices = this.db.getTuyaDevices();
      if (!devices || devices.length === 0) {
        const defaultDev = {
          id: 'd705ffaccaf4d0f1b1addg',
          name: 'Wi-Fi Smart Circuit Breaker (Main)',
          ip: '192.168.1.25',
          local_key: 'gp->j2_X[Bx=.ovC',
          protocol_version: 3.5,
          category: 'breaker',
          model: 'B-B1-M',
          mac: '30:48:7d:e8:5d:5c',
          is_active: 1
        };
        this.db.upsertTuyaDevice(defaultDev);
      }
      const active = this.db.getActiveTuyaDevice() || this.db.getTuyaDevices()[0];
      if (active) {
        this.activeDeviceId = active.id;
        this.applyDeviceConfigToPoller(active);
      }
    } catch (err) {
      console.error('[TuyaBridge] Error initializing devices from DB:', err.message);
    }
  }

  async applyDeviceConfigToPoller(dev) {
    if (!dev) return;
    try {
      await this.httpPost('/api/config', {
        device_name: dev.name,
        device_id: dev.id,
        local_key: dev.local_key,
        ip_address: dev.ip,
        protocol_version: Number(dev.protocol_version || 3.5),
        mac_address: dev.mac || '30:48:7d:e8:5d:5c',
        model_sn: dev.model || 'B-B1-M'
      });
      this.defaultIp = dev.ip;
      this.nodeId = `NODE-${(dev.mac || dev.id).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;
    } catch (err) {
      console.warn('[TuyaBridge] Failed to apply config to poller:', err.message);
    }
  }

  getDevices() {
    return {
      devices: this.db.getTuyaDevices(),
      activeDevice: this.db.getActiveTuyaDevice()
    };
  }

  async saveDevice(devData) {
    if (!devData.id || !devData.ip || !devData.local_key) {
      throw new Error('Device ID, IP address, and Local Key are required');
    }
    const saved = this.db.upsertTuyaDevice(devData);
    if (saved.is_active) {
      this.activeDeviceId = saved.id;
      await this.applyDeviceConfigToPoller(saved);
      this.logSerial('SYS', 'CONFIG', `Active breaker configuration updated: ${saved.name} (IP: ${saved.ip})`);
      await this.refresh();
    }
    if (this.nodeManager && typeof this.nodeManager.broadcast === 'function') {
      this.nodeManager.broadcast('tuya_device_list_updated', this.getDevices());
    }
    return { success: true, device: saved };
  }

  async setActiveDevice(id) {
    const updated = this.db.setActiveTuyaDevice(id);
    if (!updated) throw new Error('Device not found');
    this.activeDeviceId = updated.id;
    await this.applyDeviceConfigToPoller(updated);
    this.logSerial('SYS', 'DEVICE_SWITCH', `Switched active breaker to: ${updated.name} (IP: ${updated.ip})`);
    await this.refresh();
    if (this.nodeManager && typeof this.nodeManager.broadcast === 'function') {
      this.nodeManager.broadcast('tuya_device_list_updated', this.getDevices());
    }
    return { success: true, activeDevice: updated };
  }

  async deleteDevice(id) {
    const all = this.db.getTuyaDevices();
    if (all.length <= 1) {
      throw new Error('Cannot delete the only configured device');
    }
    this.db.deleteTuyaDevice(id);
    const newActive = this.db.getActiveTuyaDevice();
    if (newActive) {
      this.activeDeviceId = newActive.id;
      await this.applyDeviceConfigToPoller(newActive);
      await this.refresh();
    }
    if (this.nodeManager && typeof this.nodeManager.broadcast === 'function') {
      this.nodeManager.broadcast('tuya_device_list_updated', this.getDevices());
    }
    return { success: true };
  }

  async testConnection(testData = {}) {
    try {
      const active = this.db.getActiveTuyaDevice() || {};
      const payload = {
        ip_address: testData.ip || testData.ip_address || active.ip,
        device_id: testData.id || testData.device_id || active.id,
        local_key: testData.local_key || testData.key || active.local_key,
        protocol_version: Number(testData.protocol_version || active.protocol_version || 3.5)
      };
      return await this.httpPost('/api/test-connection', payload);
    } catch (err) {
      return { status: 'error', online: false, error: err.message };
    }
  }

  async scanLan() {
    try {
      return await this.httpPost('/api/scan', {});
    } catch (err) {
      return { status: 'error', devices: [], error: err.message };
    }
  }

  // --- HTTP HELPERS ---

  httpGet(endpoint) {
    return new Promise((resolve, reject) => {
      const req = http.get(`${this.portalUrl}${endpoint}`, { timeout: 3000 }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw));
            } catch (e) {
              resolve(raw);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
    });
  }

  httpPost(endpoint, bodyObj) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(bodyObj || {});
      const req = http.request(`${this.portalUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 4000
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw));
            } catch (e) {
              resolve(raw);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
      req.write(payload);
      req.end();
    });
  }
}

module.exports = TuyaBreakerBridge;
