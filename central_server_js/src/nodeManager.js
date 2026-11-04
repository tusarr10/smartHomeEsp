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

    // Concurrently fetch GPIO channels and status diagnostics
    const [gpioRes, statusRes] = await Promise.allSettled([
      fetch(`http://${ip}/api/gpio`, { signal: AbortSignal.timeout(2500) }).then(r => r.json()),
      fetch(`http://${ip}/api/status`, { signal: AbortSignal.timeout(2500) }).then(r => r.json())
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
      name: statusData.deviceName || node.name || nodeId,
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
        this.db.logAudit(change.newState ? 'PIN_ON' : 'PIN_OFF', nodeId, `Channel ${change.channelId} ('${change.name}', Pin D${change.pin}) switched ${stateStr} on node '${nodeName}' (Hardware sync)`);
        this.broadcastNotification(
          `Pin Switched ${stateStr}`,
          `'${change.name}' (Pin D${change.pin}, Ch ${change.channelId}) on '${nodeName}' switched ${stateStr}.`,
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

    // Ingest LittleFS / Flash metrics if present
    if (data.littlefs_total || data.fs_total || data.flash_size || data.flashSize) {
      const fsTotal = Number(data.littlefs_total || data.fs_total) || 0;
      const fsUsed = Number(data.littlefs_used || data.fs_used) || 0;
      const fsFree = Number(data.littlefs_free || data.fs_free) || (fsTotal - fsUsed);
      this.db.upsertDeviceCapabilities(nodeId, {
        littlefs_total_bytes: fsTotal,
        littlefs_used_bytes: fsUsed,
        littlefs_free_bytes: fsFree,
        flash_size_bytes: Number(data.flash_size || data.flashSize) || 4194304,
        ram_size_bytes: Number(data.freeHeap || data.free_heap) || 81920,
        mcu_type: data.hardware || data.hardware_type || 'ESP8266'
      });
    }

    // Live telemetry update broadcast
    this.broadcast('telemetry_update', {
      node_id: nodeId,
      nodeId: nodeId,
      name: nodeName,
      ip: data.ip,
      rssi: data.rssi,
      uptime_sec: data.uptimeSec || data.uptime_sec,
      free_heap: data.freeHeap || data.free_heap,
      channels: data.channels || [],
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
      const res = await this.sendDirectLanHttp(ip, command);
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
        this.db.logAudit(nextState ? 'PIN_ON' : 'PIN_OFF', nodeId, `Channel ${channelId} ('${relay.name}', Pin D${relay.pin}) turned ${stateStr} on node '${node.name}' via Central Server`);
        this.broadcastNotification(
          `Pin Switched ${stateStr}`,
          `'${relay.name}' (Pin D${relay.pin}, Ch ${channelId}) on '${node.name}' turned ${stateStr}.`,
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
        this.db.logAudit(nextState ? 'PIN_ON' : 'PIN_OFF', nodeId, `Channel ${channelId} ('${relay.name}', Pin D${relay.pin}) toggled to ${stateStr} on node '${node.name}' via Central Server`);
        this.broadcastNotification(
          `Pin Switched ${stateStr}`,
          `'${relay.name}' (Pin D${relay.pin}, Ch ${channelId}) on '${node.name}' toggled to ${stateStr}.`,
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

  async sendDirectLanHttp(ip, command) {
    const timeoutMs = this.config.direct_http_timeout_ms || 2500;

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

  async authenticateNode(ip) {
    const creds = this.config.node_auth || { username: 'admin', password: 'admin' };
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
    if (!node || !node.ip) {
      throw new Error(`Node '${nodeId}' not found or has no IP address`);
    }

    const ip = node.ip;
    return new Promise((resolve, reject) => {
      const req = http.get(`http://${ip}/api/gpio`, { timeout: 3500 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const channels = JSON.parse(body);
              if (Array.isArray(channels)) {
                const count = this.db.syncNodeRelays(nodeId, channels);
                this.db.touchNode(nodeId);
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
    });
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
