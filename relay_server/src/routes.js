const fs = require('node:fs');
const path = require('node:path');

function createRouter(nodeStore, proxyEngine, breakerClient, config) {
  const sseClients = new Set();

  // Broadcast helper for SSE
  function broadcastSse(eventType, data) {
    const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(message);
      } catch (err) {
        sseClients.delete(client);
      }
    }
  }

  // Hook up store events to SSE
  nodeStore.on('node_status', (data) => broadcastSse('node_status', data));
  nodeStore.on('channel_changed', (data) => broadcastSse('channel_changed', data));
  nodeStore.on('sensors_updated', (data) => broadcastSse('sensors_updated', data));
  nodeStore.on('automations_updated', (data) => broadcastSse('automations_updated', data));
  proxyEngine.on('central_status', (data) => broadcastSse('central_status', data));
  if (breakerClient) {
    breakerClient.on('reading', (data) => broadcastSse('breaker_reading', data));
  }

  return async function handleHttpRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // CORS & Common Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Node-ID');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Helper: read JSON body
    const readJsonBody = () => new Promise((resolve) => {
      let buf = '';
      req.on('data', chunk => { buf += chunk; });
      req.on('end', () => {
        try {
          resolve(buf ? JSON.parse(buf) : {});
        } catch (e) {
          resolve({});
        }
      });
    });

    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    // === 1. SSE EVENT STREAM ===
    if (method === 'GET' && (pathname === '/api/events' || pathname === '/events')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write(': connected\n\n');
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // === 2. TELEMETRY INGESTION (HTTP) ===
    if (method === 'POST' && (pathname === '/api/telemetry' || pathname === '/api/node/telemetry')) {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress?.replace(/^.*:/, '') || 'unknown';
      const body = await readJsonBody();

      // Process locally
      const localCommands = nodeStore.processTelemetry(body, clientIp, 'HTTP');

      // Forward to Central Server (if online)
      let centralCommands = null;
      try {
        centralCommands = await proxyEngine.forwardTelemetry(body);
      } catch (err) {
        // silent fallback
      }

      const mergedCommands = [
        ...(localCommands || []),
        ...(centralCommands || [])
      ];

      sendJson(200, {
        status: 'ok',
        time: Math.floor(Date.now() / 1000),
        commands: mergedCommands.length > 0 ? mergedCommands : undefined
      });
      return;
    }

    // === 3. NODES & CHANNELS API ===
    if (method === 'GET' && pathname === '/api/nodes') {
      sendJson(200, {
        nodes: nodeStore.getNodes(),
        central: proxyEngine.getStatus()
      });
      return;
    }

    // POST /api/nodes/:nodeId/channels/:channelId/set
    const channelMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/channels\/([^/]+)\/set$/);
    if (method === 'POST' && channelMatch) {
      const nodeId = decodeURIComponent(channelMatch[1]);
      const channelId = decodeURIComponent(channelMatch[2]);
      const body = await readJsonBody();
      const state = body.state !== undefined ? Boolean(body.state) : (body.value !== undefined ? Boolean(body.value) : true);

      const result = nodeStore.setChannelState(nodeId, channelId, state);
      sendJson(result.success ? 200 : 400, result);
      return;
    }

    // === 4. CIRCUIT BREAKER API ===
    if (method === 'GET' && pathname === '/api/breaker') {
      const reading = breakerClient ? breakerClient.getReading() : null;
      sendJson(200, {
        reading: reading || { online: false, decoded: {} },
        central: proxyEngine.getStatus()
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/breaker/switch') {
      const body = await readJsonBody();
      const state = body.state !== undefined ? Boolean(body.state) : Boolean(body.switch);
      if (breakerClient) {
        const result = await breakerClient.setSwitch(state);
        sendJson(200, result);
      } else {
        sendJson(503, { error: 'Breaker client not enabled' });
      }
      return;
    }

    // === 5. AUTOMATIONS API ===
    if (method === 'GET' && pathname === '/api/automations') {
      sendJson(200, nodeStore.getAutomations());
      return;
    }

    if (method === 'POST' && pathname === '/api/automations') {
      const body = await readJsonBody();
      const created = nodeStore.addAutomation(body);
      sendJson(201, created);
      return;
    }

    const autoIdMatch = pathname.match(/^\/api\/automations\/([^/]+)$/);
    if (autoIdMatch) {
      const autoId = decodeURIComponent(autoIdMatch[1]);
      if (method === 'PUT') {
        const body = await readJsonBody();
        const updated = nodeStore.updateAutomation(autoId, body);
        if (updated) sendJson(200, updated);
        else sendJson(404, { error: 'Automation not found' });
        return;
      }
      if (method === 'DELETE') {
        const deleted = nodeStore.deleteAutomation(autoId);
        sendJson(deleted ? 200 : 404, { success: deleted });
        return;
      }
    }

    // === 6. GATEWAY SYSTEM STATUS API ===
    if (method === 'GET' && pathname === '/api/status') {
      const mem = process.memoryUsage();
      sendJson(200, {
        name: config.server_name || 'SmartHome Relay Gateway',
        uptimeSec: Math.floor(process.uptime()),
        memory: {
          rssMb: (mem.rss / 1024 / 1024).toFixed(1),
          heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(1),
          heapTotalMb: (mem.heapTotal / 1024 / 1024).toFixed(1)
        },
        nodesTotal: nodeStore.getNodes().length,
        nodesOnline: nodeStore.getNodes().filter(n => n.is_online).length,
        central: proxyEngine.getStatus(),
        breaker: breakerClient ? { online: breakerClient.isLive } : null
      });
      return;
    }

    // === 7. SERVE STATIC FRONTEND (public/) ===
    const publicDir = path.resolve(__dirname, '..', 'public');
    let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);

    if (!filePath.startsWith(publicDir)) {
      sendJson(403, { error: 'Forbidden' });
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, must-revalidate'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Fallback to index.html for SPA
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    sendJson(404, { error: 'Not found' });
  };
}

module.exports = createRouter;
