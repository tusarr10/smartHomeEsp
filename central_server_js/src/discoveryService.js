const os = require('node:os');
const http = require('node:http');

class DiscoveryService {
  constructor(db, nodeManager) {
    this.db = db;
    this.nodeManager = nodeManager;
    this.isScanning = false;
    this.lastScanResults = [];
    this.lastScanEpoch = 0;
  }

  getLocalSubnets() {
    const interfaces = os.networkInterfaces();
    const subnets = [];

    for (const [name, list] of Object.entries(interfaces)) {
      for (const item of list) {
        if (item.family === 'IPv4' && !item.internal) {
          const parts = item.address.split('.');
          if (parts.length === 4) {
            const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
            // Mark priority: standard home router subnets over VirtualBox / VM adapters
            const isVirtual = name.toLowerCase().includes('virtual') || 
                              name.toLowerCase().includes('vbox') || 
                              item.address.startsWith('192.168.56.');
            subnets.push({
              interface: name,
              ip: item.address,
              netmask: item.netmask,
              subnet,
              isVirtual
            });
          }
        }
      }
    }

    // Sort so physical non-virtual interfaces come first
    subnets.sort((a, b) => (a.isVirtual ? 1 : 0) - (b.isVirtual ? 1 : 0));
    return subnets;
  }

  getPrimarySubnet() {
    const subnets = this.getLocalSubnets();
    if (subnets.length > 0) {
      return subnets[0].subnet;
    }
    return '192.168.1';
  }

  async probeIp(ip, timeoutMs = 1200, authCreds = null) {
    return new Promise((resolve) => {
      const headers = { 'Accept': 'application/json' };
      if (authCreds && authCreds.username && authCreds.password) {
        const token = Buffer.from(`${authCreds.username}:${authCreds.password}`).toString('base64');
        headers['Authorization'] = `Basic ${token}`;
      }

      const req = http.get(`http://${ip}/api/status`, { headers, timeout: timeoutMs }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          if (res.statusCode === 401) {
            resolve({
              found: true,
              ip,
              statusCode: 401,
              isProtected: true,
              deviceName: `Protected Node (${ip})`,
              hardware: 'ESP8266/ESP32',
              firmwareVersion: 'Unknown',
              mac: '',
              needsAuth: true
            });
            return;
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(raw);
              if (data && (data.deviceName || data.hardware || data.mac || data.firmwareVersion || data.freeHeap !== undefined)) {
                resolve({
                  found: true,
                  ip,
                  statusCode: 200,
                  isProtected: false,
                  deviceName: data.deviceName || data.name || `Node-${ip}`,
                  hardware: data.hardware || data.hardware_type || 'ESP8266',
                  firmwareVersion: data.firmwareVersion || data.firmware_version || '1.6.0',
                  mac: data.mac || data.mac_address || '',
                  rssi: data.rssi || 0,
                  freeHeap: data.freeHeap || data.free_heap || 0,
                  uptimeSec: data.uptimeSec || data.uptime_sec || 0,
                  receiverServer: data.receiverServer || ''
                });
                return;
              }
            } catch {}
          }
          resolve({ found: false, ip });
        });
      });

      req.on('error', () => resolve({ found: false, ip }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ found: false, ip });
      });
    });
  }

  async scanNetwork(options = {}) {
    if (this.isScanning) {
      throw new Error('A network discovery scan is already in progress');
    }

    this.isScanning = true;
    const subnet = (options.subnet || this.getPrimarySubnet()).trim();
    const start = Math.max(1, Number(options.start) || 1);
    const end = Math.min(254, Number(options.end) || 254);
    const concurrency = Math.min(50, Math.max(10, Number(options.concurrency) || 30));
    const timeoutMs = Number(options.timeoutMs) || 1200;
    const authCreds = options.auth || null;

    const discovered = [];
    const existingNodes = this.db.getNodes();
    const existingIps = new Set(existingNodes.map(n => n.ip_address).filter(Boolean));
    const existingMacs = new Set(existingNodes.map(n => n.mac_address ? n.mac_address.toUpperCase() : '').filter(Boolean));

    const ips = [];
    for (let i = start; i <= end; i++) {
      ips.push(`${subnet}.${i}`);
    }

    try {
      let index = 0;
      let completed = 0;
      const total = ips.length;

      const worker = async () => {
        while (index < ips.length) {
          const currentIp = ips[index++];
          const res = await this.probeIp(currentIp, timeoutMs, authCreds);
          completed++;

          if (res.found) {
            const isAlreadyAddedByIp = existingIps.has(res.ip);
            const isAlreadyAddedByMac = res.mac && existingMacs.has(res.mac.toUpperCase());
            const matchedNode = existingNodes.find(n => n.ip_address === res.ip || (res.mac && n.mac_address && n.mac_address.toUpperCase() === res.mac.toUpperCase()));

            discovered.push({
              ...res,
              alreadyAdded: Boolean(isAlreadyAddedByIp || isAlreadyAddedByMac),
              existingNodeId: matchedNode ? matchedNode.node_id : null,
              existingNodeName: matchedNode ? matchedNode.name : null
            });

            // Broadcast live discovery event over WebSockets
            if (this.nodeManager) {
              this.nodeManager.broadcast('node_discovered', {
                ip: res.ip,
                deviceName: res.deviceName,
                hardware: res.hardware,
                alreadyAdded: Boolean(matchedNode)
              });
            }
          }

          // Broadcast progress
          if (this.nodeManager && completed % 15 === 0) {
            this.nodeManager.broadcast('scan_progress', {
              completed,
              total,
              percent: Math.round((completed / total) * 100),
              discoveredCount: discovered.length
            });
          }
        }
      };

      const workers = [];
      for (let w = 0; w < concurrency; w++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      // Sort discovered: unadded nodes first, then by IP
      discovered.sort((a, b) => {
        if (a.alreadyAdded !== b.alreadyAdded) {
          return a.alreadyAdded ? 1 : -1;
        }
        const ipA = a.ip.split('.').map(Number);
        const ipB = b.ip.split('.').map(Number);
        return ipA[3] - ipB[3];
      });

      this.lastScanResults = discovered;
      this.lastScanEpoch = Date.now() / 1000;

      return {
        success: true,
        subnet,
        start,
        end,
        totalScanned: ips.length,
        count: discovered.length,
        nodes: discovered
      };
    } finally {
      this.isScanning = false;
    }
  }
}

module.exports = DiscoveryService;
