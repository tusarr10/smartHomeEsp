const http = require('node:http');

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
            status: 'Offline'
          });
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

    // Persist to database
    this.db.upsertNode(data);
    const eventType = data.eventType || 'heartbeat';
    this.db.logTelemetry(nodeId, eventType, data);

    const nodeName = data.nodeName || data.name || nodeId;

    if (!wasOnline) {
      this.db.logAudit('NODE_ONLINE', nodeId, `Node '${nodeName}' (${data.ip}) connected via ${protocol}`);
      this.db.logSystemEvent(nodeId, protocol, 'INFO', `Node '${nodeName}' came ONLINE via ${protocol}`);
      this.broadcast('node_status', {
        node_id: nodeId,
        nodeId: nodeId,
        is_online: true,
        isOnline: true,
        status: 'Online'
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

    // Check if commands are queued for this node
    const pending = this.commandQueues.get(nodeId) || [];
    this.commandQueues.delete(nodeId);
    return pending;
  }

  // === COMMAND DISPATCH ===

  async dispatchCommand(nodeId, command) {
    const node = this.db.getNode(nodeId);
    if (!node) {
      return { success: false, error: `Node '${nodeId}' not found in fleet` };
    }

    const ip = node.ip || node.ip_address;
    const action = command.action || 'setState';
    const channelId = Number(command.id ?? command.gpioId ?? command.channel_id ?? 0);

    this.db.logAudit('COMMAND_SENT', nodeId, `Dispatched command '${action}' for channel ${channelId}`);

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
      } else if (action === 'toggle') {
        const curr = this.db.getRelay(nodeId, channelId);
        const nextState = curr ? !curr.current_state : true;
        this.db.updateRelayState(nodeId, channelId, nextState);
        this.db.logRelayEvent(nodeId, channelId, !nextState, nextState, 'LAN_DIRECT_TOGGLE');
      }

      this.broadcast('command_executed', {
        node_id: nodeId,
        nodeId: nodeId,
        channel_id: channelId,
        command,
        delivery: 'direct_lan_http'
      });

      return {
        success: true,
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

    // Standard GPIO State Command
    let token = this.nodeAuthTokens.get(ip);
    let res = await makeRequest('/api/gpio/state', command, token);

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
