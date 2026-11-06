import sys

new_section_2 = r'''// --- 2. NODES, DISCOVERY SCANNER & NODE SETTINGS ---
async function loadNodes() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/nodes`);
    const rawNodes = await res.json();
    const nodes = Array.isArray(rawNodes) ? rawNodes : (rawNodes.nodes || []);
    fleetData.nodes = nodes;

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
        <div>
          <div style="font-size: 16px; font-weight: 600;">Node Fleet Management</div>
          <div style="font-size: 13px; color: var(--text-secondary);">${nodes.length} Node(s) registered in fleet</div>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary" onclick="showNetworkScannerModal()">🔍 Scan Local Network</button>
          <button class="btn btn-primary" onclick="showAddNodeModal()">+ Add Node</button>
        </div>
      </div>
      <div class="cards-grid">
        ${nodes.length === 0 ? '<div style="color: var(--text-secondary); padding: 20px; grid-column: 1 / -1; background: var(--bg-secondary); border-radius: 8px; border: 1px dashed var(--border-color); text-align: center;">No nodes currently registered. Click <strong>"🔍 Scan Local Network"</strong> to discover live ESP devices or <strong>"+ Add Node"</strong> to manually register one.</div>' : ''}
        ${nodes.map(n => `
          <div class="node-card">
            <div class="card-header">
              <div>
                <div class="card-title">${escapeHtml(n.name || n.node_id)}</div>
                <div class="card-meta">ID: <code>${escapeHtml(n.node_id)}</code></div>
              </div>
              <span class="status-badge ${n.is_online ? 'badge-online' : 'badge-offline'}">
                <span class="pulse-dot"></span> ${n.status || (n.is_online ? 'Online' : 'Offline')}
              </span>
            </div>
            <div style="font-size: 13px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0;">
              <div><strong>HW:</strong> ${escapeHtml(n.hardware_type || 'ESP8266')}</div>
              <div><strong>FW:</strong> v${escapeHtml(n.firmware_version || '1.0.0')}</div>
              <div><strong>IP:</strong> <a href="http://${escapeHtml(n.ip_address)}" target="_blank" style="color: var(--accent-blue);">${escapeHtml(n.ip_address || 'N/A')}</a></div>
              <div><strong>RSSI:</strong> ${n.rssi || -70} dBm</div>
              <div><strong>Room:</strong> ${escapeHtml(n.room || 'General')}</div>
              <div><strong>Free Heap:</strong> ${(Number(n.free_heap || 0) / 1024).toFixed(1)} KB</div>
            </div>
            <div style="border-top: 1px solid var(--border-color); padding-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn btn-primary" style="font-size: 12px; padding: 6px 10px;" onclick="showNodeSettingsModal('${n.node_id}')">⚙️ Settings</button>
              <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="syncPinsWithHardware('${n.node_id}')">⚡ Sync Pins</button>
              <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="restartNode('${n.node_id}')">🔄 Reboot</button>
              <button class="btn btn-danger" style="font-size: 12px; padding: 6px 10px;" onclick="deleteNode('${n.node_id}')">🗑️ Delete</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading nodes: ${e.message}</div>`;
  }
}

function showAddNodeModal(prefillIp = '', prefillName = '', prefillUser = 'admin', prefillPass = 'admin') {
  const html = `
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0;">+ Register Fleet Node</h3>
        <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
      </div>
      <p style="font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5;">
        Enter the LAN IP and optional authentication credentials of your ESP8266 or ESP32 node. The server will probe its status, read configured relay channels, and register it in the central fleet.
      </p>
      <div class="form-group">
        <label class="form-label">Node IP Address *</label>
        <input type="text" id="add-node-ip" class="form-control" placeholder="192.168.1.103" value="${escapeHtml(prefillIp || '192.168.1.103')}">
      </div>
      <div class="form-group">
        <label class="form-label">Friendly Name (Optional)</label>
        <input type="text" id="add-node-name" class="form-control" placeholder="e.g. Master Bedroom Controller" value="${escapeHtml(prefillName)}">
      </div>
      <div class="form-group">
        <label class="form-label">Room / Zone</label>
        <input type="text" id="add-node-room" class="form-control" placeholder="Living Room" value="General">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Node User ID / Login</label>
          <input type="text" id="add-node-user" class="form-control" placeholder="admin" value="${escapeHtml(prefillUser)}">
        </div>
        <div class="form-group">
          <label class="form-label">Node Password</label>
          <input type="password" id="add-node-pass" class="form-control" placeholder="admin" value="${escapeHtml(prefillPass)}">
        </div>
      </div>
      <div id="add-node-status" style="display: none; font-size: 13px; padding: 10px; border-radius: 6px;"></div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="btn-submit-add-node" onclick="submitAddNode()">Probe & Register Node</button>
      </div>
    </div>
  `;
  openModal(html);
}

async function submitAddNode() {
  const ip = document.getElementById("add-node-ip").value.trim();
  const name = document.getElementById("add-node-name").value.trim();
  const room = document.getElementById("add-node-room").value.trim();
  const auth_username = document.getElementById("add-node-user").value.trim() || 'admin';
  const auth_password = document.getElementById("add-node-pass").value.trim() || 'admin';
  const statusBox = document.getElementById("add-node-status");
  const btn = document.getElementById("btn-submit-add-node");

  if (!ip) {
    statusBox.style.display = "block";
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = "Please enter a valid IP address.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Probing Node...";
  statusBox.style.display = "block";
  statusBox.style.background = "rgba(59, 130, 246, 0.15)";
  statusBox.style.color = "var(--accent-blue)";
  statusBox.textContent = `Connecting to http://${ip}/api/status...`;

  try {
    const res = await fetch(`${API_BASE}/nodes/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, name, room, auth_username, auth_password })
    });
    const result = await res.json();

    if (result.success) {
      statusBox.style.background = "rgba(34, 197, 94, 0.15)";
      statusBox.style.color = "var(--accent-green)";
      statusBox.textContent = result.message || "Node successfully connected and registered!";
      setTimeout(() => {
        closeModal();
        loadNodes();
      }, 1000);
    } else {
      statusBox.style.background = "rgba(239, 68, 68, 0.15)";
      statusBox.style.color = "var(--accent-red)";
      statusBox.textContent = result.error || "Failed to probe node.";
      btn.disabled = false;
      btn.textContent = "Try Again";
    }
  } catch (err) {
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = "Network error: " + err.message;
    btn.disabled = false;
    btn.textContent = "Try Again";
  }
}

// --- NETWORK DISCOVERY SCANNER ---
async function showNetworkScannerModal() {
  let detectedSubnet = "192.168.1";
  let subnetsList = [];

  try {
    const res = await fetch(`${API_BASE}/nodes/discovery/subnets`);
    const data = await res.json();
    if (data.primarySubnet) {
      detectedSubnet = data.primarySubnet;
    }
    if (Array.isArray(data.subnets)) {
      subnetsList = data.subnets;
    }
  } catch (e) {
    console.warn("Failed to fetch subnets:", e);
  }

  const html = `
    <div class="modal-content modal-lg">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h3 style="margin: 0;">🔍 Local Network Node Scanner</h3>
          <p style="font-size: 13px; color: var(--text-secondary); margin: 4px 0 0 0;">
            Automatically scan your LAN for ESP8266 / ESP32 smart home controllers and add them with one click.
          </p>
        </div>
        <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
      </div>

      <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px; display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 10px; align-items: flex-end;">
        <div class="form-group" style="margin: 0;">
          <label class="form-label">Subnet Base</label>
          <input type="text" id="scan-subnet" class="form-control" value="${escapeHtml(detectedSubnet)}" placeholder="192.168.1">
        </div>
        <div class="form-group" style="margin: 0;">
          <label class="form-label">Start IP</label>
          <input type="number" id="scan-start" class="form-control" value="1" min="1" max="254">
        </div>
        <div class="form-group" style="margin: 0;">
          <label class="form-label">End IP</label>
          <input type="number" id="scan-end" class="form-control" value="254" min="1" max="254">
        </div>
        <div>
          <button class="btn btn-primary" id="btn-start-scan" style="white-space: nowrap; height: 38px;" onclick="runDiscoveryScan()">🚀 Start Scan</button>
        </div>
      </div>

      <div style="display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--text-secondary);">
        <span>Quick Presets:</span>
        <button class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="document.getElementById('scan-start').value=100; document.getElementById('scan-end').value=120;">DHCP Range (100-120)</button>
        <button class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="document.getElementById('scan-start').value=1; document.getElementById('scan-end').value=50;">Low Range (1-50)</button>
        <button class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="document.getElementById('scan-start').value=1; document.getElementById('scan-end').value=254;">Full Subnet (1-254)</button>
      </div>

      <div id="scan-status-container" style="display: none;">
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
          <span id="scan-status-text" style="color: var(--accent-blue);">Scanning network...</span>
          <span id="scan-status-count" style="color: var(--text-secondary);">0 / 254</span>
        </div>
        <div class="scan-progress-bar">
          <div class="scan-progress-fill" id="scan-progress-fill" style="width: 100%;"></div>
        </div>
      </div>

      <div id="scan-results-container" style="max-height: 380px; overflow-y: auto; padding-right: 4px;">
        <div style="text-align: center; color: var(--text-secondary); padding: 30px; font-size: 13px;">
          Click "🚀 Start Scan" to probe your local network for active ESP8266/ESP32 controllers.
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 12px;">
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
      </div>
    </div>
  `;
  openModal(html);
}

async function runDiscoveryScan() {
  const subnet = document.getElementById("scan-subnet").value.trim();
  const start = parseInt(document.getElementById("scan-start").value) || 1;
  const end = parseInt(document.getElementById("scan-end").value) || 254;
  const btn = document.getElementById("btn-start-scan");
  const statusContainer = document.getElementById("scan-status-container");
  const statusText = document.getElementById("scan-status-text");
  const statusCount = document.getElementById("scan-status-count");
  const resultsContainer = document.getElementById("scan-results-container");

  btn.disabled = true;
  btn.textContent = "Scanning...";
  statusContainer.style.display = "block";
  statusText.textContent = `Probing ${subnet}.${start} through ${subnet}.${end}...`;
  statusCount.textContent = `Range: ${end - start + 1} IPs`;
  resultsContainer.innerHTML = `
    <div style="text-align: center; color: var(--text-secondary); padding: 40px; font-size: 13px;">
      <div style="font-size: 24px; margin-bottom: 10px;">📡</div>
      Sending status probes to port 80 across ${subnet}.${start} - ${subnet}.${end}...<br>
      <span style="font-size: 12px; opacity: 0.7;">This typically takes 2 to 5 seconds depending on network latency.</span>
    </div>
  `;

  try {
    const res = await fetch(`${API_BASE}/nodes/discovery/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subnet, start, end, timeoutMs: 1500, concurrency: 30 })
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = "🚀 Scan Again";

    if (!data.success) {
      statusText.textContent = "Scan failed";
      statusText.style.color = "var(--accent-red)";
      resultsContainer.innerHTML = `<div style="color: var(--accent-red); padding: 20px;">Error: ${escapeHtml(data.error || 'Scan failed')}</div>`;
      return;
    }

    const devices = data.devices || [];
    statusText.textContent = `Scan complete in ${data.durationMs}ms. Found ${devices.length} smart device(s).`;
    statusText.style.color = "var(--accent-green)";
    statusCount.textContent = `${devices.length} found / ${data.totalScanned} checked`;

    if (devices.length === 0) {
      resultsContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-secondary); padding: 40px; font-size: 13px;">
          <div style="font-size: 24px; margin-bottom: 8px;">🔍</div>
          No ESP devices replied on ${subnet}.${start}-${end}:80.<br>
          <span style="font-size: 12px; opacity: 0.8;">Make sure your NodeMCU / ESP8266 is powered on, connected to the same Wi-Fi network, and HTTP server is active.</span>
        </div>
      `;
      return;
    }

    resultsContainer.innerHTML = devices.map(d => {
      const isAdded = d.alreadyAdded;
      const freeHeapKb = d.freeHeap ? (d.freeHeap / 1024).toFixed(1) + ' KB' : 'N/A';
      const nodeName = d.deviceName || d.nodeId || `ESP-${d.ip.split('.').pop()}`;
      return `
        <div class="scan-device-item">
          <div style="display: flex; gap: 14px; align-items: center;">
            <div style="font-size: 28px; background: rgba(59, 130, 246, 0.1); padding: 8px 12px; border-radius: 8px;">
              ${d.hardware && d.hardware.includes('ESP32') ? '⚡' : '📡'}
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 600; font-size: 14px;">${escapeHtml(nodeName)}</span>
                ${d.protected ? '<span class="status-badge badge-warning" style="font-size: 11px;">🔒 Protected</span>' : '<span class="status-badge badge-online" style="font-size: 11px;">Open</span>'}
                ${isAdded ? '<span class="status-badge badge-info" style="font-size: 11px;">✓ In Fleet</span>' : ''}
              </div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px; display: flex; gap: 12px; flex-wrap: wrap;">
                <span><strong>IP:</strong> <code>${escapeHtml(d.ip)}</code></span>
                <span><strong>MAC:</strong> <code>${escapeHtml(d.mac || 'N/A')}</code></span>
                <span><strong>HW:</strong> ${escapeHtml(d.hardware || 'ESP8266')}</span>
                <span><strong>FW:</strong> v${escapeHtml(d.firmware || '1.0')}</span>
                <span><strong>Heap:</strong> ${freeHeapKb}</span>
                <span><strong>RSSI:</strong> ${d.rssi || -65} dBm</span>
              </div>
            </div>
          </div>
          <div>
            ${isAdded ? `
              <button class="btn btn-secondary" style="font-size: 12px;" onclick="closeModal(); showNodeSettingsModal('${d.existingNodeId}');">⚙️ Settings</button>
            ` : `
              <button class="btn btn-primary" style="font-size: 12px;" onclick="closeModal(); showAddNodeModal('${d.ip}', '${escapeHtml(nodeName)}');">+ Add to Fleet</button>
            `}
          </div>
        </div>
      `;
    }).join("");

  } catch (err) {
    btn.disabled = false;
    btn.textContent = "🚀 Scan Again";
    statusText.textContent = "Scan error: " + err.message;
    statusText.style.color = "var(--accent-red)";
  }
}

// --- NODE SETTINGS MODAL (DETAILS, AUTH & RELAYS) ---
function switchSettingsTab(tabName) {
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.settings-tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-pane-${tabName}`);
  });
}

async function showNodeSettingsModal(nodeId, activeTab = 'general') {
  try {
    const res = await fetch(`${API_BASE}/nodes`);
    const rawNodes = await res.json();
    const nodes = Array.isArray(rawNodes) ? rawNodes : (rawNodes.nodes || []);
    const node = nodes.find(n => n.node_id === nodeId);

    if (!node) {
      alert(`Node ${nodeId} not found.`);
      return;
    }

    // Parse configured relay channels
    let channels = [];
    try {
      if (typeof node.channels_json === 'string' && node.channels_json.trim()) {
        channels = JSON.parse(node.channels_json);
      } else if (Array.isArray(node.channels_json)) {
        channels = node.channels_json;
      }
    } catch (e) {
      channels = [];
    }

    const html = `
      <div class="modal-content modal-lg">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h3 style="margin: 0;">⚙️ Node Settings: ${escapeHtml(node.name || node.node_id)}</h3>
              <span class="status-badge ${node.is_online ? 'badge-online' : 'badge-offline'}">${node.status || (node.is_online ? 'Online' : 'Offline')}</span>
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
              Node ID: <code>${escapeHtml(node.node_id)}</code> &bull; IP: <code>${escapeHtml(node.ip_address)}</code> &bull; MAC: <code>${escapeHtml(node.mac_address || 'N/A')}</code>
            </div>
          </div>
          <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
        </div>

        <!-- TABS NAVIGATION -->
        <div class="settings-tabs" style="margin-top: 8px;">
          <button class="settings-tab-btn ${activeTab === 'general' ? 'active' : ''}" data-tab="general" onclick="switchSettingsTab('general')">
            📋 General & Network
          </button>
          <button class="settings-tab-btn ${activeTab === 'auth' ? 'active' : ''}" data-tab="auth" onclick="switchSettingsTab('auth')">
            🔐 User ID & Password
          </button>
          <button class="settings-tab-btn ${activeTab === 'relays' ? 'active' : ''}" data-tab="relays" onclick="switchSettingsTab('relays')">
            ⚡ Relay Channels (${channels.length})
          </button>
        </div>

        <!-- TAB 1: GENERAL & NETWORK -->
        <div id="tab-pane-general" class="settings-tab-pane ${activeTab === 'general' ? 'active' : ''}">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <div class="form-group">
              <label class="form-label">Friendly Device Name *</label>
              <input type="text" id="setting-name" class="form-control" value="${escapeHtml(node.name || '')}" placeholder="Master Controller">
            </div>
            <div class="form-group">
              <label class="form-label">Room / Zone</label>
              <input type="text" id="setting-room" class="form-control" value="${escapeHtml(node.room || 'General')}" placeholder="Living Room">
            </div>
            <div class="form-group">
              <label class="form-label">Category</label>
              <input type="text" id="setting-category" class="form-control" value="${escapeHtml(node.category || 'Controller')}" placeholder="Controller">
            </div>
            <div class="form-group">
              <label class="form-label">LAN IP Address *</label>
              <input type="text" id="setting-ip" class="form-control" value="${escapeHtml(node.ip_address || '')}" placeholder="192.168.1.103">
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
              <label class="form-label">Location Notes / Physical Placement</label>
              <input type="text" id="setting-location" class="form-control" value="${escapeHtml(node.location || '')}" placeholder="Behind TV Switchboard / Main Distribution Box">
            </div>
          </div>

          <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-top: 14px; font-size: 12.5px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div><strong>Hardware Model:</strong> ${escapeHtml(node.hardware_type || 'ESP8266')}</div>
            <div><strong>Firmware Version:</strong> v${escapeHtml(node.firmware_version || '1.0.0')}</div>
            <div><strong>Wi-Fi RSSI:</strong> ${node.rssi || -70} dBm</div>
            <div><strong>Free Dynamic Heap:</strong> ${(Number(node.free_heap || 0) / 1024).toFixed(1)} KB</div>
            <div><strong>System Uptime:</strong> ${Math.floor((node.uptime_sec || 0) / 3600)}h ${Math.floor(((node.uptime_sec || 0) % 3600) / 60)}m</div>
            <div><strong>Last Heartbeat:</strong> ${node.last_seen ? new Date(node.last_seen).toLocaleTimeString() : 'N/A'}</div>
          </div>
        </div>

        <!-- TAB 2: AUTHENTICATION -->
        <div id="tab-pane-auth" class="settings-tab-pane ${activeTab === 'auth' ? 'active' : ''}">
          <p style="font-size: 13px; color: var(--text-secondary); margin-top: 0;">
            Configure per-node HTTP Basic Authentication credentials. The central server will authenticate with these credentials when querying <code>/api/status</code>, controlling relays, and pushing configurations.
          </p>

          <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
              <div class="form-group">
                <label class="form-label">Node User ID / Username *</label>
                <input type="text" id="setting-auth-user" class="form-control" value="${escapeHtml(node.auth_username || 'admin')}" placeholder="admin">
              </div>
              <div class="form-group">
                <label class="form-label">Node Password *</label>
                <div style="display: flex; gap: 6px;">
                  <input type="password" id="setting-auth-pass" class="form-control" value="${escapeHtml(node.auth_password || 'admin')}" placeholder="admin">
                  <button type="button" class="btn btn-secondary" style="padding: 6px 10px;" onclick="
                    const p = document.getElementById('setting-auth-pass');
                    p.type = p.type === 'password' ? 'text' : 'password';
                    this.textContent = p.type === 'password' ? '👁️' : '🔒';
                  ">👁️</button>
                </div>
              </div>
            </div>

            <div style="margin-top: 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
              <button class="btn btn-secondary" id="btn-test-auth" onclick="testNodeAuth('${node.node_id}')">
                🧪 Test Connection & Authentication
              </button>
              <div id="auth-test-result" style="font-size: 13px; font-weight: 500;"></div>
            </div>
          </div>
        </div>

        <!-- TAB 3: RELAY CHANNELS -->
        <div id="tab-pane-relays" class="settings-tab-pane ${activeTab === 'relays' ? 'active' : ''}">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="font-size: 13px; color: var(--text-secondary);">
              Configure GPIO pins, load types, and active logic for this node's relays.
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" style="font-size: 12px;" onclick="pushConfigToNode('${node.node_id}')">📤 Push Config to Node</button>
              <button class="btn btn-primary" style="font-size: 12px;" onclick="showAddRelayModal('${node.node_id}')">+ Add Relay</button>
            </div>
          </div>

          <div id="push-config-result" style="display: none; padding: 8px 12px; border-radius: 6px; font-size: 13px; margin-bottom: 10px;"></div>

          <div class="settings-table-wrapper">
            <table class="settings-table">
              <thead>
                <tr>
                  <th>Channel ID</th>
                  <th>GPIO Pin</th>
                  <th>Relay Name</th>
                  <th>Room</th>
                  <th>Type</th>
                  <th>Logic</th>
                  <th>Boot State</th>
                  <th style="text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${channels.length === 0 ? `
                  <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 24px;">
                      No relay channels configured for this node. Click <strong>"+ Add Relay"</strong> to create one.
                    </td>
                  </tr>
                ` : channels.map(c => `
                  <tr>
                    <td><code>${escapeHtml(c.id || c.channel_id || 'ch1')}</code></td>
                    <td><span class="status-badge badge-info" style="font-size: 11px;">GPIO ${c.pin}</span></td>
                    <td style="font-weight: 500;">${escapeHtml(c.name || 'Relay')}</td>
                    <td>${escapeHtml(c.room || node.room || 'General')}</td>
                    <td><span style="text-transform: capitalize;">${escapeHtml(c.function || c.type || 'relay')}</span></td>
                    <td>${c.active_low !== false ? '<span style="color: var(--accent-blue);">Active LOW</span>' : '<span style="color: var(--accent-green);">Active HIGH</span>'}</td>
                    <td><code>${escapeHtml(c.boot_state || c.initial_mode || 'OFF')}</code></td>
                    <td style="text-align: right;">
                      <div style="display: inline-flex; gap: 6px;">
                        <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="showAddRelayModal('${node.node_id}', '${escapeHtml(c.id || c.channel_id)}')">✏️ Edit</button>
                        <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteRelayChannel('${node.node_id}', '${escapeHtml(c.id || c.channel_id)}')">🗑️</button>
                      </div>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <!-- MODAL FOOTER -->
        <div id="node-settings-status" style="display: none; padding: 10px; border-radius: 6px; font-size: 13px;"></div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 14px;">
          <button class="btn btn-secondary" onclick="closeModal()">Close</button>
          <button class="btn btn-primary" id="btn-save-settings" onclick="saveNodeSettings('${node.node_id}')">💾 Save Settings</button>
        </div>
      </div>
    `;
    openModal(html);
  } catch (err) {
    alert("Error loading node settings: " + err.message);
  }
}

// Test per-node credentials against physical device
async function testNodeAuth(nodeId) {
  const btn = document.getElementById("btn-test-auth");
  const resultDiv = document.getElementById("auth-test-result");
  const username = document.getElementById("setting-auth-user").value.trim();
  const password = document.getElementById("setting-auth-pass").value.trim();

  btn.disabled = true;
  btn.textContent = "Testing...";
  resultDiv.style.color = "var(--accent-blue)";
  resultDiv.textContent = "Connecting to node...";

  try {
    const res = await fetch(`${API_BASE}/nodes/${nodeId}/test-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = "🧪 Test Connection & Authentication";

    if (data.success) {
      resultDiv.style.color = "var(--accent-green)";
      resultDiv.textContent = `✅ Connected! Latency: ${data.latencyMs}ms (HTTP ${data.httpStatus} OK, ${data.hardware || 'ESP8266'})`;
    } else {
      resultDiv.style.color = "var(--accent-red)";
      resultDiv.textContent = `❌ ${data.error || 'Authentication / Connection failed'}`;
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "🧪 Test Connection & Authentication";
    resultDiv.style.color = "var(--accent-red)";
    resultDiv.textContent = `❌ Error: ${err.message}`;
  }
}

// Save node settings to database
async function saveNodeSettings(nodeId) {
  const name = document.getElementById("setting-name").value.trim();
  const room = document.getElementById("setting-room").value.trim();
  const category = document.getElementById("setting-category").value.trim();
  const ip_address = document.getElementById("setting-ip").value.trim();
  const location = document.getElementById("setting-location").value.trim();
  const auth_username = document.getElementById("setting-auth-user").value.trim();
  const auth_password = document.getElementById("setting-auth-pass").value.trim();
  const statusBox = document.getElementById("node-settings-status");
  const btn = document.getElementById("btn-save-settings");

  btn.disabled = true;
  btn.textContent = "Saving...";
  statusBox.style.display = "block";
  statusBox.style.background = "rgba(59, 130, 246, 0.15)";
  statusBox.style.color = "var(--accent-blue)";
  statusBox.textContent = "Saving node settings...";

  try {
    const res = await fetch(`${API_BASE}/nodes/${nodeId}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, room, category, ip_address, location, auth_username, auth_password })
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = "💾 Save Settings";

    if (data.success) {
      statusBox.style.background = "rgba(34, 197, 94, 0.15)";
      statusBox.style.color = "var(--accent-green)";
      statusBox.textContent = "Settings saved successfully!";
      setTimeout(() => {
        closeModal();
        loadNodes();
      }, 800);
    } else {
      statusBox.style.background = "rgba(239, 68, 68, 0.15)";
      statusBox.style.color = "var(--accent-red)";
      statusBox.textContent = "Error: " + (data.error || "Failed to update node");
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "💾 Save Settings";
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = "Network error: " + err.message;
  }
}

// Modal for adding or editing a relay channel
async function showAddRelayModal(nodeId, editChannelId = null) {
  let existingChannel = null;

  try {
    const res = await fetch(`${API_BASE}/nodes`);
    const rawNodes = await res.json();
    const nodes = Array.isArray(rawNodes) ? rawNodes : (rawNodes.nodes || []);
    const node = nodes.find(n => n.node_id === nodeId);
    if (node && node.channels_json) {
      const channels = typeof node.channels_json === 'string' ? JSON.parse(node.channels_json) : node.channels_json;
      if (editChannelId) {
        existingChannel = channels.find(c => (c.id || c.channel_id) === editChannelId);
      }
    }
  } catch (e) {
    console.warn("Could not find existing channel data", e);
  }

  const isEdit = !!existingChannel;
  const channelId = existingChannel ? (existingChannel.id || existingChannel.channel_id) : `ch${Date.now() % 1000}`;
  const pin = existingChannel ? existingChannel.pin : 4;
  const name = existingChannel ? existingChannel.name : 'Ceiling Light';
  const room = existingChannel ? (existingChannel.room || '') : '';
  const func = existingChannel ? (existingChannel.function || existingChannel.type || 'light') : 'light';
  const activeLow = existingChannel ? (existingChannel.active_low !== false) : true;
  const bootState = existingChannel ? (existingChannel.boot_state || 'OFF') : 'OFF';

  const html = `
    <div class="modal-content" style="max-width: 500px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0;">${isEdit ? '✏️ Edit Relay Channel' : '⚡ Add Relay Channel'}</h3>
        <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="showNodeSettingsModal('${nodeId}', 'relays')">&times;</button>
      </div>

      <div class="form-group">
        <label class="form-label">Channel Identifier (Unique) *</label>
        <input type="text" id="relay-channel-id" class="form-control" value="${escapeHtml(channelId)}" ${isEdit ? 'readonly style="opacity: 0.7;"' : ''} placeholder="ch1">
      </div>

      <div class="form-group">
        <label class="form-label">GPIO Pin *</label>
        <select id="relay-pin" class="form-control">
          <option value="4" ${pin == 4 ? 'selected' : ''}>GPIO 4 (NodeMCU D2) - Standard Relay 1</option>
          <option value="5" ${pin == 5 ? 'selected' : ''}>GPIO 5 (NodeMCU D1) - Standard Relay 2</option>
          <option value="12" ${pin == 12 ? 'selected' : ''}>GPIO 12 (NodeMCU D6) - Relay 3</option>
          <option value="14" ${pin == 14 ? 'selected' : ''}>GPIO 14 (NodeMCU D5) - Relay 4</option>
          <option value="13" ${pin == 13 ? 'selected' : ''}>GPIO 13 (NodeMCU D7)</option>
          <option value="15" ${pin == 15 ? 'selected' : ''}>GPIO 15 (NodeMCU D8 - Pull-down required)</option>
          <option value="0" ${pin == 0 ? 'selected' : ''}>GPIO 0 (NodeMCU D3 / ESP-01 Flash Pin)</option>
          <option value="2" ${pin == 2 ? 'selected' : ''}>GPIO 2 (NodeMCU D4 / ESP-01 TXD1)</option>
          <option value="16" ${pin == 16 ? 'selected' : ''}>GPIO 16 (NodeMCU D0 - No PWM)</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Friendly Name *</label>
        <input type="text" id="relay-name" class="form-control" value="${escapeHtml(name)}" placeholder="e.g. Master Bedroom Fan">
      </div>

      <div class="form-group">
        <label class="form-label">Room / Zone</label>
        <input type="text" id="relay-room" class="form-control" value="${escapeHtml(room)}" placeholder="Leave blank to use Node's room">
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Load Type / Function</label>
          <select id="relay-func" class="form-control">
            <option value="light" ${func === 'light' ? 'selected' : ''}>💡 Light</option>
            <option value="fan" ${func === 'fan' ? 'selected' : ''}>💨 Fan</option>
            <option value="socket" ${func === 'socket' ? 'selected' : ''}>🔌 Socket / Outlet</option>
            <option value="relay" ${func === 'relay' ? 'selected' : ''}>⚡ General Relay</option>
            <option value="heater" ${func === 'heater' ? 'selected' : ''}>🔥 Water Heater</option>
            <option value="ac" ${func === 'ac' ? 'selected' : ''}>❄️ AC / Cooler</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Initial State on Boot</label>
          <select id="relay-boot" class="form-control">
            <option value="OFF" ${bootState === 'OFF' ? 'selected' : ''}>OFF (Safe Default)</option>
            <option value="ON" ${bootState === 'ON' ? 'selected' : ''}>ON</option>
            <option value="RESTORE" ${bootState === 'RESTORE' ? 'selected' : ''}>RESTORE (Last State)</option>
          </select>
        </div>
      </div>

      <div style="margin-top: 4px;">
        <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
          <input type="checkbox" id="relay-active-low" ${activeLow ? 'checked' : ''}>
          <span>Active LOW Relay (Typical optically-isolated relay modules)</span>
        </label>
      </div>

      <div id="add-relay-status" style="display: none; padding: 8px; border-radius: 6px; font-size: 13px;"></div>

      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
        <button class="btn btn-secondary" onclick="showNodeSettingsModal('${nodeId}', 'relays')">Back</button>
        <button class="btn btn-primary" id="btn-submit-relay" onclick="submitSaveRelay('${nodeId}')">${isEdit ? 'Update Relay' : 'Add Relay'}</button>
      </div>
    </div>
  `;
  openModal(html);
}

// Submit relay add or update
async function submitSaveRelay(nodeId) {
  const channelId = document.getElementById("relay-channel-id").value.trim();
  const pin = parseInt(document.getElementById("relay-pin").value);
  const name = document.getElementById("relay-name").value.trim();
  const room = document.getElementById("relay-room").value.trim();
  const func = document.getElementById("relay-func").value;
  const bootState = document.getElementById("relay-boot").value;
  const activeLow = document.getElementById("relay-active-low").checked;
  const statusBox = document.getElementById("add-relay-status");
  const btn = document.getElementById("btn-submit-relay");

  if (!channelId || !name) {
    statusBox.style.display = "block";
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = "Please provide both Channel ID and Name.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const res = await fetch(`${API_BASE}/nodes/${nodeId}/relays`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: channelId,
        pin,
        name,
        room,
        function: func,
        active_low: activeLow,
        boot_state: bootState
      })
    });
    const data = await res.json();
    btn.disabled = false;

    if (data.success) {
      showNodeSettingsModal(nodeId, 'relays');
    } else {
      statusBox.style.display = "block";
      statusBox.style.background = "rgba(239, 68, 68, 0.15)";
      statusBox.style.color = "var(--accent-red)";
      statusBox.textContent = data.error || "Failed to save relay channel";
    }
  } catch (err) {
    btn.disabled = false;
    statusBox.style.display = "block";
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = "Network error: " + err.message;
  }
}

// Delete relay channel from node
async function deleteRelayChannel(nodeId, channelId) {
  if (!confirm(`Are you sure you want to delete relay channel "${channelId}" from this node?`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/nodes/${nodeId}/relays/${channelId}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (data.success) {
      showNodeSettingsModal(nodeId, 'relays');
    } else {
      alert("Failed to delete relay: " + (data.error || "Unknown error"));
    }
  } catch (err) {
    alert("Error deleting relay: " + err.message);
  }
}

// Push configuration to physical ESP hardware
async function pushConfigToNode(nodeId) {
  const resultDiv = document.getElementById("push-config-result");
  if (resultDiv) {
    resultDiv.style.display = "block";
    resultDiv.style.background = "rgba(59, 130, 246, 0.15)";
    resultDiv.style.color = "var(--accent-blue)";
    resultDiv.textContent = "Sending configuration update to ESP node...";
  }

  try {
    const res = await fetch(`${API_BASE}/nodes/${nodeId}/push-config`, {
      method: "POST"
    });
    const data = await res.json();
    if (resultDiv) {
      if (data.success) {
        resultDiv.style.background = "rgba(34, 197, 94, 0.15)";
        resultDiv.style.color = "var(--accent-green)";
        resultDiv.textContent = data.message || "Configuration successfully synced to node hardware!";
      } else {
        resultDiv.style.background = "rgba(239, 68, 68, 0.15)";
        resultDiv.style.color = "var(--accent-red)";
        resultDiv.textContent = data.error || "Failed to push configuration to hardware.";
      }
    }
  } catch (err) {
    if (resultDiv) {
      resultDiv.style.background = "rgba(239, 68, 68, 0.15)";
      resultDiv.style.color = "var(--accent-red)";
      resultDiv.textContent = "Network error pushing config: " + err.message;
    }
  }
}
'''

# Read app.js
with open('central_server_js/public/assets/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Locate section 2
start_marker = '// --- 2. NODES & ADD NODE MODAL ---'
end_marker = '// --- 3. RELAYS ---'

start_pos = content.find(start_marker)
end_pos = content.find(end_marker)

if start_pos == -1 or end_pos == -1:
    print(f"Error: Markers not found! start_pos={start_pos}, end_pos={end_pos}")
    sys.exit(1)

new_content = content[:start_pos] + new_section_2 + '\n\n' + content[end_pos:]

with open('central_server_js/public/assets/app.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Successfully replaced section 2 in app.js!")
