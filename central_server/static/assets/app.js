// ==============================================================================
// SmartHome Central Management Platform - SPA Controller
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
  initRealtimeSync();
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

// --- REALTIME SYNC ENGINE (SSE with WebSocket Fallback) ---
function initRealtimeSync() {
  try {
    const sse = new EventSource(`${API_BASE}/events`);
    sse.onopen = () => {
      updateWsStatus(true);
    };
    sse.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleLiveEvent(msg.type || "telemetry_update", msg.data || msg);
      } catch (e) {}
    };
    sse.addEventListener("node_status", (e) => {
      try { handleLiveEvent("node_status", JSON.parse(e.data)); } catch (err) {}
    });
    sse.addEventListener("telemetry", (e) => {
      try { handleLiveEvent("telemetry_update", JSON.parse(e.data)); } catch (err) {}
    });
    sse.addEventListener("command_executed", (e) => {
      try { handleLiveEvent("relay_state_confirmed", JSON.parse(e.data)); } catch (err) {}
    });
    sse.onerror = () => {
      tryWebSocketFallback();
    };
    return;
  } catch (e) {
    tryWebSocketFallback();
  }
}

function tryWebSocketFallback() {
  try {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}${API_BASE}/ws`;
    ws = new WebSocket(wsUrl);
    ws.onopen = () => updateWsStatus(true);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleLiveEvent(msg.type, msg.data);
      } catch (e) {}
    };
    ws.onclose = () => {
      updateWsStatus(false);
      setTimeout(initRealtimeSync, 5000);
    };
    ws.onerror = () => {
      updateWsStatus(false);
      setTimeout(initRealtimeSync, 5000);
    };
  } catch (e) {
    updateWsStatus(false);
    setTimeout(initRealtimeSync, 5000);
  }
}

function updateWsStatus(connected) {
  const badge = document.getElementById("ws-badge");
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
    // Update relay toggles in DOM
    const el = document.getElementById(`relay-toggle-${data.node_id}-${data.channel_id}`);
    if (el) el.checked = data.new_state;
    const syncBadge = document.getElementById(`sync-badge-${data.node_id}-${data.channel_id}`);
    if (syncBadge) syncBadge.style.display = "none";
  } else if (type === "node_status") {
    // Refresh if in nodes or overview
    if (currentView === "nodes" || currentView === "overview") loadCurrentView();
  } else if (type === "telemetry_update") {
    if (currentView === "telemetry") appendTelemetryLog(data);
  }
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
          <div class="metric-label">TCP Listener (Port ${data.protocols.tcp_server.port})</div>
          <div class="metric-value" style="color: ${data.protocols.tcp_server.running ? 'var(--accent-green)' : 'var(--accent-red)'}">
            ${data.protocols.tcp_server.running ? 'RUNNING' : 'STOPPED'}
          </div>
        </div>
      </div>

      <h3 style="margin-bottom: 16px;">Quick Relay Controls</h3>
      <div class="cards-grid">
        ${relays.slice(0, 8).map(r => renderRelayCard(r)).join("")}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading overview: ${e.message}</div>`;
  }
}

// --- 2. NODES ---
async function loadNodes() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/nodes`);
    const nodes = await res.json();
    fleetData.nodes = nodes;

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="font-size: 14px; color: var(--text-secondary);">${nodes.length} Nodes Configured</div>
        <button class="btn btn-primary" onclick="showAddNodeModal()">+ Add Node</button>
      </div>
      <div class="cards-grid">
        ${nodes.map(n => {
          const name = n.name || n.node_name || n.node_id;
          const isOnline = !!n.is_online;
          const status = isOnline ? 'Online' : 'Offline';
          const ip = n.ip_address || n.ip || 'N/A';
          const hw = n.hardware_type || 'ESP8266';
          const fw = n.firmware_version || '1.6.0';
          const rssi = n.rssi !== undefined ? n.rssi : 0;
          const uptime = n.uptime_sec || 0;
          const heap = n.free_heap || 0;
          return `
          <div class="node-card">
            <div class="card-header">
              <div>
                <div class="card-title">${name}</div>
                <div class="card-meta">ID: <code>${n.node_id}</code></div>
              </div>
              <span class="status-badge ${isOnline ? 'badge-online' : 'badge-offline'}">
                <span class="pulse-dot"></span> ${status}
              </span>
            </div>
            <div style="font-size: 13px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div><strong>HW:</strong> ${hw}</div>
              <div><strong>FW:</strong> v${fw}</div>
              <div><strong>IP:</strong> <a href="http://${ip}" target="_blank" style="color: var(--accent-blue);">${ip}</a></div>
              <div><strong>RSSI:</strong> ${rssi} dBm</div>
              <div><strong>Uptime:</strong> ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m</div>
              <div><strong>Free Heap:</strong> ${(heap / 1024).toFixed(1)} KB</div>
            </div>
            <div style="border-top: 1px solid var(--border-color); padding-top: 12px; display: flex; gap: 8px;">
              <button class="btn btn-secondary" onclick="restartNode('${n.node_id}')">🔄 Reboot</button>
              <button class="btn btn-danger" onclick="deleteNode('${n.node_id}')">🗑️ Delete</button>
            </div>
          </div>
        `;}).join("")}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading nodes: ${e.message}</div>`;
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
      <div style="font-size: 12px; color: var(--text-secondary); display: flex; justify-content: space-between;">
        <span>Room: <strong>${r.room}</strong></span>
        <span>Logic: ${r.active_low ? 'Active-Low' : 'Active-High'}</span>
      </div>
      <div style="display: flex; gap: 8px;">
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
            <div style="font-size: 12px; color: var(--text-secondary);">
              Thresholds: Min: ${s.min_threshold || 'None'} | Max: ${s.max_threshold || 'None'}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading sensors: ${e.message}</div>`;
  }
}

// --- 5. AUTOMATION ---
async function loadAutomation() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/automations`);
    const rules = await res.json();
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="font-size: 14px; color: var(--text-secondary);">${rules.length} Central Automation Rules</div>
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
          </tr>
        </thead>
        <tbody>
          ${rules.map(r => `
            <tr>
              <td><strong>${r.name}</strong><br><small style="color: var(--text-muted);">${r.description}</small></td>
              <td>${r.trigger_type}</td>
              <td>${r.conditions.length} (${r.condition_logic})</td>
              <td>${r.actions.length} action(s)</td>
              <td>${r.execution_count} times</td>
              <td>
                <span class="status-badge ${r.enabled ? 'badge-online' : 'badge-offline'}">
                  ${r.enabled ? 'Active' : 'Disabled'}
                </span>
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

// --- 6. FIRMWARE & OTA ---
async function loadFirmware() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/firmware`);
    const files = await res.json();
    container.innerHTML = `
      <div style="margin-bottom: 20px; font-size: 14px; color: var(--text-secondary);">Firmware Repository & Staged OTA Deployments</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Filename</th>
            <th>Version</th>
            <th>Target Hardware</th>
            <th>Size (Bytes)</th>
            <th>MD5 Checksum</th>
          </tr>
        </thead>
        <tbody>
          ${files.map(f => `
            <tr>
              <td>${f.filename}</td>
              <td>v${f.version}</td>
              <td><strong>${f.hardware_type}</strong></td>
              <td>${(f.file_size_bytes / 1024).toFixed(1)} KB</td>
              <td><code>${f.checksum_md5}</code></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading firmware: ${e.message}</div>`;
  }
}

// --- 7. TELEMETRY ---
async function loadTelemetry() {
  const container = document.getElementById("content-area");
  container.innerHTML = `
    <div style="margin-bottom: 16px; font-size: 14px; color: var(--text-secondary);">Live Structured Telemetry Stream (Port 2000 & MQTT)</div>
    <div id="telemetry-log-stream" style="background: #060911; border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; height: 500px; overflow-y: auto; font-family: monospace; font-size: 12.5px;">
      <div style="color: var(--text-muted);">Awaiting telemetry packets...</div>
    </div>
  `;
}

function appendTelemetryLog(data) {
  const stream = document.getElementById("telemetry-log-stream");
  if (!stream) return;
  const entry = document.createElement("div");
  entry.style.marginBottom = "8px";
  entry.innerHTML = `<span style="color: var(--accent-blue);">[${new Date().toLocaleTimeString()}]</span> <span style="color: var(--accent-green);">${data.node_id}</span> (${data.ip}) RSSI: ${data.rssi}dBm Heap: ${data.free_heap}B Event: ${data.event_type}`;
  stream.prepend(entry);
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
          ${events.map(ev => `
            <tr>
              <td>${new Date(ev.timestamp).toLocaleString()}</td>
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
        ${notifs.map(n => `
          <div class="node-card">
            <div class="card-header">
              <div class="card-title">${n.title}</div>
              <span class="status-badge badge-sync">${n.severity}</span>
            </div>
            <p style="font-size: 13.5px; color: var(--text-secondary);">${n.message}</p>
            <div style="font-size: 11px; color: var(--text-muted);">${new Date(n.timestamp).toLocaleString()}</div>
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
        <div class="metric-label">MQTT Port</div>
        <div class="metric-value">1883</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">HTTP Web Port</div>
        <div class="metric-value">8000</div>
      </div>
    </div>
    <div class="metric-card">
      <h3 style="margin-bottom: 12px;">Remote Access Recommendation</h3>
      <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.6;">
        For secure remote control from your mobile phone outside the home Wi-Fi, install <strong>Tailscale</strong> on this Windows PC and on your Android/iPhone.<br>
        Tailscale provides an encrypted WireGuard peer-to-peer mesh VPN with zero port forwarding required on your home router!
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
      <h3>PostgreSQL Primary Database & Automated Backups</h3>
      <p style="margin: 10px 0 16px 0; color: var(--text-secondary); line-height: 1.6;">
        Database schema: <code>database/schema.sql</code><br>
        Automated weekly backup script: <code>database/backup_postgres.bat</code><br>
        Retention policy: 8 weekly snapshots preserved in <code>central_server/backups/</code>
      </p>
      <button class="btn btn-primary" onclick="alert('Run database/backup_postgres.bat on your Windows command prompt.')">💾 Run Database Backup Now</button>
    </div>
  `;
}

// --- 13. SETTINGS ---
async function loadSettings() {
  const container = document.getElementById("content-area");
  container.innerHTML = `
    <div class="metric-card">
      <h3>Platform Settings</h3>
      <p style="margin-top: 8px; color: var(--text-secondary);">
        Configuration file: <code>central_server/backend/app/config.py</code> and <code>.env</code>
      </p>
    </div>
  `;
}

// --- 14. LOGS ---
async function loadLogs() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/system/logs`);
    const data = await res.json();
    container.innerHTML = `
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
          ${data.map(l => `
            <tr>
              <td>${new Date(l.timestamp).toLocaleString()}</td>
              <td>${l.username || 'System'}</td>
              <td><strong>${l.action}</strong></td>
              <td>${l.target || 'N/A'}</td>
              <td>${l.details || ''}</td>
            </tr>
          `).join("")}
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
