const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');

class NodeStore extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.dataDir = path.resolve(__dirname, '..', config.storage?.data_dir || './data');
    this.stateFile = path.join(this.dataDir, 'state.json');
    this.automationsFile = path.join(this.dataDir, 'automations.json');

    this.nodes = new Map(); // nodeId -> node object
    this.commandQueues = new Map(); // nodeId -> [commandObj]
    this.automations = [];
    this.offlineTimer = null;
    this.saveTimer = null;
    this.isDirty = false;

    this.initStorage();
    this.loadState();
    this.startOfflineWatcher();
  }

  initStorage() {
    if (!fs.existsSync(this.dataDir)) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
      } catch (err) {
        console.error('[NodeStore] Failed to create data directory:', err.message);
      }
    }
  }

  loadState() {
    // 1. Load Nodes State
    if (fs.existsSync(this.stateFile)) {
      try {
        const raw = fs.readFileSync(this.stateFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.nodes)) {
          for (const n of parsed.nodes) {
            if (n && n.nodeId) {
              // Reset is_online on server boot until next heartbeat
              n.is_online = false;
              this.nodes.set(n.nodeId, n);
            }
          }
        }
        console.log(`[NodeStore] Restored ${this.nodes.size} nodes from ${this.stateFile}`);
      } catch (err) {
        console.warn('[NodeStore] Could not load state.json:', err.message);
      }
    }

    // 2. Load Automations
    if (fs.existsSync(this.automationsFile)) {
      try {
        const raw = fs.readFileSync(this.automationsFile, 'utf-8');
        this.automations = JSON.parse(raw);
        console.log(`[NodeStore] Loaded ${this.automations.length} automation rules`);
      } catch (err) {
        this.automations = [];
      }
    } else {
      this.automations = this.getDefaultAutomations();
      this.saveAutomations();
    }
  }

  getDefaultAutomations() {
    return [
      {
        id: 'rule-sample-1',
        name: 'Auto Cutoff on High Temp',
        enabled: true,
        trigger: {
          type: 'SENSOR_THRESHOLD',
          sensorType: 'TEMPERATURE',
          operator: '>',
          value: 75
        },
        action: {
          type: 'SET_CHANNEL',
          nodeId: 'NODE-30487DE85D5C',
          channelId: 1,
          value: 0
        },
        lastTriggered: null
      }
    ];
  }

  scheduleSave() {
    if (this.isDirty) return;
    this.isDirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);

    // Debounce save to avoid SD-card / flash wear on MTK routers
    this.saveTimer = setTimeout(() => {
      this.saveState();
      this.isDirty = false;
    }, 2000);
  }

  saveState() {
    try {
      const payload = {
        updatedAt: new Date().toISOString(),
        nodes: Array.from(this.nodes.values())
      };
      const tmpFile = `${this.stateFile}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tmpFile, this.stateFile);
    } catch (err) {
      console.error('[NodeStore] Failed to write state.json:', err.message);
    }
  }

  saveAutomations() {
    try {
      const tmpFile = `${this.automationsFile}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.automations, null, 2), 'utf-8');
      fs.renameSync(tmpFile, this.automationsFile);
      this.emit('automations_updated', this.automations);
    } catch (err) {
      console.error('[NodeStore] Failed to write automations.json:', err.message);
    }
  }

  // === TELEMETRY PROCESSING ===
  processTelemetry(data, clientIp = '', protocol = 'TCP') {
    const nodeId = data.nodeId || data.node_id;
    if (!nodeId) return [];

    const nowEpoch = Math.floor(Date.now() / 1000);
    const existing = this.nodes.get(nodeId) || {};
    const wasOnline = Boolean(existing.is_online);

    // Update node record
    const updatedNode = {
      ...existing,
      nodeId,
      name: data.nodeName || data.name || existing.name || nodeId,
      ip: clientIp || data.ip || existing.ip || '127.0.0.1',
      mac: data.mac || existing.mac || '',
      rssi: typeof data.rssi === 'number' ? data.rssi : existing.rssi || 0,
      uptimeSec: Number(data.uptimeSec || data.uptime_sec || existing.uptimeSec || 0),
      freeHeap: Number(data.freeHeap || existing.freeHeap || 0),
      firmwareVersion: data.firmwareVersion || existing.firmwareVersion || '1.0.0',
      is_online: true,
      protocol: protocol,
      last_seen: nowEpoch,
      channels: existing.channels || [],
      sensors: existing.sensors || []
    };

    // Update channels if provided
    if (Array.isArray(data.channels)) {
      const stateChanges = [];
      const mergedChannels = data.channels.map((ch, idx) => {
        const chId = ch.channelId !== undefined ? ch.channelId : (ch.id !== undefined ? ch.id : idx + 1);
        const oldCh = (existing.channels || []).find(c => (c.channelId === chId || c.id === chId));
        const newState = Boolean(ch.state);

        if (oldCh && Boolean(oldCh.state) !== newState) {
          stateChanges.push({
            channelId: chId,
            name: ch.name || oldCh.name || `Channel ${chId}`,
            pin: ch.pin || oldCh.pin,
            state: newState
          });
        }

        return {
          channelId: chId,
          id: chId,
          name: ch.name || oldCh?.name || `Channel ${chId}`,
          pin: ch.pin !== undefined ? ch.pin : oldCh?.pin,
          state: newState,
          room: ch.room || oldCh?.room || 'General',
          function: ch.function || oldCh?.function || 'Switch'
        };
      });

      updatedNode.channels = mergedChannels;

      if (stateChanges.length > 0) {
        for (const change of stateChanges) {
          this.emit('channel_changed', {
            nodeId,
            channelId: change.channelId,
            name: change.name,
            state: change.state
          });
        }
      }
    }

    // Update sensors if provided in telemetry
    if (Array.isArray(data.sensors)) {
      updatedNode.sensors = data.sensors;
      this.emit('sensors_updated', { nodeId, sensors: data.sensors });
    }

    this.nodes.set(nodeId, updatedNode);
    this.scheduleSave();

    if (!wasOnline) {
      console.log(`[NodeStore] Node '${updatedNode.name}' (${nodeId}) is now ONLINE via ${protocol}`);
      this.emit('node_status', {
        nodeId,
        is_online: true,
        ip: updatedNode.ip,
        name: updatedNode.name
      });
    }

    // Process ACKs for queued commands
    if (Array.isArray(data.acks)) {
      for (const ack of data.acks) {
        const cmdUuid = ack.command_uuid || ack.commandId;
        this.emit('command_ack', { nodeId, cmdUuid, success: ack.success });
      }
    }

    // Return any pending commands for this node
    const queue = this.commandQueues.get(nodeId) || [];
    if (queue.length > 0) {
      this.commandQueues.delete(nodeId);
      return queue;
    }

    return [];
  }

  // Queue a command for the node
  queueCommand(nodeId, command) {
    if (!this.commandQueues.has(nodeId)) {
      this.commandQueues.set(nodeId, []);
    }
    const queue = this.commandQueues.get(nodeId);
    queue.push(command);

    // Limit queue size to 20 to avoid memory buildup
    if (queue.length > 20) queue.shift();

    console.log(`[NodeStore] Queued command for ${nodeId}:`, command);
  }

  // Offline watcher for nodes
  startOfflineWatcher() {
    const timeoutSec = this.config.node_timeout_sec || 35;
    this.offlineTimer = setInterval(() => {
      const nowEpoch = Math.floor(Date.now() / 1000);
      for (const [nodeId, node] of this.nodes.entries()) {
        if (!node.is_online) continue;
        if (nowEpoch - (node.last_seen || 0) > timeoutSec) {
          node.is_online = false;
          console.log(`[NodeStore] Node '${node.name}' (${nodeId}) timed out -> OFFLINE`);
          this.emit('node_status', {
            nodeId,
            is_online: false,
            name: node.name
          });
          this.scheduleSave();
        }
      }
    }, 5000);
  }

  getNodes() {
    return Array.from(this.nodes.values());
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId) || null;
  }

  setChannelState(nodeId, channelId, state) {
    const node = this.nodes.get(nodeId);
    if (!node) return { success: false, error: 'Node not found' };

    const ch = (node.channels || []).find(c => (c.channelId == channelId || c.id == channelId));
    if (ch) {
      ch.state = Boolean(state);
      this.scheduleSave();
      this.emit('channel_changed', {
        nodeId,
        channelId: Number(channelId),
        name: ch.name,
        state: Boolean(state)
      });
    }

    // Prepare standard command payload compatible with app2 firmware
    const cmdUuid = 'cmd_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const commandObj = {
      command_uuid: cmdUuid,
      action: 'SET_STATE',
      channelId: Number(channelId),
      value: state ? 1 : 0
    };

    this.queueCommand(nodeId, commandObj);
    return { success: true, command: commandObj };
  }

  // === AUTOMATIONS API ===
  getAutomations() {
    return this.automations;
  }

  addAutomation(rule) {
    const newRule = {
      id: 'rule_' + Date.now(),
      name: rule.name || 'Custom Rule',
      enabled: rule.enabled !== false,
      trigger: rule.trigger || {},
      action: rule.action || {},
      lastTriggered: null,
      createdAt: new Date().toISOString()
    };
    this.automations.push(newRule);
    this.saveAutomations();
    return newRule;
  }

  updateAutomation(id, updates) {
    const idx = this.automations.findIndex(a => a.id === id);
    if (idx === -1) return null;
    this.automations[idx] = { ...this.automations[idx], ...updates };
    this.saveAutomations();
    return this.automations[idx];
  }

  deleteAutomation(id) {
    const initialLen = this.automations.length;
    this.automations = this.automations.filter(a => a.id !== id);
    if (this.automations.length !== initialLen) {
      this.saveAutomations();
      return true;
    }
    return false;
  }
}

module.exports = NodeStore;
