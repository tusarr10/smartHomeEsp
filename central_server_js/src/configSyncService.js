const crypto = require('node:crypto');

class ConfigSyncService {
  constructor(database, nodeManager) {
    this.db = database;
    this.nodeManager = nodeManager;
  }

  // === 1. GET AUTHORITATIVE CONFIG ===
  async getDeviceConfig(nodeId) {
    let conf = this.db.getDeviceConfiguration(nodeId);
    if (!conf) {
      // Generate baseline config from current database node and relays
      const node = this.db.getNode(nodeId);
      if (!node) {
        throw new Error(`Node '${nodeId}' not found in registry`);
      }

      const baseline = {
        node_id: node.node_id,
        name: node.name,
        room: node.room || 'General',
        location: node.location || 'Home',
        device_group: node.device_group || 'DEFAULT',
        category: node.category || 'Controller',
        hardware_type: node.hardware_type || 'ESP8266',
        wifi: {
          ssid: node.wifi_ssid || '',
          static_ip: node.ip || ''
        },
        network: {
          central_server_ip: '',
          tcp_port: 2000,
          http_port: 9100,
          telemetry_interval_sec: 10
        },
        channels: ((node.relays && node.relays.length > 0 ? node.relays : node.channels) || []).map(ch => ({
          id: Number(ch.id ?? ch.channel_id ?? 1),
          pin: Number(ch.pin ?? 0),
          name: ch.name || `Channel ${ch.id ?? 1}`,
          room: ch.room || node.room || 'General',
          function: ch.function || 'Relay',
          active_low: ch.activeLow === false ? 0 : 1,
          initial_mode: Number(ch.initialMode ?? 0),
          enabled: ch.enabled === false ? 0 : 1
        }))
      };

      this.db.saveDeviceConfiguration(nodeId, baseline, null, 'Initial baseline snapshot');
      this.db.updateDeviceConfigSyncStatus(nodeId, 'SYNCED');
      conf = this.db.getDeviceConfiguration(nodeId);
    }

    return conf;
  }

  // === 2. UPDATE AUTHORITATIVE CONFIG ===
  async updateDeviceConfig(nodeId, newConfig, userId = null, changeSummary = 'Config update') {
    if (!newConfig || typeof newConfig !== 'object') {
      throw new Error('Valid configuration object is required');
    }

    const node = this.db.getNode(nodeId);
    if (!node) {
      throw new Error(`Node '${nodeId}' not found`);
    }

    // Save authoritative configuration in DB (sets status = 'PENDING')
    const saved = this.db.saveDeviceConfiguration(nodeId, newConfig, userId, changeSummary);

    // If device properties changed (name, room, group), update nodes table
    if (newConfig.name && newConfig.name !== node.name) {
      this.db.renameNode(nodeId, newConfig.name);
    }

    this.nodeManager.broadcast('config_updated', {
      node_id: nodeId,
      version: saved.config_version,
      sync_status: 'PENDING'
    });

    // Attempt immediate push if node is online
    const syncRes = await this.syncDeviceConfig(nodeId, userId).catch(err => ({
      success: false,
      error: err.message
    }));

    return {
      success: true,
      configuration: this.db.getDeviceConfiguration(nodeId),
      syncResult: syncRes
    };
  }

  // === 3. PUSH CONFIG TO NODE ===
  async syncDeviceConfig(nodeId, userId = null) {
    const node = this.db.getNode(nodeId);
    if (!node) {
      throw new Error(`Node '${nodeId}' not found`);
    }

    const conf = this.db.getDeviceConfiguration(nodeId);
    if (!conf) {
      throw new Error(`No authoritative configuration found for node '${nodeId}'`);
    }

    const ip = node.ip || node.ip_address;
    if (!node.is_online || !ip) {
      this.db.updateDeviceConfigSyncStatus(nodeId, 'OFFLINE');
      // Queue command for next check-in
      this.db.createCommand({
        node_id: nodeId,
        user_id: userId,
        command_type: 'CONFIG_SYNC',
        payload: {
          action: 'syncConfig',
          version: conf.config_version,
          checksum: conf.sha256_checksum,
          config: conf.config
        }
      });
      return {
        success: true,
        status: 'OFFLINE',
        message: 'Node is currently offline; configuration sync command queued for next check-in'
      };
    }

    this.db.updateDeviceConfigSyncStatus(nodeId, 'SYNCING');

    const user = node.auth_username || this.nodeManager?.config?.node_auth?.username || 'admin';
    const pass = node.auth_password || this.nodeManager?.config?.node_auth?.password || 'admin';
    const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      // 1. Try unified commands execute endpoint
      const res = await fetch(`http://${ip}/api/commands/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify({
          action: 'syncConfig',
          command_uuid: crypto.randomUUID(),
          version: conf.config_version,
          checksum: conf.sha256_checksum,
          config: conf.config
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.ok) {
        const ackData = await res.json().catch(() => ({}));
        this.db.updateDeviceConfigSyncStatus(nodeId, 'SYNCED');
        this.db.logAudit('CONFIG_SYNCED', nodeId, `Configuration v${conf.config_version} successfully pushed and acknowledged by node`);

        this.nodeManager.broadcast('config_synced', {
          node_id: nodeId,
          version: conf.config_version,
          sync_status: 'SYNCED',
          ack: ackData
        });

        return {
          success: true,
          status: 'SYNCED',
          version: conf.config_version,
          message: 'Configuration successfully synchronized with microcontroller',
          ack: ackData
        };
      }

      // 2. If node returned 400 or 404 (e.g. ESP-01 where syncConfig action is not mapped), fallback to pushNodeConfig
      if (res.status === 400 || res.status === 404) {
        if (this.nodeManager?.pushNodeConfig) {
          const pushRes = await this.nodeManager.pushNodeConfig(nodeId);
          if (pushRes && pushRes.success) {
            this.db.updateDeviceConfigSyncStatus(nodeId, 'SYNCED');
            this.db.logAudit('CONFIG_SYNCED', nodeId, `Configuration v${conf.config_version} synchronized via GPIO/Receiver fallback`);

            this.nodeManager.broadcast('config_synced', {
              node_id: nodeId,
              version: conf.config_version,
              sync_status: 'SYNCED',
              ack: pushRes
            });

            return {
              success: true,
              status: 'SYNCED',
              version: conf.config_version,
              message: 'Configuration synchronized via direct GPIO/Receiver channels',
              ack: pushRes
            };
          }
        }
      }

      throw new Error(`Node HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      clearTimeout(timeout);

      // Attempt second fallback to pushNodeConfig if fetch threw
      if (this.nodeManager?.pushNodeConfig) {
        try {
          const pushRes = await this.nodeManager.pushNodeConfig(nodeId);
          if (pushRes && pushRes.success) {
            this.db.updateDeviceConfigSyncStatus(nodeId, 'SYNCED');
            this.db.logAudit('CONFIG_SYNCED', nodeId, `Configuration v${conf.config_version} recovered via GPIO push fallback`);
            this.nodeManager.broadcast('config_synced', {
              node_id: nodeId,
              version: conf.config_version,
              sync_status: 'SYNCED',
              ack: pushRes
            });
            return {
              success: true,
              status: 'SYNCED',
              version: conf.config_version,
              message: 'Configuration synchronized via GPIO push fallback',
              ack: pushRes
            };
          }
        } catch {}
      }

      this.db.updateDeviceConfigSyncStatus(nodeId, 'FAILED');
      this.db.logSystemEvent(nodeId, 'CONFIG_SYNC', 'ERROR', `Sync failed: ${err.message}`);

      // Queue command fallback
      this.db.createCommand({
        node_id: nodeId,
        user_id: userId,
        command_type: 'CONFIG_SYNC',
        payload: {
          action: 'syncConfig',
          version: conf.config_version,
          checksum: conf.sha256_checksum,
          config: conf.config
        }
      });

      return {
        success: false,
        status: 'FAILED',
        error: `LAN HTTP sync attempt failed: ${err.message}. Queued for subsequent heartbeat sync.`
      };
    }
  }

  // === 4. VERSION HISTORY & ROLLBACK ===
  getConfigurationVersions(nodeId) {
    return this.db.getConfigurationVersions(nodeId);
  }

  async rollbackDeviceConfig(nodeId, targetVersion, userId = null) {
    const rolled = this.db.rollbackConfiguration(nodeId, targetVersion, userId);
    this.db.logAudit('CONFIG_ROLLBACK', nodeId, `Rolled back configuration to v${targetVersion} (New v${rolled.config_version})`);

    // Sync immediately
    const syncRes = await this.syncDeviceConfig(nodeId, userId).catch(e => ({ success: false, error: e.message }));

    return {
      success: true,
      rolledBackTo: targetVersion,
      currentVersion: rolled.config_version,
      configuration: this.db.getDeviceConfiguration(nodeId),
      syncResult: syncRes
    };
  }
}

module.exports = ConfigSyncService;
