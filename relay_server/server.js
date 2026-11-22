const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

const NodeStore = require('./src/nodeStore');
const ProxyEngine = require('./src/proxyEngine');
const BreakerClient = require('./src/breakerClient');
const AutomationEngine = require('./src/automationEngine');
const createRouter = require('./src/routes');

// 1. Load Configuration
const configPath = path.join(__dirname, 'config.json');
let config = {
  server_name: 'SmartHome Relay Gateway',
  bind_host: '0.0.0.0',
  http_port: 9200,
  tcp_port: 2000,
  auth_token: '',
  node_timeout_sec: 35,
  central_server: {
    enabled: true,
    url: 'http://127.0.0.1:9100',
    timeout_ms: 2500,
    health_check_interval_sec: 5
  },
  breaker: {
    enabled: true,
    portal_url: 'http://127.0.0.1:8085',
    direct_ip: '192.168.1.164',
    poll_interval_ms: 3000
  }
};

if (fs.existsSync(configPath)) {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    config = { ...config, ...JSON.parse(raw) };
  } catch (err) {
    console.warn('[Config] Failed to read config.json, using defaults:', err.message);
  }
}

// 2. Initialize Core Subsystems
const nodeStore = new NodeStore(config);
const proxyEngine = new ProxyEngine(config);
const breakerClient = new BreakerClient(nodeStore, config);
const automationEngine = new AutomationEngine(nodeStore, breakerClient);
const httpHandler = createRouter(nodeStore, proxyEngine, breakerClient, config);

// 3. Start Raw TCP Telemetry Server (Port 2000 - ESP8266 Fleet Protocol)
const tcpPort = Number(config.tcp_port || 2000);
const bindHost = config.bind_host || '0.0.0.0';

const tcpServer = net.createServer((socket) => {
  const clientIp = socket.remoteAddress ? socket.remoteAddress.replace(/^.*:/, '') : 'unknown';
  let buffer = '';

  socket.setTimeout(6000);

  socket.on('data', async (chunk) => {
    buffer += chunk.toString('utf-8');

    if (buffer.includes('\n')) {
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep remainder

      for (const line of lines) {
        const raw = line.trim();
        if (!raw) continue;

        try {
          const payload = JSON.parse(raw);
          if (!payload.ip || payload.ip === '0.0.0.0') {
            payload.ip = clientIp;
          }

          // Process in local node store & retrieve queued commands
          const localCommands = nodeStore.processTelemetry(payload, clientIp, 'TCP');

          // Proxy to Central Server if online
          let centralCommands = null;
          try {
            centralCommands = await proxyEngine.forwardTelemetry(payload);
          } catch (e) {
            // non-fatal
          }

          // Combine any pending local or central commands
          const combinedCommands = [
            ...(localCommands || []),
            ...(centralCommands || [])
          ];

          const response = {
            status: 'ok',
            epoch: Math.floor(Date.now() / 1000)
          };

          if (combinedCommands.length > 0) {
            response.commands = combinedCommands;
          }

          socket.write(JSON.stringify(response) + '\n', () => {
            socket.end();
          });
        } catch (err) {
          console.error(`[TCP] Malformed payload from ${clientIp}:`, err.message);
          socket.write(JSON.stringify({ status: 'error', message: 'Malformed JSON' }) + '\n', () => {
            socket.end();
          });
        }
      }
    }
  });

  socket.on('timeout', () => {
    socket.destroy();
  });

  socket.on('error', (err) => {
    // Socket dropped by ESP
  });
});

tcpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(` [TCP Server] Warning: Port ${tcpPort} is already in use by another process on this machine.`);
    console.warn(`              (On your MTK router this will be free, or you can change tcp_port in config.json for local testing).`);
  } else {
    console.error(' [TCP Server] Error:', err.message);
  }
});

tcpServer.listen(tcpPort, bindHost, () => {
  console.log(` [TCP Server] Ingestion listening on ${bindHost}:${tcpPort} (Raw ESP8266 line protocol)`);
});

// 4. Start HTTP Server (Web Dashboard & REST Ingestion)
const httpPort = Number(config.http_port || 9200);
const httpServer = http.createServer((req, res) => {
  httpHandler(req, res).catch(err => {
    console.error('[HTTP] Request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  });
});

httpServer.listen(httpPort, bindHost, () => {
  console.log('='.repeat(70));
  console.log(' [SmartHome] LIGHTWEIGHT RELAY & FALLBACK GATEWAY (v1.0.0)');
  console.log('='.repeat(70));
  console.log(` [Device Spec]    Optimized for MTK 830 / 512MB RAM Embedded Environments`);
  console.log(` [TCP Telemetry]  Listening on ${bindHost}:${tcpPort}`);
  console.log(` [HTTP Dashboard] http://localhost:${httpPort} (Listening on ${bindHost}:${httpPort})`);
  console.log(` [Central Server] ${config.central_server.url} (Health check: ${config.central_server.health_check_interval_sec}s)`);
  console.log(` [Tuya Breaker]   ${config.breaker.portal_url} (Poll: ${config.breaker.poll_interval_ms}ms)`);
  console.log('='.repeat(70));
  console.log(' >> Gateway active: Ready for user control & auto-fallback.\n');
});

// Graceful Shutdown
function shutdown() {
  console.log('\n[Gateway] Shutting down gracefully...');
  nodeStore.saveState();
  breakerClient.stop();
  automationEngine.stop();
  proxyEngine.stopHealthCheck();
  tcpServer.close();
  httpServer.close(() => {
    console.log('[Gateway] Closed all ports. Goodbye.');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
