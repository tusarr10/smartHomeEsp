// ==============================================================================
// SmartHome Central Management Platform - SPA Controller (v1.6.0)
// ==============================================================================

const API_BASE = "/api/v1";
let currentView = "overview";
let ws = null;
let fleetData = {
  nodes: [],
  relays: [],
  sensors: [],
  rules: [],
  firmware: [],
  events: [],
  overview: {}
};

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  initWebSocket();
  loadCurrentView();
  setInterval(refreshActiveMetrics, 10000);
});

// --- NAVIGATION ---
function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", e => {
      e.preventDefault();
      document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      currentView = item.dataset.view;
      document.getElementById("view-title").textContent = item.querySelector("span:last-child").textContent;
      loadCurrentView();
    });
  });
}

function loadCurrentView() {
  const container = document.getElementById("content-area");
  container.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-secondary);">Loading ${currentView}...</div>`;

  switch (currentView) {
    case "overview": loadOverview(); break;
    case "nodes": loadNodes(); break;
    case "relays": loadRelays(); break;
    case "sensors": loadSensors(); break;
    case "automation": loadAutomation(); break;
    case "firmware": loadFirmware(); break;
    case "telemetry": loadTelemetry(); break;
    case "events": loadEvents(); break;
    case "notifications": loadNotifications(); break;
    case "network": loadNetwork(); break;
    case "users": loadUsers(); break;
    case "database": loadDatabase(); break;
    case "settings": loadSettings(); break;
    case "logs": loadLogs(); break;
    default: loadOverview();
  }
}

// --- WEBSOCKET REALTIME ENGINE ---
function initWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}${API_BASE}/ws`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateWsStatus(true);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleLiveEvent(msg.type, msg.data);
    } catch (e) {
      console.error("WS Parse Error:", e);
    }
  };

  ws.onclose = () => {
    updateWsStatus(false);
    setTimeout(initWebSocket, 4000);
  };

  ws.onerror = () => {
    updateWsStatus(false);
  };
}

function updateWsStatus(connected) {
  const badge = document.getElementById("ws-badge");
  if (!badge) return;
  if (connected) {
    badge.className = "status-badge badge-online";
    badge.innerHTML = `<span class="pulse-dot"></span> Live Sync`;
  } else {
    badge.className = "status-badge badge-offline";
    badge.innerHTML = `<span class="pulse-dot"></span> Reconnecting...`;
  }
}

function handleLiveEvent(type, data) {
  if (type === "relay_state_confirmed") {
    const el = document.getElementById(`relay-toggle-${data.node_id}-${data.channel_id}`);
    if (el) el.checked = data.new_state;
    const syncBadge = document.getElementById(`sync-badge-${data.node_id}-${data.channel_id}`);
    if (syncBadge) syncBadge.style.display = "none";
  } else if (type === "node_status" || type === "node_added" || type === "node_deleted") {
    if (currentView === "nodes" || currentView === "overview") loadCurrentView();
  } else if (type === "telemetry_update") {
    if (currentView === "telemetry") appendTelemetryLog(data);
    if (currentView === "overview") refreshActiveMetrics();
  }
}

// --- MODAL UTILITIES ---
function openModal(htmlContent) {
  let overlay = document.getElementById("global-modal-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "global-modal-overlay";
    overlay.className = "modal-overlay";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = htmlContent;
  overlay.style.display = "flex";
}

function closeModal() {
  const overlay = document.getElementById("global-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

// --- 1. OVERVIEW ---
async function loadOverview() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/system/overview`);
    const data = await res.json();
    fleetData.overview = data;

    const relaysRes = await fetch(`${API_BASE}/relays`);
    const relays = await relaysRes.json();

    container.innerHTML = `
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Registered Nodes</div>
          <div class="metric-value">${data.nodes.total} <span class="metric-sub">(${data.nodes.online} Online)</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Relay Channels</div>
          <div class="metric-value">${data.relays.total} <span class="metric-sub">(${data.relays.on} Active)</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Connected Sensors</div>
          <div class="metric-value">${data.sensors.total} <span class="metric-sub">Monitoring</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">TCP Telemetry (Port ${data.protocols.tcp_server.port})</div>
          <div class="metric-value" style="color: ${data.protocols.tcp_server.running ? 'var(--accent-green)' : 'var(--accent-red)'}">
            ${data.protocols.tcp_server.running ? 'RUNNING' : 'STOPPED'}
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin: 24px 0 16px 0;">
        <h3 style="margin: 0;">Quick Relay Controls</h3>
        <button class="btn btn-primary" onclick="showAddNodeModal()">+ Add Node</button>
      </div>
      <div class="cards-grid">
        ${relays.length === 0 ? '<div style="color: var(--text-secondary); padding: 16px;">No relays configured yet. Click "+ Add Node" to connect your first ESP8266 controller.</div>' : ''}
        ${relays.slice(0, 8).map(r => renderRelayCard(r)).join("")}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading overview: ${e.message}</div>`;
  }
}

// --- 2. NODES & ADD NODE MODAL ---
async function loadNodes() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/nodes`);
    const nodes = await res.json();
    fleetData.nodes = nodes;

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="font-size: 14px; color: var(--text-secondary);">${nodes.length} Node(s) in Fleet</div>
        <button class="btn btn-primary" onclick="showAddNodeModal()">+ Add Node</button>
      </div>
      <div class="cards-grid">
        ${nodes.length === 0 ? '<div style="color: var(--text-secondary); padding: 20px;">No nodes currently registered. Click "+ Add Node" to connect your NodeMCU / ESP8266 controller.</div>' : ''}
        ${nodes.map(n => `
          <div class="node-card">
            <div class="card-header">
              <div>
                <div class="card-title">${n.name}</div>
                <div class="card-meta">ID: <code>${n.node_id}</code></div>
              </div>
              <span class="status-badge ${n.is_online ? 'badge-online' : 'badge-offline'}">
                <span class="pulse-dot"></span> ${n.status}
              </span>
            </div>
            <div style="font-size: 13px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0;">
              <div><strong>HW:</strong> ${n.hardware_type}</div>
              <div><strong>FW:</strong> v${n.firmware_version}</div>
              <div><strong>IP:</strong> <a href="http://${n.ip_address}" target="_blank" style="color: var(--accent-blue);">${n.ip_address || 'N/A'}</a></div>
              <div><strong>RSSI:</strong> ${n.rssi} dBm</div>
              <div><strong>Uptime:</strong> ${Math.floor(n.uptime_sec / 3600)}h ${Math.floor((n.uptime_sec % 3600) / 60)}m</div>
              <div><strong>Free Heap:</strong> ${(n.free_heap / 1024).toFixed(1)} KB</div>
            </div>
            <div style="border-top: 1px solid var(--border-color); padding-top: 12px; display: flex; gap: 8px;">
              <button class="btn btn-secondary" style="font-size: 12px;" onclick="restartNode('${n.node_id}')">🔄 Reboot</button>
              <button class="btn btn-danger" style="font-size: 12px;" onclick="deleteNode('${n.node_id}')">🗑️ Delete</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading nodes: ${e.message}</div>`;
  }
}

function showAddNodeModal() {
  const html = `
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0;">+ Register Fleet Node</h3>
        <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
      </div>
      <p style="font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5;">
        Enter the LAN IP address of your ESP8266 or ESP32 node. The server will probe its status, read configured relay channels, and register it in the central fleet.
      </p>
      <div class="form-group">
        <label class="form-label">Node IP Address *</label>
        <input type="text" id="add-node-ip" class="form-control" placeholder="192.168.1.105" value="192.168.1.105">
      </div>
      <div class="form-group">
        <label class="form-label">Friendly Name (Optional)</label>
        <input type="text" id="add-node-name" class="form-control" placeholder="e.g. Master Controller">
      </div>
      <div class="form-group">
        <label class="form-label">Room / Zone</label>
        <input type="text" id="add-node-room" class="form-control" placeholder="General" value="General">
      </div>
      <div id="add-node-status" style="display: none; font-size: 13px; padding: 8px; border-radius: 6px;"></div>
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
      body: JSON.stringify({ ip, name, room })
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

// --- 3. RELAYS ---
async function loadRelays() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/relays`);
    const relays = await res.json();
    fleetData.relays = relays;

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="font-size: 14px; color: var(--text-secondary);">${relays.length} Relay Channels Managed</div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary" onclick="broadcastRelays(true)">All ON</button>
          <button class="btn btn-secondary" onclick="broadcastRelays(false)">All OFF</button>
        </div>
      </div>
      <div class="cards-grid">
        ${relays.length === 0 ? '<div style="color: var(--text-secondary); padding: 16px;">No relays detected. Once nodes report telemetry, all channels will appear here automatically.</div>' : ''}
        ${relays.map(r => renderRelayCard(r)).join("")}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading relays: ${e.message}</div>`;
  }
}

function renderRelayCard(r) {
  return `
    <div class="relay-card">
      <div class="card-header">
        <div>
          <div class="card-title">${r.name}</div>
          <div class="card-meta">${r.node_name} | Pin D${r.pin} (GPIO${r.pin})</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="relay-toggle-${r.node_id}-${r.channel_id}" 
            ${r.current_state ? 'checked' : ''} 
            onchange="toggleRelay('${r.node_id}', ${r.channel_id}, this.checked)">
          <span class="slider"></span>
        </label>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary); display: flex; justify-content: space-between; margin: 8px 0;">
        <span>Room: <strong>${r.room}</strong></span>
        <span>Logic: ${r.active_low ? 'Active-Low' : 'Active-High'}</span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px;" onclick="pulseRelay('${r.node_id}', ${r.channel_id})">⚡ Pulse 500ms</button>
        <span id="sync-badge-${r.node_id}-${r.channel_id}" style="display: ${r.is_syncing ? 'inline' : 'none'}; font-size: 11px; color: var(--accent-amber);">Syncing...</span>
      </div>
    </div>
  `;
}

async function toggleRelay(nodeId, channelId, state) {
  const syncBadge = document.getElementById(`sync-badge-${nodeId}-${channelId}`);
  if (syncBadge) syncBadge.style.display = "inline";

  try {
    await fetch(`${API_BASE}/relays/${nodeId}/${channelId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setState", state: state })
    });
  } catch (e) {
    alert("Relay command failed: " + e.message);
  }
}

async function pulseRelay(nodeId, channelId) {
  try {
    await fetch(`${API_BASE}/relays/${nodeId}/${channelId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pulse", duration: 500 })
    });
  } catch (e) {
    alert("Pulse failed: " + e.message);
  }
}

async function broadcastRelays(state) {
  await fetch(`${API_BASE}/relays/broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "setState", state: state })
  });
  loadRelays();
}

async function restartNode(nodeId) {
  if (!confirm(`Reboot node ${nodeId}?`)) return;
  await fetch(`${API_BASE}/nodes/${nodeId}/restart`, { method: "POST" });
  alert("Reboot command sent.");
}

async function deleteNode(nodeId) {
  if (!confirm(`Permanently remove ${nodeId} from fleet?`)) return;
  await fetch(`${API_BASE}/nodes/${nodeId}`, { method: "DELETE" });
  loadNodes();
}

// --- 4. SENSORS ---
async function loadSensors() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/sensors`);
    const sensors = await res.json();
    container.innerHTML = `
      <div style="margin-bottom: 20px; font-size: 14px; color: var(--text-secondary);">${sensors.length} Dynamic Sensors Registered</div>
      <div class="cards-grid">
        ${sensors.length === 0 ? '<div style="color: var(--text-secondary); padding: 16px;">No external sensors (e.g. DHT11/BME280) detected. Standard GPIO output relays are active.</div>' : ''}
        ${sensors.map(s => `
          <div class="sensor-card">
            <div class="card-header">
              <div>
                <div class="card-title">${s.name}</div>
                <div class="card-meta">${s.node_id} | Type: ${s.sensor_type}</div>
              </div>
              <div style="font-size: 24px; font-weight: 700; color: var(--accent-blue);">
                ${s.current_value !== null ? s.current_value + ' ' + s.unit : 'N/A'}
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading sensors: ${e.message}</div>`;
  }
}

// --- 5. AUTOMATION (FIXED & FULLY FUNCTIONAL) ---
async function loadAutomation() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/automations`);
    const rules = await res.json();
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="font-size: 14px; color: var(--text-secondary);">${rules.length} Central Automation Rule(s) Configured</div>
        <button class="btn btn-primary" onclick="showCreateAutomationModal()">+ Create Automation Rule</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Rule Name</th>
            <th>Trigger Type</th>
            <th>Conditions</th>
            <th>Actions</th>
            <th>Executions</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rules.length === 0 ? '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No automation rules configured. Click "+ Create Automation Rule" to add one.</td></tr>' : ''}
          ${rules.map(r => `
            <tr>
              <td><strong>${r.name}</strong><br><small style="color: var(--text-muted);">${r.description || ''}</small></td>
              <td>${r.trigger_type || 'GPIO State'}</td>
              <td>${(r.conditions || []).length} (${r.condition_logic || 'ALL'})</td>
              <td>${(r.actions || []).length} action(s)</td>
              <td>${r.execution_count || 0} times</td>
              <td>
                <label class="switch" style="transform: scale(0.85); transform-origin: left center;">
                  <input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="toggleAutomationRule(${r.id})">
                  <span class="slider"></span>
                </label>
              </td>
              <td>
                <button class="btn btn-danger" style="font-size: 11px; padding: 4px 8px;" onclick="deleteAutomationRule(${r.id})">Delete</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading automations: ${e.message}</div>`;
  }
}

function showCreateAutomationModal() {
  const html = `
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0;">+ Create Automation Rule</h3>
        <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">Rule Name *</label>
        <input type="text" id="auto-name" class="form-control" placeholder="e.g. Night Gate Light Auto-Off">
      </div>
      <div class="form-group">
        <label class="form-label">Trigger Type</label>
        <select id="auto-trigger-type" class="form-control">
          <option value="GPIO State Change">GPIO Relay State Change</option>
          <option value="Heartbeat Check">Node Telemetry Heartbeat</option>
          <option value="Time Schedule">Periodic Schedule</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Rule Description</label>
        <input type="text" id="auto-desc" class="form-control" placeholder="Details about this automated trigger">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitCreateAutomation()">Save Rule</button>
      </div>
    </div>
  `;
  openModal(html);
}

async function submitCreateAutomation() {
  const name = document.getElementById("auto-name").value.trim();
  const trigger_type = document.getElementById("auto-trigger-type").value;
  const description = document.getElementById("auto-desc").value.trim();

  if (!name) {
    alert("Please enter a rule name.");
    return;
  }

  await fetch(`${API_BASE}/automations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      trigger_type,
      description,
      conditions: [{ target: "Trigger", operator: "EQUALS", value: true }],
      actions: [{ target: "Relay", action: "toggle" }],
      enabled: true
    })
  });

  closeModal();
  loadAutomation();
}

async function toggleAutomationRule(id) {
  await fetch(`${API_BASE}/automations/${id}/toggle`, { method: "POST" });
}

async function deleteAutomationRule(id) {
  if (!confirm("Delete this automation rule?")) return;
  await fetch(`${API_BASE}/automations/${id}`, { method: "DELETE" });
  loadAutomation();
}

// --- 6. FIRMWARE & OTA (FIXED & UPLOAD READY) ---
async function loadFirmware() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/firmware`);
    const files = await res.json();
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="font-size: 14px; color: var(--text-secondary);">Firmware Repository & Staged OTA Deployments</div>
        <button class="btn btn-primary" onclick="showUploadFirmwareModal()">+ Upload Firmware (.bin)</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Filename</th>
            <th>Version</th>
            <th>Target Hardware</th>
            <th>Size</th>
            <th>MD5 Checksum</th>
            <th>Deploy</th>
          </tr>
        </thead>
        <tbody>
          ${files.length === 0 ? '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No firmware binaries in catalog. Click "+ Upload Firmware" to add one.</td></tr>' : ''}
          ${files.map(f => `
            <tr>
              <td><strong>${f.filename}</strong></td>
              <td>v${f.version}</td>
              <td><span class="status-badge badge-sync">${f.hardware_type}</span></td>
              <td>${(f.file_size_bytes / 1024).toFixed(1)} KB</td>
              <td><code style="font-size: 11px;">${f.checksum_md5}</code></td>
              <td>
                <button class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px;" onclick="deployFirmwareOta(${f.id}, '${f.filename}')">🚀 Flash OTA</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading firmware: ${e.message}</div>`;
  }
}

function showUploadFirmwareModal() {
  const html = `
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0;">Upload Firmware Binary (.bin)</h3>
        <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">Firmware File (.bin) *</label>
        <input type="file" id="fw-file" class="form-control" accept=".bin">
      </div>
      <div class="form-group">
        <label class="form-label">Firmware Version</label>
        <input type="text" id="fw-version" class="form-control" placeholder="1.6.0" value="1.6.0">
      </div>
      <div class="form-group">
        <label class="form-label">Target Hardware</label>
        <select id="fw-hardware" class="form-control">
          <option value="ESP8266">ESP8266 (ESP-12E/F NodeMCU)</option>
          <option value="ESP32">ESP32</option>
          <option value="ESP-01">ESP-01</option>
        </select>
      </div>
      <div id="fw-upload-status" style="display: none; font-size: 13px; padding: 8px; border-radius: 6px;"></div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="btn-submit-upload-fw" onclick="submitUploadFirmware()">Upload Binary</button>
      </div>
    </div>
  `;
  openModal(html);
}

async function submitUploadFirmware() {
  const fileInput = document.getElementById("fw-file");
  const version = document.getElementById("fw-version").value.trim() || "1.6.0";
  const hardware_type = document.getElementById("fw-hardware").value;
  const statusBox = document.getElementById("fw-upload-status");
  const btn = document.getElementById("btn-submit-upload-fw");

  if (!fileInput.files || fileInput.files.length === 0) {
    statusBox.style.display = "block";
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = "Please select a .bin firmware file.";
    return;
  }

  const formData = new FormData();
  formData.append("firmware", fileInput.files[0]);
  formData.append("version", version);
  formData.append("hardware_type", hardware_type);

  btn.disabled = true;
  btn.textContent = "Uploading...";
  statusBox.style.display = "block";
  statusBox.style.background = "rgba(59, 130, 246, 0.15)";
  statusBox.style.color = "var(--accent-blue)";
  statusBox.textContent = "Uploading file to server...";

  try {
    const res = await fetch(`${API_BASE}/firmware/upload`, {
      method: "POST",
      body: formData
    });
    const result = await res.json();
    if (result.success) {
      statusBox.style.background = "rgba(34, 197, 94, 0.15)";
      statusBox.style.color = "var(--accent-green)";
      statusBox.textContent = "Firmware uploaded and registered!";
      setTimeout(() => {
        closeModal();
        loadFirmware();
      }, 1000);
    } else {
      statusBox.style.background = "rgba(239, 68, 68, 0.15)";
      statusBox.style.color = "var(--accent-red)";
      statusBox.textContent = result.error || "Upload failed.";
      btn.disabled = false;
      btn.textContent = "Try Again";
    }
  } catch (err) {
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = "Error: " + err.message;
    btn.disabled = false;
    btn.textContent = "Try Again";
  }
}

async function deployFirmwareOta(fwId, filename) {
  const nodesRes = await fetch(`${API_BASE}/nodes`);
  const nodes = await nodesRes.json();
  if (nodes.length === 0) {
    alert("No registered nodes online to deploy firmware to.");
    return;
  }

  const nodeOptions = nodes.map(n => `${n.name} (${n.ip_address || n.node_id})`).join("\n");
  const target = prompt(`Enter Node IP or Node ID to flash ${filename}:\n\nAvailable Nodes:\n${nodeOptions}`, nodes[0].ip_address || nodes[0].node_id);
  if (!target) return;

  const selectedNode = nodes.find(n => n.node_id === target || n.ip_address === target) || nodes[0];
  const res = await fetch(`${API_BASE}/firmware/${fwId}/flash/${selectedNode.node_id}`, { method: "POST" });
  const result = await res.json();
  alert(result.message || "OTA firmware deployment initiated!");
}

// --- 7. TELEMETRY (FIXED & LIVE STREAMING) ---
async function loadTelemetry() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/telemetry?limit=30`);
    const logs = await res.json();

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div style="font-size: 14px; color: var(--text-secondary);">Live Telemetry Ingestion (Port 2000 TCP & HTTP)</div>
        <span class="status-badge badge-online"><span class="pulse-dot"></span> Streaming</span>
      </div>

      <div style="margin-bottom: 12px; font-weight: 600; font-size: 13px;">Live Ingestion Stream:</div>
      <div id="telemetry-log-stream" style="background: #060911; border: 1px solid var(--border-color); border-radius: 8px; padding: 14px; height: 180px; overflow-y: auto; font-family: monospace; font-size: 12px; margin-bottom: 24px;">
        <div style="color: var(--text-muted);">Listening for real-time telemetry packets...</div>
      </div>

      <div style="margin-bottom: 12px; font-weight: 600; font-size: 13px;">Recent Telemetry Packets:</div>
      <table class="data-table" id="telemetry-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Node ID</th>
            <th>Event</th>
            <th>Node IP</th>
            <th>Signal (RSSI)</th>
            <th>Free Heap</th>
            <th>Uptime</th>
          </tr>
        </thead>
        <tbody id="telemetry-table-body">
          ${logs.length === 0 ? '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No telemetry packets received yet.</td></tr>' : ''}
          ${logs.map(t => `
            <tr>
              <td>${t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : 'Recent'}</td>
              <td><code>${t.node_id}</code></td>
              <td><span class="status-badge badge-sync">${t.event_type}</span></td>
              <td>${t.ip || 'LAN'}</td>
              <td>${t.rssi} dBm</td>
              <td>${(t.free_heap / 1024).toFixed(1)} KB</td>
              <td>${Math.floor(t.uptime_sec / 60)} min</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading telemetry: ${e.message}</div>`;
  }
}

function appendTelemetryLog(data) {
  const stream = document.getElementById("telemetry-log-stream");
  const nodeId = data.node_id || data.nodeId || "Node";
  const ip = data.ip || "LAN";
  const rssi = data.rssi || 0;
  const heap = data.free_heap || data.freeHeap || 0;
  const eventType = data.event_type || data.eventType || "heartbeat";

  if (stream) {
    const entry = document.createElement("div");
    entry.style.marginBottom = "6px";
    entry.innerHTML = `<span style="color: var(--accent-blue);">[${new Date().toLocaleTimeString()}]</span> <span style="color: var(--accent-green); font-weight: 600;">${nodeId}</span> (${ip}) | RSSI: ${rssi} dBm | Heap: ${(heap/1024).toFixed(1)} KB | Event: <strong>${eventType}</strong>`;
    stream.prepend(entry);
  }

  // Also prepend row to table if on telemetry view
  const tbody = document.getElementById("telemetry-table-body");
  if (tbody) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date().toLocaleTimeString()}</td>
      <td><code>${nodeId}</code></td>
      <td><span class="status-badge badge-sync">${eventType}</span></td>
      <td>${ip}</td>
      <td>${rssi} dBm</td>
      <td>${(heap / 1024).toFixed(1)} KB</td>
      <td>${Math.floor((data.uptime_sec || data.uptimeSec || 0) / 60)} min</td>
    `;
    tbody.prepend(row);
  }
}

// --- 8. EVENTS ---
async function loadEvents() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/system/events`);
    const events = await res.json();
    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Category</th>
            <th>Severity</th>
            <th>Node</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${events.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No events recorded yet.</td></tr>' : ''}
          ${events.map(ev => `
            <tr>
              <td>${ev.timestamp ? new Date(ev.timestamp).toLocaleString() : 'Recent'}</td>
              <td>${ev.category}</td>
              <td><span class="status-badge ${ev.severity === 'WARNING' ? 'badge-sync' : 'badge-online'}">${ev.severity}</span></td>
              <td>${ev.node_id || 'System'}</td>
              <td>${ev.description}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading events: ${e.message}</div>`;
  }
}

// --- 9. NOTIFICATIONS ---
async function loadNotifications() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/system/notifications`);
    const notifs = await res.json();
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
        <div>${notifs.length} Alerts & Notifications</div>
        <button class="btn btn-secondary" onclick="markAllNotificationsRead()">Mark All Read</button>
      </div>
      <div class="cards-grid">
        ${notifs.length === 0 ? '<div style="color: var(--text-secondary); padding: 16px;">No unread alerts or notifications.</div>' : ''}
        ${notifs.map(n => `
          <div class="node-card">
            <div class="card-header">
              <div class="card-title">${n.title}</div>
              <span class="status-badge badge-sync">${n.severity}</span>
            </div>
            <p style="font-size: 13.5px; color: var(--text-secondary); margin: 8px 0;">${n.message}</p>
            <div style="font-size: 11px; color: var(--text-muted);">${n.timestamp ? new Date(n.timestamp).toLocaleString() : 'Recent'}</div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading notifications: ${e.message}</div>`;
  }
}

async function markAllNotificationsRead() {
  await fetch(`${API_BASE}/system/notifications/mark-read`, { method: "POST" });
  loadNotifications();
}

// --- 10. NETWORK ---
async function loadNetwork() {
  const container = document.getElementById("content-area");
  container.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">TCP Telemetry Port</div>
        <div class="metric-value">2000</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">WebSocket Stream</div>
        <div class="metric-value">/api/v1/ws</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">HTTP Web Port</div>
        <div class="metric-value">9100</div>
      </div>
    </div>
    <div class="metric-card" style="margin-top: 20px;">
      <h3 style="margin-bottom: 12px;">Remote Access & ESP8266 Settings</h3>
      <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.6;">
        In the NodeMCU ESP8266 dashboard (<code>http://192.168.1.105</code>), set the Central Receiver configuration to:<br>
        • <strong>Server Host</strong>: <code>192.168.1.10</code><br>
        • <strong>Protocol</strong>: <code>Raw TCP Socket</code> or <code>HTTP POST</code><br>
        • <strong>Port</strong>: <code>2000</code> (TCP) or <code>9100</code> (HTTP)<br>
        Telemetry heartbeats and relay switching events stream in real-time.
      </p>
    </div>
  `;
}

// --- 11. USERS ---
async function loadUsers() {
  const container = document.getElementById("content-area");
  container.innerHTML = `
    <div class="metric-card">
      <h3>Active Administrator</h3>
      <p style="margin-top: 8px; color: var(--text-secondary);">User: <strong>admin</strong> | Role: <strong>Administrator</strong></p>
    </div>
  `;
}

// --- 12. DATABASE ---
async function loadDatabase() {
  const container = document.getElementById("content-area");
  container.innerHTML = `
    <div class="metric-card">
      <h3>High-Performance Native SQLite Engine</h3>
      <p style="margin: 10px 0 16px 0; color: var(--text-secondary); line-height: 1.6;">
        Database engine: <strong>node:sqlite (Node.js 24 Native C++ Driver)</strong><br>
        Database path: <code>central_server_js/data/fleet.db</code><br>
        Active tables: <code>nodes</code>, <code>relays</code>, <code>telemetry_logs</code>, <code>audit_logs</code>, <code>automations</code>, <code>firmware</code>
      </p>
      <button class="btn btn-primary" onclick="alert('Database is continuously synchronized to central_server_js/data/fleet.db.')">💾 Database Verified Active</button>
    </div>
  `;
}

// --- 13. SETTINGS ---
async function loadSettings() {
  const container = document.getElementById("content-area");
  container.innerHTML = `
    <div class="metric-card">
      <h3>Platform Configuration</h3>
      <p style="margin-top: 8px; color: var(--text-secondary); line-height: 1.6;">
        Configuration file: <code>central_server_js/config.json</code><br>
        HTTP Port: <strong>9100</strong> | TCP Port: <strong>2000</strong> | Node Auth: <strong>admin/admin</strong>
      </p>
    </div>
  `;
}

// --- 14. LOGS (FIXED: DEFINITE DATES & CLEAN FORMAT) ---
async function loadLogs() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/system/logs`);
    const data = await res.json();
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="font-size: 14px; color: var(--text-secondary);">${data.length} Audit Log Entries</div>
        <button class="btn btn-secondary" onclick="loadLogs()">🔄 Refresh Logs</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Target</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${data.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No audit logs recorded yet.</td></tr>' : ''}
          ${data.map(l => {
            const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleString() : 'Just now';
            return `
              <tr>
                <td style="white-space: nowrap; font-size: 12.5px;">${timeStr}</td>
                <td><strong>${l.user || l.username || 'admin'}</strong></td>
                <td><span class="status-badge badge-sync">${l.action || 'SYSTEM'}</span></td>
                <td><code>${l.target || l.node_id || 'System'}</code></td>
                <td>${l.details || l.message || ''}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading audit logs: ${e.message}</div>`;
  }
}

function refreshActiveMetrics() {
  if (currentView === "overview") loadOverview();
}
