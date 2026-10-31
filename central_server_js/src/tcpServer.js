const net = require('node:net');

class TcpTelemetryServer {
  constructor(nodeManager, config) {
    this.nodeManager = nodeManager;
    this.config = config;
    this.server = null;
    this.isRunning = false;
  }

  start() {
    const host = this.config.bind_host || '0.0.0.0';
    const port = Number(this.config.tcp_port || 2000);

    this.server = net.createServer((socket) => {
      const clientIp = socket.remoteAddress ? socket.remoteAddress.replace(/^.*:/, '') : 'unknown';
      let buffer = '';

      socket.setTimeout(6000);

      socket.on('data', async (chunk) => {
        buffer += chunk.toString('utf-8');

        // Look for framed JSON packet
        if (buffer.includes('\n') || buffer.trim().endsWith('}')) {
          const raw = buffer.trim();
          buffer = '';

          try {
            const payload = JSON.parse(raw);
            if (!payload.ip || payload.ip === '0.0.0.0') {
              payload.ip = clientIp;
            }

            const pendingCommands = await this.nodeManager.processTelemetry(payload, clientIp, 'TCP');

            const response = {
              status: 'ok',
              epoch: Math.floor(Date.now() / 1000)
            };

            if (pendingCommands && pendingCommands.length > 0) {
              response.commands = pendingCommands;
            }

            socket.write(JSON.stringify(response) + '\n', () => {
              socket.end();
            });
          } catch (err) {
            console.error(`[TCP] Malformed JSON from ${clientIp}:`, err.message);
            const errResp = { status: 'error', message: 'Malformed JSON payload' };
            socket.write(JSON.stringify(errResp) + '\n', () => {
              socket.end();
            });
          }
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
      });

      socket.on('error', (err) => {
        // Socket errors e.g. client reset
      });
    });

    this.server.listen(port, host, () => {
      this.isRunning = true;
      console.log(`[TCP Telemetry] Listening on ${host}:${port}`);
    });

    this.server.on('error', (err) => {
      console.error(`[TCP Telemetry] Server error:`, err.message);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.isRunning = false;
      console.log('[TCP Telemetry] Server stopped');
    }
  }
}

module.exports = TcpTelemetryServer;
