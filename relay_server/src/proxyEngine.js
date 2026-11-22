const http = require('node:http');
const https = require('node:https');
const EventEmitter = require('node:events');

class ProxyEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config.central_server || {};
    this.enabled = this.config.enabled !== false;
    this.centralUrl = (this.config.url || 'http://127.0.0.1:9100').replace(/\/+$/, '');
    this.timeoutMs = Number(this.config.timeout_ms || 2500);
    this.healthIntervalSec = Number(this.config.health_check_interval_sec || 5);

    this.isCentralOnline = false;
    this.lastCheckedEpoch = 0;
    this.lastSuccessfulEpoch = 0;
    this.consecutiveFailures = 0;
    this.healthTimer = null;
    this.pendingForwardCount = 0;

    if (this.enabled) {
      this.startHealthCheck();
    }
  }

  startHealthCheck() {
    this.checkHealth();
    this.healthTimer = setInterval(() => {
      this.checkHealth();
    }, this.healthIntervalSec * 1000);
  }

  stopHealthCheck() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      centralUrl: this.centralUrl,
      isOnline: this.isCentralOnline,
      lastCheckedEpoch: this.lastCheckedEpoch,
      lastSuccessfulEpoch: this.lastSuccessfulEpoch,
      consecutiveFailures: this.consecutiveFailures
    };
  }

  async checkHealth() {
    this.lastCheckedEpoch = Math.floor(Date.now() / 1000);
    try {
      const url = `${this.centralUrl}${this.config.health_check_endpoint || '/api/nodes'}`;
      const res = await this.httpRequest('GET', url, null, 1500);
      
      const wasOnline = this.isCentralOnline;
      this.isCentralOnline = true;
      this.consecutiveFailures = 0;
      this.lastSuccessfulEpoch = this.lastCheckedEpoch;

      if (!wasOnline) {
        console.log(`[ProxyEngine] Central Server (${this.centralUrl}) is ONLINE.`);
        this.emit('central_status', { isOnline: true, url: this.centralUrl });
      }
    } catch (err) {
      this.consecutiveFailures++;
      const wasOnline = this.isCentralOnline;
      this.isCentralOnline = false;

      if (wasOnline || this.consecutiveFailures === 1) {
        console.warn(`[ProxyEngine] Central Server (${this.centralUrl}) is OFFLINE. Running in FALLBACK mode.`);
        this.emit('central_status', { isOnline: false, url: this.centralUrl, error: err.message });
      }
    }
  }

  /**
   * Forward incoming node telemetry payload to the central server.
   * Returns commands array if the central server returned any commands.
   */
  async forwardTelemetry(telemetryData) {
    if (!this.enabled || !this.isCentralOnline) {
      return null;
    }

    const endpoint = `${this.centralUrl}${this.config.telemetry_endpoint || '/api/telemetry'}`;

    try {
      this.pendingForwardCount++;
      const resData = await this.httpRequest('POST', endpoint, telemetryData, this.timeoutMs);
      
      if (resData && Array.isArray(resData.commands) && resData.commands.length > 0) {
        console.log(`[ProxyEngine] Central Server returned ${resData.commands.length} commands for node:`, resData.commands);
        return resData.commands;
      }
      return null;
    } catch (err) {
      // If forward fails, don't crash
      console.warn(`[ProxyEngine] Failed to forward telemetry to Central Server: ${err.message}`);
      return null;
    } finally {
      this.pendingForwardCount = Math.max(0, this.pendingForwardCount - 1);
    }
  }

  httpRequest(method, targetUrl, data = null, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(targetUrl);
        const isHttps = parsed.protocol === 'https:';
        const client = isHttps ? https : http;

        const options = {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + (parsed.search || ''),
          method: method.toUpperCase(),
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'SmartHome-Relay-Gateway/1.0.0'
          },
          timeout: timeoutMs
        };

        let bodyPayload = '';
        if (data) {
          bodyPayload = typeof data === 'string' ? data : JSON.stringify(data);
          options.headers['Content-Length'] = Buffer.byteLength(bodyPayload);
        }

        const req = client.request(options, (res) => {
          let responseText = '';
          res.on('data', chunk => { responseText += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsedJson = JSON.parse(responseText);
                resolve(parsedJson);
              } catch (e) {
                resolve({ raw: responseText });
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${responseText.slice(0, 100)}`));
            }
          });
        });

        req.on('timeout', () => {
          req.destroy(new Error('Connection timed out'));
        });

        req.on('error', (err) => {
          reject(err);
        });

        if (bodyPayload) {
          req.write(bodyPayload);
        }
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

module.exports = ProxyEngine;
