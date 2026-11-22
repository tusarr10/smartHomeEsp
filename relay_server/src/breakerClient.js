const http = require('node:http');
const EventEmitter = require('node:events');

class BreakerClient extends EventEmitter {
  constructor(nodeStore, config = {}) {
    super();
    this.nodeStore = nodeStore;
    this.config = config.breaker || {};
    this.enabled = this.config.enabled !== false;
    this.portalUrl = (this.config.portal_url || 'http://127.0.0.1:8085').replace(/\/+$/, '');
    this.pollIntervalMs = Number(this.config.poll_interval_ms || 3000);
    this.nodeId = this.config.node_id || 'NODE-30487DE85D5C';
    this.deviceName = this.config.device_name || 'Wi-Fi Smart Circuit Breaker';

    this.timer = null;
    this.isPolling = false;
    this.lastReading = null;
    this.isLive = false;
    this.failedCount = 0;

    if (this.enabled) {
      this.start();
    }
  }

  start() {
    this.poll();
    this.timer = setInterval(() => {
      this.poll();
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const data = await this.fetchJson(`${this.portalUrl}/api/status`);
      if (data && data.reading) {
        this.failedCount = 0;
        this.isLive = Boolean(data.reading.online);
        this.lastReading = this.processReading(data.reading, data.config);
        this.emit('reading', this.lastReading);
        this.syncToNodeStore(this.lastReading);
      }
    } catch (err) {
      this.failedCount++;
      if (this.failedCount > 3 && this.isLive) {
        this.isLive = false;
        if (this.lastReading) this.lastReading.online = false;
        this.emit('reading', this.lastReading);
      }
    } finally {
      this.isPolling = false;
    }
  }

  processReading(rawReading = {}, deviceCfg = {}) {
    const decoded = rawReading.decoded || {};
    const dps = rawReading.dps || {};

    return {
      online: Boolean(rawReading.online),
      deviceId: deviceCfg.device_id || this.nodeId,
      deviceName: deviceCfg.device_name || this.deviceName,
      ip: deviceCfg.ip_address || this.config.direct_ip || '192.168.1.164',
      mac: deviceCfg.mac_address || '30:48:7d:e8:5d:5c',
      timestamp: rawReading.timestamp || new Date().toISOString(),
      decoded: {
        switch_state: decoded.switch_state !== undefined ? Boolean(decoded.switch_state) : Boolean(dps['108'] ?? dps['1'] ?? true),
        voltage_v: Number(decoded.voltage_v || 230.0),
        current_a: Number(decoded.current_a || 0.0),
        power_w: Number(decoded.power_w || 0.0),
        frequency_hz: Number(decoded.frequency_hz || 50.0),
        temperature_c: Number(decoded.temperature_c || 32.0),
        leakage_current_ma: Number(decoded.leakage_current_ma || 0.0),
        total_energy_kwh: Number(decoded.total_energy_kwh || 0.0),
        child_lock: Boolean(decoded.child_lock ?? dps['129']),
        power_factor: Number(decoded.power_factor || 0.99),
        // Protection limits
        overcurrent_limit_a: Number(decoded.overcurrent_limit_a || dps['18'] || 32),
        high_temp_threshold_c: Number(decoded.high_temp_threshold_c || dps['115'] || 90),
        leakage_threshold_ma: Number(decoded.leakage_threshold_ma || dps['132'] || 30)
      },
      dps: dps
    };
  }

  syncToNodeStore(reading) {
    if (!this.nodeStore || !reading) return;

    const channels = [
      {
        channelId: 1,
        id: 1,
        pin: 108,
        name: 'Main Circuit Breaker Contact',
        room: 'Main DB',
        function: 'Breaker Contact',
        state: reading.decoded.switch_state
      }
    ];

    const sensors = [
      { type: 'VOLTAGE', name: 'Mains Voltage', value: reading.decoded.voltage_v, unit: 'V' },
      { type: 'CURRENT', name: 'Load Current', value: reading.decoded.current_a, unit: 'A' },
      { type: 'POWER', name: 'Active Power', value: reading.decoded.power_w, unit: 'W' },
      { type: 'ENERGY', name: 'Total Energy', value: reading.decoded.total_energy_kwh, unit: 'kWh' },
      { type: 'FREQUENCY', name: 'Grid Frequency', value: reading.decoded.frequency_hz, unit: 'Hz' },
      { type: 'TEMPERATURE', name: 'Breaker Temperature', value: reading.decoded.temperature_c, unit: '°C' },
      { type: 'LEAKAGE_CURRENT', name: 'Earth Leakage', value: reading.decoded.leakage_current_ma, unit: 'mA' }
    ];

    const telemetryPayload = {
      nodeId: this.nodeId,
      nodeName: reading.deviceName,
      ip: reading.ip,
      mac: reading.mac,
      uptimeSec: Math.floor(process.uptime()),
      channels: channels,
      sensors: sensors,
      eventType: 'breaker_status'
    };

    this.nodeStore.processTelemetry(telemetryPayload, reading.ip, 'TUYA_LAN');
  }

  async setSwitch(state) {
    // Send to portal API
    const targetUrl = `${this.portalUrl}/api/control`;
    try {
      const res = await this.postJson(targetUrl, {
        switch: Boolean(state),
        dp: 108,
        value: Boolean(state)
      });
      if (this.lastReading) {
        this.lastReading.decoded.switch_state = Boolean(state);
        this.emit('reading', this.lastReading);
        this.syncToNodeStore(this.lastReading);
      }
      return { success: true, res };
    } catch (err) {
      // If portal not reachable, update local reading optimistically
      if (this.lastReading) {
        this.lastReading.decoded.switch_state = Boolean(state);
        this.emit('reading', this.lastReading);
        this.syncToNodeStore(this.lastReading);
      }
      return { success: false, error: err.message };
    }
  }

  fetchJson(targetUrl) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const req = http.get({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + (parsed.search || ''),
        timeout: 2000
      }, (res) => {
        let buf = '';
        res.on('data', chunk => { buf += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(buf));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('Timeout')));
      req.on('error', reject);
    });
  }

  postJson(targetUrl, payload) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const body = JSON.stringify(payload);
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + (parsed.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 2500
      }, (res) => {
        let buf = '';
        res.on('data', chunk => { buf += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            resolve({ raw: buf });
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('Timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  getReading() {
    return this.lastReading;
  }
}

module.exports = BreakerClient;
