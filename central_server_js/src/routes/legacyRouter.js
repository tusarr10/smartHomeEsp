const express = require('express');
const http = require('node:http');

function createLegacyRouter(nodeManager, db, config) {
  const router = express.Router();

  // === HTTP TELEMETRY INGESTION (For ESP8266 HTTP mode) ===
  const handleTelemetry = async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress?.replace(/^.*:/, '') || 'unknown';
    const payload = req.body || {};

    if (!payload.ip || payload.ip === '0.0.0.0') {
      payload.ip = clientIp;
    }

    const pendingCommands = await nodeManager.processTelemetry(payload, clientIp, 'HTTP');

    const response = {
      status: 'ok',
      time: Math.floor(Date.now() / 1000)
    };

    if (pendingCommands && pendingCommands.length > 0) {
      response.commands = pendingCommands;
    }

    res.json(response);
  };

  router.post('/telemetry', handleTelemetry);
  router.post('/node/telemetry', handleTelemetry);

  // === SERVER-SENT EVENTS (SSE) STREAM ===
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Send initial stats event
    res.write(`event: stats\ndata: ${JSON.stringify(nodeManager.getFleetStats())}\n\n`);

    nodeManager.addSseClient(res);
  });

  // === FLEET NODES (Flat JSON structure for lightweight server compatibility) ===
  router.get('/nodes', (req, res) => {
    const nodes = db.getNodes();
    res.json({
      nodes,
      stats: nodeManager.getFleetStats()
    });
  });

  router.get('/nodes/:nodeId', (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    const history = db.getTelemetryHistory(req.params.nodeId, 20);
    res.json({ node, history });
  });

  router.post('/nodes/:nodeId/command', async (req, res) => {
    const result = await nodeManager.dispatchCommand(req.params.nodeId, req.body);
    res.json(result);
  });

  router.post('/nodes/:nodeId/rename', (req, res) => {
    const newName = (req.body.name || '').trim();
    if (newName && db.renameNode(req.params.nodeId, newName)) {
      nodeManager.broadcast('node_renamed', { nodeId: req.params.nodeId, name: newName });
      res.json({ success: true, nodeId: req.params.nodeId, name: newName });
    } else {
      res.status(400).json({ success: false, error: 'Invalid name or node not found' });
    }
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

  // === BROADCAST COMMAND ===
  router.post('/broadcast/command', async (req, res) => {
    const result = await nodeManager.broadcastCommand(req.body);
    res.json(result);
  });

  // === FLEET STATS ===
  router.get('/stats', (req, res) => {
    res.json(nodeManager.getFleetStats());
  });

  // === AUDIT LOGS ===
  router.get('/logs', (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json({ logs: db.getAuditLogs(limit) });
  });

  // === CONFIGURATION ===
  router.get('/config', (req, res) => {
    const safeCfg = { ...config };
    if (safeCfg.auth_token) {
      safeCfg.has_auth_token = true;
      safeCfg.auth_token = '***';
    }
    if (safeCfg.node_auth) {
      safeCfg.node_auth = { username: safeCfg.node_auth.username, password: '***' };
    }
    res.json(safeCfg);
  });

  // === DIRECT NODE PROBE & PROXY (e.g. Probe 192.168.1.105) ===
  router.get('/probe/:ip', (req, res) => {
    const targetIp = req.params.ip;
    const clientReq = http.get(`http://${targetIp}/api/status`, { timeout: 2500 }, (targetRes) => {
      let data = '';
      targetRes.on('data', chunk => data += chunk);
      targetRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Automatically register or update node if probe succeeds!
          nodeManager.processTelemetry({
            nodeId: `NODE-${(parsed.mac || targetIp).replace(/:/g, '')}`,
            nodeName: parsed.deviceName || `Node-${targetIp}`,
            eventType: 'manual_probe',
            ip: targetIp,
            mac: parsed.mac,
            rssi: parsed.rssi,
            uptimeSec: parsed.uptimeSec,
            freeHeap: parsed.freeHeap,
            firmwareVersion: parsed.firmwareVersion,
            hardware: parsed.hardware
          }, targetIp, 'PROBE');

          res.json({ success: true, status: parsed });
        } catch {
          res.json({ success: false, raw: data });
        }
      });
    });

    clientReq.on('error', (err) => {
      res.status(500).json({ success: false, error: err.message });
    });

    clientReq.on('timeout', () => {
      clientReq.destroy();
      res.status(504).json({ success: false, error: 'Probe timed out' });
    });
  });

  return router;
}

module.exports = createLegacyRouter;
