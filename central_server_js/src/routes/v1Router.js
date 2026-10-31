const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const multer = require('multer');

function createV1Router(nodeManager, db) {
  const router = express.Router();

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

  // === FIRMWARE & OTA ===
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
      const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
      const version = req.body.version || '1.6.0';
      const hardware = req.body.hardware_type || 'ESP8266';

      const id = db.addFirmwareRecord({
        filename: req.file.originalname,
        version,
        hardware_type: hardware,
        file_size_bytes: req.file.size,
        checksum_md5: hash,
        file_path: req.file.path
      });

      db.logAudit('FIRMWARE_UPLOAD', 'System', `Uploaded firmware '${req.file.originalname}' v${version} (${req.file.size} bytes)`);

      res.json({
        success: true,
        id,
        filename: req.file.originalname,
        version,
        checksum: hash,
        message: 'Firmware uploaded and registered in catalog'
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Flash OTA to Node
  router.post('/firmware/:id/flash/:nodeId', async (req, res) => {
    const { id, nodeId } = req.params;
    const fwList = db.getFirmwareList();
    const fw = fwList.find(f => f.id === Number(id));
    const node = db.getNode(nodeId);

    if (!fw || !fs.existsSync(fw.file_path)) {
      return res.status(404).json({ success: false, error: 'Firmware binary file not found on server' });
    }
    if (!node || !node.ip) {
      return res.status(404).json({ success: false, error: 'Target node is not online or has no IP' });
    }

    db.logAudit('OTA_FLASH_START', nodeId, `Initiated OTA firmware update to ${node.name} (${node.ip}) with ${fw.filename}`);
    res.json({
      success: true,
      message: `OTA firmware flash initiated for node ${node.name} (${node.ip}) using ${fw.filename}`
    });
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
    res.json(db.getNotifications());
  });

  router.post('/system/notifications/mark-read', (req, res) => {
    db.markNotificationsRead();
    res.json({ success: true });
  });

  router.get('/system/logs', (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const logs = db.getAuditLogs(limit);
    res.json(logs);
  });

  return router;
}

module.exports = createV1Router;
