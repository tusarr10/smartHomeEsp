const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const multer = require('multer');

function createV1Router(nodeManager, db) {
  const router = express.Router();
  const OtaService = require('../otaService');
  const otaService = new OtaService(db, nodeManager);

  // Configure Multer for Firmware Uploads
  const firmwareDir = path.join(__dirname, '..', '..', 'data', 'firmware');
  if (!fs.existsSync(firmwareDir)) {
    fs.mkdirSync(firmwareDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, firmwareDir),
    filename: (req, file, cb) => {
      const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${sanitized}`);
    }
  });
  const upload = multer({ storage });

  // === SYSTEM OVERVIEW ===
  router.get('/system/overview', (req, res) => {
    res.json(nodeManager.getOverview());
  });

  // === NODES ===
  router.get('/nodes', (req, res) => {
    const { room, status, hardware, search } = req.query;
    const nodes = db.getNodes({ room, status, hardware, search });
    res.json(nodes);
  });

  // Add / Register Node (via IP or manual probe)
  const addNodeHandler = async (req, res) => {
    const ip = (req.body.ip || req.body.ip_address || '').trim();
    const name = (req.body.name || req.body.node_name || '').trim();
    const room = req.body.room || 'General';

    if (!ip) {
      return res.status(400).json({ success: false, error: 'IP address is required to probe and add a node' });
    }

    // Helper: probe node REST API on LAN
    const probeNode = () => new Promise((resolve) => {
      const clientReq = http.get(`http://${ip}/api/status`, { timeout: 3000 }, (targetRes) => {
        let raw = '';
        targetRes.on('data', chunk => raw += chunk);
        targetRes.on('end', () => {
          try {
            resolve({ ok: true, data: JSON.parse(raw) });
          } catch (e) {
            resolve({ ok: false, error: 'Invalid JSON response from node' });
          }
        });
      });
      clientReq.on('error', (err) => resolve({ ok: false, error: err.message }));
      clientReq.on('timeout', () => {
        clientReq.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      });
    });

    const probeGpios = () => new Promise((resolve) => {
      const clientReq = http.get(`http://${ip}/api/gpio`, { timeout: 3000 }, (targetRes) => {
        let raw = '';
        targetRes.on('data', chunk => raw += chunk);
        targetRes.on('end', () => {
          try {
            resolve({ ok: true, data: JSON.parse(raw) });
          } catch {
            resolve({ ok: false, data: [] });
          }
        });
      });
      clientReq.on('error', () => resolve({ ok: false, data: [] }));
      clientReq.on('timeout', () => { clientReq.destroy(); resolve({ ok: false, data: [] }); });
    });

    const probe = await probeNode();
    const gpios = await probeGpios();

    let nodeId = `NODE-${ip.replace(/\./g, '')}`;
    let nodeName = name || `SmartHome-${ip}`;
    let hw = 'ESP8266';
    let fw = '1.6.0';
    let mac = '';
    let rssi = 0;
    let uptime = 0;
    let heap = 0;
    let channels = Array.isArray(gpios.data) ? gpios.data : [];

    if (probe.ok && probe.data) {
      const d = probe.data;
      if (d.mac) {
        mac = d.mac;
        nodeId = `NODE-${d.mac.replace(/:/g, '')}`;
      }
      if (d.deviceName && !name) nodeName = d.deviceName;
      if (d.hardware) hw = d.hardware;
      if (d.firmwareVersion) fw = d.firmwareVersion;
      if (d.rssi) rssi = d.rssi;
      if (d.uptimeSec) uptime = d.uptimeSec;
      if (d.freeHeap) heap = d.freeHeap;
    }

    const nodePayload = {
      nodeId,
      nodeName,
      hardware: hw,
      firmwareVersion: fw,
      ip,
      mac,
      rssi,
      uptimeSec: uptime,
      freeHeap: heap,
      room,
      channels
    };

    await nodeManager.processTelemetry(nodePayload, ip, 'MANUAL_ADD');
    db.logAudit('NODE_ADDED', nodeId, `Manually registered node '${nodeName}' (${ip}) into fleet`);
    nodeManager.broadcast('node_added', { nodeId, name: nodeName, ip });

    res.json({
      success: true,
      message: `Node '${nodeName}' successfully registered and probed!`,
      node: db.getNode(nodeId)
    });
  };

  router.post('/nodes', addNodeHandler);
  router.post('/nodes/add', addNodeHandler);

  router.get('/nodes/:nodeId', (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    const history = db.getTelemetryHistory(req.params.nodeId, 20);
    res.json({ node, history });
  });

  router.delete('/nodes/:nodeId', (req, res) => {
    const ok = db.deleteNode(req.params.nodeId);
    if (ok) {
      nodeManager.broadcast('node_deleted', { nodeId: req.params.nodeId });
      res.json({ success: true, nodeId: req.params.nodeId });
    } else {
      res.status(404).json({ success: false, error: 'Node not found' });
    }
  });

  router.post('/nodes/:nodeId/restart', async (req, res) => {
    const result = await nodeManager.dispatchCommand(req.params.nodeId, { action: 'reboot' });
    res.json(result);
  });

  // === RELAYS ===
  router.get('/relays', (req, res) => {
    const { room, node_id, state } = req.query;
    const filters = {};
    if (room) filters.room = room;
    if (node_id) filters.node_id = node_id;
    if (state !== undefined) filters.state = state === 'true' || state === '1';

    const relays = db.getRelays(filters);
    res.json(relays);
  });

  // Reconcile and synchronize pins directly with all online nodes
  router.post('/relays/sync', async (req, res) => {
    try {
      const results = await nodeManager.syncAllOnlineNodesPins();
      const updatedRelays = db.getRelays();
      res.json({
        success: true,
        message: 'Synchronized hardware GPIO pins with nodes',
        totalRelays: updatedRelays.length,
        results,
        relays: updatedRelays
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Synchronize pins for a specific node
  router.post('/nodes/:nodeId/sync-pins', async (req, res) => {
    try {
      const result = await nodeManager.syncNodePins(req.params.nodeId);
      const updatedRelays = db.getRelays({ node_id: req.params.nodeId });
      res.json({
        success: true,
        message: `Synchronized ${result.count} pins from node ${req.params.nodeId}`,
        nodeId: req.params.nodeId,
        count: result.count,
        relays: updatedRelays
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/relays/:nodeId/:channelId/command', async (req, res) => {
    const { nodeId, channelId } = req.params;
    const action = req.body.action || 'setState';
    const state = Boolean(req.body.state);
    const duration = Number(req.body.duration) || 500;

    const cmd = {
      id: Number(channelId),
      gpioId: Number(channelId),
      action,
      state,
      duration
    };

    const result = await nodeManager.dispatchCommand(nodeId, cmd);
    res.json(result);
  });

  router.post('/relays/broadcast', async (req, res) => {
    const action = req.body.action || 'setState';
    const targetState = Boolean(req.body.state);
    const targetRoom = req.body.room;

    const result = await nodeManager.broadcastCommand({ action, state: targetState }, targetRoom);
    res.json(result);
  });

  router.get('/relays/:nodeId/:channelId/history', (req, res) => {
    const { nodeId, channelId } = req.params;
    const limit = Number(req.query.limit) || 50;
    const history = db.getRelayHistory(nodeId, channelId, limit);
    res.json(history);
  });

  // === SENSORS ===
  router.get('/sensors', (req, res) => {
    const sensors = db.getSensors();
    res.json(sensors);
  });

  // === AUTOMATIONS ===
  router.get('/automations', (req, res) => {
    const automations = db.getAutomations();
    res.json(automations);
  });

  router.post('/automations', (req, res) => {
    try {
      const id = db.addAutomation(req.body);
      db.logAudit('AUTO_RULE_ADD', 'System', `Created automation rule: ${req.body.name}`);
      res.json({ success: true, id, message: 'Automation rule created' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/automations/:id/toggle', (req, res) => {
    const nextState = db.toggleAutomation(req.params.id);
    db.logAudit('AUTO_RULE_TOGGLE', 'System', `Automation rule #${req.params.id} enabled: ${nextState}`);
    res.json({ success: true, enabled: nextState });
  });

  router.delete('/automations/:id', (req, res) => {
    const ok = db.deleteAutomation(req.params.id);
    res.json({ success: ok });
  });

  // === FIRMWARE & LONG-TERM SUPPORT (LTS) OTA ===
  router.get('/firmware', (req, res) => {
    const list = db.getFirmwareList();
    res.json(list);
  });

  router.post('/firmware/upload', upload.single('firmware'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No firmware file uploaded' });
    }

    try {
      const fileBuffer = fs.readFileSync(req.file.path);
      const hashMd5 = crypto.createHash('md5').update(fileBuffer).digest('hex');
      const hashSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const version = req.body.version || '1.6.0';
      const hardware = req.body.hardware_type || 'ESP8266';
      const releaseChannel = req.body.release_channel || 'LTS';
      const notes = req.body.notes || '';

      const id = db.addFirmwareRecord({
        filename: req.file.originalname,
        version,
        hardware_type: hardware,
        release_channel: releaseChannel,
        notes,
        file_size_bytes: req.file.size,
        checksum_md5: hashMd5,
        checksum_sha256: hashSha256,
        file_path: req.file.path
      });

      db.logAudit('FIRMWARE_UPLOAD', 'System', `Uploaded firmware '${req.file.originalname}' v${version} [${releaseChannel}] (${req.file.size} bytes)`);

      res.json({
        success: true,
        id,
        filename: req.file.originalname,
        version,
        release_channel: releaseChannel,
        checksum_md5: hashMd5,
        checksum_sha256: hashSha256,
        message: 'Firmware uploaded and registered in LTS catalog'
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete('/firmware/:id', (req, res) => {
    const id = Number(req.params.id);
    const fw = db.getFirmware(id);
    if (!fw) return res.status(404).json({ success: false, error: 'Firmware not found' });

    try {
      if (fs.existsSync(fw.file_path)) {
        fs.unlinkSync(fw.file_path);
      }
    } catch {}

    db.deleteFirmware(id);
    db.logAudit('FIRMWARE_DELETED', 'System', `Deleted firmware '${fw.filename}' v${fw.version}`);
    res.json({ success: true, message: 'Firmware removed from catalog' });
  });

  // 1. Fetch live diagnostic data from node before OTA
  router.get('/ota/node-diagnostics/:nodeId', async (req, res) => {
    try {
      const diag = await otaService.fetchNodeDiagnostics(req.params.nodeId);
      res.json(diag);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Pre-Check & Version Compatibility Validation
  router.post('/ota/pre-check', async (req, res) => {
    const { nodeId, firmwareId } = req.body;
    if (!nodeId || !firmwareId) {
      return res.status(400).json({ success: false, error: 'nodeId and firmwareId are required' });
    }
    try {
      const result = await otaService.preCheckOta(nodeId, firmwareId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Create Node Configuration & State Backup
  router.post('/ota/backup/:nodeId', async (req, res) => {
    try {
      const backupType = req.body.backupType || 'MANUAL';
      const result = await otaService.backupNode(req.params.nodeId, backupType);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // List all backups
  router.get('/ota/backups', (req, res) => {
    const list = db.getNodeBackups(req.query.nodeId);
    res.json(list);
  });

  // Download backup JSON file
  router.get('/ota/backups/:id/download', (req, res) => {
    const b = db.getNodeBackup(req.params.id);
    if (!b || !fs.existsSync(b.backup_path)) {
      return res.status(404).json({ success: false, error: 'Backup archive file not found' });
    }
    res.download(b.backup_path, path.basename(b.backup_path));
  });

  // Delete backup
  router.delete('/ota/backups/:id', (req, res) => {
    const b = db.getNodeBackup(req.params.id);
    if (!b) return res.status(404).json({ success: false, error: 'Backup not found' });
    try {
      if (fs.existsSync(b.backup_path)) fs.unlinkSync(b.backup_path);
    } catch {}
    db.deleteNodeBackup(b.id);
    res.json({ success: true, message: 'Backup deleted' });
  });

  // Restore node configuration from backup
  router.post('/ota/backups/:id/restore/:nodeId', async (req, res) => {
    try {
      const result = await otaService.restoreNodeConfig(req.params.nodeId, req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Managed End-to-End OTA Deployment Pipeline
  router.post('/ota/deploy', async (req, res) => {
    const { nodeId, firmwareId, options } = req.body;
    if (!nodeId || !firmwareId) {
      return res.status(400).json({ success: false, error: 'nodeId and firmwareId are required' });
    }
    try {
      const result = await otaService.deployOta(nodeId, firmwareId, options || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. OTA Deployment History Log
  router.get('/ota/history', (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const history = db.getOtaHistory(limit);
    res.json(history);
  });

  // Legacy Flash Route adapter
  router.post('/firmware/:id/flash/:nodeId', async (req, res) => {
    const { id, nodeId } = req.params;
    try {
      const result = await otaService.deployOta(nodeId, id, { autoBackup: true, postVerify: true });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // === TELEMETRY STREAM & HISTORY ===
  router.get('/telemetry', (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const records = db.getRecentTelemetry(limit);
    res.json(records);
  });

  // === SYSTEM EVENTS & LOGS ===
  router.get('/system/events', (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json(db.getSystemEvents(limit));
  });

  router.get('/system/notifications', (req, res) => {
    const limit = Number(req.query.limit) || 60;
    res.json(db.getNotifications(limit));
  });

  router.get('/system/notifications/unread-count', (req, res) => {
    res.json({ unreadCount: db.getUnreadNotificationCount() });
  });

  router.post('/system/notifications/mark-read', (req, res) => {
    db.markNotificationsRead();
    res.json({ success: true, message: 'All notifications marked as read' });
  });

  router.delete('/system/notifications/:id', (req, res) => {
    db.deleteNotification(req.params.id);
    res.json({ success: true, message: 'Notification removed' });
  });

  router.delete('/system/notifications', (req, res) => {
    db.clearAllNotifications();
    res.json({ success: true, message: 'All notifications cleared' });
  });

  router.get('/system/logs', (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const category = req.query.category || null;
    const logs = db.getAuditLogs(limit, category);
    res.json(logs);
  });

  // === HEALTH & PIN STATUS AUTO-SYNC POLLER ===
  router.get('/system/poll-settings', (req, res) => {
    res.json(nodeManager.getPollSettings());
  });

  router.post('/system/poll-settings', async (req, res) => {
    const { intervalSec, enabled } = req.body;
    const settings = await nodeManager.setPollInterval(intervalSec, enabled);
    res.json({ success: true, settings });
  });

  router.post('/system/poll-now', async (req, res) => {
    await nodeManager.pollAllNodesStatusAndPins();
    res.json({
      success: true,
      message: 'Active pin and status polling cycle executed across fleet',
      settings: nodeManager.getPollSettings()
    });
  });

  return router;
}

module.exports = createV1Router;
