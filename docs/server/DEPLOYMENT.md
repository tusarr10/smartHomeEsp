# CENTRAL SERVER DEPLOYMENT & OPERATION GUIDE

**Platform**: Windows Server / Linux (Ubuntu/Debian)  
**Process Manager**: Node.js Native / PM2 / Windows Batch  
**Evidence Source**: [`central_server_js/run.bat`](file:///d:/ai/Homeautomation_server/central_server_js/run.bat), [`central_server_js/run.sh`](file:///d:/ai/Homeautomation_server/central_server_js/run.sh)  

---

## 1. Prerequisites

- **Node.js**: Version 20.x or 22.x LTS (Required for `--experimental-sqlite` `node:sqlite` module).
- **Network Ports**:
  - `9100/TCP`: HTTP REST API, WebSockets, and Web SPA Dashboard.
  - `2000/TCP`: Raw TCP Telemetry Socket for microcontrollers.
- **Firewall**: Must allow inbound traffic on ports 9100 and 2000 from local IoT subnets.

---

## 2. Launching on Windows

### Method A: One-Click Launcher (`run.bat`)
Double-click `central_server_js/run.bat` or run from PowerShell:
```powershell
cd d:\ai\Homeautomation_server\central_server_js
.\run.bat
```
The script validates Node.js availability, checks if `node_modules` exists (running `npm install` if missing), and launches `node --experimental-sqlite server.js`.

### Method B: Production Service via PM2
```powershell
npm install -g pm2
cd d:\ai\Homeautomation_server\central_server_js
pm2 start server.js --name "smarthome-server" --node-args="--experimental-sqlite"
pm2 save
pm2 startup
```

---

## 3. Launching on Linux

```bash
cd /opt/Homeautomation_server/central_server_js
chmod +x run.sh
./run.sh
```

### Systemd Service Configuration (`/etc/systemd/system/smarthome.service`):
```ini
[Unit]
Description=SmartHome Central Management Platform
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/Homeautomation_server/central_server_js
ExecStart=/usr/bin/node --experimental-sqlite server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable smarthome
sudo systemctl start smarthome
```
