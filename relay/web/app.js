// SmartHome Go Edge Broker Web Dashboard & Full Breaker Manager
const API_BASE = '/api/v1';

let nodes = [];
let latestBreakerData = null;
let tuyaDevicesList = [];
let activeTuyaDeviceId = null;
let breakerSubTab = 'telemetry';
let ws = null;

// DP Names mapping identical to Central Server
const BREAKER_DP_NAMES = {
  "1": "Main Relay / Switch",
  "9": "Countdown Timer (s)",
  "17": "Alarm Code (bitmask)",
  "18": "Overcurrent Limit (A)",
  "19": "Overcurrent Delay (s)",
  "20": "Voltage Upper Limit (V)",
  "21": "Voltage Lower Limit (V)",
  "22": "Auto Reclose Wait (s)",
  "23": "Leakage Limit (mA)",
  "24": "Leakage Trip Delay (s)",
  "26": "Hardware Safety Fault Reg",
  "38": "Power-On AC Behavior",
  "40": "Maintenance Lock",
  "101": "Forward Cumulative Energy (0.01 kWh)",
  "102": "V / I / P Stream (Base64)",
  "103": "Prepayment Switch / Auxiliary Contact",
  "104": "Over-Voltage Protect Delay (s)",
  "105": "Over-Voltage Recovery Delay (s)",
  "107": "Under-Voltage Recovery Delay (s)",
  "108": "Main Breaker Contact Switch",
  "111": "Hardware Model Revision",
  "112": "AC Grid Frequency (0.1 Hz)",
  "113": "Phase / Line Status",
  "114": "Internal Probe Temperature (°C)",
  "115": "High Temp Cutoff Threshold (°C)",
  "116": "Protection Trip Delay (s)",
  "117": "Instant Safety Delay (s)",
  "118": "Auto-Reclose Delay (s)",
  "119": "Auto-Reclose Master Enable",
  "121": "Over-Voltage Threshold Register",
  "123": "Power Calibration Register",
  "126": "Residual Leakage Current (mA)",
  "127": "Leakage Protection Master",
  "129": "Leakage Recovery Delay (s)",
  "130": "Overcurrent Threshold (A)",
  "131": "Overcurrent Delay (s)",
  "132": "Leakage Trip Threshold (mA)",
  "133": "Auto-Reclose Max Attempts"
};

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  fetchNodes();
  loadBreakerView();
  fetchDiagnostics();
  connectWebSocket();
  setInterval(fetchDiagnostics, 5000);
  setInterval(pollBreakerSilently, 3000);
});

function setupTabs() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
      if (tab === 'events') fetchEvents();
      if (tab === 'breaker') loadBreakerView();
    });
  });
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/v1/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    const el = document.getElementById('ws-status-text');
    if (el) el.textContent = 'WS: Connected';
    const pill = document.getElementById('ws-status');
    if (pill) pill.className = 'pill pill-online';
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'pin_update') {
        updateChannelUI(msg.data.nodeId, msg.data.channelId, msg.data.state);
      } else if (msg.type === 'node_status') {
        fetchNodes();
      } else if (msg.type === 'breaker_update') {
        updateBreakerDom(msg.data);
      }
    } catch (err) {}
  };

  ws.onclose = () => {
    const el = document.getElementById('ws-status-text');
    if (el) el.textContent = 'WS: Reconnecting...';
    const pill = document.getElementById('ws-status');
    if (pill) pill.className = 'pill pill-offline';
    setTimeout(connectWebSocket, 3000);
  };
}

// ==========================================================================
// === NODES & SWITCHES VIEW ===
// ==========================================================================

async function fetchNodes() {
  try {
    const res = await fetch(`${API_BASE}/nodes`);
    const data = await res.json();
    nodes = data.nodes || [];
    renderSwitches();
    updateCentralStatus(data.centralOnline);
  } catch (err) {}
}

function renderSwitches() {
  const container = document.getElementById('switches-grid');
  if (!container) return;
  let channels = [];

  nodes.forEach(n => {
    (n.channels || []).forEach(ch => {
      channels.push({
        nodeId: n.nodeId,
        nodeName: n.nodeName,
        ...ch
      });
    });
  });

  const countEl = document.getElementById('switch-count');
  if (countEl) countEl.textContent = channels.length;

  if (channels.length === 0) {
    container.innerHTML = '<div class="empty">Waiting for ESP8266 node telemetry on port 2000...</div>';
    return;
  }

  container.innerHTML = channels.map(ch => {
    const isOn = Boolean(ch.state);
    const chId = ch.id || ch.channelId;
    const cardId = `card-${escapeHtml(ch.nodeId)}-${chId}`;

    return `
      <div class="card ${isOn ? 'is-on' : 'is-off'}" id="${cardId}">
        <div class="card-left">
          <div class="card-header-line">
            <span class="status-indicator ${isOn ? 'on' : 'off'}"></span>
            <div class="card-title">${escapeHtml(ch.name || 'Switch')}</div>
          </div>
          <div class="card-sub">
            <span class="node-tag">${escapeHtml(ch.nodeName)}</span>
            <span class="pin-tag">Pin ${ch.pin || chId}</span>
            ${ch.room ? `<span class="room-tag">${escapeHtml(ch.room)}</span>` : ''}
          </div>
        </div>

        <div class="card-right">
          <button 
            id="btn-${escapeHtml(ch.nodeId)}-${chId}" 
            class="switch-btn ${isOn ? 'btn-active' : 'btn-inactive'}" 
            onclick="toggleChannel('${ch.nodeId}', ${chId}, ${!isOn})">
            <span class="btn-icon">${isOn ? '💡' : '🔌'}</span>
            <span class="btn-text">${isOn ? 'POWER ON' : 'POWER OFF'}</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleChannel(nodeId, chId, targetState) {
  const cardId = `card-${nodeId}-${chId}`;
  const btnId = `btn-${nodeId}-${chId}`;
  const card = document.getElementById(cardId);
  const btn = document.getElementById(btnId);

  // Instant visual feedback
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> <span>Switching...</span>`;
  }
  if (card) {
    card.classList.toggle('is-on', targetState);
    card.classList.toggle('is-off', !targetState);
  }

  try {
    const res = await fetch(`${API_BASE}/nodes/${encodeURIComponent(nodeId)}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: chId, state: targetState })
    });

    if (res.ok) {
      updateChannelUI(nodeId, chId, targetState);
      showToast({
        title: "Relay Switched",
        message: `Node ${nodeId} Channel ${chId} turned ${targetState ? 'ON' : 'OFF'}`,
        severity: "SUCCESS"
      });
    } else {
      showToast({ title: "Command Error", message: res.statusText, severity: "ERROR" });
      fetchNodes();
    }
  } catch (err) {
    showToast({ title: "Network Error", message: err.message, severity: "ERROR" });
    fetchNodes();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function updateChannelUI(nodeId, chId, state) {
  const node = nodes.find(n => n.nodeId === nodeId);
  if (node && Array.isArray(node.channels)) {
    const ch = node.channels.find(c => (c.id == chId || c.channelId == chId));
    if (ch) ch.state = Boolean(state);
  }

  const cardId = `card-${nodeId}-${chId}`;
  const btnId = `btn-${nodeId}-${chId}`;
  const card = document.getElementById(cardId);
  const btn = document.getElementById(btnId);

  if (card) {
    card.classList.toggle('is-on', state);
    card.classList.toggle('is-off', !state);
    const ind = card.querySelector('.status-indicator');
    if (ind) ind.className = `status-indicator ${state ? 'on' : 'off'}`;
  }

  if (btn) {
    btn.className = `switch-btn ${state ? 'btn-active' : 'btn-inactive'}`;
    btn.innerHTML = `
      <span class="btn-icon">${state ? '💡' : '🔌'}</span>
      <span class="btn-text">${state ? 'POWER ON' : 'POWER OFF'}</span>
    `;
    btn.setAttribute('onclick', `toggleChannel('${nodeId}', ${chId}, ${!state})`);
  }
}

// ==========================================================================
// === CIRCUIT BREAKER VIEW (IDENTICAL TO CENTRAL SERVER) ===
// ==========================================================================

async function loadBreakerView() {
  const container = document.getElementById("breaker-container");
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/breaker/status`);
    const data = await res.json();
    latestBreakerData = data;

    try {
      const devRes = await fetch(`${API_BASE}/breaker/devices`);
      const devData = await devRes.json();
      if (devData.success) {
        tuyaDevicesList = devData.devices || [];
        activeTuyaDeviceId = devData.activeDevice?.id || (tuyaDevicesList[0]?.id);
      }
    } catch (e) {}

    renderBreakerDashboard(container, data);
    updateCentralStatus(data.centralOnline);
  } catch (err) {
    container.innerHTML = `
      <div style="padding: 30px; text-align: center; color: var(--accent-red);">
        <h3>⚠️ Unable to connect to Smart Breaker</h3>
        <p style="margin-top: 8px; color: var(--text-secondary);">${escapeHtml(err.message)}</p>
        <button class="btn btn-primary" onclick="loadBreakerView()" style="margin-top: 16px;">🔄 Retry Connection</button>
      </div>
    `;
  }
}

async function pollBreakerSilently() {
  const breakerTabActive = document.querySelector('.nav-btn[data-tab="breaker"]')?.classList.contains('active');
  if (!breakerTabActive) return;

  try {
    const res = await fetch(`${API_BASE}/breaker/status`);
    if (!res.ok) return;
    const data = await res.json();
    latestBreakerData = data;
    updateBreakerDom(data);
  } catch (e) {}
}

function renderBreakerDashboard(container, data) {
  const cfg = data.config || {};
  const rd = data.reading || {};
  const dec = rd.decoded || {};
  const dps = rd.dps || {};
  const isOnline = Boolean(rd.online);
  const switchState = Boolean(dec.switch_state);
  const isLocked = Boolean(dec.child_lock);
  const currentIp = cfg.ip_address || '192.168.1.25';

  container.innerHTML = `
    <!-- Top Header Banner -->
    <div class="breaker-header-bar">
      <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
        <div class="breaker-device-avatar">⚡</div>
        <div>
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <select class="breaker-device-select" onchange="handleSelectTuyaDevice(this.value)" title="Switch Active Breaker / Device">
              ${(tuyaDevicesList.length > 0 ? tuyaDevicesList : [{ id: cfg.device_id || 'd705ffaccaf4d0f1b1addg', name: cfg.device_name || 'Wi-Fi Smart Circuit Breaker', ip: currentIp, is_active: 1 }]).map(d => `
                <option value="${escapeHtml(d.id)}" ${d.is_active || d.id === activeTuyaDeviceId ? 'selected' : ''}>
                  ⚡ ${escapeHtml(d.name || 'Breaker')} (${escapeHtml(d.ip)})
                </option>
              `).join('')}
            </select>

            <span class="status-badge ${isOnline ? 'badge-online' : 'badge-offline'}" id="breaker-online-badge">
              <span class="pulse-dot"></span> ${isOnline ? '🟢 LIVE LAN (Local)' : '🔴 OFFLINE / UNREACHABLE'}
            </span>
          </div>

          <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">
            <span class="breaker-meta-pill clickable" onclick="openBreakerNetworkConfigModal()" title="Click to Change IP Address or Credentials">
              📍 IP: <strong>${escapeHtml(currentIp)}</strong> <span style="font-size: 11px; margin-left: 4px; color: #60a5fa;">✏️ Change IP</span>
            </span>
            <span class="breaker-meta-pill">🆔 MAC: <strong>${escapeHtml(data.macAddress || cfg.mac_address || '30:48:7d:e8:5d:5c')}</strong></span>
            <span class="breaker-meta-pill">📦 Model: <strong>${escapeHtml(dec.model_str || cfg.model_sn || 'B-B1-M')}</strong></span>
            <span class="breaker-meta-pill">🔒 Protocol: <strong>v${escapeHtml(String(cfg.protocol_version || '3.5'))} (AES-128 Local)</strong></span>
          </div>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <button class="btn btn-primary" onclick="openAddTuyaDeviceModal()" title="Add another Tuya Breaker or Smart Device">
          <span>➕</span> Add Device
        </button>
        <button class="btn" onclick="openBreakerNetworkConfigModal()" title="Configure IP, Name, and Key">
          <span>⚙️</span> Network & IP
        </button>
        <button class="btn" onclick="refreshBreakerNow()" id="breaker-refresh-btn" title="Poll Device Locally">
          <span>🔄</span> Refresh Now
        </button>
      </div>
    </div>

    <!-- Master Switch Hero Card -->
    <div class="breaker-hero-card">
      <div class="breaker-switch-section">
        <div class="breaker-switch-label" id="breaker-status-text" style="color: ${switchState ? '#34d399' : '#f87171'};">
          ${switchState ? 'CIRCUIT CLOSED (ENERGIZED)' : 'CIRCUIT TRIPPED (ISOLATED)'}
        </div>
        <div style="margin: 14px 0;">
          <button id="breaker-main-btn" class="breaker-power-btn ${switchState ? 'state-on' : 'state-off'}" onclick="handleBreakerTogglePrompt()" title="Click to Switch Main Breaker">
            ⏻
          </button>
        </div>
        <div id="breaker-status-desc" style="font-size: 12.5px; color: var(--text-secondary); text-align: center; max-width: 320px;">
          ${switchState ? 'Main internal contacts (DP 108) are closed. Mains electricity is flowing safely through the breaker.' : 'Circuit is open. Downstream power is isolated.'}
        </div>
      </div>

      <div class="breaker-controls-group">
        <div class="breaker-ctrl-row">
          <div>
            <div style="font-weight: 600; font-size: 13.5px;">Maintenance Lock (Child Lock - DP 40)</div>
            <div style="font-size: 11.5px; color: var(--text-secondary);">Forces breaker OFF and blocks remote switching during repairs</div>
          </div>
          <div>
            <button id="breaker-lock-btn" class="btn" onclick="handleBreakerLockToggle(${isLocked})" style="font-size: 12px; padding: 6px 12px; border-color: ${isLocked ? 'var(--accent-red)' : 'var(--border-color)'};">
              ${isLocked ? '🔒 Locked (Safety Active)' : '🔓 Unlocked'}
            </button>
          </div>
        </div>

        <div class="breaker-ctrl-row">
          <div>
            <div style="font-weight: 600; font-size: 13.5px;">AC Power-On Recovery Behavior (DP 38)</div>
            <div style="font-size: 11.5px; color: var(--text-secondary);">Restored contact state when AC mains power returns after blackout</div>
          </div>
          <div>
            <select id="breaker-poweron-select" onchange="handleBreakerPowerOnBehavior(this.value)" style="background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 12px;">
              <option value="memory" ${dec.power_on_behavior === 'memory' ? 'selected' : ''}>Remember Last State (Memory)</option>
              <option value="0" ${dec.power_on_behavior === '0' ? 'selected' : ''}>Always Power OFF</option>
              <option value="1" ${dec.power_on_behavior === '1' ? 'selected' : ''}>Always Power ON</option>
            </select>
          </div>
        </div>

        <div class="breaker-ctrl-row">
          <div>
            <div style="font-weight: 600; font-size: 13.5px;">Auto Countdown Timer (DP 9)</div>
            <div style="font-size: 11.5px; color: var(--text-secondary);">Automatically trips contact switch after duration</div>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <input type="number" id="breaker-countdown-input" placeholder="Sec (0-86400)" style="width: 100px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 8px; font-size: 12px;" min="0" max="86400">
            <button class="btn btn-primary" onclick="handleCountdownSet()" style="font-size: 12px; padding: 6px 10px;">Set</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Navigation Subtabs (Serial Monitor excluded as requested) -->
    <div class="breaker-tabs-nav">
      <button class="breaker-tab-btn ${breakerSubTab === 'telemetry' ? 'active' : ''}" onclick="switchBreakerTab('telemetry')">
        <span>📊</span> Live Telemetry
      </button>
      <button class="breaker-tab-btn ${breakerSubTab === 'protection' ? 'active' : ''}" onclick="switchBreakerTab('protection')">
        <span>🛡️</span> Protection & Thresholds
      </button>
      <button class="breaker-tab-btn ${breakerSubTab === 'devices' ? 'active' : ''}" onclick="switchBreakerTab('devices')">
        <span>📱</span> Devices & Fleet (${tuyaDevicesList.length || 1})
      </button>
      <button class="breaker-tab-btn ${breakerSubTab === 'alarms' ? 'active' : ''}" onclick="switchBreakerTab('alarms')">
        <span>🚨</span> Alarms & Faults
        ${dec.has_alarm ? '<span class="status-badge badge-offline" style="font-size: 9px; padding: 1px 4px;">ALARM</span>' : ''}
      </button>
      <button class="breaker-tab-btn ${breakerSubTab === 'dps' ? 'active' : ''}" onclick="switchBreakerTab('dps')">
        <span>🔍</span> Raw DP Inspector
      </button>
      <button class="breaker-tab-btn ${breakerSubTab === 'reference' ? 'active' : ''}" onclick="switchBreakerTab('reference')">
        <span>📖</span> Reference & How It Works
      </button>
    </div>

    <!-- Subtab Content Area -->
    <div id="breaker-subtab-container">
      ${renderBreakerSubTab(data)}
    </div>
  `;
}

function switchBreakerTab(tabName) {
  breakerSubTab = tabName;
  document.querySelectorAll(".breaker-tab-btn").forEach(btn => {
    btn.classList.remove("active");
    if (btn.textContent.toLowerCase().includes(tabName)) {
      btn.classList.add("active");
    }
  });
  const container = document.getElementById("breaker-subtab-container");
  if (container && latestBreakerData) {
    container.innerHTML = renderBreakerSubTab(latestBreakerData);
  }
}

function renderBreakerSubTab(data) {
  const dec = data.reading?.decoded || {};
  const dps = data.reading?.dps || {};
  const cfg = data.config || {};
  const currentIp = cfg.ip_address || '192.168.1.25';

  // 1. LIVE TELEMETRY VIEW
  if (breakerSubTab === 'telemetry') {
    return `
      <div class="breaker-metrics-grid">
        <!-- Voltage -->
        <div class="breaker-metric-card volt">
          <div class="breaker-metric-header">
            <span>Mains Voltage</span>
            <span>🔌</span>
          </div>
          <div class="breaker-metric-val-row">
            <span class="breaker-metric-val" id="bm-voltage">${dec.voltage_v !== undefined ? dec.voltage_v : '—'}</span>
            <span class="breaker-metric-unit">V</span>
          </div>
          <div class="breaker-metric-footer">
            <span>Nominal: 230V</span>
            <span style="color: ${dec.voltage_v > 265 ? 'var(--accent-red)' : dec.voltage_v < 185 ? 'var(--accent-amber)' : 'var(--accent-green)'};">
              ${dec.voltage_v > 265 ? 'High' : dec.voltage_v < 185 ? 'Low' : 'Normal'}
            </span>
          </div>
        </div>

        <!-- Current -->
        <div class="breaker-metric-card curr">
          <div class="breaker-metric-header">
            <span>Load Current</span>
            <span>⚡</span>
          </div>
          <div class="breaker-metric-val-row">
            <span class="breaker-metric-val" id="bm-current">${dec.current_a !== undefined ? dec.current_a : '—'}</span>
            <span class="breaker-metric-unit">A</span>
          </div>
          <div class="breaker-metric-footer">
            <span>Rated Limit: 63A</span>
            <span>${(dec.current_a || 0) > 0.05 ? 'Load Active' : 'Idle'}</span>
          </div>
        </div>

        <!-- Residual Leakage Current -->
        <div class="breaker-metric-card leakage">
          <div class="breaker-metric-header">
            <span>Residual Earth Leakage</span>
            <span>⚠️</span>
          </div>
          <div class="breaker-metric-val-row">
            <span class="breaker-metric-val" id="bm-leakage" style="color: ${(dec.leakage_current_ma || 0) > (dec.leakage_threshold_ma || 200) ? 'var(--accent-red)' : 'var(--text-primary)'};">
              ${dec.leakage_current_ma !== undefined ? dec.leakage_current_ma : '0'}
            </span>
            <span class="breaker-metric-unit">mA</span>
          </div>
          <div class="breaker-metric-footer">
            <span>Limit: <strong id="bm-leakage-thresh">${dec.leakage_threshold_ma || 200} mA</strong></span>
            <span style="color: ${(dec.leakage_current_ma || 0) > 0 ? 'var(--accent-amber)' : 'var(--accent-green)'};">
              ${(dec.leakage_current_ma || 0) === 0 ? 'Safe (0 mA)' : 'Residual Draw'}
            </span>
          </div>
        </div>

        <!-- Active Power -->
        <div class="breaker-metric-card pwr">
          <div class="breaker-metric-header">
            <span>Active Power</span>
            <span>💡</span>
          </div>
          <div class="breaker-metric-val-row">
            <span class="breaker-metric-val" id="bm-power">${dec.power_w !== undefined ? dec.power_w : '—'}</span>
            <span class="breaker-metric-unit">W</span>
          </div>
          <div class="breaker-metric-footer">
            <span>${dec.power_kw ? dec.power_kw + ' kW' : '—'}</span>
            <span>PF: <strong id="bm-pf">${dec.power_factor || '0.99'}</strong></span>
          </div>
        </div>

        <!-- Total Forward Energy -->
        <div class="breaker-metric-card energy">
          <div class="breaker-metric-header">
            <span>Cumulative Energy</span>
            <span>📈</span>
          </div>
          <div class="breaker-metric-val-row">
            <span class="breaker-metric-val" id="bm-energy">${dec.total_energy_kwh !== undefined ? dec.total_energy_kwh : '—'}</span>
            <span class="breaker-metric-unit">kWh</span>
          </div>
          <div class="breaker-metric-footer">
            <span>DP 101 Forward Meter</span>
            <span>Totalized</span>
          </div>
        </div>

        <!-- Line Frequency -->
        <div class="breaker-metric-card freq">
          <div class="breaker-metric-header">
            <span>Line Frequency</span>
            <span>〰️</span>
          </div>
          <div class="breaker-metric-val-row">
            <span class="breaker-metric-val" id="bm-freq">${dec.frequency_hz !== undefined ? dec.frequency_hz : '50.0'}</span>
            <span class="breaker-metric-unit">Hz</span>
          </div>
          <div class="breaker-metric-footer">
            <span>Standard: 50.0 Hz</span>
            <span style="color: var(--accent-green);">Synchronized</span>
          </div>
        </div>

        <!-- Internal Temperature -->
        <div class="breaker-metric-card temp">
          <div class="breaker-metric-header">
            <span>Internal Temperature</span>
            <span>🌡️</span>
          </div>
          <div class="breaker-metric-val-row">
            <span class="breaker-metric-val" id="bm-temp">${dec.temperature_c !== undefined ? dec.temperature_c : '—'}</span>
            <span class="breaker-metric-unit">°C</span>
          </div>
          <div class="breaker-metric-footer">
            <span>Cutoff: <strong id="bm-temp-thresh">${dps['115'] || dec.high_temp_threshold_c || 93}°C</strong></span>
            <span style="color: ${(dec.temperature_c || 0) > 60 ? 'var(--accent-amber)' : 'var(--accent-green)'};">
              ${(dec.temperature_c || 0) > 60 ? 'Warm' : 'Normal'}
            </span>
          </div>
        </div>
      </div>
    `;
  }

  // 2. PROTECTION & THRESHOLDS VIEW
  if (breakerSubTab === 'protection') {
    const isLeakageMasterOn = dps['127'] !== false;
    const isVoltageProtectMasterOn = dps['108'] !== false;
    const isAutoRecloseOn = dps['119'] !== false;
    const leakageThresh = Number(dps['132'] || dec.leakage_threshold_ma || 200);
    const overcurrentLimit = Number(dps['130'] || 30);
    const autoRecloseMax = Number(dps['133'] || 10);
    const autoRecloseDelay = Number(dps['118'] || 30);
    const leakageDelay = Number(dps['129'] || 1);
    const highTempThresh = Number(dps['115'] || dec.high_temp_threshold_c || 93);
    const liveTemp = Number(dec.temperature_c !== undefined ? dec.temperature_c : (dps['114'] || 33));
    const overvoltageReg = Number(dps['121'] || 14144);
    const overvoltageDelay = Number(dps['105'] || 0);
    const protectionDelay = Number(dps['117'] || 1);
    const generalTripDelay = Number(dps['116'] || 5);

    return `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 18px;">
        <!-- Over-Voltage & Under-Voltage Protection Card -->
        <div class="threshold-card">
          <h3 style="font-size: 15px; margin: 0 0 14px 0; color: #38bdf8; display: flex; align-items: center; justify-content: space-between;">
            <span>⚡ Over & Under-Voltage Protection</span>
            <span class="status-badge ${isVoltageProtectMasterOn ? 'badge-online' : 'badge-offline'}">
              ${isVoltageProtectMasterOn ? 'ACTIVE' : 'OFF'}
            </span>
          </h3>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
            <div>
              <div style="font-size: 13px; font-weight: 600;">Voltage Protection Master (DP 108)</div>
              <div style="font-size: 11.5px; color: var(--text-secondary);">Master enable for grid voltage limits</div>
            </div>
            <div>
              <button class="btn ${isVoltageProtectMasterOn ? 'btn-primary' : ''}" onclick="handleVoltageMasterToggle(${!isVoltageProtectMasterOn})" style="font-size: 12px; padding: 4px 10px;">
                ${isVoltageProtectMasterOn ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>

          <div style="margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label style="font-size: 13px; font-weight: 600;">Over-Voltage Cutoff / Register (DP 121)</label>
              <span style="font-size: 13.5px; font-weight: 700; color: #38bdf8;">${overvoltageReg}</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="number" id="input-overvol-thresh" value="${overvoltageReg}" min="100" max="65535" style="width: 110px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px;">
              <button class="btn btn-primary" onclick="handleOvervoltageThresholdUpdate(document.getElementById('input-overvol-thresh').value)" style="font-size: 12px;">Save</button>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;">
              <span style="font-size: 11px; color: var(--text-secondary); margin-right: 4px;">Presets:</span>
              <button class="preset-pill ${overvoltageReg === 14144 ? 'active' : ''}" onclick="handleOvervoltageThresholdUpdate(14144)">Default (14144 / ~275V)</button>
              <button class="preset-pill" onclick="handleOvervoltageThresholdUpdate(13800)">265V Safe</button>
              <button class="preset-pill" onclick="handleOvervoltageThresholdUpdate(14300)">280V Wide</button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px;">
            <div>
              <label style="font-size: 11.5px; color: var(--text-secondary);">Recovery Delay (DP 105)</label>
              <div style="display: flex; gap: 6px; margin-top: 4px;">
                <input type="number" id="input-overvol-recovery" value="${overvoltageDelay}" min="0" max="999" style="width: 65px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 6px; font-size: 12px;">
                <button class="btn" onclick="updateBreakerDp('105', Number(document.getElementById('input-overvol-recovery').value))" style="font-size: 11px; padding: 4px 8px;">Save</button>
              </div>
            </div>
            <div>
              <label style="font-size: 11.5px; color: var(--text-secondary);">Safety Delay (DP 117)</label>
              <div style="display: flex; gap: 6px; margin-top: 4px;">
                <input type="number" id="input-protect-delay" value="${protectionDelay}" min="1" max="30" style="width: 65px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 4px 6px; font-size: 12px;">
                <button class="btn" onclick="updateBreakerDp('117', Number(document.getElementById('input-protect-delay').value))" style="font-size: 11px; padding: 4px 8px;">Save</button>
              </div>
            </div>
          </div>
        </div>

        <!-- High Temperature Protection Card -->
        <div class="threshold-card">
          <h3 style="font-size: 15px; margin: 0 0 14px 0; color: #f97316; display: flex; align-items: center; justify-content: space-between;">
            <span>🌡️ High Temperature Protection</span>
            <span class="status-badge ${liveTemp > highTempThresh ? 'badge-offline' : 'badge-online'}">
              ${liveTemp > highTempThresh ? 'OVERHEAT' : 'NORMAL'}
            </span>
          </h3>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
            <div>
              <div style="font-size: 13px; font-weight: 600;">Live Sensor Probe (DP 114)</div>
              <div style="font-size: 11.5px; color: var(--text-secondary);">Real-time internal PCB heat reading</div>
            </div>
            <div>
              <span style="font-size: 17px; font-weight: 800; color: ${liveTemp > 60 ? '#f59e0b' : '#34d399'};">${liveTemp} °C</span>
            </div>
          </div>

          <div style="margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label style="font-size: 13px; font-weight: 600;">High Temp Cutoff Threshold (DP 115)</label>
              <span style="font-size: 14px; font-weight: 700; color: #f97316;">${highTempThresh} °C</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="number" id="input-hightemp-thresh" value="${highTempThresh}" min="40" max="150" step="1" style="width: 100px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px;">
              <button class="btn btn-primary" onclick="handleHighTempThresholdUpdate(document.getElementById('input-hightemp-thresh').value)" style="font-size: 12px;">Save</button>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px;">
              <span style="font-size: 11px; color: var(--text-secondary); margin-right: 4px;">Presets:</span>
              <button class="preset-pill ${highTempThresh === 70 ? 'active' : ''}" onclick="handleHighTempThresholdUpdate(70)">70°C Safe</button>
              <button class="preset-pill ${highTempThresh === 80 ? 'active' : ''}" onclick="handleHighTempThresholdUpdate(80)">80°C High</button>
              <button class="preset-pill ${highTempThresh === 93 ? 'active' : ''}" onclick="handleHighTempThresholdUpdate(93)">93°C (Current)</button>
              <button class="preset-pill ${highTempThresh === 100 ? 'active' : ''}" onclick="handleHighTempThresholdUpdate(100)">100°C Max</button>
            </div>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            Thermal Safety Trip Delay: <strong>${generalTripDelay} seconds</strong> (DP 116).
          </div>
        </div>

        <!-- Residual Earth Leakage Protection Card -->
        <div class="threshold-card">
          <h3 style="font-size: 15px; margin: 0 0 14px 0; color: #ec4899; display: flex; align-items: center; justify-content: space-between;">
            <span>⚠️ Residual Earth Leakage Protection</span>
            <span class="status-badge ${isLeakageMasterOn ? 'badge-online' : 'badge-offline'}">
              ${isLeakageMasterOn ? 'ENABLED' : 'DISABLED'}
            </span>
          </h3>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
            <div>
              <div style="font-size: 13px; font-weight: 600;">Leakage Master Switch (DP 127)</div>
              <div style="font-size: 11.5px; color: var(--text-secondary);">Master enable for residual current trip</div>
            </div>
            <div>
              <button class="btn ${isLeakageMasterOn ? 'btn-primary' : ''}" onclick="handleLeakageMasterToggle(${!isLeakageMasterOn})" style="font-size: 12px; padding: 4px 10px;">
                ${isLeakageMasterOn ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>

          <div style="margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label style="font-size: 13px; font-weight: 600;">Trip Threshold (DP 132)</label>
              <span style="font-size: 14px; font-weight: 700; color: #ec4899;">${leakageThresh} mA</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="number" id="input-leakage-thresh" value="${leakageThresh}" min="10" max="1000" step="10" style="width: 110px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px;">
              <button class="btn btn-primary" onclick="handleLeakageThresholdUpdate(document.getElementById('input-leakage-thresh').value)" style="font-size: 12px;">Save</button>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px;">
              <span style="font-size: 11px; color: var(--text-secondary); margin-right: 4px;">Presets:</span>
              <button class="preset-pill ${leakageThresh === 30 ? 'active' : ''}" onclick="handleLeakageThresholdUpdate(30)">30mA (Human Safety)</button>
              <button class="preset-pill ${leakageThresh === 50 ? 'active' : ''}" onclick="handleLeakageThresholdUpdate(50)">50mA</button>
              <button class="preset-pill ${leakageThresh === 100 ? 'active' : ''}" onclick="handleLeakageThresholdUpdate(100)">100mA</button>
              <button class="preset-pill ${leakageThresh === 200 ? 'active' : ''}" onclick="handleLeakageThresholdUpdate(200)">200mA (Current)</button>
              <button class="preset-pill ${leakageThresh === 300 ? 'active' : ''}" onclick="handleLeakageThresholdUpdate(300)">300mA</button>
            </div>
          </div>

          <div>
            <div style="font-size: 13px; font-weight: 600; margin-bottom: 4px;">Leakage Recovery Trip Delay (DP 129)</div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="number" id="input-leakage-delay" value="${leakageDelay}" min="1" max="60" style="width: 90px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px;">
              <span style="font-size: 12px; color: var(--text-secondary);">seconds</span>
              <button class="btn" onclick="updateBreakerDp('129', Number(document.getElementById('input-leakage-delay').value))" style="font-size: 12px;">Save</button>
            </div>
          </div>
        </div>

        <!-- Overcurrent Protection Card -->
        <div class="threshold-card">
          <h3 style="font-size: 15px; margin: 0 0 14px 0; color: #f59e0b;">⚡ Overcurrent & Overload Protection</h3>
          
          <div style="margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label style="font-size: 13px; font-weight: 600;">Overcurrent Trip Limit (DP 130)</label>
              <span style="font-weight: 700; color: #f59e0b;">${overcurrentLimit} A</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="number" id="input-overcurrent-limit" value="${overcurrentLimit}" min="1" max="63" style="width: 90px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px;">
              <span style="font-size: 12px; color: var(--text-secondary);">Amperes (1 - 63A)</span>
              <button class="btn btn-primary" onclick="updateBreakerDp('130', Number(document.getElementById('input-overcurrent-limit').value))" style="font-size: 12px;">Save</button>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px;">
              <span style="font-size: 11px; color: var(--text-secondary); margin-right: 4px;">Presets:</span>
              <button class="preset-pill ${overcurrentLimit === 16 ? 'active' : ''}" onclick="updateBreakerDp('130', 16)">16A</button>
              <button class="preset-pill ${overcurrentLimit === 25 ? 'active' : ''}" onclick="updateBreakerDp('130', 25)">25A</button>
              <button class="preset-pill ${overcurrentLimit === 30 ? 'active' : ''}" onclick="updateBreakerDp('130', 30)">30A</button>
              <button class="preset-pill ${overcurrentLimit === 40 ? 'active' : ''}" onclick="updateBreakerDp('130', 40)">40A</button>
              <button class="preset-pill ${overcurrentLimit === 63 ? 'active' : ''}" onclick="updateBreakerDp('130', 63)">63A</button>
            </div>
          </div>

          <div style="margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label style="font-size: 13px; font-weight: 600;">Overcurrent Trip Delay (DP 131 / 116)</label>
              <span style="font-weight: 700;">${generalTripDelay} s</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="number" id="input-overcurrent-delay" value="${generalTripDelay}" min="1" max="60" style="width: 90px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px;">
              <span style="font-size: 12px; color: var(--text-secondary);">seconds</span>
              <button class="btn" onclick="updateBreakerDp('116', Number(document.getElementById('input-overcurrent-delay').value))" style="font-size: 12px;">Save</button>
            </div>
          </div>
        </div>

        <!-- Auto-Reclose Parameters Card -->
        <div class="threshold-card">
          <h3 style="font-size: 15px; margin: 0 0 14px 0; color: #10b981; display: flex; align-items: center; justify-content: space-between;">
            <span>🔄 Auto-Reclose Recovery System</span>
            <span class="status-badge ${isAutoRecloseOn ? 'badge-online' : 'badge-offline'}">
              ${isAutoRecloseOn ? 'ENABLED' : 'DISABLED'}
            </span>
          </h3>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
            <div>
              <div style="font-size: 13px; font-weight: 600;">Auto-Reclosing Master (DP 119)</div>
              <div style="font-size: 11.5px; color: var(--text-secondary);">Re-energize automatically after fault clears</div>
            </div>
            <div>
              <button class="btn ${isAutoRecloseOn ? 'btn-primary' : ''}" onclick="updateBreakerDp('119', ${!isAutoRecloseOn})" style="font-size: 12px; padding: 4px 10px;">
                ${isAutoRecloseOn ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <label style="font-size: 12px; font-weight: 600;">Max Attempts (DP 133)</label>
              <div style="display: flex; gap: 6px; margin-top: 6px;">
                <input type="number" id="input-reclose-attempts" value="${autoRecloseMax}" min="0" max="20" style="width: 75px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 8px; font-size: 12px;">
                <button class="btn btn-primary" onclick="updateBreakerDp('133', Number(document.getElementById('input-reclose-attempts').value))" style="font-size: 11px; padding: 6px 10px;">Save</button>
              </div>
            </div>
            <div>
              <label style="font-size: 12px; font-weight: 600;">Wait Delay (DP 118)</label>
              <div style="display: flex; gap: 6px; margin-top: 6px;">
                <input type="number" id="input-reclose-delay" value="${autoRecloseDelay}" min="5" max="600" style="width: 75px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 8px; font-size: 12px;">
                <button class="btn btn-primary" onclick="updateBreakerDp('118', Number(document.getElementById('input-reclose-delay').value))" style="font-size: 11px; padding: 6px 10px;">Save</button>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;
  }

  // 3. MULTI-DEVICE FLEET VIEW
  if (breakerSubTab === 'devices') {
    return `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h3 style="font-size: 16px; margin: 0; font-weight: 700; color: var(--text-primary);">Configured Tuya Devices (${tuyaDevicesList.length || 1})</h3>
            <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">Manage, switch, or add multiple Smart Breakers & Plugs on your local LAN.</div>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-primary" onclick="openAddTuyaDeviceModal()">
              <span>➕</span> Add New Device
            </button>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-bottom: 24px;">
          ${(tuyaDevicesList.length > 0 ? tuyaDevicesList : [{
            id: cfg.device_id || 'd705ffaccaf4d0f1b1addg',
            name: cfg.device_name || 'Wi-Fi Smart Circuit Breaker (Main)',
            ip: currentIp,
            local_key: cfg.local_key || 'gp->j2_X[Bx=.ovC',
            protocol_version: cfg.protocol_version || 3.5,
            is_active: 1
          }]).map(d => {
            const isActive = Boolean(d.is_active || d.id === activeTuyaDeviceId);
            return `
              <div class="tuya-device-card ${isActive ? 'active-device' : ''}">
                <div>
                  <div class="tuya-device-header">
                    <div class="tuya-device-title">
                      <span>⚡</span>
                      <span>${escapeHtml(d.name || 'Smart Breaker')}</span>
                    </div>
                    <span class="status-badge ${isActive ? 'badge-online' : 'badge-sync'}" style="font-size: 10px;">
                      ${isActive ? 'ACTIVE BREAKER' : 'CONFIGURED'}
                    </span>
                  </div>

                  <div class="tuya-device-meta">
                    <div>📍 <strong>IP:</strong> <code style="color: #60a5fa;">${escapeHtml(d.ip)}</code></div>
                    <div>🆔 <strong>Tuya ID:</strong> <code>${escapeHtml(d.id)}</code></div>
                    <div>🔒 <strong>Protocol:</strong> v${escapeHtml(String(d.protocol_version || '3.5'))} (AES-128 Local)</div>
                    <div>📦 <strong>Category:</strong> ${escapeHtml(d.category || 'breaker')}</div>
                  </div>
                </div>

                <div class="tuya-device-actions">
                  ${!isActive ? `
                    <button class="btn btn-primary" onclick="handleSelectTuyaDevice('${escapeHtml(d.id)}')" style="font-size: 11.5px; padding: 4px 10px;">
                      ⚡ Switch To This
                    </button>
                  ` : `
                    <span style="font-size: 11.5px; color: #34d399; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                      ✓ Currently Monitored
                    </span>
                  `}
                  <button class="btn" onclick="openBreakerNetworkConfigModal('${escapeHtml(d.id)}')" style="font-size: 11.5px; padding: 4px 10px;">
                    ✏️ Edit IP / Key
                  </button>
                  <button class="btn" onclick="handleTestTuyaConnection('${escapeHtml(d.ip)}', '${escapeHtml(d.id)}', '${escapeHtml(d.local_key || '')}', ${d.protocol_version || 3.5})" style="font-size: 11.5px; padding: 4px 10px;">
                    ⚡ Test Socket
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // 4. ALARMS & FAULTS VIEW
  if (breakerSubTab === 'alarms') {
    const faults = dec.faults || {};
    const hasAlarm = Boolean(dec.has_alarm);
    const faultItems = [
      { key: "leakage_alarm", name: "Earth Leakage Trip", desc: "Residual current exceeded protection threshold" },
      { key: "overcurrent_alarm", name: "Overcurrent / Overload", desc: "Continuous load exceeded safe limit" },
      { key: "overvoltage_alarm", name: "Over-Voltage Fault", desc: "Grid voltage exceeded high protection threshold" },
      { key: "undervoltage_alarm", name: "Under-Voltage Fault", desc: "Grid voltage dropped below minimum threshold" },
      { key: "high_temp_alarm", name: "High Temperature Overheat", desc: "Internal sensor reached critical thermal limit" },
      { key: "unbalance_alarm", name: "Phase Imbalance Fault", desc: "Voltage or load phase angle divergence" },
      { key: "phase_loss_alarm", name: "Phase Loss Fault", desc: "Missing line AC grid phase" },
      { key: "relay_failure_alarm", name: "Contactor Mechanical Fault", desc: "Internal contactor stuck or failed to switch" }
    ];

    return `
      <div style="padding: 16px 20px; background: ${hasAlarm ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.08)'}; border: 1px solid ${hasAlarm ? 'rgba(239, 68, 68, 0.35)' : 'rgba(16, 185, 129, 0.25)'}; border-radius: 12px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-weight: 700; font-size: 15px; color: ${hasAlarm ? '#f87171' : '#34d399'};">
            ${hasAlarm ? '🚨 HARDWARE SAFETY ALARM ACTIVE' : '✅ ALL SAFETY SENSORS NORMAL'}
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
            Hardware Safety Fault Register (DP 26): <strong>0x${(dec.fault_raw || 0).toString(16).toUpperCase()}</strong> (${dec.fault_raw || 0})
          </div>
        </div>
        <div>
          <button class="btn" onclick="refreshBreakerNow()" style="font-size: 12px;">Check Now</button>
        </div>
      </div>

      <div class="faults-grid">
        ${faultItems.map(item => {
          const isTriggered = Boolean(faults[item.key]);
          return `
            <div class="fault-item ${isTriggered ? 'alarm-triggered' : 'fault-ok'}">
              <div class="fault-indicator"></div>
              <div>
                <div style="font-size: 13px; font-weight: 600; color: ${isTriggered ? '#f87171' : 'var(--text-primary)'};">
                  ${item.name}
                </div>
                <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 2px;">
                  ${item.desc}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // 5. RAW DP INSPECTOR VIEW
  if (breakerSubTab === 'dps') {
    const dpEntries = Object.entries(dps).sort((a, b) => Number(a[0]) - Number(b[0]));
    return `
      <div class="threshold-card" style="margin-bottom: 20px;">
        <h3 style="font-size: 15px; margin: 0 0 10px 0; color: #38bdf8;">⚡ Write / Override DP Parameter</h3>
        <form onsubmit="handleCustomDpWrite(event)" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <input type="text" id="custom-dp-id" placeholder="DP ID (e.g. 132)" style="width: 120px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px;" required>
          <select id="custom-dp-type" style="background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px;">
            <option value="integer">Integer (Number)</option>
            <option value="boolean">Boolean (True/False)</option>
            <option value="string">String (Text)</option>
          </select>
          <input type="text" id="custom-dp-val" placeholder="Value (e.g. 200)" style="width: 150px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 13px;" required>
          <button type="submit" class="btn btn-primary" style="font-size: 12px;">Send LAN Command</button>
        </form>
      </div>

      <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden;">
        <table class="dp-table">
          <thead>
            <tr>
              <th style="width: 80px;">DP ID</th>
              <th>Function / Description</th>
              <th>Data Type</th>
              <th>Live Value</th>
            </tr>
          </thead>
          <tbody>
            ${dpEntries.map(([id, val]) => `
              <tr>
                <td><strong>DP ${id}</strong></td>
                <td>${BREAKER_DP_NAMES[id] || 'Custom Manufacturer Register'}</td>
                <td><code style="font-size: 11.5px; color: #93c5fd;">${typeof val}</code></td>
                <td><code style="font-size: 12.5px; color: #34d399; word-break: break-all;">${escapeHtml(JSON.stringify(val))}</code></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // 6. REFERENCE & HOW IT WORKS VIEW
  if (breakerSubTab === 'reference') {
    return `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 18px;">
        <div class="threshold-card">
          <h3 style="font-size: 15px; margin: 0 0 14px 0; color: #38bdf8;">⚙️ How Direct Socket Local Integration Works</h3>
          <div style="font-size: 12.5px; line-height: 1.8; color: var(--text-secondary);">
            <div>&bull; <strong>100% Local LAN Communication:</strong> The Edge Broker connects directly to your Smart Breaker's IP address (<code>${escapeHtml(currentIp)}</code>) over TCP Port <strong>6668</strong>.</div>
            <div>&bull; <strong>AES-128 Hardware Handshake:</strong> Packets are encrypted with the device's unique local key (<code>${escapeHtml(cfg.local_key || 'gp->j2_X[Bx=.ovC')}</code>). No Tuya cloud or external internet connection is required.</div>
            <div>&bull; <strong>Contactor Switch (DP 108):</strong> In TDQ category breakers, DP 108 controls the internal physical mechanical contactor. When energized, DP 108 is TRUE; when tripped or isolated, DP 108 is FALSE.</div>
            <div>&bull; <strong>Real-time Telemetry (DP 102):</strong> The breaker streams 8-byte packed telemetry containing Voltage (16-bit), Current (24-bit), and Active Power (24-bit).</div>
            <div>&bull; <strong>Dynamic IP Switching:</strong> If your Wi-Fi router's DHCP changes the breaker's IP address, update it via <strong>"✏️ Change IP"</strong> or the <strong>"Devices & Fleet"</strong> tab anytime!</div>
          </div>
        </div>

        <div class="threshold-card">
          <h3 style="font-size: 15px; margin: 0 0 14px 0; color: #10b981;">🛡️ Electrical Safety Matrix</h3>
          <div style="font-size: 12.5px; line-height: 1.8; color: var(--text-secondary);">
            <div>&bull; <strong>DP 108:</strong> Main Contactor Switch (True = Closed / ON, False = Tripped / OFF)</div>
            <div>&bull; <strong>DP 102:</strong> 8-Byte Base64 stream for Voltage, Current, and Active Power</div>
            <div>&bull; <strong>DP 114 / 115:</strong> Internal Thermal Sensor & Trip Cutoff (93°C)</div>
            <div>&bull; <strong>DP 121:</strong> Over-Voltage Trip Threshold Register (14144 / ~275V)</div>
            <div>&bull; <strong>DP 126 / 132:</strong> Residual Earth Leakage Monitor & Protection (200mA)</div>
            <div>&bull; <strong>DP 130 / 131:</strong> Overcurrent Trip Limit & Safety Delays (30A)</div>
            <div>&bull; <strong>DP 26:</strong> 16-Bit Hardware Fault and Trip Register</div>
            <div>&bull; <strong>DP 40:</strong> Maintenance Lockout prohibits remote energizing</div>
          </div>
        </div>
      </div>
    `;
  }

  return '';
}

function updateBreakerDom(data) {
  latestBreakerData = data;
  const rd = data.reading || data;
  const dec = rd.decoded || {};
  const isOnline = Boolean(rd.online);
  const switchState = Boolean(dec.switch_state);

  const statusBadge = document.getElementById("breaker-online-badge");
  if (statusBadge) {
    statusBadge.className = `status-badge ${isOnline ? 'badge-online' : 'badge-offline'}`;
    statusBadge.innerHTML = `<span class="pulse-dot"></span> ${isOnline ? '🟢 LIVE LAN (Local)' : '🔴 OFFLINE / UNREACHABLE'}`;
  }

  const btn = document.getElementById("breaker-main-btn");
  if (btn) {
    btn.className = `breaker-power-btn ${switchState ? 'state-on' : 'state-off'}`;
  }

  const statusText = document.getElementById("breaker-status-text");
  if (statusText) {
    statusText.textContent = switchState ? 'CIRCUIT CLOSED (ENERGIZED)' : 'CIRCUIT TRIPPED (ISOLATED)';
    statusText.style.color = switchState ? '#34d399' : '#f87171';
  }

  const statusDesc = document.getElementById("breaker-status-desc");
  if (statusDesc) {
    statusDesc.textContent = switchState
      ? 'Main internal contacts (DP 108) are closed. Mains electricity is flowing safely through the breaker.'
      : 'Circuit is open. Downstream power is isolated.';
  }

  if (breakerSubTab === 'telemetry') {
    const vEl = document.getElementById("bm-voltage");
    if (vEl && dec.voltage_v !== undefined) vEl.textContent = dec.voltage_v;

    const iEl = document.getElementById("bm-current");
    if (iEl && dec.current_a !== undefined) iEl.textContent = dec.current_a;

    const pEl = document.getElementById("bm-power");
    if (pEl && dec.power_w !== undefined) pEl.textContent = dec.power_w;

    const eEl = document.getElementById("bm-energy");
    if (eEl && dec.total_energy_kwh !== undefined) eEl.textContent = dec.total_energy_kwh;

    const lEl = document.getElementById("bm-leakage");
    if (lEl && dec.leakage_current_ma !== undefined) lEl.textContent = dec.leakage_current_ma;

    const fEl = document.getElementById("bm-freq");
    if (fEl && dec.frequency_hz !== undefined) fEl.textContent = dec.frequency_hz;

    const tEl = document.getElementById("bm-temp");
    if (tEl && dec.temperature_c !== undefined) tEl.textContent = dec.temperature_c;

    const pfEl = document.getElementById("bm-pf");
    if (pfEl && dec.power_factor !== undefined) pfEl.textContent = dec.power_factor;
  }
}

// ==========================================================================
// === BREAKER USER CONTROLS & PROTECTION ACTIONS ===
// ==========================================================================

function handleBreakerTogglePrompt() {
  if (!latestBreakerData) return;
  const dec = latestBreakerData.reading?.decoded || latestBreakerData.decoded || {};
  const currentState = Boolean(dec.switch_state);
  const targetState = !currentState;

  if (dec.child_lock && targetState === true) {
    showToast({
      title: "Action Blocked by Safety Lock",
      message: "Maintenance Lock (DP 40) is currently ACTIVE. Unlock it before energizing.",
      severity: "WARNING"
    });
    return;
  }

  const actionText = targetState ? "CLOSE contacts (Turn ON)" : "OPEN contacts (TRIP OFF)";
  const warningText = targetState
    ? "Energizing the circuit will restore electrical power to all connected downstream appliances."
    : "Tripping the circuit breaker will cut electrical power immediately to all connected devices!";

  openModal(`
    <div style="max-width: 440px; padding: 24px; text-align: center;">
      <div style="font-size: 44px; margin-bottom: 12px;">⚠️</div>
      <h3 style="margin-bottom: 10px; color: ${targetState ? 'var(--accent-green)' : 'var(--accent-red)'};">
        Confirm Breaker Switch Action
      </h3>
      <p style="font-size: 13.5px; color: var(--text-primary); margin-bottom: 12px; line-height: 1.5;">
        Are you sure you want to <strong>${actionText}</strong> on the Smart Circuit Breaker?
      </p>
      <div style="font-size: 12px; color: var(--text-secondary); background: rgba(255,255,255,0.04); padding: 10px; border-radius: 8px; margin-bottom: 20px;">
        ${warningText}
      </div>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn ${targetState ? 'btn-primary' : 'btn-danger'}" onclick="closeModal(); executeBreakerToggle(${targetState})">
          Confirm ${targetState ? 'Turn ON' : 'Trip Breaker'}
        </button>
      </div>
    </div>
  `);
}

async function executeBreakerToggle(targetState) {
  try {
    const res = await fetch(`${API_BASE}/breaker/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: targetState })
    });
    const result = await res.json();
    if (result.success) {
      showToast({
        title: "Breaker Switched",
        message: `Circuit breaker contacts turned ${targetState ? 'ON' : 'OFF'} via local LAN socket.`,
        severity: targetState ? "SUCCESS" : "WARNING"
      });
      loadBreakerView();
    } else {
      showToast({
        title: "Breaker Switch Failed",
        message: result.error || "Device did not acknowledge command",
        severity: "ERROR"
      });
    }
  } catch (err) {
    showToast({
      title: "Network Error",
      message: err.message,
      severity: "ERROR"
    });
  }
}

async function updateBreakerDp(dp, val) {
  try {
    const res = await fetch(`${API_BASE}/breaker/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dp, value: val })
    });
    const result = await res.json();
    if (result.success) {
      showToast({
        title: "Setting Saved",
        message: `DP ${dp} updated to ${JSON.stringify(val)} via LAN.`,
        severity: "SUCCESS"
      });
      loadBreakerView();
    } else {
      showToast({
        title: "Update Failed",
        message: result.error || "Could not write DP",
        severity: "ERROR"
      });
    }
  } catch (err) {
    showToast({ title: "Error", message: err.message, severity: "ERROR" });
  }
}

function handleBreakerLockToggle(currentState) {
  updateBreakerDp("40", !currentState);
}

function handleBreakerPowerOnBehavior(val) {
  updateBreakerDp("38", val);
}

function handleCountdownSet() {
  const el = document.getElementById("breaker-countdown-input");
  const val = Number(el?.value);
  if (isNaN(val) || val < 0) return;
  updateBreakerDp("9", val);
}

function handleVoltageMasterToggle(enabled) {
  updateBreakerDp("108", enabled);
}

function handleOvervoltageThresholdUpdate(val) {
  const n = Number(val);
  if (isNaN(n) || n < 100 || n > 65535) {
    alert("Please enter a valid voltage register threshold.");
    return;
  }
  updateBreakerDp("121", n);
}

function handleHighTempThresholdUpdate(val) {
  const n = Number(val);
  if (isNaN(n) || n < 40 || n > 150) {
    alert("Please enter a valid high temperature threshold between 40°C and 150°C.");
    return;
  }
  updateBreakerDp("115", n);
}

function handleLeakageMasterToggle(enabled) {
  updateBreakerDp("127", enabled);
}

function handleLeakageThresholdUpdate(val) {
  const n = Number(val);
  if (isNaN(n) || n < 10 || n > 1000) {
    alert("Please enter a valid leakage threshold between 10 mA and 1000 mA.");
    return;
  }
  updateBreakerDp("132", n);
}

async function refreshBreakerNow() {
  const btn = document.getElementById("breaker-refresh-btn");
  if (btn) btn.innerHTML = `<span>⏳</span> Polling...`;
  try {
    const res = await fetch(`${API_BASE}/breaker/refresh`, { method: "POST" });
    const result = await res.json();
    if (result.success) {
      showToast({
        title: "Device Polled",
        message: "Latest telemetry and status registers updated from breaker.",
        severity: "INFO"
      });
      loadBreakerView();
    }
  } catch (err) {
    showToast({ title: "Poll Failed", message: err.message, severity: "ERROR" });
  } finally {
    if (btn) btn.innerHTML = `<span>🔄</span> Refresh Now`;
  }
}

function handleCustomDpWrite(e) {
  e.preventDefault();
  const dp = document.getElementById("custom-dp-id").value.trim();
  const type = document.getElementById("custom-dp-type").value;
  const rawVal = document.getElementById("custom-dp-val").value.trim();

  let val = rawVal;
  if (type === "integer") val = parseInt(rawVal, 10);
  else if (type === "boolean") val = (rawVal.toLowerCase() === "true" || rawVal === "1");

  updateBreakerDp(dp, val);
}

// ==========================================================================
// === MULTI-DEVICE MANAGEMENT & MODALS ===
// ==========================================================================

function openBreakerNetworkConfigModal(deviceId) {
  let dev = null;
  if (deviceId) {
    dev = tuyaDevicesList.find(d => d.id === deviceId);
  }
  if (!dev) {
    dev = tuyaDevicesList.find(d => d.id === activeTuyaDeviceId) || latestBreakerData?.config || {};
  }

  openModal(`
    <div style="max-width: 500px; padding: 22px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 17px; font-weight: 700; color: #38bdf8;">
          ⚙️ Edit Device Network & Credentials
        </h3>
        <button class="btn" onclick="closeModal()" style="padding: 2px 8px; font-size: 14px;">✕</button>
      </div>

      <form onsubmit="handleSaveDeviceConfig(event)">
        <input type="hidden" id="edit-dev-id" value="${escapeHtml(dev.id || dev.device_id || 'd705ffaccaf4d0f1b1addg')}">

        <div style="margin-bottom: 14px;">
          <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">Device Friendly Name</label>
          <input type="text" id="edit-dev-name" value="${escapeHtml(dev.name || dev.device_name || 'Wi-Fi Smart Circuit Breaker')}" class="form-input" style="width: 100%;" required>
        </div>

        <div style="margin-bottom: 14px;">
          <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">LAN IP Address (e.g. 192.168.1.25)</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="edit-dev-ip" value="${escapeHtml(dev.ip || dev.ip_address || '192.168.1.25')}" class="form-input" style="flex-grow: 1; font-family: monospace;" required>
            <button type="button" class="btn" onclick="triggerModalTestSocket()" id="modal-test-btn" style="font-size: 12px; white-space: nowrap;">
              ⚡ Test Ping
            </button>
          </div>
          <div id="modal-test-result" style="font-size: 11.5px; margin-top: 6px; display: none;"></div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
          <div>
            <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">Tuya Device ID</label>
            <input type="text" id="edit-dev-gwid" value="${escapeHtml(dev.id || dev.device_id || '')}" class="form-input" style="width: 100%; font-family: monospace;" required>
          </div>
          <div>
            <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">Local Key (AES-128)</label>
            <input type="text" id="edit-dev-key" value="${escapeHtml(dev.local_key || '')}" class="form-input" style="width: 100%; font-family: monospace;" required>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
          <div>
            <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">Protocol Version</label>
            <select id="edit-dev-version" class="form-input" style="width: 100%;">
              <option value="3.5" ${String(dev.protocol_version) === '3.5' ? 'selected' : ''}>v3.5 (AES-128 CBC/GCM)</option>
              <option value="3.4" ${String(dev.protocol_version) === '3.4' ? 'selected' : ''}>v3.4</option>
              <option value="3.3" ${String(dev.protocol_version) === '3.3' ? 'selected' : ''}>v3.3</option>
            </select>
          </div>
          <div>
            <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">Device Category</label>
            <select id="edit-dev-category" class="form-input" style="width: 100%;">
              <option value="breaker" selected>Circuit Breaker (TDQ/DLQ)</option>
              <option value="switch">Smart Switch</option>
              <option value="socket">Smart Plug / Socket</option>
            </select>
          </div>
        </div>

        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button type="button" class="btn" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="save-config-btn">
            💾 Save & Apply Immediately
          </button>
        </div>
      </form>
    </div>
  `);
}

function openAddTuyaDeviceModal() {
  openModal(`
    <div style="max-width: 500px; padding: 22px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 17px; font-weight: 700; color: #10b981;">
          ➕ Add New Tuya Device / Circuit Breaker
        </h3>
        <button class="btn" onclick="closeModal()" style="padding: 2px 8px; font-size: 14px;">✕</button>
      </div>

      <form onsubmit="handleSaveDeviceConfig(event, true)">
        <div style="margin-bottom: 14px;">
          <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">Device Name</label>
          <input type="text" id="edit-dev-name" placeholder="e.g. AC Circuit Breaker, Kitchen Subpanel" class="form-input" style="width: 100%;" required>
        </div>

        <div style="margin-bottom: 14px;">
          <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">LAN IP Address</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="edit-dev-ip" placeholder="192.168.1.X" class="form-input" style="flex-grow: 1; font-family: monospace;" required>
            <button type="button" class="btn" onclick="triggerModalTestSocket()" id="modal-test-btn" style="font-size: 12px; white-space: nowrap;">
              ⚡ Test Ping
            </button>
          </div>
          <div id="modal-test-result" style="font-size: 11.5px; margin-top: 6px; display: none;"></div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
          <div>
            <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">Tuya Device ID</label>
            <input type="text" id="edit-dev-gwid" placeholder="e.g. d705ffaccaf4d0f1..." class="form-input" style="width: 100%; font-family: monospace;" required>
          </div>
          <div>
            <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">Local Key (16 chars)</label>
            <input type="text" id="edit-dev-key" placeholder="AES-128 Local Key" class="form-input" style="width: 100%; font-family: monospace;" required>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
          <div>
            <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">Protocol Version</label>
            <select id="edit-dev-version" class="form-input" style="width: 100%;">
              <option value="3.5" selected>v3.5 (AES-128)</option>
              <option value="3.4">v3.4</option>
              <option value="3.3">v3.3</option>
            </select>
          </div>
          <div>
            <label style="font-size: 12.5px; font-weight: 600; display: block; margin-bottom: 5px;">Category</label>
            <select id="edit-dev-category" class="form-input" style="width: 100%;">
              <option value="breaker" selected>Circuit Breaker</option>
              <option value="switch">Smart Switch</option>
              <option value="socket">Smart Plug / Socket</option>
            </select>
          </div>
        </div>

        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button type="button" class="btn" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="save-config-btn">
            ➕ Add Device
          </button>
        </div>
      </form>
    </div>
  `);
}

async function triggerModalTestSocket() {
  const ip = document.getElementById("edit-dev-ip")?.value.trim();
  const id = document.getElementById("edit-dev-gwid")?.value.trim();
  const key = document.getElementById("edit-dev-key")?.value.trim();
  const version = document.getElementById("edit-dev-version")?.value;
  const resEl = document.getElementById("modal-test-result");
  const btn = document.getElementById("modal-test-btn");

  if (!ip) {
    alert("Please enter an IP address to test.");
    return;
  }

  if (btn) btn.innerHTML = `<span>⏳</span> Testing...`;
  if (resEl) {
    resEl.style.display = 'block';
    resEl.style.color = 'var(--text-secondary)';
    resEl.textContent = `Attempting local AES socket handshake with ${ip}:6668...`;
  }

  try {
    const res = await fetch(`${API_BASE}/breaker/devices/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, id, local_key: key, protocol_version: version })
    });
    const result = await res.json();
    if (result.online) {
      resEl.style.color = '#34d399';
      resEl.innerHTML = `✅ <strong>ONLINE & RESPONDING!</strong> Connected to socket at <code>${ip}:6668</code>.`;
    } else {
      resEl.style.color = '#f87171';
      resEl.innerHTML = `⚠️ <strong>UNREACHABLE:</strong> ${escapeHtml(result.error || 'No response from device socket')}.`;
    }
  } catch (err) {
    if (resEl) {
      resEl.style.color = '#f87171';
      resEl.textContent = `Error: ${err.message}`;
    }
  } finally {
    if (btn) btn.innerHTML = `⚡ Test Ping`;
  }
}

async function handleSaveDeviceConfig(e, isNew = false) {
  e.preventDefault();
  const id = document.getElementById("edit-dev-gwid")?.value.trim();
  const name = document.getElementById("edit-dev-name")?.value.trim();
  const ip = document.getElementById("edit-dev-ip")?.value.trim();
  const local_key = document.getElementById("edit-dev-key")?.value.trim();
  const protocol_version = Number(document.getElementById("edit-dev-version")?.value || 3.5);
  const category = document.getElementById("edit-dev-category")?.value || 'breaker';

  const btn = document.getElementById("save-config-btn");
  if (btn) btn.innerHTML = `<span>⏳</span> Saving...`;

  try {
    const res = await fetch(`${API_BASE}/breaker/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, ip, local_key, protocol_version, category, is_active: isNew ? 1 : undefined })
    });
    const result = await res.json();
    if (result.success !== false) {
      closeModal();
      showToast({
        title: "Device Saved",
        message: `Device configuration for "${name}" (${ip}) updated successfully.`,
        severity: "SUCCESS"
      });
      loadBreakerView();
    } else {
      alert(result.error || "Failed to save device");
    }
  } catch (err) {
    alert("Save error: " + err.message);
  } finally {
    if (btn) btn.innerHTML = `💾 Save & Apply`;
  }
}

async function handleSelectTuyaDevice(id) {
  if (!id) return;
  try {
    const res = await fetch(`${API_BASE}/breaker/devices/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    const result = await res.json();
    if (result.success) {
      activeTuyaDeviceId = id;
      showToast({
        title: "Active Device Changed",
        message: `Monitoring switched to "${result.activeDevice?.name || id}".`,
        severity: "INFO"
      });
      loadBreakerView();
    }
  } catch (err) {
    showToast({ title: "Switch Failed", message: err.message, severity: "ERROR" });
  }
}

async function handleTestTuyaConnection(ip, id, key, ver) {
  try {
    showToast({ title: "Testing Connection", message: `Connecting to socket ${ip}:6668...`, severity: "INFO" });
    const res = await fetch(`${API_BASE}/breaker/devices/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, id, local_key: key, protocol_version: ver })
    });
    const result = await res.json();
    if (result.online) {
      showToast({
        title: "Device Reachable",
        message: `Socket connection to ${ip} succeeded!`,
        severity: "SUCCESS"
      });
    } else {
      showToast({
        title: "Device Unreachable",
        message: `Socket at ${ip}:6668 did not respond. Check power & IP.`,
        severity: "WARNING"
      });
    }
  } catch (err) {
    showToast({ title: "Test Failed", message: err.message, severity: "ERROR" });
  }
}

// ==========================================================================
// === EVENTS & DIAGNOSTICS ===
// ==========================================================================

async function fetchEvents() {
  try {
    const res = await fetch(`${API_BASE}/events`);
    const events = await res.json();
    const box = document.getElementById('events-list');
    if (!box) return;
    if (!events || events.length === 0) {
      box.innerHTML = '<div class="empty">No events in persistent spool.</div>';
      return;
    }
    box.innerHTML = events.reverse().map(e => `
      <div class="event-row">
        <b>[${new Date(e.timestamp * 1000).toLocaleTimeString()}]</b> 
        <span style="color:#38bdf8">${escapeHtml(e.type)}</span> &bull; Node: ${escapeHtml(e.nodeId)} &bull; ${escapeHtml(JSON.stringify(e.data))}
      </div>
    `).join('');
  } catch (err) {}
}

async function fetchDiagnostics() {
  try {
    const res = await fetch(`${API_BASE}/edge/status`);
    const d = await res.json();
    const memEl = document.getElementById('diag-mem');
    if (memEl) memEl.textContent = d.memoryMb || '--';
    const upEl = document.getElementById('diag-uptime');
    if (upEl) upEl.textContent = `${d.uptimeSec}s`;
    const cenEl = document.getElementById('diag-central');
    if (cenEl) cenEl.textContent = d.centralOnline ? 'ONLINE (Proxying)' : 'STANDALONE (Fallback)';
    const nodeEl = document.getElementById('diag-nodes');
    if (nodeEl) nodeEl.textContent = d.nodesCount || 0;
    updateCentralStatus(d.centralOnline);
  } catch (err) {}
}

function updateCentralStatus(online) {
  const p = document.getElementById('central-status');
  const t = document.getElementById('central-status-text');
  if (p && t) {
    if (online) {
      p.className = 'pill pill-online';
      t.textContent = 'Central: Online';
    } else {
      p.className = 'pill pill-offline';
      t.textContent = 'Central: Standalone';
    }
  }
}

// ==========================================================================
// === TOAST & MODAL HELPERS ===
// ==========================================================================

function showToast(notif) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  const severity = (notif.severity || "INFO").toLowerCase();
  toast.className = `toast-item toast-${severity}`;

  let icon = "🔔";
  if (severity === "success") icon = "✅";
  else if (severity === "warning") icon = "⚠️";
  else if (severity === "error") icon = "🚨";

  const timeStr = new Date().toLocaleTimeString();

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(notif.title || 'Notification')}</div>
      <div class="toast-msg">${escapeHtml(notif.message || '')}</div>
      <div class="toast-time">${timeStr}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-leave");
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function toast(msg) {
  showToast({ title: "Alert", message: msg, severity: "INFO" });
}

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

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}