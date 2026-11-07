const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const FleetDatabase = require('./src/database');
const NodeManager = require('./src/nodeManager');
const TcpTelemetryServer = require('./src/tcpServer');
const createV1Router = require('./src/routes/v1Router');
const createLegacyRouter = require('./src/routes/legacyRouter');

// 1. Load Configuration
const configPath = path.join(__dirname, 'config.json');
let config = {
  bind_host: '0.0.0.0',
  http_port: 9100,
  tcp_port: 2000,
  offline_timeout_sec: 30,
  auth_token: '',
  direct_http_timeout_ms: 2500,
  node_auth: {
    username: 'admin',
    password: 'admin'
  }
};

if (fs.existsSync(configPath)) {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    config = { ...config, ...JSON.parse(raw) };
  } catch (err) {
    console.warn('[Config] Warning: Failed to parse config.json, using defaults:', err.message);
  }
}

// 2. Initialize Database & Node Manager
const dbPath = path.join(__dirname, 'data', 'fleet.db');
const db = new FleetDatabase(dbPath);
const nodeManager = new NodeManager(db, config);

// 3. Initialize Express App & HTTP Server
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount API Routers
app.use('/api/v1', createV1Router(nodeManager, db));
app.use('/api', createLegacyRouter(nodeManager, db, config));

// Serve Frontend Static UI
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

const server = http.createServer(app);

// 4. Initialize WebSocket Server for Real-Time UI Updates
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  nodeManager.addWsClient(ws);
  // Send immediate initial sync
  ws.send(JSON.stringify({
    type: 'initial_state',
    data: {
      overview: nodeManager.getOverview(),
      stats: nodeManager.getFleetStats(),
      nodes: db.getNodes()
    }
  }));
});

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);
  if (pathname === '/api/v1/ws' || pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// 5. Initialize & Start Raw TCP Telemetry Server
const tcpServer = new TcpTelemetryServer(nodeManager, config);
tcpServer.start();

// 6. Start Offline Watcher & Active Health & Pin Poller
nodeManager.startOfflineWatcher();
nodeManager.startPeriodicStatusPoller();

// 7. Start HTTP Server
const host = config.bind_host || '0.0.0.0';
const httpPort = Number(config.http_port || 9100);

server.listen(httpPort, host, () => {
  console.log('='.repeat(70));
  console.log(' [SmartHome] CENTRAL FLEET SERVER (Node.js Edition v1.6.0)');
  console.log('='.repeat(70));
  console.log(` [TCP Telemetry]  Listening on ${host}:${config.tcp_port || 2000}`);
  console.log(` [HTTP Dashboard] http://localhost:${httpPort} (Listening on ${host}:${httpPort})`);
  console.log(` [WebSocket Live] ws://localhost:${httpPort}/api/v1/ws`);
  console.log(` [Offline Watch]  Timeout set to ${config.offline_timeout_sec || 30}s`);
  console.log('='.repeat(70));
  console.log(' >> Ready for ESP8266 fleet telemetry & control.\n');
});

// Graceful Shutdown
function shutdown() {
  console.log('\n[Server] Graceful shutdown initiated...');
  nodeManager.stopOfflineWatcher();
  tcpServer.stop();
  server.close(() => {
    console.log('[Server] HTTP and TCP listeners stopped. Goodbye.');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
