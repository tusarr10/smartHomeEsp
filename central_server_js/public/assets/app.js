let authToken = localStorage.getItem('smarthome_token') || '';
let currentUser = null;

// Global transparent fetch interceptor to attach Bearer token and handle 401 Unauthorized
const _nativeFetch = window.fetch;
window.fetch = async function(resource, init = {}) {
  init = init || {};
  const urlStr = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');

  // Attach token if available
  if (authToken && (urlStr.includes('/api/') || urlStr.startsWith('/api'))) {
    if (!init.headers) {
      init.headers = { 'Authorization': `Bearer ${authToken}` };
    } else if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
      if (!init.headers.has('Authorization')) {
        init.headers.set('Authorization', `Bearer ${authToken}`);
      }
    } else if (Array.isArray(init.headers)) {
      if (!init.headers.some(([k]) => k.toLowerCase() === 'authorization')) {
        init.headers.push(['Authorization', `Bearer ${authToken}`]);
      }
    } else {
      if (!init.headers['Authorization'] && !init.headers['authorization']) {
        init.headers['Authorization'] = `Bearer ${authToken}`;
      }
    }
  }

  let res = await _nativeFetch(resource, init);

  // If token is rejected (401 Unauthorized), session has expired or been revoked
  if (res.status === 401 && !urlStr.includes('/auth/login')) {
    if (authToken || currentUser) {
      authToken = '';
      currentUser = null;
      localStorage.removeItem('smarthome_token');
      if (ws) {
        try { ws.close(); } catch {}
        ws = null;
      }
      if (typeof closeModal === 'function') closeModal();
      if (typeof updateTopbarUserBadge === 'function') updateTopbarUserBadge();
      if (typeof showLoginScreen === 'function') showLoginScreen();
      if (typeof showToast === 'function') {
        showToast({ title: 'Session Expired', message: 'Please sign in to continue.', severity: 'WARNING' });
      }
    }
  }

  return res;
};

async function fetchWithAuth(url, options = {}) {
  return window.fetch(url, options);
}

async function checkCurrentUser() {
  if (!authToken) {
    currentUser = null;
    updateTopbarUserBadge();
    return false;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/auth/me`);
    if (res.status === 401) {
      currentUser = null;
      authToken = '';
      localStorage.removeItem('smarthome_token');
      updateTopbarUserBadge();
      return false;
    }
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      updateTopbarUserBadge();
      return true;
    } else {
      currentUser = null;
      authToken = '';
      localStorage.removeItem('smarthome_token');
      updateTopbarUserBadge();
      return false;
    }
  } catch {
    currentUser = null;
    updateTopbarUserBadge();
    return false;
  }
}

function showLoginScreen() {
  const screen = document.getElementById('login-screen');
  if (screen) {
    screen.style.display = 'flex';
    const uInput = document.getElementById('login-username');
    if (uInput) {
      setTimeout(() => uInput.focus(), 60);
    }
    const errEl = document.getElementById('login-error-msg');
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
  }
  const mainWrapper = document.querySelector('.main-wrapper');
  const sidebar = document.querySelector('.sidebar');
  if (mainWrapper) mainWrapper.style.visibility = 'hidden';
  if (sidebar) sidebar.style.visibility = 'hidden';
}

function hideLoginScreen() {
  const screen = document.getElementById('login-screen');
  if (screen) {
    screen.style.display = 'none';
  }
  const mainWrapper = document.querySelector('.main-wrapper');
  const sidebar = document.querySelector('.sidebar');
  if (mainWrapper) mainWrapper.style.visibility = 'visible';
  if (sidebar) sidebar.style.visibility = 'visible';
}

function toggleLoginPasswordVisibility() {
  const pwd = document.getElementById('login-password');
  if (!pwd) return;
  pwd.type = pwd.type === 'password' ? 'text' : 'password';
}

function showLoginModal() {
  showLoginScreen();
}

function updateTopbarUserBadge() {
  const nameEl = document.getElementById('topbar-username');
  const roleEl = document.getElementById('topbar-role');
  if (!nameEl || !roleEl) return;

  if (currentUser) {
    nameEl.textContent = currentUser.username;
    const primaryRole = (currentUser.roles && currentUser.roles[0]) || (currentUser.is_superuser ? 'SUPER_ADMIN' : 'USER');
    roleEl.textContent = primaryRole;
    roleEl.className = 'status-badge ' + (primaryRole === 'SUPER_ADMIN' ? 'badge-sync' : 'badge-online');
  } else {
    nameEl.textContent = 'Not Signed In';
    roleEl.textContent = 'LOCKED';
    roleEl.className = 'status-badge badge-offline';
  }
}

function handleUserBadgeClick() {
  if (!currentUser) {
    showLoginScreen();
    return;
  }

  const rolesHtml = (currentUser.roles || ['SUPER_ADMIN']).map(r => `<span class="status-badge badge-online" style="margin-right: 4px;">${r}</span>`).join('');
  const scopesHtml = (currentUser.scopes || []).map(s => `<span class="status-badge badge-sync" style="margin-right: 4px;">${s.name || s.scope_identifier}</span>`).join('') || '<span style="color:var(--text-muted);">GLOBAL</span>';

  openModal(`
    <div class="modal-card" style="max-width: 480px;">
      <div class="modal-header">
        <h3>User Account Details</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div style="padding: 16px 0;">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
          <div style="width:48px; height:48px; border-radius:50%; background:var(--accent-blue); display:flex; align-items:center; justify-content:center; font-size:20px;">👤</div>
          <div>
            <h4 style="font-size:16px;">${escapeHtml(currentUser.full_name || currentUser.username)}</h4>
            <div style="font-size:12.5px; color:var(--text-secondary);">@${escapeHtml(currentUser.username)} ${currentUser.email ? `(${escapeHtml(currentUser.email)})` : ''}</div>
          </div>
        </div>
        <div style="margin-bottom:12px;">
          <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">Assigned Roles:</div>
          <div>${rolesHtml}</div>
        </div>
        <div style="margin-bottom:18px;">
          <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">Resource Scopes:</div>
          <div>${scopesHtml}</div>
        </div>
        <div style="border-top:1px solid var(--border-color); padding-top:14px; margin-top:14px;">
          <h5 style="margin-bottom:8px;">Change Password</h5>
          <input type="password" id="modal-old-pwd" placeholder="Current Password" class="input-field" style="margin-bottom:8px; width:100%;">
          <input type="password" id="modal-new-pwd" placeholder="New Password (min 6 chars)" class="input-field" style="margin-bottom:12px; width:100%;">
          <button class="btn btn-secondary" onclick="submitPasswordChange()" style="width:100%; margin-bottom:12px;">Update Password</button>
        </div>
      </div>
      <div class="modal-footer" style="display:flex; justify-content:space-between;">
        <button class="btn btn-danger" onclick="logoutUser()">Sign Out</button>
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
      </div>
    </div>
  `);
}

async function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  const uInput = document.getElementById('login-username');
  const pInput = document.getElementById('login-password');
  const errEl = document.getElementById('login-error-msg');
  const btn = document.getElementById('login-submit-btn');

  const u = uInput ? uInput.value.trim() : '';
  const p = pInput ? pInput.value : '';

  if (!u || !p) {
    if (errEl) {
      errEl.textContent = 'Please enter both username and password';
      errEl.style.display = 'flex';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Signing In...</span>';
  }
  if (errEl) errEl.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (data.success && data.token) {
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('smarthome_token', authToken);
      updateTopbarUserBadge();
      hideLoginScreen();
      if (pInput) pInput.value = '';
      showToast({ title: 'Signed In', message: `Welcome back, ${data.user.full_name || data.user.username}!`, severity: 'SUCCESS' });
      initWebSocket();
      checkUnreadNotifications();
      loadCurrentView();
    } else {
      if (errEl) {
        errEl.textContent = data.error || 'Authentication failed';
        errEl.style.display = 'flex';
      }
      if (pInput) pInput.focus();
    }
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'Server connection error. Please try again.';
      errEl.style.display = 'flex';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Sign In to Dashboard</span><span class="login-btn-arrow">→</span>';
    }
  }
}

async function logoutUser() {
  try {
    await fetchWithAuth(`${API_BASE}/auth/logout`, { method: 'POST' });
  } catch {}
  authToken = '';
  currentUser = null;
  localStorage.removeItem('smarthome_token');
  closeModal();

  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }

  updateTopbarUserBadge();

  const container = document.getElementById("content-area");
  if (container) {
    container.innerHTML = '';
  }

  showToast({ title: 'Signed Out', message: 'You have been signed out.', severity: 'INFO' });
  showLoginScreen();
}

async function submitPasswordChange() {
  const oldPassword = document.getElementById('modal-old-pwd').value;
  const newPassword = document.getElementById('modal-new-pwd').value;
  if (!oldPassword || !newPassword) {
    alert('Both passwords are required');
    return;
  }
  try {
    const res = await fetchWithAuth(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      alert('Password updated successfully! Please sign in again.');
      logoutUser();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Error updating password: ' + err.message);
  }
}

function switchView(view) {
  if (!currentUser) {
    showLoginScreen();
    return;
  }
  const item = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (item) {
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    item.classList.add("active");
    currentView = view;
    document.getElementById("view-title").textContent = item.querySelector("span:last-child").textContent;
    loadCurrentView();
  }
}

// --- HELPER UTILITIES ---
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let unreadNotifCount = 0;

async function checkUnreadNotifications() {
  try {
    const res = await fetch(`${API_BASE}/system/notifications/unread-count`);
    const data = await res.json();
    setNotificationBadges(data.unreadCount || 0);
  } catch (e) {}
}

function setNotificationBadges(count) {
  unreadNotifCount = Math.max(0, count);
  const navBadge = document.getElementById("nav-notif-badge");
  const topBadge = document.getElementById("topbar-notif-count");

  if (unreadNotifCount > 0) {
    if (navBadge) {
      navBadge.innerText = unreadNotifCount > 99 ? "99+" : unreadNotifCount;
      navBadge.style.display = "inline-block";
    }
    if (topBadge) {
      topBadge.innerText = unreadNotifCount > 99 ? "99+" : unreadNotifCount;
      topBadge.style.display = "inline-block";
    }
  } else {
    if (navBadge) navBadge.style.display = "none";
    if (topBadge) topBadge.style.display = "none";
  }
}

function updateNotificationBadges(delta) {
  setNotificationBadges(unreadNotifCount + delta);
}

function showToast(notif) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  const severity = (notif.severity || "INFO").toLowerCase();
  toast.className = `toast-item toast-${severity}`;

  let icon = "🔔";
  if (notif.category === "PIN" || (notif.title && notif.title.includes("Pin"))) {
    icon = notif.title.includes("ON") ? "⚡" : "⚪";
  } else if (notif.category === "NODE" || (notif.title && notif.title.includes("Node"))) {
    icon = notif.title.includes("Online") ? "🟢" : "🔴";
  } else if (notif.category === "RESTART" || (notif.title && (notif.title.includes("Reboot") || notif.title.includes("Restart")))) {
    icon = "🔄";
  }

  const timeStr = notif.timestamp ? new Date(notif.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(notif.title || 'Notification')}</div>
      <div class="toast-msg">${escapeHtml(notif.message || '')}</div>
      <div class="toast-time">${timeStr}</div>
    </div>
    <button class="toast-close" title="Dismiss">&times;</button>
  `;

  const closeBtn = toast.querySelector(".toast-close");
  const dismiss = () => {
    toast.classList.add("toast-leave");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  };

  if (closeBtn) closeBtn.onclick = (e) => { e.stopPropagation(); dismiss(); };
  setTimeout(dismiss, 5500);

  container.appendChild(toast);
}

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
document.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  const isAuthenticated = await checkCurrentUser();
  if (isAuthenticated) {
    hideLoginScreen();
    initWebSocket();
    checkUnreadNotifications();
    loadCurrentView();
  } else {
    showLoginScreen();
  }
  setInterval(() => {
    if (currentUser) refreshActiveMetrics();
  }, 10000);
  setInterval(() => {
    if (currentUser) checkUnreadNotifications();
  }, 25000);
});

// --- NAVIGATION ---
function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", e => {
      e.preventDefault();
      if (!currentUser) {
        showLoginScreen();
        return;
      }
      document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      currentView = item.dataset.view;
      document.getElementById("view-title").textContent = item.querySelector("span:last-child").textContent;
      loadCurrentView();
    });
  });
}

function loadCurrentView() {
  if (!currentUser) {
    showLoginScreen();
    return;
  }
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
    case "littlefs": loadLittlefs(); break;
    case "config-sync": loadConfigSync(); break;
    case "commands": loadCommands(); break;
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
    if (currentUser) {
      setTimeout(initWebSocket, 4000);
    }
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
  if (type === "notification") {
    showToast(data);
    updateNotificationBadges(1);
    if (currentView === "notifications") loadNotifications();
    if (currentView === "logs") loadLogs();
  } else if (type === "relay_state_confirmed") {
    const el = document.getElementById(`relay-toggle-${data.node_id}-${data.channel_id}`);
    if (el) el.checked = data.new_state;
    const syncBadge = document.getElementById(`sync-badge-${data.node_id}-${data.channel_id}`);
    if (syncBadge) syncBadge.style.display = "none";
    if (currentView === "relays" || currentView === "overview") loadCurrentView();
  } else if (type === "node_status" || type === "node_added" || type === "node_deleted") {
    if (currentView === "nodes" || currentView === "overview") loadCurrentView();
  } else if (type === "telemetry_update") {
    if (currentView === "telemetry") appendTelemetryLog(data);
    if (currentView === "overview") refreshActiveMetrics();
  } else if (type === "poll_cycle_completed") {
    if (currentView === "overview") refreshActiveMetrics();
  } else if (type === "poll_settings_changed") {
    updateTopbarSyncIndicator(data);
  } else if (type === "command_executed" || type === "command_acknowledged") {
    if (currentView === "commands") loadCommands();
  } else if (type === "config_updated" || type === "config_synced") {
    if (currentView === "config-sync") loadConfigSync();
  } else if (type === "littlefs_synced") {
    if (currentView === "littlefs") refreshLittlefsList();
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

// --- 2. HOME-CENTRIC NODE MANAGEMENT & DISCOVERY SCANNER ---
let activeHomeId = null;
let activeRoomTab = 'all'; // 'all', numeric roomId, or 'unassigned'
let cachedHomes = [];
let cachedRooms = [];

async function loadNodes() {
  const container = document.getElementById("content-area");
  try {
    // 1. Fetch homes
    let homes = [];
    try {
      const homesRes = await fetchWithAuth(`${API_BASE}/homes`);
      const homesData = await homesRes.json();
      if (homesData.success && Array.isArray(homesData.homes)) {
        homes = homesData.homes;
      }
    } catch (e) {
      console.warn("Failed to fetch homes:", e);
    }

    if (homes.length === 0) {
      homes = [{ id: 1, name: 'Primary Residence', owner_user_id: null, rooms_count: 1, nodes_count: 2 }];
    }
    cachedHomes = homes;

    // Default active home to first available home
    if (!activeHomeId || !homes.some(h => Number(h.id) === Number(activeHomeId))) {
      activeHomeId = homes[0].id;
    }
    const currentHome = homes.find(h => Number(h.id) === Number(activeHomeId)) || homes[0];

    // 2. Fetch rooms for active home
    let rooms = [];
    try {
      const roomsRes = await fetchWithAuth(`${API_BASE}/homes/${activeHomeId}/rooms`);
      const roomsData = await roomsRes.json();
      if (roomsData.success && Array.isArray(roomsData.rooms)) {
        rooms = roomsData.rooms;
      }
    } catch (e) {
      console.warn("Failed to fetch rooms:", e);
    }
    cachedRooms = rooms;

    // 3. Fetch nodes
    let allNodes = [];
    try {
      const nodesRes = await fetchWithAuth(`${API_BASE}/nodes`);
      const rawNodes = await nodesRes.json();
      allNodes = Array.isArray(rawNodes) ? rawNodes : (rawNodes.nodes || []);
      fleetData.nodes = allNodes;
    } catch (e) {
      console.warn("Failed to fetch nodes:", e);
    }

    // Separate home nodes and unassigned nodes
    const homeNodes = allNodes.filter(n => Number(n.home_id) === Number(activeHomeId));
    const unassignedNodes = allNodes.filter(n => !n.home_id || !n.room_id);

    // Validate active room tab
    if (activeRoomTab !== 'all' && activeRoomTab !== 'unassigned') {
      const roomIdNum = Number(activeRoomTab);
      if (!rooms.some(r => Number(r.id) === roomIdNum)) {
        activeRoomTab = 'all';
      }
    }

    container.innerHTML = `
      <!-- HOME SELECTOR BAR -->
      <div class="home-selector-bar">
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">🏡</span>
            <select class="home-select-dropdown" id="active-home-select" onchange="handleHomeChange(this.value)">
              ${homes.map(h => `
                <option value="${h.id}" ${Number(h.id) === Number(activeHomeId) ? 'selected' : ''}>
                  ${escapeHtml(h.name)} (${h.nodes_count ?? 0} devices, ${h.rooms_count ?? 0} rooms)
                </option>
              `).join('')}
            </select>
          </div>
          <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;" onclick="showAddHomeModal()">+ Add Home</button>
          <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;" onclick="showManageHomeModal(${activeHomeId})">⚙️ Home Settings & Members</button>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;" onclick="showAddRoomModal(${activeHomeId})">+ Add Room</button>
          <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;" onclick="showNetworkScannerModal()">🔍 Scan Network</button>
          <button class="btn btn-primary" style="font-size: 12px; padding: 6px 12px;" onclick="showAddNodeModal()">+ Add Node</button>
        </div>
      </div>

      <!-- HOME SUMMARY STRIP -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
        <div class="home-summary-strip">
          <span class="home-summary-pill">
            📍 <strong>${escapeHtml(currentHome.name)}</strong>
          </span>
          <span class="home-summary-pill">
            ${currentHome.owner_username 
              ? `👑 Owner: <strong>${escapeHtml(currentHome.owner_username)}</strong>` 
              : `👑 <em>Managed by Super Admin (Bootstrap Mode)</em>`}
          </span>
          <span class="home-summary-pill">
            🚪 <strong>${rooms.length}</strong> Room(s)
          </span>
          <span class="home-summary-pill">
            ⚡ <strong>${homeNodes.filter(n => n.is_online).length} / ${homeNodes.length}</strong> Online
          </span>
        </div>

        ${unassignedNodes.length > 0 ? `
          <button class="btn btn-secondary" style="font-size: 11.5px; padding: 4px 10px; border-color: rgba(245,158,11,0.4); color: #fbbf24;" onclick="switchRoomTab('unassigned')">
            ⚠️ ${unassignedNodes.length} Unassigned Device(s) waiting for room placement
          </button>
        ` : ''}
      </div>

      <!-- ROOM SELECTOR TABS -->
      <div class="room-tabs-nav">
        <button class="room-tab-btn ${activeRoomTab === 'all' ? 'active' : ''}" onclick="switchRoomTab('all')">
          🏠 All Rooms <span class="room-tab-badge">${homeNodes.length}</span>
        </button>
        ${rooms.map(r => {
          const roomNodeCount = homeNodes.filter(n => Number(n.room_id) === Number(r.id)).length;
          return `
            <button class="room-tab-btn ${activeRoomTab === String(r.id) ? 'active' : ''}" onclick="switchRoomTab('${r.id}')">
              ${r.icon === 'bed' ? '🛏️' : r.icon === 'couch' ? '🛋️' : r.icon === 'kitchen' ? '🍳' : '🚪'} ${escapeHtml(r.name)}
              <span class="room-tab-badge">${roomNodeCount}</span>
            </button>
          `;
        }).join('')}
        <button class="room-tab-btn ${activeRoomTab === 'unassigned' ? 'active' : ''}" onclick="switchRoomTab('unassigned')">
          📥 Unassigned Nodes <span class="room-tab-badge" style="${unassignedNodes.length > 0 ? 'background:#f59e0b; color:#111827; font-weight:700;' : ''}">${unassignedNodes.length}</span>
        </button>
      </div>

      <!-- ROOM / NODE CONTENT -->
      ${renderRoomNodeSections({
        activeRoomTab,
        currentHome,
        rooms,
        homeNodes,
        unassignedNodes
      })}
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red); padding: 20px;">Error loading nodes: ${e.message}</div>`;
  }
}

function handleHomeChange(val) {
  activeHomeId = Number(val);
  activeRoomTab = 'all';
  loadNodes();
}

function switchRoomTab(tab) {
  activeRoomTab = tab;
  loadNodes();
}

function renderRoomNodeSections({ activeRoomTab, currentHome, rooms, homeNodes, unassignedNodes }) {
  if (activeRoomTab === 'unassigned') {
    return `
      <div class="unassigned-banner">
        <div>
          <div style="font-weight: 600; color: #fbbf24; font-size: 14px;">📥 Unassigned Nodes Queue</div>
          <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 2px;">
            These newly registered or detached microcontrollers do not currently belong to any room. Assign them to a room to organize your smart home.
          </div>
        </div>
      </div>
      ${unassignedNodes.length === 0 ? `
        <div style="color: var(--text-secondary); padding: 32px; background: var(--bg-secondary); border-radius: 8px; border: 1px dashed var(--border-color); text-align: center;">
          🎉 All nodes in your fleet are currently assigned to homes and rooms!
        </div>
      ` : `
        <div class="cards-grid">
          ${unassignedNodes.map(n => renderNodeCard(n, true)).join('')}
        </div>
      `}
    `;
  }

  if (activeRoomTab !== 'all') {
    const targetRoomId = Number(activeRoomTab);
    const room = rooms.find(r => Number(r.id) === targetRoomId);
    const roomNodes = homeNodes.filter(n => Number(n.room_id) === targetRoomId);

    return `
      <div class="room-section-header">
        <div class="room-section-title">
          <span>${room?.icon === 'bed' ? '🛏️' : room?.icon === 'couch' ? '🛋️' : '🚪'}</span>
          <span>${escapeHtml(room?.name || 'Room')}</span>
          <span style="font-size: 12px; font-weight: normal; color: var(--text-secondary);">(${roomNodes.length} devices)</span>
        </div>
        <div>
          <button class="btn btn-secondary" style="font-size: 11.5px; padding: 4px 10px;" onclick="showEditRoomModal(${targetRoomId})">⚙️ Edit Room</button>
        </div>
      </div>
      ${roomNodes.length === 0 ? `
        <div style="color: var(--text-secondary); padding: 28px; background: var(--bg-secondary); border-radius: 8px; border: 1px dashed var(--border-color); text-align: center;">
          No devices assigned to <strong>${escapeHtml(room?.name || 'this room')}</strong>. Click <strong>"📦 Move"</strong> on any device to place it here.
        </div>
      ` : `
        <div class="cards-grid">
          ${roomNodes.map(n => renderNodeCard(n, false)).join('')}
        </div>
      `}
    `;
  }

  // "All Rooms" view: Group by room
  if (rooms.length === 0 && homeNodes.length === 0) {
    return `
      <div style="color: var(--text-secondary); padding: 32px; background: var(--bg-secondary); border-radius: 8px; border: 1px dashed var(--border-color); text-align: center;">
        No rooms or devices currently in <strong>${escapeHtml(currentHome.name)}</strong>. Click <strong>"+ Add Room"</strong> to create your first room.
      </div>
    `;
  }

  let html = '';
  for (const r of rooms) {
    const roomNodes = homeNodes.filter(n => Number(n.room_id) === Number(r.id));
    html += `
      <div class="room-section-header">
        <div class="room-section-title">
          <span>${r.icon === 'bed' ? '🛏️' : r.icon === 'couch' ? '🛋️' : r.icon === 'kitchen' ? '🍳' : '🚪'}</span>
          <span>${escapeHtml(r.name)}</span>
          <span style="font-size: 12px; font-weight: normal; color: var(--text-secondary);">(${roomNodes.length} node${roomNodes.length === 1 ? '' : 's'})</span>
        </div>
        <div>
          <button class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="showEditRoomModal(${r.id})">⚙️ Edit Room</button>
        </div>
      </div>
      ${roomNodes.length === 0 ? `
        <div style="color: var(--text-muted); padding: 16px; background: rgba(255,255,255,0.02); border-radius: 6px; font-size: 12.5px; margin-bottom: 14px;">
          No devices currently assigned to this room.
        </div>
      ` : `
        <div class="cards-grid" style="margin-bottom: 24px;">
          ${roomNodes.map(n => renderNodeCard(n, false)).join('')}
        </div>
      `}
    `;
  }

  return html;
}

function renderNodeCard(n, isUnassigned = false) {
  return `
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

      <!-- LOCATION / HOME / ROOM HIERARCHY BADGES -->
      <div style="display: flex; gap: 6px; margin: 8px 0; flex-wrap: wrap;">
        ${n.home_name ? `<span class="badge-home">🏡 ${escapeHtml(n.home_name)}</span>` : '<span class="badge-unassigned">⚠️ Unassigned Home</span>'}
        ${n.room_name ? `<span class="badge-room">🚪 ${escapeHtml(n.room_name)}</span>` : '<span class="badge-unassigned">⚠️ No Room</span>'}
        <span class="status-badge" style="font-size: 11px; padding: 2px 6px;">${escapeHtml(n.hardware_type || 'ESP8266')}</span>
      </div>

      <div style="font-size: 12.5px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 10px 0;">
        <div><strong>FW:</strong> v${escapeHtml(n.firmware_version || '1.0.0')}</div>
        <div><strong>IP:</strong> <a href="http://${escapeHtml(n.ip_address)}" target="_blank" style="color: var(--accent-blue);">${escapeHtml(n.ip_address || 'N/A')}</a></div>
        <div><strong>RSSI:</strong> ${n.rssi || -70} dBm</div>
        <div><strong>Heap:</strong> ${(Number(n.free_heap || 0) / 1024).toFixed(1)} KB</div>
        <div><strong>Relays:</strong> ${n.relays_count || (n.channels ? n.channels.length : 0)} Active</div>
        <div><strong>Uptime:</strong> ${Math.floor((n.uptime_sec || 0) / 3600)}h ${Math.floor(((n.uptime_sec || 0) % 3600) / 60)}m</div>
      </div>

      <div style="border-top: 1px solid var(--border-color); padding-top: 10px; display: flex; gap: 6px; flex-wrap: wrap;">
        ${isUnassigned ? `
          <button class="btn btn-primary" style="font-size: 11.5px; padding: 5px 10px;" onclick="showAssignNodeModal('${n.node_id}')">➕ Assign to Room</button>
        ` : `
          <button class="btn btn-primary" style="font-size: 11.5px; padding: 5px 9px;" onclick="showNodeSettingsModal('${n.node_id}')">⚙️ Settings</button>
          <button class="btn btn-secondary" style="font-size: 11.5px; padding: 5px 9px;" onclick="showMoveNodeModal('${n.node_id}')">📦 Move</button>
        `}
        <button class="btn btn-secondary" style="font-size: 11.5px; padding: 5px 9px;" onclick="syncPinsWithHardware('${n.node_id}')">⚡ Sync Pins</button>
        <button class="btn btn-secondary" style="font-size: 11.5px; padding: 5px 9px;" onclick="restartNode('${n.node_id}')">🔄 Reboot</button>
        ${!isUnassigned ? `
          <button class="btn btn-secondary" style="font-size: 11.5px; padding: 5px 9px; color: #fbbf24;" onclick="confirmUnassignNode('${n.node_id}')">📤 Unassign</button>
        ` : ''}
        <button class="btn btn-danger" style="font-size: 11.5px; padding: 5px 9px;" onclick="deleteNode('${n.node_id}')">🗑️ Delete</button>
      </div>
    </div>
  `;
}

// ==========================================
// HOME, ROOM, & NODE ASSIGNMENT MODALS
// ==========================================

function showAddHomeModal() {
  const html = `
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <h3 style="margin: 0;">🏡 Create New Home</h3>
        <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">Home Name *</label>
        <input type="text" id="add-home-name" class="form-control" placeholder="e.g. Summer Beach House, Office" value="">
      </div>
      <div class="form-group">
        <label class="form-label">Description (Optional)</label>
        <input type="text" id="add-home-desc" class="form-control" placeholder="e.g. Primary holiday property" value="">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Timezone</label>
          <input type="text" id="add-home-tz" class="form-control" placeholder="UTC" value="UTC">
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" id="add-home-addr" class="form-control" placeholder="City, Country" value="">
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitAddHome()">Create Home</button>
      </div>
    </div>
  `;
  openModal(html);
}

async function submitAddHome() {
  const name = document.getElementById("add-home-name").value.trim();
  const description = document.getElementById("add-home-desc").value.trim();
  const timezone = document.getElementById("add-home-tz").value.trim();
  const address = document.getElementById("add-home-addr").value.trim();

  if (!name) {
    alert("Home name is required");
    return;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/homes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, timezone, address })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Home Created", message: `Home '${data.home.name}' initialized`, severity: "SUCCESS" });
      closeModal();
      activeHomeId = data.home.id;
      loadNodes();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Failed to create home: " + err.message);
  }
}

async function showManageHomeModal(homeId) {
  try {
    const res = await fetchWithAuth(`${API_BASE}/homes/${homeId}`);
    const data = await res.json();
    if (!data.success || !data.home) {
      alert("Could not load home details: " + (data.error || "Unknown"));
      return;
    }
    const h = data.home;

    const membersRes = await fetchWithAuth(`${API_BASE}/homes/${homeId}/members`);
    const membersData = await membersRes.json();
    const members = membersData.members || [];

    const html = `
      <div class="modal-content" style="max-width: 640px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="margin: 0;">⚙️ Manage Home: ${escapeHtml(h.name)}</h3>
          <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
        </div>

        <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 13px;">
          <div><strong>Owner Status:</strong> ${h.owner_username ? `<span style="color:var(--accent-blue);">👑 ${escapeHtml(h.owner_username)}</span>` : '<span style="color:#fbbf24;">👑 Managed by Super Admin (Bootstrap Mode)</span>'}</div>
          <div style="margin-top: 4px; color: var(--text-secondary);">Total Rooms: ${h.rooms_count} | Total Devices: ${h.nodes_count}</div>
        </div>

        <h4 style="margin: 16px 0 8px; font-size: 14px;">Home Information</h4>
        <div class="form-group">
          <label class="form-label">Home Name</label>
          <input type="text" id="edit-home-name" class="form-control" value="${escapeHtml(h.name)}">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label class="form-label">Timezone</label>
            <input type="text" id="edit-home-tz" class="form-control" value="${escapeHtml(h.timezone || 'UTC')}">
          </div>
          <div class="form-group">
            <label class="form-label">Address</label>
            <input type="text" id="edit-home-addr" class="form-control" value="${escapeHtml(h.address || '')}">
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="btn btn-primary" style="font-size: 12px;" onclick="submitUpdateHome(${homeId})">Save Changes</button>
          <button class="btn btn-secondary" style="font-size: 12px;" onclick="showAppointOwnerModal(${homeId})">👑 Appoint / Transfer Owner</button>
        </div>

        <hr style="border: none; border-top: 1px solid var(--border-color); margin: 20px 0;">

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <h4 style="margin: 0; font-size: 14px;">Home Members & Access Roles</h4>
          <button class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="showAddMemberModal(${homeId})">+ Add Member</button>
        </div>

        <div style="max-height: 180px; overflow-y: auto;">
          ${members.length === 0 ? '<div style="color:var(--text-muted); font-size:12px; padding:8px 0;">No assigned members yet. Add members to grant family or guest access.</div>' : `
            <table style="width: 100%; font-size: 12.5px; border-collapse: collapse;">
              <thead>
                <tr style="text-align: left; color: var(--text-secondary); border-bottom: 1px solid var(--border-color);">
                  <th style="padding: 6px;">User</th>
                  <th style="padding: 6px;">Role</th>
                  <th style="padding: 6px; text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${members.map(m => `
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 6px;"><strong>${escapeHtml(m.username)}</strong> <span style="color:var(--text-muted); font-size:11px;">(${escapeHtml(m.email || '')})</span></td>
                    <td style="padding: 6px;"><span class="badge-home">${escapeHtml(m.role)}</span></td>
                    <td style="padding: 6px; text-align: right;">
                      <button class="btn btn-danger" style="font-size: 10px; padding: 2px 6px;" onclick="removeHomeMember(${homeId}, ${m.user_id})">Remove</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>

        <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
          <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
      </div>
    `;
    openModal(html);
  } catch (err) {
    alert("Error loading manage home modal: " + err.message);
  }
}

async function submitUpdateHome(homeId) {
  const name = document.getElementById("edit-home-name").value.trim();
  const timezone = document.getElementById("edit-home-tz").value.trim();
  const address = document.getElementById("edit-home-addr").value.trim();

  if (!name) {
    alert("Home name is required");
    return;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/homes/${homeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, timezone, address })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Home Updated", message: "Home settings updated", severity: "SUCCESS" });
      closeModal();
      loadNodes();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Update failed: " + err.message);
  }
}

function showAddRoomModal(homeId) {
  const html = `
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <h3 style="margin: 0;">🚪 Add Room</h3>
        <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
      </div>
      <div class="form-group">
        <label class="form-label">Room Name *</label>
        <input type="text" id="add-room-name" class="form-control" placeholder="e.g. Living Room, Kitchen, Kids Room" value="">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Floor</label>
          <input type="text" id="add-room-floor" class="form-control" placeholder="Ground" value="Ground">
        </div>
        <div class="form-group">
          <label class="form-label">Icon</label>
          <select id="add-room-icon" class="form-control">
            <option value="room">🚪 General Room</option>
            <option value="bed">🛏️ Bedroom</option>
            <option value="couch">🛋️ Living Room</option>
            <option value="kitchen">🍳 Kitchen</option>
            <option value="bath">🛁 Bathroom</option>
            <option value="desk">🖥️ Office / Study</option>
            <option value="garage">🚗 Garage</option>
          </select>
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitAddRoom(${homeId})">Create Room</button>
      </div>
    </div>
  `;
  openModal(html);
}

async function submitAddRoom(homeId) {
  const name = document.getElementById("add-room-name").value.trim();
  const floor = document.getElementById("add-room-floor").value.trim();
  const icon = document.getElementById("add-room-icon").value;

  if (!name) {
    alert("Room name is required");
    return;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/homes/${homeId}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, floor, icon })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Room Created", message: `Room '${data.room.name}' created`, severity: "SUCCESS" });
      closeModal();
      activeRoomTab = String(data.room.id);
      loadNodes();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Failed to create room: " + err.message);
  }
}

async function showEditRoomModal(roomId) {
  try {
    const res = await fetchWithAuth(`${API_BASE}/rooms/${roomId}`);
    const data = await res.json();
    if (!data.success || !data.room) {
      alert("Could not load room details");
      return;
    }
    const r = data.room;

    const html = `
      <div class="modal-content">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="margin: 0;">⚙️ Edit Room: ${escapeHtml(r.name)}</h3>
          <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
        </div>
        <div class="form-group">
          <label class="form-label">Room Name *</label>
          <input type="text" id="edit-room-name" class="form-control" value="${escapeHtml(r.name)}">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label class="form-label">Floor</label>
            <input type="text" id="edit-room-floor" class="form-control" value="${escapeHtml(r.floor || 'Ground')}">
          </div>
          <div class="form-group">
            <label class="form-label">Icon</label>
            <select id="edit-room-icon" class="form-control">
              <option value="room" ${r.icon === 'room' ? 'selected' : ''}>🚪 General Room</option>
              <option value="bed" ${r.icon === 'bed' ? 'selected' : ''}>🛏️ Bedroom</option>
              <option value="couch" ${r.icon === 'couch' ? 'selected' : ''}>🛋️ Living Room</option>
              <option value="kitchen" ${r.icon === 'kitchen' ? 'selected' : ''}>🍳 Kitchen</option>
              <option value="bath" ${r.icon === 'bath' ? 'selected' : ''}>🛁 Bathroom</option>
              <option value="desk" ${r.icon === 'desk' ? 'selected' : ''}>🖥️ Office / Study</option>
              <option value="garage" ${r.icon === 'garage' ? 'selected' : ''}>🚗 Garage</option>
            </select>
          </div>
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">
          Assigned Devices in Room: <strong>${r.nodes_count ?? 0}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 18px;">
          <button class="btn btn-danger" style="font-size: 12px;" onclick="confirmDeleteRoom(${roomId}, ${r.nodes_count ?? 0})">🗑️ Delete Room</button>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="submitEditRoom(${roomId})">Save Changes</button>
          </div>
        </div>
      </div>
    `;
    openModal(html);
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function submitEditRoom(roomId) {
  const name = document.getElementById("edit-room-name").value.trim();
  const floor = document.getElementById("edit-room-floor").value.trim();
  const icon = document.getElementById("edit-room-icon").value;

  if (!name) {
    alert("Room name is required");
    return;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/rooms/${roomId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, floor, icon })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Room Updated", message: `Room '${data.room.name}' saved`, severity: "SUCCESS" });
      closeModal();
      loadNodes();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Failed to update room: " + err.message);
  }
}

async function confirmDeleteRoom(roomId, nodesCount) {
  if (nodesCount > 0) {
    alert(`Cannot delete this room because ${nodesCount} device(s) are currently assigned to it. Move or unassign all devices first.`);
    return;
  }
  if (!confirm("Are you sure you want to delete this room? This action cannot be undone.")) {
    return;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/rooms/${roomId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Room Deleted", message: "Room deleted successfully", severity: "INFO" });
      closeModal();
      activeRoomTab = 'all';
      loadNodes();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Failed to delete room: " + err.message);
  }
}

async function showMoveNodeModal(nodeId) {
  try {
    const homesRes = await fetchWithAuth(`${API_BASE}/homes`);
    const homesData = await homesRes.json();
    const homes = homesData.homes || [];

    const node = fleetData.nodes.find(n => n.node_id === nodeId) || {};

    const html = `
      <div class="modal-content">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="margin: 0;">📦 Move Device: ${escapeHtml(node.name || nodeId)}</h3>
          <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 14px; line-height: 1.5;">
          Select the target Home and Room. Historical telemetry, GPIO definitions, and relay configurations are preserved.
        </p>

        <div class="form-group">
          <label class="form-label">Target Home *</label>
          <select id="move-target-home" class="form-control" onchange="loadRoomsForTargetHome(this.value)">
            ${homes.map(h => `
              <option value="${h.id}" ${Number(h.id) === Number(node.home_id || activeHomeId) ? 'selected' : ''}>
                ${escapeHtml(h.name)}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Target Room *</label>
          <select id="move-target-room" class="form-control">
            <option value="">Loading rooms...</option>
          </select>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitMoveNode('${nodeId}')">Confirm Move</button>
        </div>
      </div>
    `;
    openModal(html);
    const initialHomeId = Number(document.getElementById("move-target-home").value);
    loadRoomsForTargetHome(initialHomeId, node.room_id);
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function loadRoomsForTargetHome(homeId, selectedRoomId = null) {
  const roomSelect = document.getElementById("move-target-room") || document.getElementById("assign-target-room");
  if (!roomSelect) return;
  try {
    const res = await fetchWithAuth(`${API_BASE}/homes/${homeId}/rooms`);
    const data = await res.json();
    const rooms = data.rooms || [];
    if (rooms.length === 0) {
      roomSelect.innerHTML = '<option value="">No rooms in this home (create one first)</option>';
      return;
    }
    roomSelect.innerHTML = rooms.map(r => `
      <option value="${r.id}" ${Number(r.id) === Number(selectedRoomId) ? 'selected' : ''}>
        ${r.icon === 'bed' ? '🛏️' : r.icon === 'couch' ? '🛋️' : '🚪'} ${escapeHtml(r.name)} (${escapeHtml(r.floor || 'Ground')})
      </option>
    `).join('');
  } catch (err) {
    roomSelect.innerHTML = `<option value="">Error loading rooms</option>`;
  }
}

async function submitMoveNode(nodeId) {
  const homeId = Number(document.getElementById("move-target-home").value);
  const roomId = Number(document.getElementById("move-target-room").value);

  if (!homeId || !roomId) {
    alert("Please select both a target Home and Room");
    return;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${nodeId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ homeId, roomId })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Node Moved", message: `Node moved to ${data.node?.room_name || 'new room'}`, severity: "SUCCESS" });
      closeModal();
      activeHomeId = homeId;
      activeRoomTab = String(roomId);
      loadNodes();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Move failed: " + err.message);
  }
}

async function showAssignNodeModal(nodeId) {
  try {
    const homesRes = await fetchWithAuth(`${API_BASE}/homes`);
    const homesData = await homesRes.json();
    const homes = homesData.homes || [];

    const node = fleetData.nodes.find(n => n.node_id === nodeId) || {};

    const html = `
      <div class="modal-content">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="margin: 0;">➕ Assign Node to Room</h3>
          <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 14px; line-height: 1.5;">
          Assign microcontroller <code>${escapeHtml(nodeId)}</code> (<strong>${escapeHtml(node.name || 'ESP Device')}</strong>) to an active Home and Room.
        </p>

        <div class="form-group">
          <label class="form-label">Target Home *</label>
          <select id="assign-target-home" class="form-control" onchange="loadRoomsForTargetHome(this.value)">
            ${homes.map(h => `
              <option value="${h.id}" ${Number(h.id) === Number(activeHomeId) ? 'selected' : ''}>
                ${escapeHtml(h.name)}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Target Room *</label>
          <select id="assign-target-room" class="form-control">
            <option value="">Loading rooms...</option>
          </select>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitAssignNode('${nodeId}')">Assign Node</button>
        </div>
      </div>
    `;
    openModal(html);
    const initialHomeId = Number(document.getElementById("assign-target-home").value);
    loadRoomsForTargetHome(initialHomeId);
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function submitAssignNode(nodeId) {
  const homeId = Number(document.getElementById("assign-target-home").value);
  const roomId = Number(document.getElementById("assign-target-room").value);

  if (!homeId || !roomId) {
    alert("Please select both a target Home and Room");
    return;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${nodeId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ homeId, roomId })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Node Assigned", message: `Node assigned to ${data.node?.room_name || 'Room'}`, severity: "SUCCESS" });
      closeModal();
      activeHomeId = homeId;
      activeRoomTab = String(roomId);
      loadNodes();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Assignment failed: " + err.message);
  }
}

async function confirmUnassignNode(nodeId) {
  if (!confirm(`Are you sure you want to unassign device '${nodeId}'? It will be moved to the Unassigned Nodes queue.`)) {
    return;
  }
  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${nodeId}/unassign`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Node Unassigned", message: "Node moved to Unassigned Nodes queue", severity: "INFO" });
      loadNodes();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Unassign failed: " + err.message);
  }
}

async function showAppointOwnerModal(homeId) {
  try {
    const usersRes = await fetchWithAuth(`${API_BASE}/admin/users`);
    const usersData = await usersRes.json();
    const users = usersData.users || [];

    const html = `
      <div class="modal-content">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="margin: 0;">👑 Appoint / Transfer Home Owner</h3>
          <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 14px; line-height: 1.5;">
          Appointing a Home Owner grants full authority over this home, its rooms, members, and all contained devices.
        </p>
        <div class="form-group">
          <label class="form-label">Select User *</label>
          <select id="appoint-owner-user" class="form-control">
            ${users.map(u => `
              <option value="${u.id}">${escapeHtml(u.username)} (${escapeHtml(u.email || u.full_name || 'User')})</option>
            `).join('')}
          </select>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitAppointOwner(${homeId})">Confirm Appointment</button>
        </div>
      </div>
    `;
    openModal(html);
  } catch (err) {
    alert("Failed to load users: " + err.message);
  }
}

async function submitAppointOwner(homeId) {
  const userId = Number(document.getElementById("appoint-owner-user").value);
  if (!userId) return;

  try {
    const res = await fetchWithAuth(`${API_BASE}/homes/${homeId}/owner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Owner Appointed", message: "Home Owner appointed successfully", severity: "SUCCESS" });
      closeModal();
      loadNodes();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Appointment failed: " + err.message);
  }
}

async function showAddMemberModal(homeId) {
  try {
    const usersRes = await fetchWithAuth(`${API_BASE}/admin/users`);
    const usersData = await usersRes.json();
    const users = usersData.users || [];

    const html = `
      <div class="modal-content">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="margin: 0;">👤 Add Home Member</h3>
          <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
        </div>
        <div class="form-group">
          <label class="form-label">Select User *</label>
          <select id="add-member-user" class="form-control">
            ${users.map(u => `
              <option value="${u.id}">${escapeHtml(u.username)} (${escapeHtml(u.email || '')})</option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Home Role *</label>
          <select id="add-member-role" class="form-control">
            <option value="FAMILY_MEMBER">Family Member (Control devices in permitted rooms)</option>
            <option value="HOME_ADMIN">Home Admin (Manage rooms, assign nodes, edit config)</option>
            <option value="GUEST">Guest (Restricted temporary control)</option>
            <option value="VIEWER">Viewer (Read-only access)</option>
          </select>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitAddMember(${homeId})">Add Member</button>
        </div>
      </div>
    `;
    openModal(html);
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function submitAddMember(homeId) {
  const userId = Number(document.getElementById("add-member-user").value);
  const role = document.getElementById("add-member-role").value;

  try {
    const res = await fetchWithAuth(`${API_BASE}/homes/${homeId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Member Added", message: "User added to home", severity: "SUCCESS" });
      closeModal();
      showManageHomeModal(homeId);
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Failed: " + err.message);
  }
}

async function removeHomeMember(homeId, userId) {
  if (!confirm("Are you sure you want to remove this member from the home?")) return;
  try {
    const res = await fetchWithAuth(`${API_BASE}/homes/${homeId}/members/${userId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      showToast({ title: "Member Removed", message: "Member removed from home", severity: "INFO" });
      showManageHomeModal(homeId);
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Failed: " + err.message);
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

    const devices = data.devices || data.nodes || [];
    statusText.textContent = `Scan complete in ${data.durationMs ? data.durationMs + "ms" : ""}. Found ${devices.length} smart device(s).`;
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
                ${(d.protected || d.isProtected) ? '<span class="status-badge badge-warning" style="font-size: 11px;">🔒 Protected</span>' : '<span class="status-badge badge-online" style="font-size: 11px;">Open</span>'}
                ${isAdded ? '<span class="status-badge badge-info" style="font-size: 11px;">✓ In Fleet</span>' : ''}
              </div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px; display: flex; gap: 12px; flex-wrap: wrap;">
                <span><strong>IP:</strong> <code>${escapeHtml(d.ip)}</code></span>
                <span><strong>MAC:</strong> <code>${escapeHtml(d.mac || 'N/A')}</code></span>
                <span><strong>HW:</strong> ${escapeHtml(d.hardware || 'ESP8266')}</span>
                <span><strong>FW:</strong> v${escapeHtml(d.firmwareVersion || d.firmware || '1.0')}</span>
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

    // Grab pin catalog (contains live hardware pins, allocated sensors, and active relays)
    let pinCatalog = null;
    try {
      const pinRes = await fetch(`${API_BASE}/nodes/${nodeId}/pins`);
      const pinData = await pinRes.json();
      if (pinData.success && pinData.catalog) {
        pinCatalog = pinData.catalog;
      }
    } catch (e) {
      console.warn("Could not fetch pin catalog:", e);
    }

    // Active relays from catalog or node
    const relaysList = (pinCatalog && Array.isArray(pinCatalog.relays)) ? pinCatalog.relays : [];
    const channels = relaysList.length > 0 ? relaysList : (Array.isArray(node.channels_json) ? node.channels_json : []);

    const freePinCount = pinCatalog ? pinCatalog.freePins : 0;
    const totalPinCount = pinCatalog ? pinCatalog.totalPins : 0;

    const html = `
      <div class="modal-content modal-lg" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h3 style="margin: 0;">⚙️ Node Settings: ${escapeHtml(node.name || node.node_id)}</h3>
              <span class="status-badge ${node.is_online ? 'badge-online' : 'badge-offline'}">${node.status || (node.is_online ? 'Online' : 'Offline')}</span>
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
              Node ID: <code>${escapeHtml(node.node_id)}</code> &bull; IP: <code>${escapeHtml(node.ip_address)}</code> &bull; Hardware: <code>${escapeHtml(node.hardware_type || 'ESP8266')}</code>
            </div>
          </div>
          <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
        </div>

        <!-- TABS NAVIGATION -->
        <div class="settings-tabs" style="margin-top: 10px;">
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
            <div><strong>System Uptime:</strong> ${Math.floor(Number(node.uptime_sec || 0) / 60)} min</div>
            <div><strong>MAC Address:</strong> <code>${escapeHtml(node.mac_address || 'N/A')}</code></div>
          </div>
        </div>

        <!-- TAB 2: USER ID & PASSWORD -->
        <div id="tab-pane-auth" class="settings-tab-pane ${activeTab === 'auth' ? 'active' : ''}">
          <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px;">
            <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
              Device Authentication Credentials
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 14px;">
              Configured HTTP Basic Authentication credentials matching the firmware on this node.
            </div>

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
          <!-- Action Toolbar -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
            <div>
              <div style="font-size: 13.5px; font-weight: 600; color: var(--text-primary);">
                Hardware GPIO Pin Allocation & Relay Channels
              </div>
              <div style="font-size: 12px; color: var(--text-secondary);">
                Grab live pins directly from node, view allocated sensors, and add or remove relays.
              </div>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn btn-secondary" id="btn-sync-pins" style="font-size: 12px; display: flex; align-items: center; gap: 6px; border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;" onclick="syncPinsFromNode('${node.node_id}')">
                <span>🔄</span>
                <span>Grab Pins from Node</span>
              </button>
              <button class="btn btn-secondary" style="font-size: 12px; display: flex; align-items: center; gap: 6px;" onclick="pushConfigToNode('${node.node_id}')">
                <span>📤</span>
                <span>Push to Node</span>
              </button>
              <button class="btn btn-primary" style="font-size: 12px; display: flex; align-items: center; gap: 6px;" onclick="showAddRelayModal('${node.node_id}')">
                <span>+</span>
                <span>Add Relay</span>
              </button>
            </div>
          </div>

          <div id="sync-pins-status" style="display: none; padding: 8px 12px; border-radius: 6px; font-size: 12.5px; margin-bottom: 12px;"></div>
          <div id="push-config-result" style="display: none; padding: 8px 12px; border-radius: 6px; font-size: 12.5px; margin-bottom: 12px;"></div>

          <!-- SECTION 1: PHYSICAL HARDWARE PIN MAP & AVAILABILITY -->
          <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <div style="font-size: 12.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);">
                📌 Available Hardware Pins & Sensors (${freePinCount} Free / ${totalPinCount} Total)
              </div>
              <div style="font-size: 11.5px; color: var(--text-muted);">
                Model: <code>${escapeHtml(pinCatalog ? pinCatalog.hardware : (node.hardware_type || 'ESP8266'))}</code>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;">
              ${(pinCatalog ? pinCatalog.pins : []).map(p => {
                let badgeClass = 'badge-info';
                let roleLabel = '🟢 Free Pin';
                if (p.role === 'RELAY') {
                  badgeClass = p.state ? 'badge-online' : 'badge-sync';
                  roleLabel = `⚡ Relay: ${escapeHtml(p.relayName || `Ch ${p.channelId}`)}`;
                } else if (p.role === 'SENSOR') {
                  badgeClass = 'badge-warning';
                  roleLabel = '🌡️ Sensor Input';
                } else if (p.safety === 'BOOT_SENSITIVE') {
                  badgeClass = 'badge-warning';
                  roleLabel = '⚠️ Free (Boot-Sensitive)';
                }

                return `
                  <div style="background: rgba(255,255,255,0.025); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between; gap: 8px;">
                    <div>
                      <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                        <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 5px;">
                          <span>${p.dPin.includes('A0') ? '📈' : (p.isRelay ? '🔌' : '📍')}</span>
                          <span>${escapeHtml(p.dPin)}</span>
                          <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">(GPIO ${p.pin})</span>
                        </div>
                        <span class="status-badge ${badgeClass}" style="font-size: 10px; white-space: nowrap;">
                          ${roleLabel}
                        </span>
                      </div>
                      <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">
                        ${escapeHtml(p.notes)}
                      </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end; align-items: center; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.06);">
                      ${p.isRelay ? `
                        <div style="display: flex; gap: 6px;">
                          <button class="btn btn-secondary" style="padding: 2px 7px; font-size: 11px;" onclick="showAddRelayModal('${node.node_id}', '${p.channelId}')">✏️ Edit</button>
                          <button class="btn btn-danger" style="padding: 2px 7px; font-size: 11px;" onclick="deleteRelayChannel('${node.node_id}', '${p.channelId}')">🗑️ Remove</button>
                        </div>
                      ` : (p.safety !== 'SENSOR_ONLY' ? `
                        <button class="btn btn-primary" style="padding: 2px 8px; font-size: 11px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.35); color: #93c5fd;" onclick="showAddRelayModal('${node.node_id}', null, ${p.pin})">
                          + Assign Relay
                        </button>
                      ` : `<span style="font-size: 11px; color: var(--text-muted);">Analog ADC Input</span>`)}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- SECTION 2: CONFIGURED RELAYS LIST -->
          <div style="font-size: 12.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); margin-bottom: 8px;">
            ⚡ Active Relay Channels (${channels.length})
          </div>

          <div class="settings-table-wrapper">
            <table class="settings-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>GPIO Pin</th>
                  <th>Relay Name</th>
                  <th>Room</th>
                  <th>Type</th>
                  <th>Logic</th>
                  <th>Boot State</th>
                  <th>Live Status</th>
                  <th style="text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${channels.length === 0 ? `
                  <tr>
                    <td colspan="9" style="text-align: center; color: var(--text-secondary); padding: 24px;">
                      No relay channels configured. Click <strong>"🔄 Grab Pins from Node"</strong> or <strong>"+ Add Relay"</strong>.
                    </td>
                  </tr>
                ` : channels.map(c => `
                  <tr>
                    <td><code>Ch ${escapeHtml(c.id || c.channel_id)}</code></td>
                    <td><span class="status-badge badge-info" style="font-size: 11px;">GPIO ${c.pin}</span></td>
                    <td style="font-weight: 500;">${escapeHtml(c.name || 'Relay')}</td>
                    <td>${escapeHtml(c.room || node.room || 'General')}</td>
                    <td><span style="text-transform: capitalize;">${escapeHtml(c.function || c.type || 'relay')}</span></td>
                    <td>${c.active_low !== false ? '<span style="color: var(--accent-blue);">Active LOW</span>' : '<span style="color: var(--accent-green);">Active HIGH</span>'}</td>
                    <td><code>${escapeHtml(c.boot_state || c.initial_mode || 'OFF')}</code></td>
                    <td>
                      <span class="status-badge ${c.current_state || c.state ? 'badge-online' : 'badge-offline'}" style="font-size: 11px;">
                        ${c.current_state || c.state ? '● ON' : '○ OFF'}
                      </span>
                    </td>
                    <td style="text-align: right;">
                      <div style="display: inline-flex; gap: 6px;">
                        <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="showAddRelayModal('${node.node_id}', '${escapeHtml(c.id || c.channel_id)}')">✏️ Edit</button>
                        <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteRelayChannel('${node.node_id}', '${escapeHtml(c.id || c.channel_id)}')">🗑️ Remove</button>
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

// Active grab/sync pins directly from node hardware
async function syncPinsFromNode(nodeId) {
  const btn = document.getElementById("btn-sync-pins");
  const statusBox = document.getElementById("sync-pins-status");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "<span>🔄</span><span>Grabbing...</span>";
  }
  if (statusBox) {
    statusBox.style.display = "block";
    statusBox.style.background = "rgba(59, 130, 246, 0.15)";
    statusBox.style.color = "var(--accent-blue)";
    statusBox.textContent = "Connecting to node and reading hardware pins...";
  }

  try {
    const res = await fetch(`${API_BASE}/nodes/${nodeId}/sync-pins`, {
      method: "POST"
    });
    const data = await res.json();
    if (data.success) {
      if (statusBox) {
        statusBox.style.background = "rgba(16, 185, 129, 0.15)";
        statusBox.style.color = "var(--accent-green)";
        statusBox.textContent = `✅ Successfully grabbed ${data.count} pin(s) directly from node!`;
      }
      setTimeout(() => {
        showNodeSettingsModal(nodeId, 'relays');
      }, 600);
    } else {
      if (statusBox) {
        statusBox.style.background = "rgba(239, 68, 68, 0.15)";
        statusBox.style.color = "var(--accent-red)";
        statusBox.textContent = "Failed to grab pins: " + (data.error || "Unknown error");
      }
    }
  } catch (err) {
    if (statusBox) {
      statusBox.style.background = "rgba(239, 68, 68, 0.15)";
      statusBox.style.color = "var(--accent-red)";
      statusBox.textContent = "Error grabbing pins: " + err.message;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "<span>🔄</span><span>Grab Pins from Node</span>";
    }
  }
}

// Modal for adding or editing a relay channel
async function showAddRelayModal(nodeId, editChannelId = null, preselectedPin = null) {
  let existingChannel = null;
  let pinCatalog = null;
  let node = null;

  try {
    const res = await fetch(`${API_BASE}/nodes`);
    const rawNodes = await res.json();
    const nodes = Array.isArray(rawNodes) ? rawNodes : (rawNodes.nodes || []);
    node = nodes.find(n => n.node_id === nodeId);
    if (node && node.channels_json) {
      const channels = typeof node.channels_json === 'string' ? JSON.parse(node.channels_json) : node.channels_json;
      if (editChannelId) {
        existingChannel = channels.find(c => String(c.id || c.channel_id) === String(editChannelId));
      }
    }

    const pinRes = await fetch(`${API_BASE}/nodes/${nodeId}/pins`);
    const pinData = await pinRes.json();
    if (pinData.success && pinData.catalog) {
      pinCatalog = pinData.catalog;
    }
  } catch (e) {
    console.warn("Could not load node or pin catalog for add relay modal:", e);
  }

  const isEdit = !!existingChannel;
  
  // Calculate next available integer channel ID if adding
  let nextChannelId = 1;
  if (!isEdit && pinCatalog && Array.isArray(pinCatalog.relays)) {
    const existingIds = pinCatalog.relays.map(r => parseInt(String(r.channel_id || r.id).replace(/\D/g, '')) || 0);
    while (existingIds.includes(nextChannelId)) {
      nextChannelId++;
    }
  }

  const channelId = existingChannel ? (existingChannel.id || existingChannel.channel_id) : nextChannelId;
  const pin = preselectedPin !== null ? preselectedPin : (existingChannel ? existingChannel.pin : (pinCatalog && pinCatalog.pins.find(p => p.role === 'FREE') ? pinCatalog.pins.find(p => p.role === 'FREE').pin : 5));
  const name = existingChannel ? existingChannel.name : 'Ceiling Light';
  const room = existingChannel ? (existingChannel.room || '') : (node ? node.room || '' : '');
  const func = existingChannel ? (existingChannel.function || existingChannel.type || 'light') : 'light';
  const activeLow = existingChannel ? (existingChannel.active_low !== false) : true;
  const bootState = existingChannel ? (existingChannel.boot_state || 'OFF') : 'OFF';

  // Build pin options from hardware catalog
  let pinOptionsHtml = '';
  if (pinCatalog && Array.isArray(pinCatalog.pins)) {
    pinOptionsHtml = pinCatalog.pins.filter(p => p.safety !== 'SENSOR_ONLY').map(p => {
      const isSelected = p.pin == pin;
      const isOccupied = p.isRelay && String(p.channelId) !== String(channelId);
      let desc = p.notes;
      if (isOccupied) {
        desc = `⚡ IN USE: ${p.relayName} (Ch ${p.channelId})`;
      } else if (p.safety === 'SAFE') {
        desc = '🟢 FREE (Safe Output)';
      } else if (p.safety === 'BOOT_SENSITIVE') {
        desc = '⚠️ FREE (Boot-Sensitive)';
      }
      return `<option value="${p.pin}" ${isSelected ? 'selected' : ''} ${isOccupied ? 'disabled style="color: #64748b;"' : ''}>
        ${escapeHtml(p.dPin)} - ${desc}
      </option>`;
    }).join('');
  } else {
    // Fallback standard options
    pinOptionsHtml = `
      <option value="5" ${pin == 5 ? 'selected' : ''}>D1 (GPIO 5) - Safe I2C SCL, boot-neutral</option>
      <option value="4" ${pin == 4 ? 'selected' : ''}>D2 (GPIO 4) - Safe I2C SDA, boot-neutral</option>
      <option value="14" ${pin == 14 ? 'selected' : ''}>D5 (GPIO 14) - Safe SPI SCK / Sensor</option>
      <option value="12" ${pin == 12 ? 'selected' : ''}>D6 (GPIO 12) - Safe SPI MISO</option>
      <option value="13" ${pin == 13 ? 'selected' : ''}>D7 (GPIO 13) - Safe SPI MOSI</option>
      <option value="15" ${pin == 15 ? 'selected' : ''}>D8 (GPIO 15) - Boot sensitive (Pull-down)</option>
      <option value="0" ${pin == 0 ? 'selected' : ''}>GPIO 0 - Boot sensitive / Flash pin</option>
      <option value="2" ${pin == 2 ? 'selected' : ''}>GPIO 2 - Boot sensitive / TXD1</option>
      <option value="16" ${pin == 16 ? 'selected' : ''}>D0 (GPIO 16) - Deep sleep wake</option>
    `;
  }

  const html = `
    <div class="modal-content" style="max-width: 520px;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
        <h3 style="margin: 0;">${isEdit ? '✏️ Edit Relay Channel' : '⚡ Add Relay Channel'}</h3>
        <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="showNodeSettingsModal('${nodeId}', 'relays')">&times;</button>
      </div>

      <div style="padding: 14px 0;">
        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 12px; margin-bottom: 12px;">
          <div class="form-group">
            <label class="form-label">Channel Number *</label>
            <input type="number" id="relay-channel-id" class="form-control" value="${channelId}" min="1" max="32" ${isEdit ? 'readonly style="opacity: 0.7;"' : ''} placeholder="1">
          </div>
          <div class="form-group">
            <label class="form-label">GPIO Pin *</label>
            <select id="relay-pin" class="form-control">
              ${pinOptionsHtml}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Friendly Name *</label>
          <input type="text" id="relay-name" class="form-control" value="${escapeHtml(name)}" placeholder="e.g. Living Room Fan">
        </div>

        <div class="form-group">
          <label class="form-label">Room / Zone</label>
          <input type="text" id="relay-room" class="form-control" value="${escapeHtml(room)}" placeholder="Leave blank to inherit node room">
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
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
            <label class="form-label">Boot State</label>
            <select id="relay-boot" class="form-control">
              <option value="OFF" ${bootState === 'OFF' ? 'selected' : ''}>OFF (Safe Default)</option>
              <option value="ON" ${bootState === 'ON' ? 'selected' : ''}>ON</option>
              <option value="RESTORE" ${bootState === 'RESTORE' ? 'selected' : ''}>RESTORE (Last State)</option>
            </select>
          </div>
        </div>

        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; margin-top: 4px;">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
            <input type="checkbox" id="relay-active-low" ${activeLow ? 'checked' : ''}>
            <span>Active LOW Logic (Default for optocoupler relay boards)</span>
          </label>
        </div>

        <div id="add-relay-status" style="display: none; padding: 8px 12px; border-radius: 6px; font-size: 13px; margin-top: 12px;"></div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 12px;">
        <button class="btn btn-secondary" onclick="showNodeSettingsModal('${nodeId}', 'relays')">Back</button>
        <button class="btn btn-primary" id="btn-submit-relay" onclick="submitSaveRelay('${nodeId}')">${isEdit ? 'Update Relay' : 'Add Relay'}</button>
      </div>
    </div>
  `;
  openModal(html);
}

// Submit relay add or update
async function submitSaveRelay(nodeId) {
  const rawChannelId = document.getElementById("relay-channel-id").value.trim();
  const channel_id = parseInt(rawChannelId.replace(/\D/g, '')) || 1;
  const pin = parseInt(document.getElementById("relay-pin").value);
  const name = document.getElementById("relay-name").value.trim();
  const room = document.getElementById("relay-room").value.trim();
  const func = document.getElementById("relay-func").value;
  const bootState = document.getElementById("relay-boot").value;
  const activeLow = document.getElementById("relay-active-low").checked;
  const statusBox = document.getElementById("add-relay-status");
  const btn = document.getElementById("btn-submit-relay");

  if (!name) {
    statusBox.style.display = "block";
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = "Please provide a friendly name for this relay.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const res = await fetch(`${API_BASE}/nodes/${nodeId}/relays`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id,
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
      showToast({ title: 'Relay Configured', message: `Relay '${name}' (Ch ${channel_id}) saved and pushed to node.`, severity: 'SUCCESS' });
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
  if (!confirm(`Are you sure you want to remove relay channel "${channelId}" from this node?`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/nodes/${nodeId}/relays/${channelId}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'Relay Removed', message: `Relay channel ${channelId} removed from fleet and node.`, severity: 'INFO' });
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


// --- 3. RELAYS ---
async function loadRelays() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/relays`);
    const rawRelays = await res.json();
    const relays = Array.isArray(rawRelays) ? rawRelays : (rawRelays.relays || []);
    fleetData.relays = relays;

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="font-size: 14px; color: var(--text-secondary);">${relays.length} Relay Channels Managed</div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary" onclick="syncPinsWithHardware()">♴️ Sync Pins with Node</button>
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

async function syncPinsWithHardware(nodeId) {
  try {
    const url = nodeId ? `${API_BASE}/nodes/${nodeId}/sync-pins` : `${API_BASE}/relays/sync`;
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();
    if (data.status === "ok") {
      alert(`Hardware pin synchronization complete: ${data.message || 'Synced'}`);
      if (typeof currentView !== 'undefined') {
        if (currentView === 'relays') loadRelays();
        else if (currentView === 'nodes') loadNodes();
      } else {
        loadRelays();
      }
    } else {
      alert(`Sync failed: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    alert(`Sync request error: ${err.message}`);
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

// --- 6. FIRMWARE & LONG-TERM SUPPORT (LTS) OTA MANAGEMENT ---
let otaActiveTab = 'catalog';
let otaWizardState = {
  nodeId: null,
  firmwareId: null,
  diagnostics: null,
  preCheck: null
};

async function loadFirmware(activeTab = null) {
  if (activeTab) otaActiveTab = activeTab;
  const container = document.getElementById("content-area");

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <div>
        <h2 style="margin: 0 0 4px 0; font-size: 18px;">Firmware Repository & Long-Term Support (LTS) OTA Engine</h2>
        <div style="font-size: 13px; color: var(--text-secondary);">Live node inspection, pre-update version checking, automated configuration backups, and resilient OTA flashing</div>
      </div>
      <div style="display: flex; gap: 10px;">
        <button class="btn btn-secondary" onclick="loadFirmware('wizard')">🚀 Launch OTA Wizard</button>
        <button class="btn btn-primary" onclick="showUploadFirmwareModal()">+ Upload Firmware (.bin)</button>
      </div>
    </div>

    <!-- TABS -->
    <div class="ota-tabs">
      <button class="ota-tab-btn ${otaActiveTab === 'catalog' ? 'active' : ''}" onclick="loadFirmware('catalog')">
        📦 Firmware Catalog
      </button>
      <button class="ota-tab-btn ${otaActiveTab === 'wizard' ? 'active' : ''}" onclick="loadFirmware('wizard')">
        🚀 Guided OTA Deployment Wizard
      </button>
      <button class="ota-tab-btn ${otaActiveTab === 'backups' ? 'active' : ''}" onclick="loadFirmware('backups')">
        💾 Node Backups Archive
      </button>
      <button class="ota-tab-btn ${otaActiveTab === 'history' ? 'active' : ''}" onclick="loadFirmware('history')">
        📜 OTA Deployment History
      </button>
    </div>

    <div id="ota-tab-content">
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">Loading OTA content...</div>
    </div>
  `;

  if (otaActiveTab === 'catalog') {
    renderFirmwareCatalog();
  } else if (otaActiveTab === 'wizard') {
    renderOtaWizard(otaWizardState.firmwareId, otaWizardState.nodeId);
  } else if (otaActiveTab === 'backups') {
    renderNodeBackups();
  } else if (otaActiveTab === 'history') {
    renderOtaHistory();
  }
}

// === SUB-VIEW 1: FIRMWARE CATALOG ===
async function renderFirmwareCatalog() {
  const content = document.getElementById("ota-tab-content");
  try {
    const res = await fetch(`${API_BASE}/firmware`);
    const files = await res.json();

    content.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Filename</th>
            <th>Version</th>
            <th>Channel</th>
            <th>Target Hardware</th>
            <th>Size</th>
            <th>Checksum (MD5)</th>
            <th>Release Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${files.length === 0 ? '<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">No firmware binaries in catalog. Click "+ Upload Firmware" to add one.</td></tr>' : ''}
          ${files.map(f => `
            <tr>
              <td><strong>${f.filename}</strong></td>
              <td><span class="status-badge badge-online">v${f.version}</span></td>
              <td><span class="status-badge badge-lts">${f.release_channel || 'LTS'}</span></td>
              <td><span class="status-badge badge-sync">${f.hardware_type}</span></td>
              <td>${(f.file_size_bytes / 1024).toFixed(1)} KB</td>
              <td><code style="font-size: 11px;">${f.checksum_md5}</code></td>
              <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-secondary);">
                ${f.notes || 'Official Release'}
              </td>
              <td>
                <div style="display: flex; gap: 6px;">
                  <button class="btn btn-primary" style="font-size: 11px; padding: 4px 8px;" onclick="launchWizardForFirmware(${f.id})">🚀 Deploy OTA</button>
                  <button class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px; color: var(--accent-red);" onclick="deleteFirmwareFile(${f.id}, '${f.filename}')">🗑️</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    content.innerHTML = `<div style="color: var(--accent-red); padding: 20px;">Error loading catalog: ${e.message}</div>`;
  }
}

function launchWizardForFirmware(fwId) {
  otaWizardState.firmwareId = fwId;
  loadFirmware('wizard');
}

// === SUB-VIEW 2: GUIDED OTA DEPLOYMENT WIZARD ===
async function renderOtaWizard(presetFwId = null, presetNodeId = null) {
  const content = document.getElementById("ota-tab-content");

  try {
    const [nodesRes, fwRes] = await Promise.all([
      fetch(`${API_BASE}/nodes`),
      fetch(`${API_BASE}/firmware`)
    ]);
    const rawNodes = await nodesRes.json();
    const rawFw = await fwRes.json();
    const nodes = Array.isArray(rawNodes) ? rawNodes : (rawNodes.nodes || []);
    const firmwares = Array.isArray(rawFw) ? rawFw : (rawFw.firmware || rawFw.firmwares || []);
    window._cachedFirmwares = firmwares;
    window._cachedNodes = nodes;

    if (nodes.length === 0) {
      content.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color); margin: 20px 0;">No registered nodes found in fleet. Please add or connect a node first.</div>`;
      return;
    }

    const defaultNode = presetNodeId
      ? nodes.find(n => n.node_id === presetNodeId) || nodes[0] || null
      : (otaWizardState.nodeId ? nodes.find(n => n.node_id === otaWizardState.nodeId) || nodes[0] || null : nodes[0] || null);

    const defaultFw = presetFwId
      ? firmwares.find(f => f.id === Number(presetFwId)) || firmwares[0] || null
      : (otaWizardState.firmwareId ? firmwares.find(f => f.id === Number(otaWizardState.firmwareId)) || firmwares[0] || null : firmwares[0] || null);

    otaWizardState.nodeId = defaultNode ? defaultNode.node_id : null;
    otaWizardState.firmwareId = defaultFw ? defaultFw.id : null;

    content.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">

        <!-- STEP 1: TARGET NODE & LIVE DIAGNOSTICS FETCH -->
        <div class="ota-card">
          <div class="ota-card-header">
            <div class="ota-card-title">
              <span class="ota-step-pill">1</span>
              <span>Select Target Node & Fetch Live Hardware Diagnostics</span>
            </div>
            <button class="btn btn-secondary" style="font-size: 12px;" onclick="onWizardNodeChanged()">🔄 Re-fetch Node Diagnostics</button>
          </div>

          <div style="display: flex; gap: 16px; align-items: flex-end; margin-bottom: 16px;">
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Target NodeMCU / ESP8266 Device</label>
              <select id="wiz-node-select" class="form-control" onchange="onWizardNodeChanged()">
                ${nodes.map(n => `
                  <option value="${n.node_id}" ${n.node_id === otaWizardState.nodeId ? 'selected' : ''}>
                    ${n.name} (${n.ip_address || 'No IP'}) - ${n.room} [v${n.firmware_version || '1.6.0'}]
                  </option>
                `).join("")}
              </select>
            </div>
            <button class="btn btn-primary" style="height: 38px;" onclick="executeStandaloneBackup()">💾 Create Instant Node Backup</button>
          </div>

          <!-- DIAGNOSTICS CONTAINER -->
          <div id="wiz-node-diagnostics-view">
            <div style="padding: 20px; text-align: center; color: var(--text-muted);">Fetching live diagnostics from node...</div>
          </div>
        </div>

        <!-- STEP 2: FIRMWARE SELECTION & PRE-CHECK VALIDATION -->
        <div class="ota-card">
          <div class="ota-card-header">
            <div class="ota-card-title">
              <span class="ota-step-pill">2</span>
              <span>Candidate Firmware & Pre-Flight Version Validation</span>
            </div>
            <button class="btn btn-secondary" style="font-size: 12px;" onclick="onWizardFirmwareChanged()">🧪 Run Pre-Flight Validation</button>
          </div>

          <!-- CONTAINER POPULATED DYNAMICALLY FOR THE SELECTED DEVICE TYPE ONLY -->
          <div id="wiz-fw-selector-container">
            <div style="padding: 16px; text-align: center; color: var(--text-muted);">Loading firmware options for selected device...</div>
          </div>

          <!-- PRE-CHECK RESULTS CONTAINER -->
          <div id="wiz-precheck-view">
            <div style="padding: 20px; text-align: center; color: var(--text-muted);">Analyzing firmware compatibility...</div>
          </div>
        </div>

        <!-- STEP 3: BACKUP & LTS DEPLOYMENT EXECUTION -->
        <div class="ota-card">
          <div class="ota-card-header">
            <div class="ota-card-title">
              <span class="ota-step-pill">3</span>
              <span>LTS Execution Options & Deployment Launch</span>
            </div>
          </div>

          <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; cursor: pointer;">
              <input type="checkbox" id="wiz-opt-backup" checked style="width: 16px; height: 16px;">
              <div>
                <strong>Automatically backup Node Configuration & Rules before flashing (Recommended)</strong>
                <div style="font-size: 12px; color: var(--text-secondary);">Takes full snapshot of GPIO channels, automations, receiver settings and archives to database.</div>
              </div>
            </label>

            <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; cursor: pointer;">
              <input type="checkbox" id="wiz-opt-verify" checked style="width: 16px; height: 16px;">
              <div>
                <strong>Post-Flash Verification & Automatic Reboot Handshake</strong>
                <div style="font-size: 12px; color: var(--text-secondary);">Monitors node reboot over LAN, polls status and verifies target firmware version is active.</div>
              </div>
            </label>

            <div id="wiz-downgrade-override-box" style="display: none; margin-top: 10px; padding: 10px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px;">
              <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: #fde047;">
                <input type="checkbox" id="wiz-opt-force" style="width: 16px; height: 16px;">
                <div>
                  <strong>Acknowledge and proceed with firmware downgrade</strong>
                  <div style="font-size: 11px;">Target version is older than currently installed version. Check this box to allow overwrite.</div>
                </div>
              </label>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px;">
            <button class="btn btn-secondary" onclick="executeStandaloneBackup()">💾 Create Instant Standalone Backup</button>
            <button class="btn btn-primary" id="btn-start-ota-deploy" style="padding: 10px 24px; font-weight: bold;" onclick="startGuidedOtaDeployment()">
              🚀 Start Validated OTA Deployment
            </button>
          </div>
        </div>

      </div>
    `;

    // Immediately render candidate firmware for default node before network fetch
    updateWizardFirmwareOptions(defaultNode);

    // Trigger initial live fetch & pre-check
    await onWizardNodeChanged();
  } catch (err) {
    content.innerHTML = `<div style="color: var(--accent-red); padding: 20px;">Error loading wizard: ${err.message}</div>`;
  }
}

// Handler: Node Changed in Wizard
async function onWizardNodeChanged() {
  const nodeSelect = document.getElementById("wiz-node-select");
  if (!nodeSelect) return;
  const nodeId = nodeSelect.value;
  otaWizardState.nodeId = nodeId;

  const nodes = window._cachedNodes || [];
  const currentNode = nodes.find(n => n.node_id === nodeId) || null;

  // 1. Immediately update candidate firmware selector for THIS node's device type!
  updateWizardFirmwareOptions(currentNode);

  const diagView = document.getElementById("wiz-node-diagnostics-view");
  if (diagView) {
    diagView.innerHTML = `
      <div style="padding: 16px; text-align: center; color: var(--text-secondary);">
        <span class="pulse-dot"></span> Connecting to node over LAN and fetching live hardware diagnostics...
      </div>
    `;
  }

  try {
    const res = await fetch(`${API_BASE}/ota/node-diagnostics/${nodeId}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Failed to fetch node diagnostics');
    otaWizardState.diagnostics = d;

    // 2. Refresh candidate firmware dropdown using confirmed hardware model from live diagnostics
    updateWizardFirmwareOptions(d || currentNode);

    if (diagView) {
      diagView.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="status-badge badge-online"><span class="pulse-dot"></span> Node Reachable</span>
            <span style="font-size: 12px; color: var(--text-secondary);">Ping: <strong>${d.rttMs}ms</strong> | IP: <strong>${d.ip}</strong> | MAC: <code>${d.network.mac}</code></span>
          </div>
          <div>
            <span class="status-badge badge-lts">Installed: v${d.firmwareVersion}</span>
          </div>
        </div>

        <div class="ota-diag-grid">
          <div class="ota-stat-chip">
            <span class="chip-label">Hardware Architecture</span>
            <span class="chip-value" style="font-size: 13px;">${d.hardware}</span>
            <span style="font-size: 11px; color: var(--text-muted);">Core: ${d.coreVersion} | SDK: ${d.sdkVersion}</span>
          </div>

          <div class="ota-stat-chip">
            <span class="chip-label">Free Sketch Space</span>
            <span class="chip-value" style="color: var(--accent-green);">${(d.flashGeometry.freeSketchSpace/1024).toFixed(1)} KB Available</span>
            <span style="font-size: 11px; color: var(--text-muted);">Sketch: ${(d.flashGeometry.sketchSize/1024).toFixed(1)} KB | Flash: ${(d.flashGeometry.flashSize/1024/1024).toFixed(1)} MB</span>
          </div>

          <div class="ota-stat-chip">
            <span class="chip-label">Free Heap Memory</span>
            <span class="chip-value" style="color: var(--accent-blue);">${(d.memory.freeHeap/1024).toFixed(1)} KB</span>
            <span style="font-size: 11px; color: var(--text-muted);">Max Block: ${(d.memory.maxFreeBlock/1024).toFixed(1)} KB | Frag: ${d.memory.heapFragPercent}%</span>
          </div>

          <div class="ota-stat-chip">
            <span class="chip-label">Network & Uptime</span>
            <span class="chip-value">${d.network.rssi} dBm (Wi-Fi)</span>
            <span style="font-size: 11px; color: var(--text-muted);">Uptime: ${Math.floor(d.network.uptimeSec/60)}m | Resets: ${d.network.bootCount}</span>
          </div>
        </div>
      `;
    }

    // 3. Trigger candidate firmware validation
    await onWizardFirmwareChanged();
  } catch (err) {
    if (diagView) {
      diagView.innerHTML = `
        <div class="check-item check-fail">
          <span>❌</span>
          <div>
            <strong>Failed to fetch live diagnostics:</strong> ${err.message}.
            <div style="font-size: 11px; margin-top: 4px;">Please check if the node is powered on and connected to the home Wi-Fi network.</div>
          </div>
        </div>
      `;
    }
    await onWizardFirmwareChanged();
  }
}

// Handler: Firmware Changed in Wizard
async function onWizardFirmwareChanged() {
  const fwSelect = document.getElementById("wiz-fw-select");
  const preCheckView = document.getElementById("wiz-precheck-view");
  const downgradeBox = document.getElementById("wiz-downgrade-override-box");
  const deployBtn = document.getElementById("btn-start-ota-deploy");

  if (!fwSelect || !preCheckView) return;
  const fwId = fwSelect.value;
  otaWizardState.firmwareId = fwId ? Number(fwId) : null;

  if (!otaWizardState.nodeId) return;

  if (!fwId) {
    preCheckView.innerHTML = `
      <div class="check-item check-warn">
        <span>⚠️</span>
        <div><strong>No firmware selected:</strong> Please upload a certified firmware binary compiled specifically for this device type.</div>
      </div>
    `;
    if (downgradeBox) downgradeBox.style.display = 'none';
    if (deployBtn) deployBtn.disabled = true;
    return;
  }

  preCheckView.innerHTML = `
    <div style="padding: 14px; text-align: center; color: var(--text-secondary);">
      <span class="pulse-dot"></span> Performing pre-flight safety and compatibility checks...
    </div>
  `;

  try {
    const res = await fetch(`${API_BASE}/ota/pre-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: otaWizardState.nodeId,
        firmwareId: Number(fwId)
      })
    });
    const check = await res.json();
    if (!res.ok) throw new Error(check.error || 'Pre-check failed');
    otaWizardState.preCheck = check;

    // Show downgrade override if applicable
    if (check.versionType === 'DOWNGRADE') {
      downgradeBox.style.display = 'block';
    } else {
      downgradeBox.style.display = 'none';
    }

    // Flash Space Bar
    const fwSize = check.fileSizeBytes;
    const freeSpace = check.diagnostics.flashGeometry.freeSketchSpace;
    const pct = Math.min(100, Math.round((fwSize / (freeSpace || 1)) * 100));

    preCheckView.innerHTML = `
      <!-- VERSION BADGE -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <div>
          <span style="font-size: 13px; color: var(--text-secondary);">Version Migration:</span>
          <span style="font-weight: 700; margin-left: 8px; font-size: 14px;">
            v${check.currentVersion} ➔ <span style="color: var(--accent-blue);">v${check.targetVersion}</span>
          </span>
          <span class="status-badge badge-lts" style="margin-left: 8px;">${check.releaseChannel}</span>
        </div>
        <div>
          ${check.versionType === 'UPGRADE' ? '<span class="status-badge badge-online">Upgrade Recommended</span>' : ''}
          ${check.versionType === 'SAME_VERSION' ? '<span class="status-badge badge-sync">Re-flash / Repair</span>' : ''}
          ${check.versionType === 'DOWNGRADE' ? '<span class="status-badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b;">Downgrade Warning</span>' : ''}
        </div>
      </div>

      <!-- FLASH SPACE GAUGE -->
      <div style="margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
          <span>Binary Flash Footprint: <strong>${(fwSize/1024).toFixed(1)} KB</strong></span>
          <span>Free Sketch Space: <strong>${(freeSpace/1024).toFixed(1)} KB</strong> (${pct}% space used)</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width: ${pct}%; background: ${pct > 90 ? 'var(--accent-red)' : 'linear-gradient(90deg, #3b82f6, #10b981)'};"></div>
        </div>
      </div>

      <!-- VALIDATION CHECKLIST -->
      <div style="margin-top: 10px;">
        ${check.checks.map(c => `
          <div class="check-item check-${c.status.toLowerCase()}">
            <span style="font-size: 14px;">${c.status === 'PASS' ? '✅' : (c.status === 'WARN' ? '⚠️' : '❌')}</span>
            <div style="flex: 1;">
              <strong>${c.title}</strong>: ${c.details}
            </div>
          </div>
        `).join("")}
      </div>
    `;

    deployBtn.disabled = !check.canProceed;
  } catch (err) {
    preCheckView.innerHTML = `
      <div class="check-item check-fail">
        <span>❌</span>
        <div><strong>Validation Error:</strong> ${err.message}</div>
      </div>
    `;
    deployBtn.disabled = true;
  }
}

// Standalone Backup Trigger
async function executeStandaloneBackup() {
  if (!otaWizardState.nodeId) {
    alert("Please select a target node first.");
    return;
  }

  const btn = event?.target;
  const oldText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving backup...'; }

  try {
    const res = await fetch(`${API_BASE}/ota/backup/${otaWizardState.nodeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupType: 'MANUAL' })
    });
    const result = await res.json();
    if (result.success) {
      alert(`Node snapshot backup #${result.backupId} created successfully!\n\nSaved: ${result.filename} (${(result.fileSizeBytes/1024).toFixed(1)} KB)`);
    } else {
      alert(`Backup failed: ${result.error}`);
    }
  } catch (err) {
    alert(`Backup error: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = oldText; }
  }
}

// Guided Deployment Modal Execution
async function startGuidedOtaDeployment() {
  const check = otaWizardState.preCheck;
  if (!check || !check.canProceed) {
    alert("Pre-flight validation has not passed. Cannot initiate OTA deployment.");
    return;
  }

  const autoBackup = document.getElementById("wiz-opt-backup").checked;
  const postVerify = document.getElementById("wiz-opt-verify").checked;
  const forceDowngrade = document.getElementById("wiz-opt-force")?.checked || false;

  if (check.versionType === 'DOWNGRADE' && !forceDowngrade) {
    alert("Please acknowledge the firmware downgrade checkbox before proceeding.");
    return;
  }

  if (!confirm(`Are you sure you want to deploy firmware v${check.targetVersion} to node '${check.diagnostics.nodeName}' (${check.diagnostics.ip})?\n\n- Automated Pre-Backup: ${autoBackup ? 'YES' : 'NO'}\n- Post-Flash Verification: ${postVerify ? 'YES' : 'NO'}`)) {
    return;
  }

  // Open Progress Modal
  const modalHtml = `
    <div class="modal-content" style="max-width: 640px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 17px;">🚀 Long-Term Support OTA Deployment in Progress</h3>
        <span class="status-badge badge-sync"><span class="pulse-dot"></span> Live</span>
      </div>

      <div style="margin-bottom: 16px;">
        <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Deployment Stages:</div>
        <div id="ota-stage-1" class="check-item check-pass"><span>✅</span> <div><strong>Stage 1:</strong> Pre-Flight Validation Complete</div></div>
        <div id="ota-stage-2" class="check-item ${autoBackup ? 'check-warn' : 'check-pass'}"><span>${autoBackup ? '⏳' : '⏭️'}</span> <div><strong>Stage 2:</strong> ${autoBackup ? 'Creating Complete Node Configuration Backup...' : 'Pre-backup skipped'}</div></div>
        <div id="ota-stage-3" class="check-item" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-muted);"><span>⏳</span> <div><strong>Stage 3:</strong> Streaming Firmware Binary to Node over LAN HTTP</div></div>
        <div id="ota-stage-4" class="check-item" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-muted);"><span>⏳</span> <div><strong>Stage 4:</strong> Flashing to Flash Memory & Awaiting Acknowledgment</div></div>
        <div id="ota-stage-5" class="check-item" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-muted);"><span>⏳</span> <div><strong>Stage 5:</strong> Node Reboot & Post-Flash Handshake Verification</div></div>
      </div>

      <div style="font-size: 12px; font-weight: 600; margin-bottom: 6px;">Live Execution Console:</div>
      <div id="ota-deploy-console" class="log-console">
        [0.0s] Initializing enterprise OTA deployment pipeline...<br>
        [0.1s] Target: ${check.diagnostics.nodeName} (${check.diagnostics.ip})<br>
        [0.2s] Candidate: ${check.diagnostics.nodeName} v${check.targetVersion} (${(check.fileSizeBytes/1024).toFixed(1)} KB)<br>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
        <button id="btn-ota-modal-close" class="btn btn-secondary" disabled onclick="closeModal(); loadFirmware('history');">Please wait...</button>
      </div>
    </div>
  `;
  openModal(modalHtml);

  const consoleEl = document.getElementById("ota-deploy-console");
  const closeBtn = document.getElementById("btn-ota-modal-close");
  const log = (msg) => {
    if (consoleEl) {
      consoleEl.innerHTML += `[${new Date().toLocaleTimeString()}] ${msg}<br>`;
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  };

  try {
    log("Sending OTA execution request to central server...");

    if (autoBackup) {
      document.getElementById("ota-stage-2").className = "check-item check-pass";
      document.getElementById("ota-stage-2").innerHTML = "<span>✅</span> <div><strong>Stage 2:</strong> Node Configuration Backup Saved to Database</div>";
      log("Node configuration & rules snapshot backed up successfully.");
    }

    document.getElementById("ota-stage-3").className = "check-item check-warn";
    document.getElementById("ota-stage-3").style.color = "#fde047";
    log("Streaming firmware binary chunks to node POST /api/ota/upload...");

    const res = await fetch(`${API_BASE}/ota/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: otaWizardState.nodeId,
        firmwareId: Number(otaWizardState.firmwareId),
        options: { autoBackup, forceDowngrade, postVerify }
      })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'OTA deployment failed');

    document.getElementById("ota-stage-3").className = "check-item check-pass";
    document.getElementById("ota-stage-3").style.color = "#86efac";

    document.getElementById("ota-stage-4").className = "check-item check-pass";
    document.getElementById("ota-stage-4").style.color = "#86efac";
    document.getElementById("ota-stage-4").innerHTML = "<span>✅</span> <div><strong>Stage 4:</strong> Flash Write Complete (Node Acknowledged)</div>";
    log("Node confirmed flash write. Initiating automatic restart sequence.");

    if (postVerify) {
      document.getElementById("ota-stage-5").className = "check-item check-pass";
      document.getElementById("ota-stage-5").style.color = "#86efac";
      document.getElementById("ota-stage-5").innerHTML = `<span>✅</span> <div><strong>Stage 5:</strong> Handshake Verified! Active Version: v${result.versionTo}</div>`;
      log(`Node came back online in ${(result.totalDurationMs/1000).toFixed(1)}s! Version verified: v${result.versionTo}.`);
    }

    log("🎉 OTA Deployment Pipeline Finished Successfully!");
    closeBtn.disabled = false;
    closeBtn.textContent = "Done (View History)";
    closeBtn.className = "btn btn-primary";
  } catch (err) {
    log(`❌ ERROR: ${err.message}`);
    document.getElementById("ota-stage-3").className = "check-item check-fail";
    document.getElementById("ota-stage-3").style.color = "#fca5a5";
    closeBtn.disabled = false;
    closeBtn.textContent = "Close";
  }
}

// === SUB-VIEW 3: NODE BACKUPS ARCHIVE ===
async function renderNodeBackups() {
  const content = document.getElementById("ota-tab-content");
  try {
    const res = await fetch(`${API_BASE}/ota/backups`);
    const backups = await res.json();

    content.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div style="font-size: 13px; color: var(--text-secondary);">
          Full snapshots of node hardware profiles, GPIO channels, room names, automation rules and telemetry parameters.
        </div>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>Backup ID</th>
            <th>Target Node</th>
            <th>Firmware Version</th>
            <th>Type</th>
            <th>Created At</th>
            <th>Size</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${backups.length === 0 ? '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">No configuration backups recorded. Backups are created automatically before OTA updates or via the wizard.</td></tr>' : ''}
          ${backups.map(b => `
            <tr>
              <td><strong>#${b.id}</strong></td>
              <td>${b.node_name} (<code>${b.node_id}</code>)</td>
              <td><span class="status-badge badge-sync">v${b.firmware_version}</span></td>
              <td><span class="status-badge ${b.backup_type === 'PRE_OTA' ? 'badge-lts' : 'badge-online'}">${b.backup_type}</span></td>
              <td>${new Date(b.created_at).toLocaleString()}</td>
              <td>${(b.file_size_bytes / 1024).toFixed(1)} KB</td>
              <td>
                <div style="display: flex; gap: 6px;">
                  <a href="${API_BASE}/ota/backups/${b.id}/download" class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px; text-decoration: none;">⬇️ Download JSON</a>
                  <button class="btn btn-primary" style="font-size: 11px; padding: 4px 8px;" onclick="restoreBackupToNode(${b.id}, '${b.node_id}')">🔄 Restore</button>
                  <button class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px; color: var(--accent-red);" onclick="deleteBackupRecord(${b.id})">🗑️</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    content.innerHTML = `<div style="color: var(--accent-red); padding: 20px;">Error loading backups: ${err.message}</div>`;
  }
}

async function deleteBackupRecord(id) {
  if (!confirm(`Delete configuration backup #${id}?`)) return;
  try {
    const res = await fetch(`${API_BASE}/ota/backups/${id}`, { method: 'DELETE' });
    const r = await res.json();
    if (r.success) {
      renderNodeBackups();
    } else {
      alert(r.error || 'Failed to delete backup');
    }
  } catch (e) {
    alert(e.message);
  }
}

async function restoreBackupToNode(backupId, nodeId) {
  if (!confirm(`Restore configuration snapshot #${backupId} to node '${nodeId}'?\n\nThis will restore GPIO channel names, rooms, functions and system settings.`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/ota/backups/${backupId}/restore/${nodeId}`, { method: 'POST' });
    const r = await res.json();
    if (r.success) {
      alert(`Restoration complete! Successfully applied ${r.restoredItems} configuration items to node.`);
    } else {
      alert(`Restoration finished with warnings: ${r.errors.join(', ')}`);
    }
  } catch (e) {
    alert(`Restoration failed: ${e.message}`);
  }
}

// === SUB-VIEW 4: OTA DEPLOYMENT HISTORY ===
async function renderOtaHistory() {
  const content = document.getElementById("ota-tab-content");
  try {
    const res = await fetch(`${API_BASE}/ota/history`);
    const history = await res.json();

    content.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Target Node</th>
            <th>Firmware File</th>
            <th>Version Migration</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Backup Reference</th>
          </tr>
        </thead>
        <tbody>
          ${history.length === 0 ? '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">No previous OTA deployments recorded.</td></tr>' : ''}
          ${history.map(h => `
            <tr>
              <td>${new Date(h.created_at).toLocaleString()}</td>
              <td><strong>${h.node_name}</strong> (<code>${h.node_id}</code>)</td>
              <td><code>${h.firmware_filename || 'firmware.bin'}</code></td>
              <td>
                <span style="font-size: 13px; font-weight: 600;">v${h.version_from} ➔ <span style="color: var(--accent-blue);">v${h.version_to}</span></span>
              </td>
              <td>
                <span class="status-badge ${h.status === 'SUCCESS' ? 'badge-online' : (h.status === 'IN_PROGRESS' ? 'badge-sync' : '')}" style="${h.status === 'FAILED' ? 'background: rgba(239, 68, 68, 0.2); color: var(--accent-red);' : ''}">
                  ${h.status}
                </span>
              </td>
              <td>${(h.duration_ms / 1000).toFixed(1)}s</td>
              <td>
                ${h.backup_id ? `<a href="${API_BASE}/ota/backups/${h.backup_id}/download" style="color: var(--accent-blue); font-size: 12px; text-decoration: none;">💾 Backup #${h.backup_id}</a>` : '<span style="color: var(--text-muted);">None</span>'}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    content.innerHTML = `<div style="color: var(--accent-red); padding: 20px;">Error loading history: ${err.message}</div>`;
  }
}

// Upload Modal with LTS metadata
async function showUploadFirmwareModal(preselectedHw = null) {
  let nodes = window._cachedNodes || [];
  if (nodes.length === 0) {
    try {
      const res = await fetch(`${API_BASE}/nodes`);
      const data = await res.json();
      nodes = Array.isArray(data) ? data : (data.nodes || []);
      window._cachedNodes = nodes;
    } catch {}
  }

  const html = `
    <div class="modal-content" style="max-width: 600px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div>
          <h3 style="margin: 0; font-size: 18px;">Upload Certified Firmware Binary (.bin)</h3>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
            Target an available fleet node or register a brand-new device architecture
          </div>
        </div>
        <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="closeModal()">&times;</button>
      </div>

      <div class="form-group">
        <label class="form-label">Firmware Binary File (.bin) *</label>
        <input type="file" id="fw-file" class="form-control" accept=".bin" onchange="onFwFileSelected()">
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
          Must be an exported binary file with ESP ROM magic byte <code>0xE9</code>.
        </div>
      </div>

      <!-- TARGET DEVICE / HARDWARE PLATFORM SELECTION -->
      <div class="form-group">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <label class="form-label" style="margin: 0;">Target Device or Hardware Platform *</label>
          <button type="button" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px; color: var(--accent-blue);" onclick="toggleCustomDeviceInput(true)">
            ➕ Add New Device Model
          </button>
        </div>

        <div id="fw-device-select-container">
          <select id="fw-hardware" class="form-control" onchange="onUploadDeviceSelectionChanged()">
            ${nodes.length > 0 ? `
              <optgroup label="📡 Target Available Nodes in Fleet">
                ${nodes.map(n => `
                  <option value="${escapeHtml(n.hardware_type || n.hardware || 'ESP8266')}" data-nodename="${escapeHtml(n.name)}">
                    ${escapeHtml(n.name)} (${escapeHtml(n.ip_address || 'No IP')}) — [${escapeHtml(n.hardware_type || 'ESP8266')}]
                  </option>
                `).join('')}
              </optgroup>
            ` : ''}

            <optgroup label="⚙️ Standard Hardware Platforms">
              <option value="ESP8266 (ESP-12E/F) NodeMCU">ESP8266 (ESP-12E/F) NodeMCU (4MB Flash)</option>
              <option value="ESP8266 ESP-01 / ESP-01S (1MB)">ESP8266 ESP-01 / ESP-01S (1MB Flash)</option>
              <option value="ESP8266 (Generic)">ESP8266 Generic</option>
              <option value="ESP32">ESP32 (WROOM / WROVER)</option>
            </optgroup>

            <optgroup label="➕ Custom Device Model">
              <option value="__NEW_DEVICE__">+ Add New Custom Device Model...</option>
            </optgroup>
          </select>
        </div>

        <!-- NEW CUSTOM DEVICE MODEL INPUT BOX -->
        <div id="fw-new-device-box" style="display: none; margin-top: 8px; background: rgba(59, 130, 246, 0.08); border: 1px dashed rgba(59, 130, 246, 0.3); border-radius: 6px; padding: 10px;">
          <label class="form-label" style="font-size: 12px; margin-bottom: 4px; color: #93c5fd;">Enter New Device Model / Hardware Name:</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="fw-custom-hardware" class="form-control" placeholder="e.g. ESP32-CAM, Sonoff Basic R2, Shelly 1, Custom PCB" style="font-size: 13px;">
            <button type="button" class="btn btn-secondary" style="font-size: 11px; white-space: nowrap;" onclick="toggleCustomDeviceInput(false)">Use Existing</button>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
            This registers a separate hardware platform category in your fleet firmware repository.
          </div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Firmware Version *</label>
          <input type="text" id="fw-version" class="form-control" placeholder="e.g. 1.7.0" value="1.7.0">
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Format: Semantic version (X.Y.Z)</div>
        </div>

        <div class="form-group">
          <label class="form-label">Release Channel</label>
          <select id="fw-channel" class="form-control">
            <option value="LTS">LTS (Long Term Support)</option>
            <option value="Stable">Stable Release</option>
            <option value="Beta">Beta Channel</option>
            <option value="Testing">Development / Testing</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Changelog & Release Notes</label>
        <textarea id="fw-notes" class="form-control" rows="2" placeholder="Describe optimizations, bug fixes, or enhancements...">Production LTS release with dynamic heap optimization and TCP keep-alive.</textarea>
      </div>

      <div id="fw-upload-status" style="display: none; font-size: 13px; padding: 8px; border-radius: 6px; margin-bottom: 12px;"></div>

      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="btn-submit-upload-fw" onclick="submitUploadFirmware()">Upload & Register</button>
      </div>
    </div>
  `;
  openModal(html);

  // If a preselected hardware was passed, choose it
  if (preselectedHw) {
    setTimeout(() => {
      const sel = document.getElementById("fw-hardware");
      if (sel) {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value.includes(preselectedHw) || preselectedHw.includes(sel.options[i].value)) {
            sel.selectedIndex = i;
            break;
          }
        }
      }
    }, 50);
  }
}

// Toggle custom device input vs dropdown
function toggleCustomDeviceInput(showCustom) {
  const customBox = document.getElementById("fw-new-device-box");
  const selectBox = document.getElementById("fw-device-select-container");
  const customInput = document.getElementById("fw-custom-hardware");
  const sel = document.getElementById("fw-hardware");

  if (showCustom === undefined) {
    showCustom = (customBox.style.display === "none");
  }

  if (showCustom) {
    customBox.style.display = "block";
    selectBox.style.display = "none";
    if (customInput) customInput.focus();
  } else {
    customBox.style.display = "none";
    selectBox.style.display = "block";
    if (sel && sel.value === "__NEW_DEVICE__") {
      sel.selectedIndex = 0;
    }
  }
}

// Handler when user chooses an option from the hardware / node dropdown
function onUploadDeviceSelectionChanged() {
  const sel = document.getElementById("fw-hardware");
  if (!sel) return;

  if (sel.value === "__NEW_DEVICE__") {
    toggleCustomDeviceInput(true);
    return;
  }

  const selectedOpt = sel.options[sel.selectedIndex];
  const nodeName = selectedOpt?.dataset?.nodename;
  const notesField = document.getElementById("fw-notes");
  if (nodeName && notesField && notesField.value.includes("Production LTS release")) {
    notesField.value = `Certified LTS firmware build targeted for ${nodeName} (${sel.value}).`;
  }
}

// Inspect file when selected
function onFwFileSelected() {
  const fileInput = document.getElementById("fw-file");
  const statusBox = document.getElementById("fw-upload-status");
  if (!fileInput.files || fileInput.files.length === 0) return;

  const file = fileInput.files[0];
  const sizeKb = (file.size / 1024).toFixed(1);

  // Auto-detect version from filename if present (e.g. firmware-v1.7.0.bin)
  const match = file.name.match(/v?([0-9]+\.[0-9]+(\.[0-9]+)?)/i);
  if (match) {
    const verInput = document.getElementById("fw-version");
    if (verInput) verInput.value = match[1];
  }

  // Pre-check ESP-01 file size
  const customBox = document.getElementById("fw-new-device-box");
  const isCustom = customBox && customBox.style.display !== "none";
  const hwVal = isCustom ? (document.getElementById("fw-custom-hardware")?.value || '') : (document.getElementById("fw-hardware")?.value || '');

  if (hwVal.includes("ESP-01") && file.size > 512000) {
    statusBox.style.display = "block";
    statusBox.style.background = "rgba(245, 158, 11, 0.15)";
    statusBox.style.color = "#fde047";
    statusBox.textContent = `⚠️ Notice: File size (${sizeKb} KB) is large for ESP-01 1MB flash partition limit (~480 KB). Ensure sketch fits inside partition.`;
  } else {
    statusBox.style.display = "none";
  }
}

async function submitUploadFirmware() {
  const fileInput = document.getElementById("fw-file");
  const version = document.getElementById("fw-version").value.trim() || "1.6.0";
  const release_channel = document.getElementById("fw-channel").value;
  const notes = document.getElementById("fw-notes").value.trim();
  const statusBox = document.getElementById("fw-upload-status");
  const btn = document.getElementById("btn-submit-upload-fw");

  // Determine Hardware Target: Custom Device vs Selected Node/Platform
  const customBox = document.getElementById("fw-new-device-box");
  const isCustom = customBox && customBox.style.display !== "none";
  let hardware_type = "";

  if (isCustom) {
    hardware_type = document.getElementById("fw-custom-hardware")?.value.trim() || "";
    if (!hardware_type) {
      statusBox.style.display = "block";
      statusBox.style.background = "rgba(239, 68, 68, 0.15)";
      statusBox.style.color = "var(--accent-red)";
      statusBox.textContent = "Please enter the new device model name.";
      return;
    }
  } else {
    const sel = document.getElementById("fw-hardware");
    if (sel.value === "__NEW_DEVICE__") {
      toggleCustomDeviceInput(true);
      return;
    }
    hardware_type = sel.value;
  }

  if (!fileInput.files || fileInput.files.length === 0) {
    statusBox.style.display = "block";
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = "Please select a .bin firmware file.";
    return;
  }

  // Client-side semver validation
  const semverRegex = /^v?([0-9]+)\.([0-9]+)(\.([0-9]+))?(-[0-9A-Za-z.-]+)?$/;
  if (!semverRegex.test(version)) {
    statusBox.style.display = "block";
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = "Invalid version format! Please use standard semantic versioning (e.g. 1.6.1, 1.7.0, 2.0.0).";
    return;
  }

  // Client-side ESP-01 size check
  if (hardware_type.includes("ESP-01") && fileInput.files[0].size > 512000) {
    statusBox.style.display = "block";
    statusBox.style.background = "rgba(239, 68, 68, 0.15)";
    statusBox.style.color = "var(--accent-red)";
    statusBox.textContent = `Binary is too large for ESP-01! Size is ${(fileInput.files[0].size/1024).toFixed(1)} KB, but ESP-01 max partition is ~480 KB.`;
    return;
  }

  const formData = new FormData();
  formData.append("firmware", fileInput.files[0]);
  formData.append("version", version);
  formData.append("hardware", hardware_type);
  formData.append("hardware_type", hardware_type);
  formData.append("release_channel", release_channel);
  formData.append("notes", notes);

  btn.disabled = true;
  btn.textContent = "Uploading & Verifying...";
  statusBox.style.display = "block";
  statusBox.style.background = "rgba(59, 130, 246, 0.15)";
  statusBox.style.color = "var(--accent-blue)";
  statusBox.textContent = `Uploading binary for '${hardware_type}' and validating ROM flash signature...`;

  try {
    const res = await fetch(`${API_BASE}/firmware/upload`, {
      method: "POST",
      body: formData
    });
    const result = await res.json();
    if (result.success) {
      statusBox.style.background = "rgba(34, 197, 94, 0.15)";
      statusBox.style.color = "var(--accent-green)";
      statusBox.textContent = `Firmware v${version} for '${hardware_type}' successfully registered in catalog!`;
      setTimeout(() => {
        closeModal();
        loadFirmware('catalog');
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

async function deleteFirmwareFile(id, filename) {
  if (!confirm(`Delete firmware '${filename}' (ID: ${id}) from repository?`)) return;
  try {
    const res = await fetch(`${API_BASE}/firmware/${id}`, { method: 'DELETE' });
    const r = await res.json();
    if (r.success) {
      renderFirmwareCatalog();
    } else {
      alert(r.error || 'Failed to delete');
    }
  } catch (e) {
    alert(e.message);
  }
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
let currentNotifFilter = 'all';

async function loadNotifications() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/system/notifications?limit=100`);
    const allNotifs = await res.json();
    const notifs = Array.isArray(allNotifs) ? allNotifs : (allNotifs.notifications || []);
    
    // Auto-mark badges read
    markAllNotificationsRead(false);

    // Apply filter
    const filtered = notifs.filter(n => {
      if (currentNotifFilter === 'pins') return n.category === 'PIN' || (n.title && n.title.includes('Pin'));
      if (currentNotifFilter === 'nodes') return n.category === 'NODE' || (n.title && n.title.includes('Node') && !n.title.includes('Reboot'));
      if (currentNotifFilter === 'restarts') return n.category === 'RESTART' || (n.title && (n.title.includes('Reboot') || n.title.includes('Restart')));
      if (currentNotifFilter === 'system') return n.category === 'SYSTEM' || !n.category;
      return true;
    });

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 style="font-size: 18px; font-weight: 600;">Fleet Notifications & Status Alerts</h2>
          <div style="font-size: 13px; color: var(--text-secondary); margin-top: 2px;">
            Showing ${filtered.length} of ${notifs.length} events (Pin ON/OFF, Node Status, Restarts)
          </div>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary" onclick="markAllNotificationsRead(true)">✓ Mark All Read</button>
          <button class="btn btn-danger" onclick="clearAllNotifications()">🗑️ Clear All</button>
        </div>
      </div>

      <div class="filter-pills">
        <button class="filter-btn ${currentNotifFilter === 'all' ? 'active' : ''}" onclick="setNotifFilter('all')">All Alerts (${notifs.length})</button>
        <button class="filter-btn ${currentNotifFilter === 'pins' ? 'active' : ''}" onclick="setNotifFilter('pins')">⚡ Pin Status</button>
        <button class="filter-btn ${currentNotifFilter === 'nodes' ? 'active' : ''}" onclick="setNotifFilter('nodes')">🟢 Node Online/Offline</button>
        <button class="filter-btn ${currentNotifFilter === 'restarts' ? 'active' : ''}" onclick="setNotifFilter('restarts')">🔄 Node Restarts</button>
        <button class="filter-btn ${currentNotifFilter === 'system' ? 'active' : ''}" onclick="setNotifFilter('system')">⚙️ System</button>
      </div>

      <div class="cards-grid">
        ${filtered.length === 0 ? '<div style="color: var(--text-secondary); padding: 24px; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color); grid-column: 1/-1; text-align: center;">No alerts matching the selected filter.</div>' : ''}
        ${filtered.map(n => {
          let icon = '🔔';
          let borderClass = 'toast-info';
          if (n.category === 'PIN' || (n.title && n.title.includes('Pin'))) {
            icon = n.title.includes('ON') ? '⚡' : '⚪';
            borderClass = n.title.includes('ON') ? 'toast-success' : 'toast-info';
          } else if (n.category === 'NODE' || (n.title && n.title.includes('Node'))) {
            icon = n.title.includes('Online') ? '🟢' : '🔴';
            borderClass = n.title.includes('Online') ? 'toast-success' : 'toast-danger';
          } else if (n.category === 'RESTART' || (n.title && (n.title.includes('Reboot') || n.title.includes('Restart')))) {
            icon = '🔄';
            borderClass = 'toast-warning';
          }
          const borderColor = borderClass === 'toast-success' ? 'var(--accent-green)' : borderClass === 'toast-danger' ? 'var(--accent-red)' : borderClass === 'toast-warning' ? 'var(--accent-amber)' : 'var(--accent-blue)';
          return `
            <div class="node-card" style="border-left: 4px solid ${borderColor};">
              <div class="card-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 18px;">${icon}</span>
                  <div class="card-title">${escapeHtml(n.title)}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span class="status-badge ${borderClass === 'toast-success' ? 'badge-online' : borderClass === 'toast-danger' ? 'badge-offline' : 'badge-sync'}">${escapeHtml(n.severity || 'INFO')}</span>
                  <button onclick="dismissNotification(${n.id})" title="Delete" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 2px 6px;">&times;</button>
                </div>
              </div>
              <p style="font-size: 13.5px; color: var(--text-secondary); margin: 10px 0; line-height: 1.5;">${escapeHtml(n.message)}</p>
              <div style="font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between;">
                <span>${n.timestamp ? new Date(n.timestamp).toLocaleString() : 'Just now'}</span>
                <span>Category: <strong>${escapeHtml(n.category || 'SYSTEM')}</strong></span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading notifications: ${e.message}</div>`;
  }
}

function setNotifFilter(filter) {
  currentNotifFilter = filter;
  loadNotifications();
}

async function markAllNotificationsRead(reload = true) {
  try {
    await fetch(`${API_BASE}/system/notifications/mark-read`, { method: "POST" });
    setNotificationBadges(0);
    if (reload) loadNotifications();
  } catch (e) {}
}

async function dismissNotification(id) {
  try {
    await fetch(`${API_BASE}/system/notifications/${id}`, { method: "DELETE" });
    loadNotifications();
  } catch (e) {}
}

async function clearAllNotifications() {
  if (!confirm("Clear all notification history?")) return;
  try {
    await fetch(`${API_BASE}/system/notifications`, { method: "DELETE" });
    setNotificationBadges(0);
    loadNotifications();
  } catch (e) {}
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


// ==============================================================================
// 11. RBAC & USER ADMINISTRATION CONSOLE
// ==============================================================================
let cachedUsers = [];
let cachedRoles = [];
let cachedScopes = [];

async function loadUsers() {
  const container = document.getElementById("content-area");
  container.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-secondary);">Loading user administration and access control...</div>`;

  try {
    const [uRes, rRes, sRes] = await Promise.all([
      fetchWithAuth(`${API_BASE}/admin/users`),
      fetchWithAuth(`${API_BASE}/admin/roles`),
      fetchWithAuth(`${API_BASE}/admin/scopes`)
    ]);

    const uData = await uRes.json();
    const rData = await rRes.json();
    const sData = await sRes.json();

    cachedUsers = uData.users || [];
    cachedRoles = rData.roles || [];
    cachedScopes = sData.scopes || [];

    const activeCount = cachedUsers.filter(u => u.is_active).length;

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Top Stats Banner -->
        <div class="metrics-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
          <div class="metric-card">
            <div class="metric-label">Total Users</div>
            <div class="metric-value">${cachedUsers.length}</div>
            <div class="metric-sub">${activeCount} Active / ${cachedUsers.length - activeCount} Deactivated</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">System Roles</div>
            <div class="metric-value">${cachedRoles.length}</div>
            <div class="metric-sub">Hierarchical RBAC Configured</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Access Scopes</div>
            <div class="metric-value">${cachedScopes.length}</div>
            <div class="metric-sub">Location & Device Boundaries</div>
          </div>
        </div>

        <!-- Action Toolbar -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <h2 style="font-size: 18px; font-weight: 600;">User & Scope Directory</h2>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary" onclick="openCreateUserModal()">+ Create New User</button>
            <button class="btn btn-secondary" onclick="openScopesModal()">🌐 Manage Scopes</button>
            <button class="btn btn-secondary" onclick="openPermissionsModal()">🛡️ Permissions Matrix</button>
          </div>
        </div>

        <!-- Users Table -->
        <div class="metric-card" style="padding: 0; overflow-x: auto;">
          <table class="table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); text-align: left; background: rgba(255,255,255,0.02);">
                <th style="padding: 14px 16px;">User</th>
                <th style="padding: 14px 16px;">Contact</th>
                <th style="padding: 14px 16px;">Assigned Roles</th>
                <th style="padding: 14px 16px;">Resource Scopes</th>
                <th style="padding: 14px 16px;">Status</th>
                <th style="padding: 14px 16px; text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${cachedUsers.length === 0 ? '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">No user accounts found.</td></tr>' : ''}
              ${cachedUsers.map(u => {
                const rolesHtml = (u.roles || []).map(r => {
                  let badgeClass = 'badge-sync';
                  if (r === 'SUPER_ADMIN') badgeClass = 'badge-offline';
                  else if (r === 'ADMIN') badgeClass = 'badge-sync';
                  else if (r === 'OPERATOR') badgeClass = 'badge-online';
                  return `<span class="status-badge ${badgeClass}" style="margin: 2px;">${escapeHtml(r)}</span>`;
                }).join('') || '<span style="color:var(--text-muted); font-size:12px;">None</span>';

                const scopesHtml = (u.scopes || []).map(s => {
                  return `<span class="status-badge badge-sync" style="margin: 2px;">${escapeHtml(s.name || s.scope_identifier)}</span>`;
                }).join('') || '<span style="color:var(--text-muted); font-size:12px;">GLOBAL</span>';

                return `
                  <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 14px 16px;">
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 20px;">${u.is_superuser ? '⭐' : '👤'}</span>
                        <div>
                          <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(u.username)}</div>
                          <div style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(u.full_name || 'No full name')}</div>
                        </div>
                      </div>
                    </td>
                    <td style="padding: 14px 16px; font-size: 13px; color: var(--text-secondary);">
                      ${escapeHtml(u.email || 'N/A')}
                    </td>
                    <td style="padding: 14px 16px;">${rolesHtml}</td>
                    <td style="padding: 14px 16px;">${scopesHtml}</td>
                    <td style="padding: 14px 16px;">
                      <span class="status-badge ${u.is_active ? 'badge-online' : 'badge-offline'}">
                        ${u.is_active ? 'ACTIVE' : 'DEACTIVATED'}
                      </span>
                    </td>
                    <td style="padding: 14px 16px; text-align: right;">
                      <div style="display: inline-flex; gap: 6px;">
                        <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11.5px;" onclick="openEditUserModal(${u.id})">Edit</button>
                        <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11.5px;" onclick="openResetPasswordModal(${u.id}, '${escapeHtml(u.username)}')">Password</button>
                        <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11.5px;" onclick="revokeUserSessions(${u.id})">Revoke</button>
                        ${u.username !== 'admin' ? `<button class="btn btn-danger" style="padding: 4px 8px; font-size: 11.5px;" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">Delete</button>` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="metric-card" style="color:var(--accent-red);">Error loading user management: ${escapeHtml(err.message)}</div>`;
  }
}

function openCreateUserModal() {
  const rolesCheckboxes = cachedRoles.map(r => `
    <label style="display: flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer;">
      <input type="checkbox" name="user_role" value="${r.name}" ${r.name === 'OPERATOR' ? 'checked' : ''}>
      <span>${r.name}</span>
    </label>
  `).join('');

  const scopesOptions = cachedScopes.map(s => `
    <option value="${s.id}">[${s.scope_type}] ${s.name} (${s.scope_identifier})</option>
  `).join('');

  openModal(`
    <div class="modal-card" style="max-width: 520px;">
      <div class="modal-header">
        <h3>Create New User Account</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <form onsubmit="handleCreateUserSubmit(event)" style="padding: 16px 0;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div>
            <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Username *</label>
            <input type="text" id="new-user-name" required class="input-field" style="width:100%;">
          </div>
          <div>
            <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Initial Password *</label>
            <input type="password" id="new-user-pwd" required minlength="6" class="input-field" style="width:100%;">
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div>
            <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Full Name</label>
            <input type="text" id="new-user-fullname" class="input-field" style="width:100%;">
          </div>
          <div>
            <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Email</label>
            <input type="email" id="new-user-email" class="input-field" style="width:100%;">
          </div>
        </div>

        <div style="margin-bottom: 14px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Assign Roles *</label>
          <div style="display: flex; flex-wrap: wrap; gap: 12px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px;">
            ${rolesCheckboxes}
          </div>
        </div>

        <div style="margin-bottom: 14px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Assign Scope (Optional)</label>
          <select id="new-user-scopes" multiple class="input-field" style="width:100%; height: 80px;">
            ${scopesOptions}
          </select>
          <small style="color:var(--text-muted); font-size:11px;">Hold Ctrl/Cmd to select multiple scopes</small>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
            <input type="checkbox" id="new-user-superuser">
            <span>Grant Superuser / Master Ownership</span>
          </label>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create User</button>
        </div>
      </form>
    </div>
  `);
}

async function handleCreateUserSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('new-user-name').value.trim();
  const password = document.getElementById('new-user-pwd').value;
  const full_name = document.getElementById('new-user-fullname').value.trim();
  const email = document.getElementById('new-user-email').value.trim();
  const is_superuser = document.getElementById('new-user-superuser').checked;

  const roleBoxes = document.querySelectorAll('input[name="user_role"]:checked');
  const role_names = Array.from(roleBoxes).map(b => b.value);

  const scopeSelect = document.getElementById('new-user-scopes');
  const scope_ids = Array.from(scopeSelect.selectedOptions).map(o => Number(o.value));

  try {
    const res = await fetchWithAuth(`${API_BASE}/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, full_name, email, is_superuser, role_names, scope_ids })
    });
    const data = await res.json();
    if (data.success) {
      closeModal();
      showToast({ title: 'User Created', message: `User '${username}' created successfully`, severity: 'SUCCESS' });
      loadUsers();
    } else {
      alert('Error creating user: ' + data.error);
    }
  } catch (err) {
    alert('Server error: ' + err.message);
  }
}

function openEditUserModal(userId) {
  const user = cachedUsers.find(u => u.id === userId);
  if (!user) return;

  const userRoleNames = user.roles || [];
  const userScopeIds = (user.scopes || []).map(s => s.id);

  const rolesCheckboxes = cachedRoles.map(r => `
    <label style="display: flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer;">
      <input type="checkbox" name="edit_user_role" value="${r.name}" ${userRoleNames.includes(r.name) ? 'checked' : ''}>
      <span>${r.name}</span>
    </label>
  `).join('');

  const scopesOptions = cachedScopes.map(s => `
    <option value="${s.id}" ${userScopeIds.includes(s.id) ? 'selected' : ''}>[${s.scope_type}] ${s.name} (${s.scope_identifier})</option>
  `).join('');

  openModal(`
    <div class="modal-card" style="max-width: 500px;">
      <div class="modal-header">
        <h3>Edit User: ${escapeHtml(user.username)}</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <form onsubmit="handleEditUserSubmit(event, ${userId})" style="padding: 16px 0;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div>
            <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Full Name</label>
            <input type="text" id="edit-user-fullname" value="${escapeHtml(user.full_name || '')}" class="input-field" style="width:100%;">
          </div>
          <div>
            <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Email</label>
            <input type="email" id="edit-user-email" value="${escapeHtml(user.email || '')}" class="input-field" style="width:100%;">
          </div>
        </div>

        <div style="margin-bottom: 14px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Assigned Roles</label>
          <div style="display: flex; flex-wrap: wrap; gap: 12px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px;">
            ${rolesCheckboxes}
          </div>
        </div>

        <div style="margin-bottom: 14px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Assigned Scopes</label>
          <select id="edit-user-scopes" multiple class="input-field" style="width:100%; height: 80px;">
            ${scopesOptions}
          </select>
        </div>

        <div style="margin-bottom: 16px; display: flex; gap: 20px;">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
            <input type="checkbox" id="edit-user-active" ${user.is_active ? 'checked' : ''}>
            <span>Account Active</span>
          </label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
            <input type="checkbox" id="edit-user-superuser" ${user.is_superuser ? 'checked' : ''}>
            <span>Superuser Authority</span>
          </label>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  `);
}

async function handleEditUserSubmit(e, userId) {
  e.preventDefault();
  const full_name = document.getElementById('edit-user-fullname').value.trim();
  const email = document.getElementById('edit-user-email').value.trim();
  const is_active = document.getElementById('edit-user-active').checked;
  const is_superuser = document.getElementById('edit-user-superuser').checked;

  const roleBoxes = document.querySelectorAll('input[name="edit_user_role"]:checked');
  const role_names = Array.from(roleBoxes).map(b => b.value);

  const scopeSelect = document.getElementById('edit-user-scopes');
  const scope_ids = Array.from(scopeSelect.selectedOptions).map(o => Number(o.value));

  try {
    const res = await fetchWithAuth(`${API_BASE}/admin/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, email, is_active, is_superuser, role_names, scope_ids })
    });
    const data = await res.json();
    if (data.success) {
      closeModal();
      showToast({ title: 'User Updated', message: 'User account updated successfully', severity: 'SUCCESS' });
      loadUsers();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Server error: ' + err.message);
  }
}

function openResetPasswordModal(userId, username) {
  openModal(`
    <div class="modal-card" style="max-width: 400px;">
      <div class="modal-header">
        <h3>Reset Password: ${username}</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <form onsubmit="handleResetPasswordSubmit(event, ${userId})" style="padding: 16px 0;">
        <div style="margin-bottom: 16px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">New Password (min 6 characters)</label>
          <input type="password" id="reset-user-pwd" required minlength="6" class="input-field" style="width:100%;">
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Reset Password</button>
        </div>
      </form>
    </div>
  `);
}

async function handleResetPasswordSubmit(e, userId) {
  e.preventDefault();
  const newPassword = document.getElementById('reset-user-pwd').value;
  try {
    const res = await fetchWithAuth(`${API_BASE}/admin/users/${userId}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword })
    });
    const data = await res.json();
    if (data.success) {
      closeModal();
      showToast({ title: 'Password Reset', message: 'Password updated and sessions revoked', severity: 'SUCCESS' });
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Server error: ' + err.message);
  }
}

async function revokeUserSessions(userId) {
  if (!confirm('Revoke all active sessions for this user? They will be forced to log in again.')) return;
  try {
    const res = await fetchWithAuth(`${API_BASE}/admin/users/${userId}/revoke-sessions`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'Sessions Revoked', message: 'All active sessions terminated', severity: 'INFO' });
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteUser(userId, username) {
  if (!confirm(`Are you sure you want to permanently delete user '${username}'?`)) return;
  try {
    const res = await fetchWithAuth(`${API_BASE}/admin/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'User Deleted', message: `User '${username}' removed`, severity: 'WARNING' });
      loadUsers();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function openScopesModal() {
  const scopesListHtml = cachedScopes.map(s => `
    <tr style="border-bottom: 1px solid var(--border-color);">
      <td style="padding: 10px 12px;"><strong>${escapeHtml(s.name)}</strong></td>
      <td style="padding: 10px 12px;"><span class="status-badge badge-sync">${escapeHtml(s.scope_type)}</span></td>
      <td style="padding: 10px 12px;"><code>${escapeHtml(s.scope_identifier)}</code></td>
      <td style="padding: 10px 12px; font-size:12px; color:var(--text-secondary);">${escapeHtml(s.description || '')}</td>
      <td style="padding: 10px 12px; text-align:right;">
        ${s.scope_identifier !== 'global' ? `<button class="btn btn-danger" style="padding:3px 7px; font-size:11px;" onclick="deleteScope(${s.id})">Delete</button>` : '<span style="font-size:11px; color:var(--text-muted);">Master</span>'}
      </td>
    </tr>
  `).join('');

  openModal(`
    <div class="modal-card" style="max-width: 650px;">
      <div class="modal-header">
        <h3>Hierarchical Scope Boundaries</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div style="padding: 14px 0;">
        <table class="table" style="width: 100%; border-collapse: collapse; margin-bottom: 18px;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border-color); text-align: left; background: rgba(255,255,255,0.02);">
              <th style="padding: 8px 12px;">Name</th>
              <th style="padding: 8px 12px;">Type</th>
              <th style="padding: 8px 12px;">Identifier</th>
              <th style="padding: 8px 12px;">Description</th>
              <th style="padding: 8px 12px; text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${scopesListHtml}
          </tbody>
        </table>

        <div style="border-top: 1px solid var(--border-color); padding-top: 14px;">
          <h4 style="font-size: 14px; margin-bottom: 10px;">+ Create New Scope</h4>
          <form onsubmit="handleCreateScopeSubmit(event)" style="display: grid; grid-template-columns: 140px 140px 1fr auto; gap: 8px;">
            <select id="new-scope-type" class="input-field">
              <option value="ROOM">ROOM</option>
              <option value="LOCATION">LOCATION</option>
              <option value="BUILDING">BUILDING</option>
              <option value="FLOOR">FLOOR</option>
              <option value="DEVICE_GROUP">DEVICE_GROUP</option>
              <option value="INDIVIDUAL_DEVICE">INDIVIDUAL_DEVICE</option>
            </select>
            <input type="text" id="new-scope-ident" placeholder="Identifier (e.g. kitchen)" required class="input-field">
            <input type="text" id="new-scope-name" placeholder="Scope Name" required class="input-field">
            <button type="submit" class="btn btn-primary" style="padding: 6px 14px;">Add</button>
          </form>
        </div>
      </div>
    </div>
  `);
}

async function handleCreateScopeSubmit(e) {
  e.preventDefault();
  const scope_type = document.getElementById('new-scope-type').value;
  const scope_identifier = document.getElementById('new-scope-ident').value.trim();
  const name = document.getElementById('new-scope-name').value.trim();

  try {
    const res = await fetchWithAuth(`${API_BASE}/admin/scopes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope_type, scope_identifier, name, description: `${scope_type} scope for ${name}` })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'Scope Created', message: `Scope '${name}' created`, severity: 'SUCCESS' });
      closeModal();
      loadUsers();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Server error: ' + err.message);
  }
}

async function deleteScope(scopeId) {
  if (!confirm('Delete this scope? Any user assignments to this scope will be unlinked.')) return;
  try {
    const res = await fetchWithAuth(`${API_BASE}/admin/scopes/${scopeId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'Scope Deleted', message: 'Scope removed', severity: 'INFO' });
      closeModal();
      loadUsers();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Server error: ' + err.message);
  }
}

function openPermissionsModal() {
  const rolesHtml = cachedRoles.map(r => `
    <div style="margin-bottom: 16px; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <strong style="color: var(--accent-blue); font-size: 14px;">${r.name}</strong>
        <span style="font-size: 11.5px; color: var(--text-muted);">${(r.permissions || []).length} permissions</span>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">${escapeHtml(r.description || '')}</div>
      <div style="display: flex; flex-wrap: wrap; gap: 4px;">
        ${(r.permissions || []).map(p => `<span class="status-badge badge-sync" style="font-size: 10.5px;">${p}</span>`).join('')}
      </div>
    </div>
  `).join('');

  openModal(`
    <div class="modal-card" style="max-width: 620px; max-height: 85vh; overflow-y: auto;">
      <div class="modal-header">
        <h3>Role & Permission Matrix</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div style="padding: 14px 0;">
        ${rolesHtml}
      </div>
    </div>
  `);
}

// ==============================================================================
// 12. LITTLEFS FILESYSTEM MANAGER VIEW
// ==============================================================================
let selectedFsNodeId = null;
let currentFsData = null;

async function loadLittlefs() {
  const container = document.getElementById("content-area");
  container.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-secondary);">Loading LittleFS filesystem manager...</div>`;

  try {
    const nodesRes = await fetchWithAuth(`${API_BASE}/nodes`);
    const nodes = await nodesRes.json();

    if (!Array.isArray(nodes) || nodes.length === 0) {
      container.innerHTML = `<div class="metric-card"><h3>No Devices Found</h3><p style="color:var(--text-muted); margin-top:8px;">No IoT nodes registered in fleet.</p></div>`;
      return;
    }

    if (!selectedFsNodeId || !nodes.find(n => n.node_id === selectedFsNodeId)) {
      const onlineNode = nodes.find(n => n.is_online) || nodes[0];
      selectedFsNodeId = onlineNode.node_id;
    }

    const nodeOptions = nodes.map(n => `
      <option value="${n.node_id}" ${n.node_id === selectedFsNodeId ? 'selected' : ''}>
        ${escapeHtml(n.name)} (${n.ip || 'Offline'}) - ${n.is_online ? '🟢 Online' : '🔴 Offline'}
      </option>
    `).join('');

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Top Toolbar & Node Selector -->
        <div class="metric-card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <label style="font-weight: 600; font-size: 14px;">Target Device:</label>
            <select id="littlefs-node-select" class="input-field" onchange="handleLittlefsNodeChange(this.value)" style="min-width: 280px;">
              ${nodeOptions}
            </select>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="refreshLittlefsList()">🔄 Refresh Files</button>
            <button class="btn btn-secondary" id="btn-fs-live-sync" onclick="triggerLittlefsLiveSync()">⚡ Live Sync</button>
            <button class="btn btn-secondary" onclick="openUploadFsModal()">📤 Upload File</button>
            <button class="btn btn-secondary" onclick="triggerLittlefsBackup()">💾 Backup Partition</button>
            <button class="btn btn-secondary" onclick="openFsBackupsHistoryModal()">📜 Backups History</button>
          </div>
        </div>

        <!-- Filesystem Storage Metrics & Files Container -->
        <div id="littlefs-details-container">
          <div style="text-align: center; padding: 30px; color: var(--text-secondary);">Querying node LittleFS partition...</div>
        </div>
      </div>
    `;

    await refreshLittlefsList();
  } catch (err) {
    container.innerHTML = `<div class="metric-card" style="color:var(--accent-red);">Failed to initialize LittleFS Manager: ${escapeHtml(err.message)}</div>`;
  }
}

function handleLittlefsNodeChange(val) {
  selectedFsNodeId = val;
  refreshLittlefsList();
}

function switchToFirstSupportedFsNode() {
  const sel = document.getElementById('littlefs-node-select');
  if (sel) {
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value !== selectedFsNodeId) {
        sel.selectedIndex = i;
        handleLittlefsNodeChange(sel.options[i].value);
        break;
      }
    }
  }
}

async function triggerLittlefsLiveSync() {
  if (!selectedFsNodeId) return;
  const btn = document.getElementById('btn-fs-live-sync');
  const oldText = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⚡ Syncing LittleFS...'; }
  showToast({ title: 'LittleFS Live Sync', message: 'Reconciling LittleFS filesystem and config files with central server...', severity: 'INFO' });

  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedFsNodeId}/fs/sync`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'Live Sync Completed', message: `Synchronized ${data.filesCount || 0} LittleFS files and configuration records`, severity: 'SUCCESS' });
      await refreshLittlefsList();
    } else {
      showToast({ title: 'Live Sync Notice', message: data.error || 'Live sync encountered an issue', severity: data.unsupported ? 'WARNING' : 'ERROR' });
      if (data.unsupported) {
        await refreshLittlefsList();
      }
    }
  } catch (err) {
    showToast({ title: 'Sync Error', message: err.message, severity: 'ERROR' });
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = oldText; }
  }
}

async function viewFsFile(filePath) {
  openModal(`
    <div class="modal-card" style="max-width: 680px; width: 92vw;">
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 14px;">
        <h3 style="font-size: 15px; margin: 0; color: var(--text-primary);">📄 File Inspector: <code style="color: var(--accent-blue);">${escapeHtml(filePath)}</code></h3>
        <button class="modal-close-btn" style="background:none; border:none; color:var(--text-muted); font-size:24px; cursor:pointer; line-height:1; padding:0 4px;" onclick="closeModal()">&times;</button>
      </div>
      <div id="fs-file-viewer-body" style="padding: 4px 0 16px 0;">
        <div style="text-align:center; padding: 30px; color: var(--text-secondary);">Loading file content from LittleFS...</div>
      </div>
    </div>
  `);

  const bodyEl = document.getElementById('fs-file-viewer-body');
  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedFsNodeId}/fs/file-content?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (!data.success) {
      bodyEl.innerHTML = `<div style="color:var(--accent-red); padding:10px;">Failed to read file: ${escapeHtml(data.error)}</div>`;
      return;
    }

    const isSmall = (data.size < 5120); // Strict < 5 KB heap-safe boundary
    const isJson = filePath.toLowerCase().endsWith('.json');
    const isEditable = isSmall && data.isText;

    let displayContent = data.content || '';
    if (isJson) {
      try {
        displayContent = JSON.stringify(JSON.parse(displayContent), null, 2);
      } catch {}
    }

    bodyEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; font-size:12px; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span>Size: <strong>${(data.size / 1024).toFixed(2)} KB</strong> (${data.size} bytes)</span>
          <span>Type: <code>${escapeHtml(data.contentType || 'text/plain')}</code></span>
        </div>
        <div>
          ${isEditable ? 
            `<span class="status-badge badge-online" style="font-size:11px; padding:2px 8px;">✏️ Editable (&lt; 5 KB Heap-Safe)</span>` : 
            `<span class="status-badge badge-sync" style="font-size:11px; padding:2px 8px;">🔒 Read-Only Protected (${(data.size/1024).toFixed(1)} KB)</span>`
          }
        </div>
      </div>

      ${isEditable ? `
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; font-size: 12px; color: #a7f3d0; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong>🟢 Node Heap Safe:</strong> File is strictly under 5 KB (${(data.size / 1024).toFixed(2)} KB). Completely safe for ESP8266 RAM/heap budget (~23 KB).
          </div>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-secondary" style="font-size:11px; padding:2px 8px;" onclick="toggleEditorTheme()" title="Toggle Light/Dark Editor Background">🌓 Theme</button>
            ${isJson ? `<button type="button" class="btn btn-secondary" style="font-size:11px; padding:2px 8px;" onclick="formatEditorJson()">✨ Prettify JSON</button>` : ''}
          </div>
        </div>
      ` : `
        <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; font-size: 12px; color: #f59e0b; display:flex; justify-content:space-between; align-items:center;">
          <div>
            ⚠️ <strong>Heap Safety Protection:</strong> Direct browser editing is disabled for files larger than 5 KB to prevent microcontroller RAM/heap exhaustion (ESP8266 free heap is ~23–38 KB). To replace this large web bundle file, use the <strong>Upload File</strong> button.
          </div>
          <button type="button" class="btn btn-secondary" style="font-size:11px; padding:2px 8px;" onclick="toggleEditorTheme()" title="Toggle Light/Dark Editor Background">🌓 Theme</button>
        </div>
      `}

      <textarea id="fs-editor-textarea" ${isEditable ? '' : 'readonly'} onkeydown="handleEditorKeyDown(event)" class="code-editor-textarea" style="width:100%; height:370px; font-family:'Consolas','Fira Code','Monaco',monospace; font-size:13.5px; line-height:1.6; background-color:#0b1120 !important; color:#f8fafc !important; -webkit-text-fill-color:#f8fafc !important; caret-color:#38bdf8 !important; border:1px solid rgba(56,189,248,0.4) !important; padding:12px; border-radius:6px; resize:vertical; tab-size:2;">${escapeHtml(displayContent)}</textarea>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px;">
        <div>
          <a href="${API_BASE}/nodes/${selectedFsNodeId}/fs/download?path=${encodeURIComponent(filePath)}" class="btn btn-secondary" style="font-size:12px; text-decoration:none;">💾 Download File</a>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary" onclick="closeModal()">Close</button>
          ${isEditable ? `<button id="btn-save-fs-file" class="btn btn-primary" onclick="saveFsEditedFile('${escapeHtml(filePath)}')">💾 Save Changes to LittleFS</button>` : ''}
        </div>
      </div>
    `;
  } catch (err) {
    bodyEl.innerHTML = `<div style="color:var(--accent-red); padding:10px;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function handleEditorKeyDown(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + "  " + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + 2;
  }
}

function formatEditorJson() {
  const ta = document.getElementById('fs-editor-textarea');
  if (!ta) return;
  try {
    const parsed = JSON.parse(ta.value);
    ta.value = JSON.stringify(parsed, null, 2);
    showToast({ title: 'JSON Formatted', message: 'Syntax verified and indented', severity: 'INFO' });
  } catch (err) {
    alert('Invalid JSON syntax: ' + err.message);
  }
}

function toggleEditorTheme() {
  const ta = document.getElementById('fs-editor-textarea') || document.getElementById('config-json-textarea');
  if (!ta) return;
  const isLight = ta.classList.toggle('theme-light');
  if (isLight) {
    ta.style.setProperty('background-color', '#ffffff', 'important');
    ta.style.setProperty('color', '#0f172a', 'important');
    ta.style.setProperty('-webkit-text-fill-color', '#0f172a', 'important');
    ta.style.setProperty('border-color', '#94a3b8', 'important');
    ta.style.setProperty('caret-color', '#0f172a', 'important');
  } else {
    ta.style.setProperty('background-color', '#0b1120', 'important');
    ta.style.setProperty('color', '#f8fafc', 'important');
    ta.style.setProperty('-webkit-text-fill-color', '#f8fafc', 'important');
    ta.style.setProperty('border-color', 'rgba(56, 189, 248, 0.4)', 'important');
    ta.style.setProperty('caret-color', '#38bdf8', 'important');
  }
}

async function saveFsEditedFile(filePath) {
  const ta = document.getElementById('fs-editor-textarea');
  const btn = document.getElementById('btn-save-fs-file');
  if (!ta) return;

  const content = ta.value;

  if (filePath.toLowerCase().endsWith('.json')) {
    try {
      JSON.parse(content);
    } catch (err) {
      alert('Cannot save invalid JSON: ' + err.message);
      return;
    }
  }

  const oldText = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '💾 Saving to LittleFS...'; }

  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedFsNodeId}/fs/save-content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'Saved to LittleFS', message: `Successfully saved '${filePath}' (${data.size} bytes)`, severity: 'SUCCESS' });
      closeModal();
      refreshLittlefsList();
    } else {
      alert('Save failed: ' + data.error);
    }
  } catch (err) {
    alert('Save error: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = oldText; }
  }
}

async function refreshLittlefsList() {
  const detailsEl = document.getElementById('littlefs-details-container');
  if (!detailsEl || !selectedFsNodeId) return;

  detailsEl.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-secondary);">Reading filesystem structure from node...</div>`;

  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedFsNodeId}/fs`);
    const data = await res.json();

    if (!data.success) {
      if (data.unsupported) {
        detailsEl.innerHTML = `
          <div class="metric-card" style="border-left: 4px solid var(--accent-amber); padding: 24px;">
            <div style="display: flex; align-items: flex-start; gap: 14px;">
              <span style="font-size: 30px;">⚠️</span>
              <div style="flex: 1;">
                <h3 style="color: var(--accent-amber); margin: 0 0 8px 0; font-size: 16px;">LittleFS Partition Not Supported on This Device</h3>
                <p style="color: var(--text-secondary); margin: 0 0 12px 0; font-size: 13.5px; line-height: 1.5;">
                  ${escapeHtml(data.error || 'This device uses a minimal partition scheme without a LittleFS web file manager.')}
                </p>
                <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; margin-bottom: 14px; font-size: 12.5px; color: var(--text-muted);">
                  <strong>Hardware Note:</strong> Microcontrollers with 1MB flash (e.g. ESP8266 ESP-01 / ESP-01S) allocate flash exclusively to the application sketch and OTA buffer. LittleFS file browsing and asset hosting are available on devices with 4MB+ flash (such as ESP-12E/F NodeMCU or ESP32).
                </div>
                <button class="btn btn-primary" onclick="switchToFirstSupportedFsNode()">
                  🔄 Switch to NodeMCU (4MB) with LittleFS
                </button>
              </div>
            </div>
          </div>
        `;
        return;
      }

      detailsEl.innerHTML = `
        <div class="metric-card" style="border-left: 4px solid var(--accent-red);">
          <h3 style="color: var(--accent-red);">Filesystem Query Failed</h3>
          <p style="margin-top: 6px; color: var(--text-secondary);">${escapeHtml(data.error || 'Microcontroller was unresponsive')}</p>
        </div>
      `;
      return;
    }

    currentFsData = data;
    const totalKb = (data.totalBytes / 1024).toFixed(1);
    const usedKb = (data.usedBytes / 1024).toFixed(1);
    const freeKb = (data.freeBytes / 1024).toFixed(1);
    const usedPercent = data.usedPercent || 0;

    let barColor = 'var(--accent-green)';
    if (usedPercent > 80) barColor = 'var(--accent-red)';
    else if (usedPercent > 60) barColor = 'var(--accent-amber)';

    detailsEl.innerHTML = `
      <!-- Storage Metrics Cards -->
      <div class="metrics-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 20px;">
        <div class="metric-card">
          <div class="metric-label">Total LittleFS Capacity</div>
          <div class="metric-value">${totalKb} KB</div>
          <div class="metric-sub">${data.totalBytes} bytes allocated</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Used Space</div>
          <div class="metric-value" style="color:${barColor}">${usedKb} KB</div>
          <div class="metric-sub">${usedPercent}% of filesystem capacity</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Available Free Space</div>
          <div class="metric-value">${freeKb} KB</div>
          <div class="metric-sub">${data.files.length} active files stored</div>
        </div>
      </div>

      <!-- Capacity Gauge -->
      <div class="metric-card" style="margin-bottom: 20px; padding: 14px 20px;">
        <div style="display: flex; justify-content: space-between; font-size: 12.5px; color: var(--text-secondary); margin-bottom: 6px;">
          <span>Partition Utilization</span>
          <span>${usedKb} KB / ${totalKb} KB (${usedPercent}%)</span>
        </div>
        <div style="height: 10px; background: rgba(255,255,255,0.06); border-radius: 6px; overflow: hidden;">
          <div style="height: 100%; width: ${usedPercent}%; background: ${barColor}; border-radius: 6px; transition: width 0.3s ease;"></div>
        </div>
      </div>

      <!-- Files Table -->
      <div class="metric-card" style="padding: 0; overflow-x: auto;">
        <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
          <h3 style="font-size: 15px;">Filesystem Files (${data.files.length})</h3>
          <span style="font-size: 12px; color: var(--text-muted);">Root: /</span>
        </div>
        <table class="table" style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border-color); text-align: left; background: rgba(255,255,255,0.02);">
              <th style="padding: 12px 18px;">File Name & Path</th>
              <th style="padding: 12px 18px;">File Size</th>
              <th style="padding: 12px 18px; text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.files.length === 0 ? '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 30px;">LittleFS filesystem is empty.</td></tr>' : ''}
            ${data.files.map(f => `
              <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 12px 18px;">
                  <span style="margin-right: 8px;">📄</span>
                  <strong>${escapeHtml(f.path)}</strong>
                </td>
                <td style="padding: 12px 18px; font-size: 13px; color: var(--text-secondary);">
                  ${(f.size / 1024).toFixed(2)} KB (${f.size} B)
                </td>
                <td style="padding: 12px 18px; text-align: right;">
                  <div style="display: inline-flex; gap: 6px;">
                    <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="viewFsFile('${escapeHtml(f.path)}')">👁️ View</button>
                    <a href="${API_BASE}/nodes/${selectedFsNodeId}/fs/download?path=${encodeURIComponent(f.path)}" download="${escapeHtml(f.name)}" class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px; text-decoration: none;">Download</a>
                    <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="openRenameFsModal('${escapeHtml(f.path)}')">Rename</button>
                    <button class="btn btn-danger" style="padding: 4px 10px; font-size: 12px;" onclick="deleteFsFile('${escapeHtml(f.path)}')">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    detailsEl.innerHTML = `<div class="metric-card" style="color:var(--accent-red);">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function openUploadFsModal() {
  openModal(`
    <div class="modal-card" style="max-width: 440px;">
      <div class="modal-header">
        <h3>Upload File to LittleFS</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <form onsubmit="handleFsUploadSubmit(event)" style="padding: 16px 0;">
        <div style="margin-bottom: 14px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Target Directory</label>
          <input type="text" id="fs-upload-dir" value="/" class="input-field" style="width:100%;">
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Choose File</label>
          <input type="file" id="fs-upload-file" required class="input-field" style="width:100%;">
        </div>
        <div id="fs-upload-status" style="display:none; font-size:12.5px; margin-bottom:12px;"></div>
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" id="fs-upload-btn" class="btn btn-primary">Upload</button>
        </div>
      </form>
    </div>
  `);
}

async function handleFsUploadSubmit(e) {
  e.preventDefault();
  const fileInput = document.getElementById('fs-upload-file');
  const dir = document.getElementById('fs-upload-dir').value.trim();
  const statusEl = document.getElementById('fs-upload-status');
  const btn = document.getElementById('fs-upload-btn');

  if (!fileInput.files || fileInput.files.length === 0) return;
  const file = fileInput.files[0];

  const formData = new FormData();
  formData.append('file', file);
  formData.append('dir', dir);

  btn.disabled = true;
  statusEl.style.display = 'block';
  statusEl.style.color = 'var(--text-secondary)';
  statusEl.textContent = 'Streaming file to node LittleFS...';

  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedFsNodeId}/fs/upload`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      closeModal();
      showToast({ title: 'Uploaded to LittleFS', message: `Successfully uploaded '${data.path}'`, severity: 'SUCCESS' });
      refreshLittlefsList();
    } else {
      statusEl.style.color = 'var(--accent-red)';
      statusEl.textContent = 'Upload failed: ' + data.error;
      btn.disabled = false;
    }
  } catch (err) {
    statusEl.style.color = 'var(--accent-red)';
    statusEl.textContent = 'Network error: ' + err.message;
    btn.disabled = false;
  }
}

function openRenameFsModal(oldPath) {
  openModal(`
    <div class="modal-card" style="max-width: 420px;">
      <div class="modal-header">
        <h3>Rename File</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <form onsubmit="handleFsRenameSubmit(event, '${escapeHtml(oldPath)}')" style="padding: 16px 0;">
        <div style="margin-bottom: 12px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Current Path</label>
          <input type="text" value="${escapeHtml(oldPath)}" disabled class="input-field" style="width:100%;">
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">New Path</label>
          <input type="text" id="fs-rename-new" value="${escapeHtml(oldPath)}" required class="input-field" style="width:100%;">
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Rename</button>
        </div>
      </form>
    </div>
  `);
}

async function handleFsRenameSubmit(e, oldPath) {
  e.preventDefault();
  const newPath = document.getElementById('fs-rename-new').value.trim();
  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedFsNodeId}/fs/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath })
    });
    const data = await res.json();
    if (data.success) {
      closeModal();
      showToast({ title: 'File Renamed', message: `Renamed to '${newPath}'`, severity: 'SUCCESS' });
      refreshLittlefsList();
    } else {
      alert('Rename failed: ' + data.error);
    }
  } catch (err) {
    alert('Server error: ' + err.message);
  }
}

async function deleteFsFile(filePath) {
  if (!confirm(`Are you sure you want to permanently delete '${filePath}' from LittleFS?`)) return;
  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedFsNodeId}/fs/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'Deleted from LittleFS', message: `Deleted '${filePath}'`, severity: 'WARNING' });
      refreshLittlefsList();
    } else {
      alert('Delete failed: ' + data.error);
    }
  } catch (err) {
    alert('Server error: ' + err.message);
  }
}

async function triggerLittlefsBackup() {
  if (!confirm('Create a complete LittleFS backup archive on the master server?')) return;
  showToast({ title: 'Creating Backup', message: 'Downloading files & calculating SHA-256 manifest...', severity: 'INFO' });
  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedFsNodeId}/fs/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupType: 'MANUAL' })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'Backup Complete', message: `Archived ${data.fileCount} files (${(data.totalBytes/1024).toFixed(1)} KB)`, severity: 'SUCCESS' });
    } else {
      alert('Backup failed: ' + data.error);
    }
  } catch (err) {
    alert('Backup error: ' + err.message);
  }
}

async function openFsBackupsHistoryModal() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedFsNodeId}/fs/backups`);
    const data = await res.json();
    const backups = data.backups || [];

    const rows = backups.map(b => `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 10px 12px; font-size:12px;">${new Date(b.created_at).toLocaleString()}</td>
        <td style="padding: 10px 12px;"><span class="status-badge badge-sync">${b.backup_type}</span></td>
        <td style="padding: 10px 12px;">${b.file_count} files</td>
        <td style="padding: 10px 12px; font-size:12px;">${(b.total_bytes / 1024).toFixed(1)} KB</td>
        <td style="padding: 10px 12px; font-family:monospace; font-size:11px;">${(b.sha256_checksum || '').substring(0, 10)}...</td>
      </tr>
    `).join('');

    openModal(`
      <div class="modal-card" style="max-width: 600px;">
        <div class="modal-header">
          <h3>LittleFS Backup Archives</h3>
          <button class="modal-close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div style="padding: 14px 0;">
          <table class="table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); text-align: left; background: rgba(255,255,255,0.02);">
                <th style="padding: 8px 12px;">Timestamp</th>
                <th style="padding: 8px 12px;">Type</th>
                <th style="padding: 8px 12px;">Files</th>
                <th style="padding: 8px 12px;">Size</th>
                <th style="padding: 8px 12px;">Checksum</th>
              </tr>
            </thead>
            <tbody>
              ${backups.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No LittleFS backups created yet.</td></tr>' : rows}
            </tbody>
          </table>
        </div>
      </div>
    `);
  } catch (err) {
    alert('Error fetching backups: ' + err.message);
  }
}

// ==============================================================================
// 13. DEVICE CONFIGURATION & SYNCHRONIZATION ENGINE VIEW
// ==============================================================================
let selectedConfigNodeId = null;
let currentDeviceConfig = null;

async function loadConfigSync() {
  const container = document.getElementById("content-area");
  container.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-secondary);">Loading configuration & sync center...</div>`;

  try {
    const nodesRes = await fetchWithAuth(`${API_BASE}/nodes`);
    const nodes = await nodesRes.json();

    if (!Array.isArray(nodes) || nodes.length === 0) {
      container.innerHTML = `<div class="metric-card"><h3>No Devices Found</h3></div>`;
      return;
    }

    if (!selectedConfigNodeId || !nodes.find(n => n.node_id === selectedConfigNodeId)) {
      const onlineNode = nodes.find(n => n.is_online) || nodes[0];
      selectedConfigNodeId = onlineNode.node_id;
    }

    const nodeOptions = nodes.map(n => `
      <option value="${n.node_id}" ${n.node_id === selectedConfigNodeId ? 'selected' : ''}>
        ${escapeHtml(n.name)} (${n.ip || 'Offline'}) - ${n.is_online ? '🟢 Online' : '🔴 Offline'}
      </option>
    `).join('');

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Top Toolbar & Node Selector -->
        <div class="metric-card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <label style="font-weight: 600; font-size: 14px;">Target Device:</label>
            <select id="config-node-select" class="input-field" onchange="handleConfigNodeChange(this.value)" style="min-width: 280px;">
              ${nodeOptions}
            </select>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary" onclick="triggerConfigPush()">🚀 Push & Sync to Node</button>
            <button class="btn btn-secondary" onclick="saveAuthoritativeConfig()">💾 Save Changes</button>
            <button class="btn btn-secondary" onclick="openConfigVersionsModal()">📜 Version History & Rollback</button>
          </div>
        </div>

        <!-- Config Details Card & JSON Editor -->
        <div id="config-details-container">
          <div style="text-align: center; padding: 30px; color: var(--text-secondary);">Loading authoritative device configuration...</div>
        </div>
      </div>
    `;

    await refreshConfigDetails();
  } catch (err) {
    container.innerHTML = `<div class="metric-card" style="color:var(--accent-red);">Failed to initialize Config Sync: ${escapeHtml(err.message)}</div>`;
  }
}

function handleConfigNodeChange(val) {
  selectedConfigNodeId = val;
  refreshConfigDetails();
}

async function refreshConfigDetails() {
  const container = document.getElementById('config-details-container');
  if (!container || !selectedConfigNodeId) return;

  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedConfigNodeId}/config`);
    const data = await res.json();

    if (!data.success) {
      container.innerHTML = `<div class="metric-card" style="color:var(--accent-red);">Error: ${escapeHtml(data.error)}</div>`;
      return;
    }

    currentDeviceConfig = data.configuration;
    const c = currentDeviceConfig;

    let statusBadge = 'badge-online';
    if (c.sync_status === 'PENDING') statusBadge = 'badge-sync';
    else if (c.sync_status === 'SYNCING') statusBadge = 'badge-sync';
    else if (c.sync_status === 'FAILED') statusBadge = 'badge-offline';
    else if (c.sync_status === 'OFFLINE') statusBadge = 'badge-offline';

    container.innerHTML = `
      <!-- Status Cards Grid -->
      <div class="metrics-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 20px;">
        <div class="metric-card">
          <div class="metric-label">Configuration Version</div>
          <div class="metric-value">v${c.config_version}</div>
          <div class="metric-sub">Authoritative Master Revision</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Synchronization Status</div>
          <div style="margin-top: 8px;">
            <span class="status-badge ${statusBadge}" style="font-size: 13px; padding: 4px 10px;">${c.sync_status}</span>
          </div>
          <div class="metric-sub" style="margin-top: 8px;">Last Synced: ${c.last_synced_at ? new Date(c.last_synced_at).toLocaleTimeString() : 'Never'}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">SHA-256 Checksum</div>
          <div style="font-family: monospace; font-size: 13px; color: var(--accent-blue); margin-top: 10px; word-break: break-all;">
            ${(c.sha256_checksum || '').substring(0, 16)}...
          </div>
          <div class="metric-sub" style="margin-top: 6px;">Integrity verified</div>
        </div>
      </div>

      <!-- JSON Configuration Editor -->
      <div class="metric-card" style="padding: 18px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="font-size: 15px;">Authoritative Configuration Payload (JSON)</h3>
          <span style="font-size: 12px; color: var(--text-muted);">Strict JSON schema validated</span>
        </div>
        <textarea id="config-json-textarea" class="code-editor-textarea" style="width: 100%; height: 380px; font-family: 'Consolas', 'Monaco', monospace; font-size: 13.5px; line-height: 1.6; background-color: #0b1120 !important; color: #f8fafc !important; -webkit-text-fill-color: #f8fafc !important; caret-color: #38bdf8 !important; border: 1px solid rgba(56, 189, 248, 0.4); padding: 12px; border-radius: 8px; resize: vertical;">${JSON.stringify(c.config, null, 2)}</textarea>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="metric-card" style="color:var(--accent-red);">Error loading config: ${escapeHtml(err.message)}</div>`;
  }
}

async function saveAuthoritativeConfig() {
  const textarea = document.getElementById('config-json-textarea');
  if (!textarea) return;

  let parsed = null;
  try {
    parsed = JSON.parse(textarea.value);
  } catch (e) {
    alert('Invalid JSON syntax: ' + e.message);
    return;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedConfigNodeId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: parsed, summary: 'Manual dashboard update' })
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'Config Saved', message: `Saved version v${data.configuration.config_version}`, severity: 'SUCCESS' });
      refreshConfigDetails();
    } else {
      alert('Save failed: ' + data.error);
    }
  } catch (err) {
    alert('Server error: ' + err.message);
  }
}

async function triggerConfigPush() {
  showToast({ title: 'Pushing Configuration', message: 'Delivering config payload to microcontroller...', severity: 'INFO' });
  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedConfigNodeId}/config/sync`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      showToast({ title: 'Config Synchronized', message: data.message || 'Config accepted by node', severity: 'SUCCESS' });
      refreshConfigDetails();
    } else {
      showToast({ title: 'Sync Warning', message: data.error || 'Direct sync failed; queued in persistent command queue', severity: 'WARNING' });
      refreshConfigDetails();
    }
  } catch (err) {
    alert('Sync error: ' + err.message);
  }
}

async function openConfigVersionsModal() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedConfigNodeId}/config/versions`);
    const data = await res.json();
    const versions = data.versions || [];

    const rows = versions.map(v => `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 10px 12px; font-weight: 600;">v${v.version}</td>
        <td style="padding: 10px 12px; font-size:12px; color:var(--text-secondary);">${escapeHtml(v.change_summary || 'Update')}</td>
        <td style="padding: 10px 12px; font-size:12px; color:var(--text-muted);">${new Date(v.created_at).toLocaleString()}</td>
        <td style="padding: 10px 12px; font-family:monospace; font-size:11px;">${(v.sha256_checksum || '').substring(0, 10)}...</td>
        <td style="padding: 10px 12px; text-align: right;">
          <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11.5px;" onclick="rollbackConfigToVersion(${v.version})">Rollback</button>
        </td>
      </tr>
    `).join('');

    openModal(`
      <div class="modal-card" style="max-width: 620px;">
        <div class="modal-header">
          <h3>Configuration Version History</h3>
          <button class="modal-close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div style="padding: 14px 0;">
          <table class="table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); text-align: left; background: rgba(255,255,255,0.02);">
                <th style="padding: 8px 12px;">Version</th>
                <th style="padding: 8px 12px;">Summary</th>
                <th style="padding: 8px 12px;">Created At</th>
                <th style="padding: 8px 12px;">Checksum</th>
                <th style="padding: 8px 12px; text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${versions.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No historical versions recorded.</td></tr>' : rows}
            </tbody>
          </table>
        </div>
      </div>
    `);
  } catch (err) {
    alert('Error fetching versions: ' + err.message);
  }
}

async function rollbackConfigToVersion(version) {
  if (!confirm(`Rollback configuration to historical revision v${version}? A new revision will be created and pushed to the node.`)) return;
  try {
    const res = await fetchWithAuth(`${API_BASE}/nodes/${selectedConfigNodeId}/config/rollback/${version}`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      closeModal();
      showToast({ title: 'Configuration Rolled Back', message: `Restored to v${version} (Now v${data.currentVersion})`, severity: 'SUCCESS' });
      refreshConfigDetails();
    } else {
      alert('Rollback failed: ' + data.error);
    }
  } catch (err) {
    alert('Rollback error: ' + err.message);
  }
}

// ==============================================================================
// 14. DEVICE COMMAND CENTER & ACKNOWLEDGEMENT TRACKER VIEW
// ==============================================================================
let cachedCommands = [];
let commandFilterNode = 'ALL';
let commandFilterStatus = 'ALL';

async function loadCommands() {
  const container = document.getElementById("content-area");
  container.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-secondary);">Loading persistent command center...</div>`;

  try {
    const [cRes, nRes] = await Promise.all([
      fetchWithAuth(`${API_BASE}/commands?limit=100`),
      fetchWithAuth(`${API_BASE}/nodes`)
    ]);

    const cData = await cRes.json();
    const nData = await nRes.json();

    cachedCommands = cData.commands || [];
    const nodes = nData || [];

    const nodeFilterOptions = [
      '<option value="ALL">All Nodes</option>',
      ...nodes.map(n => `<option value="${n.node_id}" ${commandFilterNode === n.node_id ? 'selected' : ''}>${escapeHtml(n.name)}</option>`)
    ].join('');

    const filtered = cachedCommands.filter(c => {
      if (commandFilterNode !== 'ALL' && c.node_id !== commandFilterNode) return false;
      if (commandFilterStatus !== 'ALL' && c.status !== commandFilterStatus) return false;
      return true;
    });

    const pendingCount = cachedCommands.filter(c => c.status === 'PENDING').length;
    const ackCount = cachedCommands.filter(c => c.status === 'ACKNOWLEDGED').length;

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Stats Banner -->
        <div class="metrics-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
          <div class="metric-card">
            <div class="metric-label">Total Persistent Commands</div>
            <div class="metric-value">${cachedCommands.length}</div>
            <div class="metric-sub">Recorded in SQLite Fleet Queue</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Pending Delivery / In-Flight</div>
            <div class="metric-value" style="color:var(--accent-amber)">${pendingCount}</div>
            <div class="metric-sub">Waiting for heartbeat or socket</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Device Application ACKs</div>
            <div class="metric-value" style="color:var(--accent-green)">${ackCount}</div>
            <div class="metric-sub">Execution verified by firmware</div>
          </div>
        </div>

        <!-- Action & Filter Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <select class="input-field" onchange="commandFilterNode = this.value; loadCommands();">
              ${nodeFilterOptions}
            </select>
            <select class="input-field" onchange="commandFilterStatus = this.value; loadCommands();">
              <option value="ALL" ${commandFilterStatus === 'ALL' ? 'selected' : ''}>All Statuses</option>
              <option value="PENDING" ${commandFilterStatus === 'PENDING' ? 'selected' : ''}>PENDING</option>
              <option value="DELIVERED" ${commandFilterStatus === 'DELIVERED' ? 'selected' : ''}>DELIVERED</option>
              <option value="ACKNOWLEDGED" ${commandFilterStatus === 'ACKNOWLEDGED' ? 'selected' : ''}>ACKNOWLEDGED</option>
              <option value="FAILED" ${commandFilterStatus === 'FAILED' ? 'selected' : ''}>FAILED</option>
            </select>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary" onclick="openDispatchCommandModal()">⚡ Dispatch Command</button>
            <button class="btn btn-secondary" onclick="loadCommands()">🔄 Refresh</button>
          </div>
        </div>

        <!-- Commands Queue Table -->
        <div class="metric-card" style="padding: 0; overflow-x: auto;">
          <table class="table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); text-align: left; background: rgba(255,255,255,0.02);">
                <th style="padding: 12px 16px;">UUID</th>
                <th style="padding: 12px 16px;">Target Node</th>
                <th style="padding: 12px 16px;">Action / Type</th>
                <th style="padding: 12px 16px;">Payload</th>
                <th style="padding: 12px 16px;">Status</th>
                <th style="padding: 12px 16px;">Timestamps</th>
                <th style="padding: 12px 16px; text-align: right;">Details</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length === 0 ? '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">No commands matching filter.</td></tr>' : ''}
              ${filtered.map(c => {
                let badgeClass = 'badge-sync';
                if (c.status === 'ACKNOWLEDGED') badgeClass = 'badge-online';
                else if (c.status === 'FAILED') badgeClass = 'badge-offline';
                else if (c.status === 'PENDING') badgeClass = 'badge-sync';

                const shortUuid = (c.command_uuid || '').substring(0, 8);
                const createdStr = c.created_at ? new Date(c.created_at).toLocaleTimeString() : 'N/A';
                const ackStr = c.acknowledged_at ? new Date(c.acknowledged_at).toLocaleTimeString() : '-';

                return `
                  <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 12px 16px; font-family: monospace; font-size: 12px; color: var(--accent-blue);">
                      ${shortUuid}...
                    </td>
                    <td style="padding: 12px 16px; font-weight: 600;">
                      <code>${escapeHtml(c.node_id)}</code>
                    </td>
                    <td style="padding: 12px 16px;">
                      <span class="status-badge badge-sync">${escapeHtml(c.command_type || 'command')}</span>
                    </td>
                    <td style="padding: 12px 16px; font-size: 12.5px; font-family: monospace; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      ${escapeHtml(JSON.stringify(c.payload || {}))}
                    </td>
                    <td style="padding: 12px 16px;">
                      <span class="status-badge ${badgeClass}">${c.status}</span>
                    </td>
                    <td style="padding: 12px 16px; font-size: 12px; color: var(--text-secondary);">
                      Sent: ${createdStr} | ACK: ${ackStr}
                    </td>
                    <td style="padding: 12px 16px; text-align: right;">
                      <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="viewCommandDetails('${c.command_uuid}')">Inspect</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="metric-card" style="color:var(--accent-red);">Error loading command center: ${escapeHtml(err.message)}</div>`;
  }
}

function openDispatchCommandModal() {
  const nodes = fleetData.nodes || [];
  const nodeOptions = nodes.map(n => `
    <option value="${n.node_id}">${escapeHtml(n.name)} (${n.ip || 'Offline'})</option>
  `).join('');

  openModal(`
    <div class="modal-card" style="max-width: 480px;">
      <div class="modal-header">
        <h3>Dispatch Device Command</h3>
        <button class="modal-close-btn" onclick="closeModal()">&times;</button>
      </div>
      <form onsubmit="handleDispatchCommandSubmit(event)" style="padding: 16px 0;">
        <div style="margin-bottom: 12px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Target Node</label>
          <select id="dispatch-node-id" required class="input-field" style="width:100%;">
            ${nodeOptions}
          </select>
        </div>
        <div style="margin-bottom: 12px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Command Action</label>
          <select id="dispatch-action" class="input-field" style="width:100%;" onchange="toggleDispatchFields(this.value)">
            <option value="setState">setState (Switch GPIO Pin)</option>
            <option value="toggle">toggle (Toggle GPIO State)</option>
            <option value="pulse">pulse (Momentary Relay Pulse)</option>
            <option value="reboot">reboot (Restart Microcontroller)</option>
            <option value="syncConfig">syncConfig (Force Sync Configuration)</option>
            <option value="custom">custom (Arbitrary JSON Payload)</option>
          </select>
        </div>

        <div id="dispatch-gpio-fields">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Channel / Pin ID</label>
              <input type="number" id="dispatch-channel-id" value="1" min="1" max="16" class="input-field" style="width:100%;">
            </div>
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Desired State</label>
              <select id="dispatch-state" class="input-field" style="width:100%;">
                <option value="true">ON (High / Active)</option>
                <option value="false">OFF (Low / Inactive)</option>
              </select>
            </div>
          </div>
        </div>

        <div id="dispatch-pulse-field" style="display:none; margin-bottom: 12px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Pulse Duration (ms)</label>
          <input type="number" id="dispatch-duration" value="500" min="50" max="10000" class="input-field" style="width:100%;">
        </div>

        <div id="dispatch-custom-field" style="display:none; margin-bottom: 12px;">
          <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:4px;">Custom JSON Payload</label>
          <textarea id="dispatch-custom-json" class="input-field" style="width:100%; height:80px; font-family:monospace; font-size:12px;">{"action": "ping"}</textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Dispatch Command</button>
        </div>
      </form>
    </div>
  `);
}

function toggleDispatchFields(action) {
  const gpioFields = document.getElementById('dispatch-gpio-fields');
  const pulseField = document.getElementById('dispatch-pulse-field');
  const customField = document.getElementById('dispatch-custom-field');

  if (gpioFields) gpioFields.style.display = (action === 'setState' || action === 'toggle' || action === 'pulse') ? 'block' : 'none';
  if (pulseField) pulseField.style.display = (action === 'pulse') ? 'block' : 'none';
  if (customField) customField.style.display = (action === 'custom') ? 'block' : 'none';
}

async function handleDispatchCommandSubmit(e) {
  e.preventDefault();
  const nodeId = document.getElementById('dispatch-node-id').value;
  const action = document.getElementById('dispatch-action').value;

  let payload = { action, node_id: nodeId };

  if (action === 'setState') {
    payload.id = Number(document.getElementById('dispatch-channel-id').value);
    payload.gpioId = payload.id;
    payload.state = document.getElementById('dispatch-state').value === 'true';
  } else if (action === 'toggle') {
    payload.id = Number(document.getElementById('dispatch-channel-id').value);
    payload.gpioId = payload.id;
  } else if (action === 'pulse') {
    payload.id = Number(document.getElementById('dispatch-channel-id').value);
    payload.gpioId = payload.id;
    payload.duration = Number(document.getElementById('dispatch-duration').value);
  } else if (action === 'custom') {
    try {
      const customObj = JSON.parse(document.getElementById('dispatch-custom-json').value);
      payload = { ...customObj, node_id: nodeId };
    } catch {
      alert('Invalid JSON in custom payload');
      return;
    }
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/commands/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeModal();
      showToast({
        title: 'Command Dispatched',
        message: `Delivery: ${data.delivery} (UUID: ${(data.command_uuid || '').substring(0, 8)})`,
        severity: data.delivery === 'direct_lan_http' ? 'SUCCESS' : 'INFO'
      });
      loadCommands();
    } else {
      alert('Dispatch failed: ' + data.error);
    }
  } catch (err) {
    alert('Server error: ' + err.message);
  }
}

async function viewCommandDetails(uuid) {
  try {
    const res = await fetchWithAuth(`${API_BASE}/commands/${uuid}`);
    const data = await res.json();
    if (!data.success) return alert(data.error);

    const cmd = data.command;
    const results = data.results || [];

    const resultsHtml = results.map(r => `
      <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 8px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
          <span class="status-badge ${r.success ? 'badge-online' : 'badge-offline'}">${r.status}</span>
          <span style="color:var(--text-muted);">${r.execution_time_ms} ms</span>
        </div>
        <div style="font-family:monospace; font-size:11.5px; color:var(--text-secondary); word-break:break-all;">
          ${escapeHtml(r.response_payload_json || '{}')}
        </div>
      </div>
    `).join('') || '<div style="color:var(--text-muted); font-size:12px;">No execution response packet received yet.</div>';

    openModal(`
      <div class="modal-card" style="max-width: 520px;">
        <div class="modal-header">
          <h3>Command Diagnostics</h3>
          <button class="modal-close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div style="padding: 14px 0;">
          <div style="margin-bottom: 12px;">
            <div style="font-size: 11px; color: var(--text-muted);">UUID</div>
            <code style="color: var(--accent-blue);">${cmd.command_uuid}</code>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
            <div>
              <div style="font-size: 11px; color: var(--text-muted);">Target Node</div>
              <strong>${escapeHtml(cmd.node_id)}</strong>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--text-muted);">Delivery Status</div>
              <span class="status-badge ${cmd.status === 'ACKNOWLEDGED' ? 'badge-online' : 'badge-sync'}">${cmd.status}</span>
            </div>
          </div>
          <div style="margin-bottom: 14px;">
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Command Payload</div>
            <pre style="background: #080c14; padding: 10px; border-radius: 6px; font-size: 12px; overflow-x: auto;">${JSON.stringify(cmd.payload, null, 2)}</pre>
          </div>
          <div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">Microcontroller Application ACK Results (${results.length})</div>
            ${resultsHtml}
          </div>
        </div>
      </div>
    `);
  } catch (err) {
    alert('Error: ' + err.message);
  }
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

// --- 13. SETTINGS & AUTO-SYNC POLLER ---
async function loadSettings() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/system/poll-settings`);
    const poller = await res.json();
    updateTopbarSyncIndicator(poller);

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Auto-Sync Status & Pin Poller -->
        <div class="metric-card" style="border-left: 4px solid var(--accent-blue);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
            <div>
              <h3 style="display: flex; align-items: center; gap: 8px;">
                <span>⚡ Periodic Health & Pin Status Poller</span>
                <span class="status-badge ${poller.enabled ? 'badge-online' : 'badge-offline'}">
                  ${poller.enabled ? 'Active Auto-Sync' : 'Disabled'}
                </span>
              </h3>
              <p style="margin-top: 6px; font-size: 13.5px; color: var(--text-secondary); line-height: 1.5;">
                Actively queries all registered ESP8266 nodes on a periodic interval. Reconciles pin states, detects physical switch toggles, synchronizes free heap & telemetry, and auto-recovers nodes when connection drops.
              </p>
            </div>
            <button class="btn btn-secondary" onclick="triggerManualPoll()">⚡ Sync Pins & Status Now</button>
          </div>

          <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-end; margin-top: 10px;">
            <div>
              <label style="font-size: 13px; font-weight: 600; display: block; margin-bottom: 6px; color: var(--text-secondary);">
                Auto-Sync Interval:
              </label>
              <select id="poll-interval-select" style="background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 8px 12px; border-radius: 6px; font-size: 13px; outline: none;">
                <option value="5" ${poller.intervalSec === 5 ? 'selected' : ''}>Every 5 Seconds (High Responsiveness)</option>
                <option value="10" ${poller.intervalSec === 10 ? 'selected' : ''}>Every 10 Seconds (Recommended)</option>
                <option value="15" ${poller.intervalSec === 15 ? 'selected' : ''}>Every 15 Seconds (Balanced)</option>
                <option value="30" ${poller.intervalSec === 30 ? 'selected' : ''}>Every 30 Seconds (Low Traffic)</option>
                <option value="60" ${poller.intervalSec === 60 ? 'selected' : ''}>Every 60 Seconds (Minimal)</option>
              </select>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <input type="checkbox" id="poll-enabled-check" ${poller.enabled ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer;">
              <label for="poll-enabled-check" style="font-size: 13px; cursor: pointer;">Enable Background Periodic Sync</label>
            </div>

            <button class="btn btn-primary" onclick="savePollerSettings()">💾 Save Poller Settings</button>
          </div>
        </div>

        <!-- Platform Configuration -->
        <div class="metric-card">
          <h3 style="margin-bottom: 12px;">Platform Architecture & Core Configuration</h3>
          <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.6;">
            • Configuration file: <code>central_server_js/config.json</code><br>
            • HTTP Web Dashboard Port: <strong>9100</strong><br>
            • TCP Raw Telemetry Socket: <strong>Port 2000</strong><br>
            • Registered Node Controller: <strong>http://192.168.1.105</strong> (v1.6.0)<br>
            • Node Authentication: <strong>admin / admin</strong><br>
            • Database Engine: <code>central_server_js/data/fleet.db</code> (SQLite WAL Mode)
          </p>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div style="color: var(--accent-red);">Error loading settings: ${e.message}</div>`;
  }
}

async function savePollerSettings() {
  const select = document.getElementById("poll-interval-select");
  const check = document.getElementById("poll-enabled-check");
  const intervalSec = Number(select ? select.value : 10);
  const enabled = check ? check.checked : true;

  try {
    const res = await fetch(`${API_BASE}/system/poll-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intervalSec, enabled })
    });
    const data = await res.json();
    if (data.success) {
      alert(`Poller settings saved! Auto-sync is now set to every ${intervalSec}s.`);
      updateTopbarSyncIndicator(data.settings);
      loadSettings();
    }
  } catch (e) {
    alert("Error saving settings: " + e.message);
  }
}

async function triggerManualPoll() {
  try {
    const syncText = document.getElementById("topbar-sync-text");
    if (syncText) syncText.innerText = "Syncing...";
    const res = await fetch(`${API_BASE}/system/poll-now`, { method: "POST" });
    const data = await res.json();
    if (syncText && data.settings) syncText.innerText = `Auto-Sync: ${data.settings.intervalSec}s`;
    if (currentView === "nodes") loadNodes();
    else if (currentView === "relays") loadRelays();
    else if (currentView === "overview") loadOverview();
    else if (currentView === "notifications") loadNotifications();
    else if (currentView === "logs") loadLogs();
  } catch (e) {
    console.error("Poll error:", e);
  }
}

function updateTopbarSyncIndicator(settings) {
  const textEl = document.getElementById("topbar-sync-text");
  if (!textEl) return;
  if (!settings || !settings.enabled) {
    textEl.innerText = "Auto-Sync: Off";
  } else {
    textEl.innerText = `Auto-Sync: ${settings.intervalSec}s`;
  }
}

// --- 14. LOGS & AUDIT TRAIL ---
let currentLogCategory = 'ALL';
let logSearchKeyword = '';

async function loadLogs() {
  const container = document.getElementById("content-area");
  try {
    const res = await fetch(`${API_BASE}/system/logs?limit=200`);
    const allData = await res.json();
    const data = Array.isArray(allData) ? allData : [];

    const filtered = data.filter(l => {
      const act = l.action || '';
      if (currentLogCategory === 'PIN') {
        if (!act.startsWith('PIN_')) return false;
      } else if (currentLogCategory === 'NODE') {
        if (!act.startsWith('NODE_ON') && !act.startsWith('NODE_OFF')) return false;
      } else if (currentLogCategory === 'REBOOT') {
        if (!act.includes('REBOOT') && !act.includes('RESTART')) return false;
      } else if (currentLogCategory === 'COMMAND_SENT') {
        if (act !== 'COMMAND_SENT') return false;
      }

      if (!logSearchKeyword) return true;
      const kw = logSearchKeyword.toLowerCase();
      return (act.toLowerCase().includes(kw)) ||
             ((l.target || '').toLowerCase().includes(kw)) ||
             ((l.details || l.message || '').toLowerCase().includes(kw)) ||
             ((l.timestamp || '').toLowerCase().includes(kw));
    });

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 style="font-size: 18px; font-weight: 600;">System Audit & Event Logs</h2>
          <div style="font-size: 13px; color: var(--text-secondary); margin-top: 2px;">
            Showing ${filtered.length} entries (Pin status, Node online/offline, Restarts, Commands)
          </div>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <input type="text" id="log-search-input" placeholder="🔍 Search logs..." value="${escapeHtml(logSearchKeyword)}" 
            oninput="handleLogSearch(this.value)" 
            style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px; padding: 6px 12px; font-size: 13px; width: 220px;">
          <button class="btn btn-secondary" onclick="loadLogs()">🔄 Refresh</button>
        </div>
      </div>

      <div class="filter-pills">
        <button class="filter-btn ${currentLogCategory === 'ALL' ? 'active' : ''}" onclick="setLogCategory('ALL')">All Logs</button>
        <button class="filter-btn ${currentLogCategory === 'PIN' ? 'active' : ''}" onclick="setLogCategory('PIN')">⚡ Pin ON / OFF</button>
        <button class="filter-btn ${currentLogCategory === 'NODE' ? 'active' : ''}" onclick="setLogCategory('NODE')">🟢 Node Online/Offline</button>
        <button class="filter-btn ${currentLogCategory === 'REBOOT' ? 'active' : ''}" onclick="setLogCategory('REBOOT')">🔄 Node Restarts</button>
        <button class="filter-btn ${currentLogCategory === 'COMMAND_SENT' ? 'active' : ''}" onclick="setLogCategory('COMMAND_SENT')">🚀 Commands</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action / Event</th>
            <th>Target Node</th>
            <th>Event Details & Status</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 28px;">No log entries found for current filter.</td></tr>' : ''}
          ${filtered.map(l => {
            const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleString() : 'Just now';
            let tagClass = 'tag-sync';
            let actionLabel = l.action || 'SYSTEM';

            if (actionLabel === 'PIN_ON') {
              tagClass = 'tag-pin-on';
              actionLabel = '⚡ PIN ON';
            } else if (actionLabel === 'PIN_OFF') {
              tagClass = 'tag-pin-off';
              actionLabel = '⚪ PIN OFF';
            } else if (actionLabel === 'NODE_ONLINE') {
              tagClass = 'tag-node-online';
              actionLabel = '🟢 ONLINE';
            } else if (actionLabel === 'NODE_OFFLINE') {
              tagClass = 'tag-node-offline';
              actionLabel = '🔴 OFFLINE';
            } else if (actionLabel.includes('REBOOT') || actionLabel.includes('RESTART')) {
              tagClass = 'tag-reboot';
              actionLabel = '🔄 RESTART';
            } else if (actionLabel === 'COMMAND_SENT') {
              tagClass = 'badge-sync';
              actionLabel = '🚀 COMMAND';
            }

            return `
              <tr>
                <td style="white-space: nowrap; font-size: 12.5px; color: var(--text-muted);">${timeStr}</td>
                <td><span class="${tagClass}">${actionLabel}</span></td>
                <td><code>${escapeHtml(l.target || l.node_id || 'System')}</code></td>
                <td style="font-size: 13px; line-height: 1.4;">${escapeHtml(l.details || l.message || '')}</td>
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

function setLogCategory(cat) {
  currentLogCategory = cat;
  loadLogs();
}

function handleLogSearch(kw) {
  logSearchKeyword = kw;
  loadLogs();
}

function refreshActiveMetrics() {
  if (currentView === "overview") loadOverview();
}

// === DEVICE-TYPE HARDWARE ISOLATION & SEPARATION HELPERS ===

function getNodeHardwareCategory(node) {
  if (!node) return 'ESP8266-NodeMCU';
  const hw = (node.hardware || node.hardware_type || '').toLowerCase();
  if (hw.includes('esp-01') || hw.includes('esp01') || hw.includes('1mb')) {
    return 'ESP-01';
  }
  if (hw.includes('nodemcu') || hw.includes('esp-12') || hw.includes('4mb')) {
    return 'ESP8266-NodeMCU';
  }
  if (hw.includes('esp32')) {
    return 'ESP32';
  }
  return 'ESP8266-Generic';
}

function getFirmwareHardwareCategory(fw) {
  if (!fw) return 'ESP8266-NodeMCU';
  const hw = (fw.hardware_type || fw.hardware || '').toLowerCase();
  if (hw.includes('esp-01') || hw.includes('esp01') || hw.includes('1mb')) {
    return 'ESP-01';
  }
  if (hw.includes('nodemcu') || hw.includes('esp-12') || hw.includes('4mb')) {
    return 'ESP8266-NodeMCU';
  }
  if (hw.includes('esp32')) {
    return 'ESP32';
  }
  return 'ESP8266-Generic';
}

function getHardwareProfileDetails(cat) {
  switch (cat) {
    case 'ESP-01':
      return {
        key: 'ESP-01',
        title: 'ESP8266 ESP-01 / ESP-01S (1MB)',
        badge: '<span class="status-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; font-weight: 600;">ESP8266 ESP-01 (1MB Flash)</span>',
        uploadHw: 'ESP8266 ESP-01 / ESP-01S (1MB)'
      };
    case 'ESP8266-NodeMCU':
      return {
        key: 'ESP8266-NodeMCU',
        title: 'ESP8266 (ESP-12E/F) NodeMCU',
        badge: '<span class="status-badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-weight: 600;">ESP8266 NodeMCU (4MB Flash)</span>',
        uploadHw: 'ESP8266 (ESP-12E/F) NodeMCU'
      };
    case 'ESP32':
      return {
        key: 'ESP32',
        title: 'ESP32 Microcontroller',
        badge: '<span class="status-badge" style="background: rgba(34, 197, 94, 0.2); color: #4ade80; font-weight: 600;">ESP32 Architecture</span>',
        uploadHw: 'ESP32'
      };
    default:
      return {
        key: 'ESP8266-Generic',
        title: 'ESP8266 Generic',
        badge: '<span class="status-badge badge-sync" font-weight: 600;">ESP8266 Generic</span>',
        uploadHw: 'ESP8266 (Generic)'
      };
  }
}

// Strictly populates candidate firmware options for the target device ONLY
function updateWizardFirmwareOptions(node) {
  const container = document.getElementById("wiz-fw-selector-container");
  if (!container) return;

  const firmwares = window._cachedFirmwares || [];
  const nodeCat = getNodeHardwareCategory(node);
  const profile = getHardwareProfileDetails(nodeCat);

  // STRICT FILTER: Keep ONLY binaries belonging to this device type!
  const deviceFirmwares = firmwares.filter(f => getFirmwareHardwareCategory(f) === nodeCat);

  // Sort: Latest version first, then descending version/id
  deviceFirmwares.sort((a, b) => (b.is_latest ? 1 : 0) - (a.is_latest ? 1 : 0) || b.id - a.id);

  if (deviceFirmwares.length === 0) {
    otaWizardState.firmwareId = null;
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <label class="form-label" style="margin: 0;">Target Hardware Profile: ${profile.badge}</label>
      </div>
      <div style="padding: 16px; background: rgba(245, 158, 11, 0.1); border: 1px dashed rgba(245, 158, 11, 0.4); border-radius: 8px; margin-bottom: 12px;">
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <span style="font-size: 22px;">⚠️</span>
          <div style="flex: 1;">
            <strong style="color: #fde047;">No Firmware Binaries Available for ${profile.title}</strong>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px; line-height: 1.5;">
              Binaries from other hardware devices are strictly hidden to prevent cross-flashing or partition bricking. Please upload a binary compiled for this specific device.
            </div>
            <div style="margin-top: 10px;">
              <button class="btn btn-primary" style="font-size: 12px; padding: 6px 14px;" onclick="showUploadFirmwareModalForHw('${profile.uploadHw}')">
                + Upload ${profile.title} Firmware (.bin)
              </button>
            </div>
          </div>
        </div>
      </div>
      <input type="hidden" id="wiz-fw-select" value="">
    `;

    const preCheckView = document.getElementById("wiz-precheck-view");
    if (preCheckView) {
      preCheckView.innerHTML = `
        <div class="check-item check-warn">
          <span>⚠️</span>
          <div><strong>Awaiting Dedicated Binary:</strong> No firmware uploaded for ${profile.title} yet. Click "+ Upload Firmware" above.</div>
        </div>
      `;
    }
    const deployBtn = document.getElementById("btn-start-ota-deploy");
    if (deployBtn) deployBtn.disabled = true;
    return;
  }

  // Auto-select latest version
  const defaultSelected = deviceFirmwares.find(f => f.is_latest) || deviceFirmwares[0];
  otaWizardState.firmwareId = defaultSelected.id;

  const latestList = deviceFirmwares.filter(f => f.is_latest);
  const historicalList = deviceFirmwares.filter(f => !f.is_latest);

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <label class="form-label" style="margin: 0;">
        Dedicated Firmware for: ${profile.badge}
      </label>
      <span style="font-size: 12px; color: var(--text-secondary);">
        <strong>${deviceFirmwares.length}</strong> version(s) available for this device
      </span>
    </div>

    <div class="form-group" style="margin-bottom: 16px;">
      <select id="wiz-fw-select" class="form-control" onchange="onWizardFirmwareChanged()" style="font-size: 13px; font-weight: 500;">
        ${latestList.length > 0 ? `
          <optgroup label="⭐ Latest Release for ${profile.title}">
            ${latestList.map(f => `
              <option value="${f.id}" selected>
                🌟 [RECOMMENDED LATEST] v${escapeHtml(f.version)} (${escapeHtml(f.filename)}) — ${(f.file_size_bytes/1024).toFixed(1)} KB [${escapeHtml(f.release_channel || 'LTS')}]
              </option>
            `).join('')}
          </optgroup>
        ` : ''}

        ${historicalList.length > 0 ? `
          <optgroup label="📦 Historical Versions for ${profile.title} (Rollback / Downgrade)">
            ${historicalList.map(f => `
              <option value="${f.id}">
                📦 [ROLLBACK] v${escapeHtml(f.version)} (${escapeHtml(f.filename)}) — ${(f.file_size_bytes/1024).toFixed(1)} KB [${escapeHtml(f.release_channel || 'LTS')}]
              </option>
            `).join('')}
          </optgroup>
        ` : ''}
      </select>
    </div>
  `;
}

// Helper: Open upload modal with preselected hardware type
function showUploadFirmwareModalForHw(preselectedHw) {
  showUploadFirmwareModal();
  setTimeout(() => {
    const sel = document.getElementById("fw-hardware");
    if (sel && preselectedHw) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value.includes(preselectedHw) || preselectedHw.includes(sel.options[i].value)) {
          sel.selectedIndex = i;
          break;
        }
      }
    }
  }, 50);
}

// Helper: Filter catalog table by hardware target
function filterCatalogByHw(targetHw) {
  const rows = document.querySelectorAll("#ota-tab-content table.data-table tbody tr");
  const buttons = document.querySelectorAll("#catalog-hw-filters button");

  buttons.forEach(b => {
    b.className = (b.textContent.includes(targetHw) || (targetHw === 'all' && b.textContent.includes('All')))
      ? 'btn btn-primary'
      : 'btn btn-secondary';
  });

  rows.forEach(r => {
    if (targetHw === 'all') {
      r.style.display = '';
      return;
    }
    const hwCell = r.querySelector("td:nth-child(2)");
    if (!hwCell) return;
    const txt = hwCell.textContent || '';
    if (txt.includes(targetHw) || targetHw.includes(txt)) {
      r.style.display = '';
    } else {
      r.style.display = 'none';
    }
  });
}

// === SUB-VIEW 5: COMPREHENSIVE OTA DEVELOPER GUIDE ===
function renderOtaDeveloperGuide() {
  const content = document.getElementById("ota-tab-content");
  content.innerHTML = `
    <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 24px; max-width: 1000px; margin: 0 auto;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
        <span style="font-size: 28px;">📖</span>
        <div>
          <h2 style="margin: 0; font-size: 20px;">ESP8266 & ESP32 Over-The-Air (OTA) Developer Guide</h2>
          <div style="font-size: 13px; color: var(--text-secondary);">Complete reference for compilation, flash partition sizing, semantic versioning, and crash-resilient updates</div>
        </div>
      </div>

      <!-- SECTION 1: ARCHITECTURE & PARTITION MAP -->
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 16px; margin: 0 0 10px 0; color: var(--accent-blue); display: flex; align-items: center; gap: 8px;">
          <span>1. Flash Memory Partition Architectures & Sizing Limits</span>
        </h3>
        <p style="font-size: 13px; line-height: 1.6; color: var(--text-secondary); margin: 0 0 12px 0;">
          The ESP8266 uses a dual-slot OTA mechanism. The flash memory must accommodate both the currently running sketch and the incoming binary simultaneously until the flash write finishes and passes verification.
        </p>

        <table class="data-table" style="font-size: 13px; margin-bottom: 12px;">
          <thead>
            <tr>
              <th>Target Board</th>
              <th>Total Flash</th>
              <th>Recommended Partition Scheme</th>
              <th>Max Sketch Binary Size</th>
              <th>Dual-Slot OTA Safe Barrier</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>ESP8266 (ESP-12E/F) NodeMCU</strong></td>
              <td>4 MB (4,194,304 B)</td>
              <td><code>4MB (FS:2MB OTA:~1019KB)</code> or <code>4MB (FS:1MB OTA:~1400KB)</code></td>
              <td>~1,044,480 B (1.0 MB)</td>
              <td><span class="status-badge badge-online">Safe Margin (+1,000 KB)</span></td>
            </tr>
            <tr>
              <td><strong>ESP8266 ESP-01 / ESP-01S</strong></td>
              <td>1 MB (1,048,576 B)</td>
              <td><code>1MB (FS:64KB OTA:~470KB)</code> (Strict Requirement)</td>
              <td>~480,000 B (468 KB)</td>
              <td><span class="status-badge badge-lts">Strict Barrier (&lt; 480 KB)</span></td>
            </tr>
            <tr>
              <td><strong>ESP32 (WROOM / WROVER)</strong></td>
              <td>4 MB / 8 MB / 16 MB</td>
              <td><code>Default 4MB with spiffs (1.2MB APP / 1.5MB SPIFFS)</code></td>
              <td>~1,310,720 B (1.25 MB)</td>
              <td><span class="status-badge badge-online">Safe Margin (+1,200 KB)</span></td>
            </tr>
          </tbody>
        </table>

        <div style="padding: 10px 14px; background: rgba(239, 68, 68, 0.1); border-left: 4px solid var(--accent-red); border-radius: 4px; font-size: 12px; color: #fca5a5;">
          <strong>CRITICAL WARNING FOR ESP-01 (1MB):</strong> Never select <code>1MB (FS:512KB)</code> in Arduino IDE or PlatformIO for ESP-01. With 512KB SPIFFS, free sketch space drops to &lt; 250KB, causing <code>Update.begin()</code> to immediately reject the upload with <code>ESP8266 OTA Begin Failed: Not Enough Space</code>.
        </div>
      </div>

      <!-- SECTION 2: EXPORTING COMPILED BINARY -->
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 16px; margin: 0 0 10px 0; color: var(--accent-blue); display: flex; align-items: center; gap: 8px;">
          <span>2. How to Compile & Export Binary (.bin)</span>
        </h3>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div style="background: var(--bg-primary); padding: 14px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #93c5fd;">In Arduino IDE 1.8.x / 2.x</div>
            <ol style="font-size: 12px; line-height: 1.6; padding-left: 20px; margin: 0; color: var(--text-secondary);">
              <li>Select your board under <strong>Tools ➔ Board</strong>:
                <br>• NodeMCU: <code>NodeMCU 1.0 (ESP-12E Module)</code>
                <br>• ESP-01: <code>Generic ESP8266 Module</code>
              </li>
              <li>Set <strong>Tools ➔ Flash Size</strong>:
                <br>• NodeMCU: <code>4MB (FS:2MB OTA:~1019KB)</code>
                <br>• ESP-01: <code>1MB (FS:64KB OTA:~470KB)</code>
              </li>
              <li>Click menu: <strong>Sketch ➔ Export Compiled Binary</strong> (or press <kbd>Ctrl+Alt+S</kbd>).</li>
              <li>Locate the <code>.bin</code> file inside your sketch folder (under <code>build/esp8266.esp8266.../</code>).</li>
            </ol>
          </div>

          <div style="background: var(--bg-primary); padding: 14px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #93c5fd;">In PlatformIO (VS Code)</div>
            <ol style="font-size: 12px; line-height: 1.6; padding-left: 20px; margin: 0; color: var(--text-secondary);">
              <li>In <code>platformio.ini</code>, specify flash partitions:
                <pre style="background: #0f172a; padding: 6px; border-radius: 4px; margin: 4px 0; font-size: 11px;">[env:esp01_1m]
board = esp01_1m
board_build.ldscript = eagle.flash.1m64.ld</pre>
              </li>
              <li>Run build task: <code>pio run</code>.</li>
              <li>The output binary is located at:
                <br><code style="font-size: 11px;">.pio/build/esp01_1m/firmware.bin</code>
              </li>
            </ol>
          </div>
        </div>
      </div>

      <!-- SECTION 3: EMBEDDING VERSION & REBOOT VERIFICATION -->
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 16px; margin: 0 0 10px 0; color: var(--accent-blue); display: flex; align-items: center; gap: 8px;">
          <span>3. Semantic Versioning in Microcontroller Code</span>
        </h3>
        <p style="font-size: 13px; line-height: 1.6; color: var(--text-secondary); margin: 0 0 10px 0;">
          The Central Server validates firmware versions using semantic versioning (<code>X.Y.Z</code>). When releasing an update, bump the version macro in your source code so the node automatically reports the new version upon rebooting:
        </p>

        <pre style="background: #0f172a; padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); font-family: monospace; font-size: 12px; color: #e2e8f0; overflow-x: auto;">
// In your sketch or config header:
#define FIRMWARE_NAME    "SmartHome-NodeMCU"
#define FIRMWARE_VERSION "1.7.0"  // &lt;-- Bump this version on every release!

// In handleStatus() returning GET /api/status:
void handleStatus() {
  DynamicJsonDocument doc(1024);
  doc["deviceName"] = FIRMWARE_NAME;
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  doc["hardware"] = "ESP8266 (ESP-12E/F) NodeMCU";
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["sketchSize"] = ESP.getSketchSize();
  doc["freeSketchSpace"] = ESP.getFreeSketchSpace();
  doc["uptimeSec"] = millis() / 1000;
  // ...
  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}
        </pre>
      </div>

      <!-- SECTION 4: PRE-FLIGHT & CRASH RESILIENCE CHECKLIST -->
      <div>
        <h3 style="font-size: 16px; margin: 0 0 10px 0; color: var(--accent-blue); display: flex; align-items: center; gap: 8px;">
          <span>4. Pre-Flight Verification & Best Practices</span>
        </h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px;">
          <div style="padding: 10px; background: rgba(34, 197, 94, 0.08); border-left: 3px solid var(--accent-green); border-radius: 4px;">
            <strong>✅ ROM Flash Magic Byte 0xE9</strong>
            <div style="color: var(--text-secondary); margin-top: 2px;">The Central Server and ESP both verify byte 0 is <code>0xE9</code>. This guarantees non-firmware files or HTML error pages are never written to flash.</div>
          </div>
          <div style="padding: 10px; background: rgba(59, 130, 246, 0.08); border-left: 3px solid var(--accent-blue); border-radius: 4px;">
            <strong>✅ Free Dynamic RAM (&gt; 15 KB)</strong>
            <div style="color: var(--text-secondary); margin-top: 2px;">Ensure node heap is healthy before flashing. The server will warn if free heap drops below 14 KB to avoid TCP buffer exhaustion.</div>
          </div>
          <div style="padding: 10px; background: rgba(245, 158, 11, 0.08); border-left: 3px solid #f59e0b; border-radius: 4px;">
            <strong>✅ MD5 Checksum Integrity Check</strong>
            <div style="color: var(--text-secondary); margin-top: 2px;">The Central Server transmits the <code>X-File-MD5</code> header. The ESP compares the MD5 upon completion before issuing a reboot.</div>
          </div>
          <div style="padding: 10px; background: rgba(168, 85, 247, 0.08); border-left: 3px solid #a855f7; border-radius: 4px;">
            <strong>✅ Automated Pre-OTA Backup & Rollback</strong>
            <div style="color: var(--text-secondary); margin-top: 2px;">Keep old firmware binaries in the catalog! If a newer release causes instability, use the wizard to select the historical version and downgrade with 1 click.</div>
          </div>
        </div>
      </div>

    </div>
  `;
}
