const http = require('node:http');
const crypto = require('node:crypto');

class NodeManager {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.commandQueues = new Map(); // nodeId -> [commandObj]
    this.onlineNodesCache = new Map(); // nodeId -> lastSeenEpoch
    this.nodeAuthTokens = new Map(); // ip -> sessionToken
    this.wsClients = new Set();
    this.sseClients = new Set();
    this.serverStartEpoch = Date.now() / 1000;
    this.packetsReceived = 0;
    this.offlineInterval = null;
    this.nodeUptimes = new Map();
    this.pollInterval = null;
    this.isPollingActive = false;
    this.lastPollEpoch = 0;
    this.nodeExpanderStatus = new Map(); // nodeId -> { type, detected, address, outputByte, updatedAt }
    this.nodeAuthMismatch = new Map(); // nodeId -> boolean
  }

  getNodeExpanderStatus(nodeId) {
    return this.nodeExpanderStatus.get(nodeId) || null;
  }

  formatPinName(pin) {
    const p = Number(pin);
    if (!Number.isFinite(p)) return `Pin ${pin}`;
    if (p >= 100 && p <= 107) {
      return `P${p - 100} (PCF8574 #${p})`;
    }
    const dMap = { 5: 'D1', 4: 'D2', 14: 'D5', 12: 'D6', 13: 'D7', 15: 'D8', 0: 'GPIO0', 2: 'GPIO2', 16: 'D0', 1: 'TX', 3: 'RX', 9: 'SD2', 10: 'SD3', 17: 'A0' };
    return dMap[p] ? `${dMap[p]} (GPIO ${p})` : `GPIO ${p}`;
  }

  broadcastNotification(title, message, severity = 'INFO', category = 'SYSTEM', metadata = {}) {
    const notif = this.db.addNotification(title, message, severity, category);
    this.broadcast('notification', {
      ...notif,
      category,
      metadata
    });
    return notif;
  }

  startOfflineWatcher() {
    const timeoutSec = this.config.offline_timeout_sec || 30;
    this.offlineInterval = setInterval(() => {
      const nowEpoch = Date.now() / 1000;
      const nodes = this.db.getNodes();

      for (const node of nodes) {
        if (!node.is_online) continue;
        const lastSeen = node.last_seen_epoch || 0;
        if (nowEpoch - lastSeen > timeoutSec) {
          this.db.setNodeOnline(node.node_id, false);
          this.onlineNodesCache.delete(node.node_id);
          this.db.logAudit('NODE_OFFLINE', node.node_id, `Node '${node.name}' (${node.ip_address}) missed heartbeats and is now OFFLINE`);
          this.db.logSystemEvent(node.node_id, 'HEARTBEAT', 'WARNING', `Node ${node.name} timed out (> ${timeoutSec}s)`);
          this.broadcast('node_status', {
            node_id: node.node_id,
            nodeId: node.node_id,
            is_online: false,
            isOnline: false,
            status: 'Offline',
            name: node.name
          });
          this.broadcastNotification(
            'Node Offline',
            `Node '${node.name}' (${node.ip_address || node.node_id}) timed out and went OFFLINE.`,
            'WARNING',
            'NODE',
            { nodeId: node.node_id, isOnline: false }
          );
        }
      }
    }, 4000);
  }

  stopOfflineWatcher() {
    if (this.offlineInterval) {
      clearInterval(this.offlineInterval);
      this.offlineInterval = null;
    }
  }

  // === PERIODIC HEALTH & PIN STATUS POLLER ===

  startPeriodicStatusPoller() {
    this.stopPeriodicStatusPoller();

    const intervalSec = Number(this.config.poll_interval_sec) || 10;
    const enabled = this.config.poll_enabled !== false;
    if (!enabled || intervalSec <= 0) {
      console.log(' [Status Poller] Background active polling is disabled.');
      return;
    }

    console.log(` [Status Poller] Active health & pin status sync running every ${intervalSec}s.`);

    // Run first poll shortly after startup (after 2 seconds)
    setTimeout(() => {
      this.pollAllNodesStatusAndPins().catch(e => console.error('Initial poll error:', e.message));
    }, 2000);

    this.pollInterval = setInterval(() => {
      this.pollAllNodesStatusAndPins().catch(e => console.error('Poll interval error:', e.message));
    }, intervalSec * 1000);
  }

  stopPeriodicStatusPoller() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  getPollSettings() {
    return {
      enabled: this.config.poll_enabled !== false,
      intervalSec: Number(this.config.poll_interval_sec) || 10,
      lastPollEpoch: this.lastPollEpoch,
      isPollingActive: this.isPollingActive
    };
  }

  async setPollInterval(intervalSec, enabled = true) {
    this.config.poll_interval_sec = Math.max(3, Number(intervalSec) || 10);
    this.config.poll_enabled = Boolean(enabled);

    try {
      const fs = require('fs');
      const path = require('path');
      const configPath = path.resolve(__dirname, '../config.json');
      fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save config.json:', e);
    }

    this.startPeriodicStatusPoller();
    this.broadcast('poll_settings_changed', this.getPollSettings());
    return this.getPollSettings();
  }

  async pollAllNodesStatusAndPins() {
    if (this.isPollingActive) return;
    this.isPollingActive = true;
    this.lastPollEpoch = Date.now() / 1000;

    try {
      const nodes = this.db.getNodes();
      for (const node of nodes) {
        const ip = node.ip || node.ip_address;
        if (!ip || !ip.trim()) continue;

        try {
          await this.pollSingleNode(node);
        } catch (err) {
          // Node poll error (silently ignore individual failures)
        }
      }
    } finally {
      this.isPollingActive = false;
      this.broadcast('poll_cycle_completed', {
        epoch: this.lastPollEpoch,
        timestamp: new Date(this.lastPollEpoch * 1000).toISOString()
      });
    }
  }

  async pollSingleNode(node) {
    const ip = node.ip || node.ip_address;
    const nodeId = node.node_id;

    const user = node.auth_username || this.config.node_auth?.username || 'admin';
    const pass = node.auth_password || this.config.node_auth?.password || 'admin';
    const headers = { 'Accept': 'application/json' };
    if (user && pass) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    }
    if (this.nodeAuthTokens.has(ip)) {
      headers['X-Session-Token'] = this.nodeAuthTokens.get(ip);
    }

    const fetchWithFallback = async (endpoint) => {
      const r = await fetch(`http://${ip}${endpoint}`, { headers, signal: AbortSignal.timeout(2500) });
      if (r.status === 401 && headers['Authorization']) {
        // Retry without stale Basic header (esp-01 /api/status allows discovery / receiverHost without wrong auth)
        this.nodeAuthMismatch.set(nodeId, true);
        const rOpen = await fetch(`http://${ip}${endpoint}`, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(2500)
        });
        if (!rOpen.ok) throw new Error(`HTTP ${rOpen.status}`);
        return rOpen.json();
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (endpoint === '/api/status') this.nodeAuthMismatch.delete(nodeId);
      return r.json();
    };

    // Concurrently fetch GPIO channels and status diagnostics
    const [gpioRes, statusRes] = await Promise.allSettled([
      fetchWithFallback('/api/gpio'),
      fetchWithFallback('/api/status')
    ]);

    // If both failed, node is unreachable via HTTP
    if (gpioRes.status === 'rejected' && statusRes.status === 'rejected') {
      return { success: false, error: 'Unreachable' };
    }

    let channels = [];
    if (gpioRes.status === 'fulfilled' && gpioRes.value) {
      channels = gpioRes.value.channels || (Array.isArray(gpioRes.value) ? gpioRes.value : []);
    }

    const statusData = statusRes.status === 'fulfilled' ? (statusRes.value || {}) : {};

    const telemetryPayload = {
      nodeId: nodeId,
      name: (node.name && node.name !== nodeId) ? node.name : (statusData.deviceName || node.name || nodeId),
      ip: ip,
      rssi: Number(statusData.rssi) || node.rssi || 0,
      uptimeSec: Number(statusData.uptimeSec) || node.uptime_sec || 0,
      freeHeap: Number(statusData.freeHeap) || node.free_heap || 0,
      resetReason: statusData.resetReason || statusData.resetRaw || '',
      channels: channels,
      eventType: 'periodic_poll',
      timestamp: Date.now()
    };

    if (statusData.hardware) telemetryPayload.hardware = statusData.hardware;
    if (statusData.firmwareVersion) telemetryPayload.firmwareVersion = statusData.firmwareVersion;
    if (statusData.mac) telemetryPayload.mac = statusData.mac;
    if (statusData.staGateway) telemetryPayload.gateway = statusData.staGateway;
    if (statusData.freeSketchSpace !== undefined) telemetryPayload.freeSketchSpace = Number(statusData.freeSketchSpace);
    if (statusData.sketchSize !== undefined) telemetryPayload.sketchSize = Number(statusData.sketchSize);
    if (statusData.pcf8574Detected !== undefined) telemetryPayload.pcf8574Detected = Boolean(statusData.pcf8574Detected);
    if (statusData.pcf8574Address !== undefined) telemetryPayload.pcf8574Address = String(statusData.pcf8574Address);
    if (statusData.pcf8574Output !== undefined) telemetryPayload.pcf8574Output = Number(statusData.pcf8574Output);

    // Process through the central telemetry and notification engine
    await this.processTelemetry(telemetryPayload, ip, 'HTTP_POLL');
    return { success: true };
  }

  // === WEBSOCKET & SSE BROADCASTS ===

  addWsClient(ws) {
    this.wsClients.add(ws);
    ws.on('close', () => this.wsClients.delete(ws));
    ws.on('error', () => this.wsClients.delete(ws));
  }

  addSseClient(res) {
    this.sseClients.add(res);
    res.on('close', () => this.sseClients.delete(res));
  }

  broadcast(eventType, data) {
    // 1. Broadcast via WebSocket
    const wsPayload = JSON.stringify({ type: eventType, data });
    for (const ws of this.wsClients) {
      if (ws.readyState === 1 /* OPEN */) {
        try {
          ws.send(wsPayload);
        } catch {
          this.wsClients.delete(ws);
        }
      }
    }

    // 2. Broadcast via Server-Sent Events (SSE)
    const ssePayload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(ssePayload);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  // === TELEMETRY PROCESSING ===

  async processTelemetry(data, clientIp = '', protocol = 'TCP') {
    this.packetsReceived++;
    const nodeId = data.nodeId || data.node_id;
    if (!nodeId) return [];

    // Optional token validation
    const expectedToken = (this.config.auth_token || '').trim();
    if (expectedToken) {
      const incomingToken = data.token || data.authToken;
      if (incomingToken !== expectedToken) {
        this.db.logAudit('AUTH_FAIL', nodeId, `Rejected telemetry from ${protocol} due to invalid auth token`);
        return [];
      }
    }

    if (clientIp && (!data.ip || data.ip === '0.0.0.0')) {
      data.ip = clientIp;
    }

    const nowEpoch = Date.now() / 1000;
    const wasOnline = this.onlineNodesCache.has(nodeId) &&
      (nowEpoch - this.onlineNodesCache.get(nodeId) < (this.config.offline_timeout_sec || 30));

    this.onlineNodesCache.set(nodeId, nowEpoch);

    const nodeName = data.nodeName || data.name || nodeId;

    // Detect Node Reboot from uptime drop
    const prevUptime = this.nodeUptimes.get(nodeId);
    const currUptime = Number(data.uptimeSec || data.uptime_sec || 0);
    if (prevUptime !== undefined && currUptime < prevUptime && prevUptime > 10) {
      const resetReason = data.resetReason || data.resetRaw || 'System Restart';
      this.db.logAudit('NODE_RESTART', nodeId, `Node '${nodeName}' rebooted. Reset reason: ${resetReason} (Uptime: ${currUptime}s)`);
      this.db.logSystemEvent(nodeId, 'REBOOT', 'INFO', `Node '${nodeName}' restarted: ${resetReason}`);
      this.broadcastNotification(
        'Node Reboot Detected',
        `Node '${nodeName}' finished rebooting (${resetReason}). Uptime: ${currUptime}s.`,
        'INFO',
        'RESTART',
        { nodeId, resetReason, uptime: currUptime }
      );
    }
    this.nodeUptimes.set(nodeId, currUptime);

    // Persist to database and inspect any hardware state changes
    const upsertRes = this.db.upsertNode(data);
    const eventType = data.eventType || 'heartbeat';
    this.db.logTelemetry(nodeId, eventType, data);

    if (upsertRes && Array.isArray(upsertRes.stateChanges)) {
      for (const change of upsertRes.stateChanges) {
        const stateStr = change.newState ? 'ON' : 'OFF';
        const pinLabel = this.formatPinName(change.pin);
        this.db.logAudit(change.newState ? 'PIN_ON' : 'PIN_OFF', nodeId, `Channel ${change.channelId} ('${change.name}', ${pinLabel}) switched ${stateStr} on node '${nodeName}' (Hardware sync)`);
        this.broadcastNotification(
          `Pin Switched ${stateStr}`,
          `'${change.name}' (${pinLabel}, Ch ${change.channelId}) on '${nodeName}' switched ${stateStr}.`,
          'INFO',
          'PIN',
          { nodeId, channelId: change.channelId, state: Boolean(change.newState) }
        );
        this.broadcast('relay_state_confirmed', {
          node_id: nodeId,
          channel_id: change.channelId,
          new_state: Boolean(change.newState)
        });
      }
    }

    if (!wasOnline) {
      this.db.logAudit('NODE_ONLINE', nodeId, `Node '${nodeName}' (${data.ip}) connected via ${protocol}`);
      this.db.logSystemEvent(nodeId, protocol, 'INFO', `Node '${nodeName}' came ONLINE via ${protocol}`);
      this.broadcast('node_status', {
        node_id: nodeId,
        nodeId: nodeId,
        is_online: true,
        isOnline: true,
        status: 'Online',
        name: nodeName
      });
      this.broadcastNotification(
        'Node Online',
        `Node '${nodeName}' (${data.ip}) is now ONLINE.`,
        'SUCCESS',
        'NODE',
        { nodeId, ip: data.ip, isOnline: true }
      );
    }

    // Process hardware application-level command ACKs returned by ESP node
    if (Array.isArray(data.acks) && data.acks.length > 0) {
      for (const ack of data.acks) {
        const uuid = ack.command_uuid || ack.commandId;
        if (uuid) {
          this.db.markCommandAcknowledged(uuid, ack);
          this.broadcast('command_acknowledged', {
            command_uuid: uuid,
            node_id: nodeId,
            status: ack.status || 'ACKNOWLEDGED',
            success: ack.success !== false,
            ack
          });
          this.db.logAudit('COMMAND_ACK', nodeId, `Command '${uuid}' acknowledged by node (status: ${ack.status || 'OK'})`);
        }
      }
    }

    // Track PCF8574T I2C Expander telemetry if present
    if (data.pcf8574Detected !== undefined || data.pcf8574Address !== undefined) {
      this.nodeExpanderStatus.set(nodeId, {
        type: 'PCF8574T',
        detected: Boolean(data.pcf8574Detected),
        address: data.pcf8574Address || '0x27',
        outputByte: data.pcf8574Output !== undefined ? Number(data.pcf8574Output) : 255,
        updatedAt: Date.now()
      });
    }

    // Ingest LittleFS / Flash / Hardware capabilities if present
    if (data.littlefs_total || data.fs_total || data.flash_size || data.flashSize || data.freeSketchSpace) {
      const fsTotal = Number(data.littlefs_total || data.fs_total) || 0;
      const fsUsed = Number(data.littlefs_used || data.fs_used) || 0;
      const fsFree = Number(data.littlefs_free || data.fs_free) || (fsTotal - fsUsed);
      const hwModel = data.hardware || data.hardware_type || 'ESP8266';
      const is1Mb = hwModel.toUpperCase().includes('1MB') || hwModel.toUpperCase().includes('ESP-01');
      this.db.upsertDeviceCapabilities(nodeId, {
        littlefs_total_bytes: fsTotal || undefined,
        littlefs_used_bytes: fsUsed || undefined,
        littlefs_free_bytes: fsFree || undefined,
        flash_size_bytes: Number(data.flash_size || data.flashSize) || (is1Mb ? 1048576 : 4194304),
        max_ota_sketch_size: data.freeSketchSpace ? Number(data.freeSketchSpace) : undefined,
        ram_size_bytes: Number(data.freeHeap || data.free_heap) || 81920,
        mcu_type: hwModel
      });
    }

    // Live telemetry update broadcast
    const expanderInfo = this.nodeExpanderStatus.get(nodeId) || null;
    this.broadcast('telemetry_update', {
      node_id: nodeId,
      nodeId: nodeId,
      name: nodeName,
      ip: data.ip,
      rssi: data.rssi,
      uptime_sec: data.uptimeSec || data.uptime_sec,
      free_heap: data.freeHeap || data.free_heap,
      channels: data.channels || [],
      pcf8574: expanderInfo,
      eventType,
      timestamp: data.timestamp
    });

    // Check both persistent database commands queue and in-memory queue
    const dbPending = this.db.getPendingCommandsForNode(nodeId, 5);
    for (const p of dbPending) {
      this.db.markCommandDelivered(p.command_uuid);
    }
    const memPending = this.commandQueues.get(nodeId) || [];
    this.commandQueues.delete(nodeId);

    return [...dbPending, ...memPending];
  }

  // === COMMAND DISPATCH ===

  async dispatchCommand(nodeId, command, user = null) {
    const node = this.db.getNode(nodeId);
    if (!node) {
      return { success: false, error: `Node '${nodeId}' not found in fleet` };
    }

    const ip = node.ip || node.ip_address;
    const action = command.action || 'setState';
    const channelId = Number(command.id ?? command.gpioId ?? command.channel_id ?? 0);

    const commandUuid = command.command_uuid || command.commandId || crypto.randomUUID();
    command.command_uuid = commandUuid;
    command.commandId = commandUuid;

    // Persist command in database
    this.db.createCommand({
      command_uuid: commandUuid,
      node_id: nodeId,
      user_id: user ? user.id : null,
      command_type: action,
      payload: command
    });

    this.db.logAudit('COMMAND_SENT', nodeId, `Dispatched command '${action}' (UUID: ${commandUuid}) for channel ${channelId}`);

    if (action === 'reboot') {
      this.db.logAudit('NODE_REBOOT', nodeId, `Administrator initiated reboot command on node '${node.name}' (${ip})`);
      this.broadcastNotification(
        'Node Reboot Initiated',
        `Reboot command sent to node '${node.name}' (${ip}). Device restarting...`,
        'WARNING',
        'RESTART',
        { nodeId, ip }
      );
    }

    let directOk = false;
    let directMsg = '';

    if (ip && ip.trim()) {
      const res = await this.sendDirectLanHttp(ip, command, nodeId);
      directOk = res.success;
      directMsg = res.message;
    }

    if (directOk) {
      if (action === 'setState') {
        const nextState = Boolean(command.state);
        this.db.updateRelayState(nodeId, channelId, nextState);
        this.db.logRelayEvent(nodeId, channelId, !nextState, nextState, 'LAN_DIRECT_CMD');
        const relay = this.db.getRelay(nodeId, channelId) || { name: `Channel ${channelId}`, pin: channelId };
        const stateStr = nextState ? 'ON' : 'OFF';
        const pinLabel = this.formatPinName(relay.pin);
        this.db.logAudit(nextState ? 'PIN_ON' : 'PIN_OFF', nodeId, `Channel ${channelId} ('${relay.name}', ${pinLabel}) turned ${stateStr} on node '${node.name}' via Central Server`);
        this.broadcastNotification(
          `Pin Switched ${stateStr}`,
          `'${relay.name}' (${pinLabel}, Ch ${channelId}) on '${node.name}' turned ${stateStr}.`,
          'INFO',
          'PIN',
          { nodeId, channelId, state: nextState }
        );
      } else if (action === 'toggle') {
        const curr = this.db.getRelay(nodeId, channelId);
        const nextState = curr ? !curr.current_state : true;
        this.db.updateRelayState(nodeId, channelId, nextState);
        this.db.logRelayEvent(nodeId, channelId, !nextState, nextState, 'LAN_DIRECT_TOGGLE');
        const relay = curr || { name: `Channel ${channelId}`, pin: channelId };
        const stateStr = nextState ? 'ON' : 'OFF';
        const pinLabel = this.formatPinName(relay.pin);
        this.db.logAudit(nextState ? 'PIN_ON' : 'PIN_OFF', nodeId, `Channel ${channelId} ('${relay.name}', ${pinLabel}) toggled to ${stateStr} on node '${node.name}' via Central Server`);
        this.broadcastNotification(
          `Pin Switched ${stateStr}`,
          `'${relay.name}' (${pinLabel}, Ch ${channelId}) on '${node.name}' toggled to ${stateStr}.`,
          'INFO',
          'PIN',
          { nodeId, channelId, state: nextState }
        );
      }

      this.db.markCommandAcknowledged(commandUuid, {
        success: true,
        delivery: 'direct_lan_http',
        message: directMsg || 'OK'
      });

      this.broadcast('command_executed', {
        command_uuid: commandUuid,
        node_id: nodeId,
        nodeId: nodeId,
        channel_id: channelId,
        command,
        delivery: 'direct_lan_http'
      });

      return {
        success: true,
        command_uuid: commandUuid,
        delivery: 'direct_lan_http',
        message: 'Command executed instantly via LAN HTTP'
      };
    }

    // Fallback: Queue command for next TCP / HTTP heartbeat check-in
    if (!this.commandQueues.has(nodeId)) {
      this.commandQueues.set(nodeId, []);
    }
    this.commandQueues.get(nodeId).push(command);

    return {
      success: true,
      command_uuid: commandUuid,
      delivery: 'queued',
      message: `Command queued for next check-in (Direct LAN HTTP: ${directMsg || 'offline'})`
    };
  }

  async sendDirectLanHttp(ip, command, nodeId = null) {
    const timeoutMs = this.config.direct_http_timeout_ms || 2500;
    const node = nodeId ? this.db.getNode(nodeId) : (this.db.getNodeByIp ? this.db.getNodeByIp(ip) : null);
    const user = node?.auth_username || this.config.node_auth?.username || 'admin';
    const pass = node?.auth_password || this.config.node_auth?.password || 'admin';
    const basicAuth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

    // Helper for making HTTP POST
    const makeRequest = (path, bodyObj, token) => {
      return new Promise((resolve) => {
        const payload = JSON.stringify(bodyObj);
        const headers = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        } else if (user && pass) {
          headers['Authorization'] = basicAuth;
        }

        const req = http.request({
          hostname: ip,
          port: 80,
          path,
          method: 'POST',
          headers,
          timeout: timeoutMs
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({ statusCode: res.statusCode, data });
          });
        });

        req.on('error', (err) => resolve({ error: err.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ error: 'Connection timed out' });
        });
        req.write(payload);
        req.end();
      });
    };

    // If reboot command
    if (command.action === 'reboot') {
      let token = this.nodeAuthTokens.get(ip);
      let res = await makeRequest('/api/system/reboot', {}, token);
      if (res.statusCode === 401) {
        token = await this.authenticateNode(ip);
        if (token) {
          res = await makeRequest('/api/system/reboot', {}, token);
        }
      }
      return { success: res.statusCode === 200, message: res.data || res.error };
    }

    // 1. Try unified firmware /api/commands/execute endpoint
    let token = this.nodeAuthTokens.get(ip);
    let res = await makeRequest('/api/commands/execute', command, token);
    if (res.statusCode === 200) {
      return { success: true, message: res.data || 'OK' };
    }

    // 2. Fallback to legacy /api/gpio/state endpoint
    res = await makeRequest('/api/gpio/state', command, token);

    if (res.statusCode === 401) {
      // Authenticate and retry
      token = await this.authenticateNode(ip);
      if (token) {
        res = await makeRequest('/api/gpio/state', command, token);
      }
    }

    if (res.statusCode === 200) {
      return { success: true, message: 'OK' };
    }
    return { success: false, message: res.error || `HTTP ${res.statusCode}` };
  }

  async authenticateNode(ip, customUser = null, customPass = null) {
    let user = customUser;
    let pass = customPass;
    if (!user || !pass) {
      const node = this.db.getNodeByIp ? this.db.getNodeByIp(ip) : null;
      user = node?.auth_username || this.config.node_auth?.username || 'admin';
      pass = node?.auth_password || this.config.node_auth?.password || 'admin';
    }
    const creds = { username: user, password: pass };
    return new Promise((resolve) => {
      const payload = JSON.stringify(creds);
      const req = http.request({
        hostname: ip,
        port: 80,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 2000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.success && parsed.token) {
              this.nodeAuthTokens.set(ip, parsed.token);
              resolve(parsed.token);
              return;
            }
          } catch {}
          resolve(null);
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(payload);
      req.end();
    });
  }

  async broadcastCommand(command, targetRoom) {
    const relays = this.db.getRelays(targetRoom ? { room: targetRoom } : {});
    let dispatched = 0;
    const results = {};

    for (const r of relays) {
      const cmd = {
        id: r.channel_id,
        action: command.action || 'setState',
        state: Boolean(command.state),
        duration: command.duration || 500
      };
      const res = await this.dispatchCommand(r.node_id, cmd);
      results[`${r.node_id}_${r.channel_id}`] = res;
      dispatched++;
    }

    return {
      success: true,
      dispatched_count: dispatched,
      results
    };
  }

  // === HARDWARE GPIO PIN SYNCHRONIZATION ===

  async syncNodePins(nodeId) {
    const node = this.db.getNode(nodeId);
    if (!node || (!node.ip && !node.ip_address)) {
      throw new Error(`Node '${nodeId}' not found or has no IP address`);
    }

    const ip = node.ip || node.ip_address;
    const user = node.auth_username || this.config.node_auth?.username || 'admin';
    const pass = node.auth_password || this.config.node_auth?.password || 'admin';

    let token = this.nodeAuthTokens.get(ip);
    if (!token && user && pass) {
      try {
        token = await this.authenticateNode(ip, user, pass);
      } catch {}
    }

    const headers = { 'Accept': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (user && pass) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    }

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: ip,
        port: 80,
        path: '/api/gpio',
        method: 'GET',
        headers,
        timeout: 3500
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(body);
              const channels = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.channels) ? parsed.channels : null);
              if (Array.isArray(channels)) {
                const count = this.db.syncNodeRelays(nodeId, channels);
                this.db.touchNode(nodeId);
                // Also pull /api/status silently to refresh hardware_type & PCF8574 expander metadata
                this.pollSingleNode(node).catch(() => {});
                this.db.logAudit('PINS_SYNCED', nodeId, `Synchronized ${count} GPIO pins directly from node '${node.name}' (${ip})`);
                this.broadcast('relay_sync', { nodeId, count, channels });
                resolve({ success: true, count, channels });
              } else {
                resolve({ success: false, message: 'Node returned invalid channels payload' });
              }
            } catch (e) {
              reject(new Error(`Failed to parse channels JSON from node: ${e.message}`));
            }
          } else {
            reject(new Error(`Node returned HTTP ${res.statusCode} from /api/gpio`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out while querying node /api/gpio'));
      });
      req.on('error', (err) => reject(err));
      req.end();
    });
  }

  getHardwarePinCatalog(nodeId) {
    const node = this.db.getNode(nodeId);
    if (!node) return null;

    const relays = this.db.getRelays({ node_id: nodeId });
    const expander = this.nodeExpanderStatus.get(nodeId) || null;
    const hwUpper = (node.hardware_type || node.hardware || '').toUpperCase();
    const isEsp01Pcf = hwUpper.includes('PCF8574') ||
                       Boolean(expander && expander.detected) ||
                       relays.some(r => Number(r.pin) >= 100 && Number(r.pin) <= 107);
    const isEsp01 = !isEsp01Pcf && ['ESP-01', 'ESP01', '1MB'].some(k => hwUpper.includes(k));

    let basePins;
    if (isEsp01Pcf) {
      basePins = [
        { pin: 100, dPin: 'P0', label: 'P0 (Pin 100)', safety: 'SAFE', bus: 'I2C EXPANDER', notes: 'PCF8574T Expander Pin P0 (Relay 1, Active-Low)' },
        { pin: 101, dPin: 'P1', label: 'P1 (Pin 101)', safety: 'SAFE', bus: 'I2C EXPANDER', notes: 'PCF8574T Expander Pin P1 (Relay 2, Active-Low)' },
        { pin: 102, dPin: 'P2', label: 'P2 (Pin 102)', safety: 'SAFE', bus: 'I2C EXPANDER', notes: 'PCF8574T Expander Pin P2 (Relay 3, Active-Low)' },
        { pin: 103, dPin: 'P3', label: 'P3 (Pin 103)', safety: 'SAFE', bus: 'I2C EXPANDER', notes: 'PCF8574T Expander Pin P3 (Relay 4, Active-Low)' },
        { pin: 104, dPin: 'P4', label: 'P4 (Pin 104)', safety: 'SAFE', bus: 'I2C EXPANDER', notes: 'PCF8574T Expander Pin P4 (Relay 5, Active-Low)' },
        { pin: 105, dPin: 'P5', label: 'P5 (Pin 105)', safety: 'SAFE', bus: 'I2C EXPANDER', notes: 'PCF8574T Expander Pin P5 (Relay 6, Active-Low)' },
        { pin: 106, dPin: 'P6', label: 'P6 (Pin 106)', safety: 'SAFE', bus: 'I2C EXPANDER', notes: 'PCF8574T Expander Pin P6 (Relay 7, Active-Low)' },
        { pin: 107, dPin: 'P7', label: 'P7 (Pin 107)', safety: 'SAFE', bus: 'I2C EXPANDER', notes: 'PCF8574T Expander Pin P7 (Relay 8, Active-Low)' },
        { pin: 3,   dPin: 'RX', label: 'RX (GPIO 3)',  safety: 'SPECIAL', bus: 'UART0 RX', notes: 'UART0 RX / Optional native GPIO (usable if Serial disabled)' },
        { pin: 1,   dPin: 'TX', label: 'TX (GPIO 1)',  safety: 'SPECIAL', bus: 'UART0 TX', notes: 'UART0 TX / Optional native GPIO (HIGH at boot)' },
        { pin: 0,   dPin: 'GPIO 0 (SDA)', label: 'GPIO 0 (I2C SDA)', safety: 'RESERVED', bus: 'I2C SDA', notes: 'Dedicated I2C SDA line to PCF8574T (4.7k pull-up to 3.3V)' },
        { pin: 2,   dPin: 'GPIO 2 (SCL)', label: 'GPIO 2 (I2C SCL)', safety: 'RESERVED', bus: 'I2C SCL', notes: 'Dedicated I2C SCL line to PCF8574T / ESP-01S Onboard LED' }
      ];
    } else if (isEsp01) {
      basePins = [
        { pin: 0, dPin: 'GPIO 0', label: 'GPIO 0 (Pin 5)', safety: 'BOOT_SENSITIVE', bus: 'FLASH / RELAY 1', notes: 'Relay 1 / Flash Pin (must be HIGH on boot)' },
        { pin: 2, dPin: 'GPIO 2', label: 'GPIO 2 (Pin 3)', safety: 'BOOT_SENSITIVE', bus: 'TXD1 / RELAY 2', notes: 'Relay 2 / TXD1 / Sensor (DHT, DS18B20)' },
        { pin: 1, dPin: 'TX (GPIO 1)', label: 'TX (GPIO 1)', safety: 'SPECIAL', bus: 'UART TX', notes: 'Serial TX / Alternate GPIO 1' },
        { pin: 3, dPin: 'RX (GPIO 3)', label: 'RX (GPIO 3)', safety: 'SPECIAL', bus: 'UART RX', notes: 'Serial RX / Alternate GPIO 3' }
      ];
    } else {
      basePins = [
        { pin: 5,  dPin: 'D1',  label: 'D1 (GPIO 5)',   safety: 'SAFE', bus: 'I2C SCL', notes: 'Safe output, boot-neutral / I2C SCL' },
        { pin: 4,  dPin: 'D2',  label: 'D2 (GPIO 4)',   safety: 'SAFE', bus: 'I2C SDA', notes: 'Safe output, boot-neutral / I2C SDA' },
        { pin: 14, dPin: 'D5',  label: 'D5 (GPIO 14)',  safety: 'SAFE', bus: 'SPI SCK / Sensor', notes: 'Safe output / SPI SCK / DS18B20 / DHT sensor' },
        { pin: 12, dPin: 'D6',  label: 'D6 (GPIO 12)',  safety: 'SAFE', bus: 'SPI MISO / Sensor', notes: 'Safe output / SPI MISO / Sensor input' },
        { pin: 13, dPin: 'D7',  label: 'D7 (GPIO 13)',  safety: 'SAFE', bus: 'SPI MOSI / Sensor', notes: 'Safe output / SPI MOSI / Sensor input' },
        { pin: 15, dPin: 'D8',  label: 'D8 (GPIO 15)',  safety: 'BOOT_SENSITIVE', bus: 'SPI SS', notes: 'Must be LOW on boot (requires external pull-down)' },
        { pin: 0,  dPin: 'D3',  label: 'D3 (GPIO 0)',   safety: 'BOOT_SENSITIVE', bus: 'FLASH PIN', notes: 'Flash button, must be HIGH on boot' },
        { pin: 2,  dPin: 'D4',  label: 'D4 (GPIO 2)',   safety: 'BOOT_SENSITIVE', bus: 'TXD1 / LED', notes: 'Internal LED, must be HIGH on boot' },
        { pin: 16, dPin: 'D0',  label: 'D0 (GPIO 16)',  safety: 'SPECIAL', bus: 'WAKE PIN', notes: 'Deep-sleep wake, HIGH on boot, no PWM' },
        { pin: 3,  dPin: 'RX',  label: 'RX (GPIO 3)',   safety: 'BOOT_SENSITIVE', bus: 'UART0 RX', notes: 'UART0 RX, serial debug input (usable as GPIO)' },
        { pin: 1,  dPin: 'TX',  label: 'TX (GPIO 1)',   safety: 'BOOT_SENSITIVE', bus: 'UART0 TX', notes: 'UART0 TX, serial debug output (HIGH at boot)' },
        { pin: 9,  dPin: 'SD2', label: 'SD2 (GPIO 9)',  safety: 'BOOT_SENSITIVE', bus: 'FLASH IO', notes: 'Flash IO SD2 (usable in DIO/DOUT flash mode)' },
        { pin: 10, dPin: 'SD3', label: 'SD3 (GPIO 10)', safety: 'BOOT_SENSITIVE', bus: 'FLASH IO', notes: 'Flash IO SD3 (usable in DIO/DOUT flash mode)' },
        { pin: 17, dPin: 'A0',  label: 'A0 (ADC0)',     safety: 'SENSOR_ONLY', bus: 'ANALOG IN', notes: 'Analog sensor input (0-1.0V / 0-3.3V on NodeMCU)' }
      ];
    }

    const relayByPin = new Map();
    for (const r of relays) {
      const p = Number(r.pin);
      if (!isNaN(p) && p >= 0) {
        relayByPin.set(p, r);
      }
    }

    const pins = basePins.map(bp => {
      const p = bp.pin;
      const pinObj = { ...bp };
      if (relayByPin.has(p)) {
        const r = relayByPin.get(p);
        pinObj.isRelay = true;
        pinObj.role = 'RELAY';
        pinObj.channelId = r.channel_id;
        pinObj.relayName = r.name;
        pinObj.room = r.room;
        pinObj.function = r.function;
        pinObj.state = Boolean(r.current_state);
        pinObj.activeLow = r.active_low !== false;
      } else {
        pinObj.isRelay = false;
        pinObj.role = bp.safety === 'SENSOR_ONLY' ? 'SENSOR' : (bp.safety === 'RESERVED' ? 'RESERVED_I2C' : 'FREE');
        pinObj.channelId = null;
        pinObj.relayName = null;
      }
      return pinObj;
    });

    return {
      nodeId,
      nodeName: node.name,
      hardware: node.hardware_type || (isEsp01Pcf ? 'ESP8266 ESP-01 + PCF8574T (1MB)' : (isEsp01 ? 'ESP8266 ESP-01 / ESP-01S (1MB)' : 'ESP8266 (ESP-12E/F) NodeMCU')),
      isPcf8574: isEsp01Pcf,
      pcf8574: expander,
      authMismatch: Boolean(this.nodeAuthMismatch.get(nodeId)),
      pins,
      relays,
      totalPins: pins.length,
      activeRelays: relays.length,
      freePins: pins.filter(p => p.role === 'FREE').length
    };
  }

  async syncAllOnlineNodesPins() {
    const nodes = this.db.getNodes();
    const results = {};
    for (const node of nodes) {
      if (node.ip_address) {
        try {
          results[node.node_id] = await this.syncNodePins(node.node_id);
        } catch (e) {
          results[node.node_id] = { success: false, error: e.message };
        }
      }
    }
    return results;
  }

  async pushNodeConfig(nodeId) {
    const node = this.db.getNode(nodeId);
    if (!node || !node.ip) {
      throw new Error(`Node '${nodeId}' not found or missing IP address`);
    }

    const relays = this.db.getRelays({ node_id: nodeId });
    const channelsPayload = relays.map(r => ({
      id: r.channel_id,
      pin: r.pin,
      name: r.name,
      room: r.room,
      function: r.function,
      activeLow: r.active_low,
      initialMode: r.initial_mode,
      enabled: r.enabled
    }));

    const os = require('node:os');
    let hostIp = '192.168.1.10';
    try {
      const ifaces = os.networkInterfaces();
      for (const [name, list] of Object.entries(ifaces)) {
        for (const item of list) {
          if (item.family === 'IPv4' && !item.internal && !name.toLowerCase().includes('virtual') && !item.address.startsWith('192.168.56.')) {
            hostIp = item.address;
            break;
          }
        }
      }
    } catch {}

    const receiverPayload = {
      enabled: true,
      server: `${hostIp}:${this.config.tcp_port || 2000}`
    };

    const user = node.auth_username || this.config.node_auth?.username || 'admin';
    const pass = node.auth_password || this.config.node_auth?.password || 'admin';
    const nodeIp = node.ip || node.ip_address;

    let token = this.nodeAuthTokens.get(nodeIp);
    if (!token) {
      token = await this.authenticateNode(nodeIp, user, pass);
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const results = {};

    try {
      const r1 = await fetch(`http://${node.ip}/api/gpio`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ channels: channelsPayload }),
        signal: AbortSignal.timeout(3000)
      });
      results.gpio = { status: r1.status, ok: r1.ok };
    } catch (e) {
      results.gpio = { error: e.message };
    }

    try {
      const r2 = await fetch(`http://${node.ip}/api/receiver`, {
        method: 'POST',
        headers,
        body: JSON.stringify(receiverPayload),
        signal: AbortSignal.timeout(3000)
      });
      results.receiver = { status: r2.status, ok: r2.ok };
    } catch (e) {
      results.receiver = { error: e.message };
    }

    this.db.logAudit('CONFIG_PUSHED', nodeId, `Pushed configuration to node '${node.name}' (${node.ip})`);
    return { success: true, results, pushedChannels: channelsPayload.length };
  }

  getFleetStats() {
    const nodes = this.db.getNodes();
    const totalNodes = nodes.length;
    const onlineNodes = nodes.filter(n => n.is_online).length;
    const relays = this.db.getRelays();
    const activeRelays = relays.filter(r => r.current_state).length;

    const uptimeSec = Math.floor(Date.now() / 1000 - this.serverStartEpoch);

    return {
      totalNodes,
      onlineNodes,
      offlineNodes: totalNodes - onlineNodes,
      totalChannels: relays.length,
      activeChannels: activeRelays,
      packetsReceived: this.packetsReceived,
      serverUptimeSec: uptimeSec
    };
  }

  getOverview() {
    const stats = this.getFleetStats();
    const notifs = this.db.getNotifications();
    const unread = notifs.filter(n => !n.read).length;

    return {
      nodes: {
        total: stats.totalNodes,
        online: stats.onlineNodes,
        offline: stats.offlineNodes
      },
      relays: {
        total: stats.totalChannels,
        on: stats.activeChannels,
        off: stats.totalChannels - stats.activeChannels
      },
      sensors: {
        total: 0
      },
      alerts: {
        unread
      },
      protocols: {
        tcp_server: {
          running: true,
          port: this.config.tcp_port || 2000
        },
        http_server: {
          running: true,
          port: this.config.http_port || 9100
        }
      },
      server: {
        version: '1.6.0',
        uptime_sec: stats.serverUptimeSec,
        platform: 'Node.js SmartHome Central Fleet Server'
      }
    };
  }
}

module.exports = NodeManager;
