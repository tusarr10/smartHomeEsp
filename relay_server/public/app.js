// SmartHome Edge Relay & User Dashboard JavaScript
let activeTab = 'switches';
let nodesData = [];
let breakerData = null;
let automationsData = [];
let eventSource = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  loadAllData();
  setupEventSource();
  setInterval(loadSystemStatus, 5000);
});

// === TAB NAVIGATION ===
function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      switchTab(target);
    });
  });
}

function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${tabId}`);
  });

  if (tabId === 'breaker') {
    refreshBreaker();
  } else if (tabId === 'automations') {
    loadAutomations();
  } else if (tabId === 'system') {
    loadSystemStatus();
  }
}

// === REAL-TIME SSE CONNECTION ===
function setupEventSource() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/events');

  eventSource.addEventListener('central_status', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateCentralStatusUI(data);
    } catch (err) {}
  });

  eventSource.addEventListener('node_status', (e) => {
    try {
      const data = JSON.parse(e.data);
      const node = nodesData.find(n => n.nodeId === data.nodeId);
      if (node) {
        node.is_online = data.is_online;
        renderSwitches();
        renderSensors();
      } else {
        loadNodes();
      }
      showToast(`Node ${data.name || data.nodeId} is ${data.is_online ? 'ONLINE' : 'OFFLINE'}`);
    } catch (err) {}
  });

  eventSource.addEventListener('channel_changed', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateChannelStateLocally(data.nodeId, data.channelId, data.state);
    } catch (err) {}
  });

  eventSource.addEventListener('breaker_reading', (e) => {
    try {
      const data = JSON.parse(e.data);
      breakerData = data;
      renderBreakerUI(data);
    } catch (err) {}
  });

  eventSource.addEventListener('sensors_updated', (e) => {
    try {
      const data = JSON.parse(e.data);
      const node = nodesData.find(n => n.nodeId === data.nodeId);
      if (node) {
        node.sensors = data.sensors;
        renderSensors();
      }
    } catch (err) {}
  });

  eventSource.onerror = () => {
    // Reconnect will happen automatically by the browser
    const pill = document.getElementById('central-status-pill');
    if (pill) {
      pill.className = 'status-pill status-offline';
      document.getElementById('central-status-text').textContent = 'Live SSE Reconnecting...';
    }
  };
}

// === DATA FETCHING ===
async function loadAllData() {
  await Promise.all([
    loadNodes(),
    refreshBreaker(),
    loadAutomations(),
    loadSystemStatus()
  ]);
}

async function loadNodes() {
  try {
    const res = await fetch('/api/nodes');
    const data = await res.json();
    nodesData = data.nodes || [];
    renderSwitches();
    renderSensors();
    if (data.central) {
      updateCentralStatusUI(data.central);
    }
  } catch (err) {
    console.error('Failed to load nodes:', err);
  }
}

async function refreshBreaker() {
  try {
    const res = await fetch('/api/breaker');
    const data = await res.json();
    breakerData = data.reading;
    renderBreakerUI(breakerData);
    if (data.central) {
      updateCentralStatusUI(data.central);
    }
  } catch (err) {
    console.error('Failed to load breaker:', err);
  }
}

async function loadAutomations() {
  try {
    const res = await fetch('/api/automations');
    automationsData = await res.json();
    renderAutomations();
  } catch (err) {
    console.error('Failed to load automations:', err);
  }
}

async function loadSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.memory) {
      document.getElementById('ram-usage-text').textContent = `${data.memory.rssMb} MB`;
      document.getElementById('diag-rss').textContent = `${data.memory.rssMb} MB / 512 MB`;
      document.getElementById('diag-heap').textContent = `${data.memory.heapUsedMb} MB`;
    }
    document.getElementById('diag-uptime').textContent = `${data.uptimeSec}s`;
    document.getElementById('diag-nodes-total').textContent = data.nodesTotal || 0;
    document.getElementById('diag-nodes-online').textContent = data.nodesOnline || 0;

    if (data.central) {
      updateCentralStatusUI(data.central);
    }
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

// === CENTRAL SERVER LINK STATUS ===
function updateCentralStatusUI(central) {
  const pill = document.getElementById('central-status-pill');
  const text = document.getElementById('central-status-text');
  const diagUrl = document.getElementById('diag-central-url');
  const diagStatus = document.getElementById('diag-central-status');
  const diagMode = document.getElementById('diag-fallback-mode');

  if (diagUrl) diagUrl.textContent = central.centralUrl || '--';

  if (central.isOnline) {
    pill.className = 'status-pill status-online';
    text.textContent = 'Central: ONLINE';
    if (diagStatus) diagStatus.innerHTML = '<span style="color:#10b981">Connected (Proxy Active)</span>';
    if (diagMode) diagMode.textContent = 'Forwarding telemetry & commands';
  } else {
    pill.className = 'status-pill status-offline';
    text.textContent = 'Central: FALLBACK (Standalone)';
    if (diagStatus) diagStatus.innerHTML = '<span style="color:#f59e0b">Unreachable (Operating Locally)</span>';
    if (diagMode) diagMode.textContent = 'Local Edge Autonomy (Direct Control)';
  }
}

// === RENDER SWITCHES ===
function renderSwitches() {
  const container = document.getElementById('switches-grid');
  let allChannels = [];

  nodesData.forEach(node => {
    if (Array.isArray(node.channels)) {
      node.channels.forEach(ch => {
        allChannels.push({
          nodeId: node.nodeId,
          nodeName: node.name,
          isOnline: node.is_online,
          ...ch
        });
      });
    }
  });

  document.getElementById('switch-count-badge').textContent = allChannels.length;

  if (allChannels.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⏳</div>
        <p>No switch channels registered. Waiting for node telemetry...</p>
      </div>`;
    return;
  }

  container.innerHTML = allChannels.map(ch => {
    const isOn = Boolean(ch.state);
    const pinName = ch.pin ? `GPIO ${ch.pin}` : `Ch #${ch.channelId || ch.id}`;

    return `
      <div class="switch-card" id="switch-${ch.nodeId}-${ch.channelId || ch.id}">
        <div class="switch-card-header">
          <div>
            <div class="switch-title">${escapeHtml(ch.name || 'Switch')}</div>
            <div class="switch-node-tag">${escapeHtml(ch.nodeName)} &bull; ${ch.room || 'General'}</div>
          </div>
          <div class="switch-pin-badge">${pinName}</div>
        </div>

        <div class="switch-card-body">
          <div class="switch-state-indicator">
            <span class="status-dot" style="background: ${isOn ? '#10b981' : '#64748b'}; box-shadow: ${isOn ? '0 0 8px #10b981' : 'none'};"></span>
            <span style="color: ${isOn ? '#34d399' : '#94a3b8'}">${isOn ? 'ON' : 'OFF'}</span>
          </div>

          <button 
            class="switch-toggle-btn ${isOn ? 'btn-on' : 'btn-off'}" 
            onclick="toggleChannel('${ch.nodeId}', ${ch.channelId || ch.id}, ${!isOn})">
            ${isOn ? 'Turn OFF' : 'Turn ON'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleChannel(nodeId, channelId, newState) {
  const card = document.getElementById(`switch-${nodeId}-${channelId}`);
  if (card) {
    const btn = card.querySelector('.switch-toggle-btn');
    if (btn) btn.textContent = 'Switching...';
  }

  try {
    const res = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/channels/${channelId}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: newState })
    });
    const result = await res.json();
    if (result.success) {
      updateChannelStateLocally(nodeId, channelId, newState);
      showToast(`Channel switched ${newState ? 'ON' : 'OFF'}`);
    } else {
      showToast(`Failed: ${result.error || 'Unknown'}`, true);
      renderSwitches();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
    renderSwitches();
  }
}

function updateChannelStateLocally(nodeId, channelId, state) {
  const node = nodesData.find(n => n.nodeId === nodeId);
  if (node && Array.isArray(node.channels)) {
    const ch = node.channels.find(c => (c.channelId == channelId || c.id == channelId));
    if (ch) {
      ch.state = Boolean(state);
      renderSwitches();
    }
  }
}

// === RENDER CIRCUIT BREAKER ===
function renderBreakerUI(reading) {
  if (!reading) return;

  const decoded = reading.decoded || {};
  const isOnline = Boolean(reading.online);
  const isSwitchOn = Boolean(decoded.switch_state);

  // Status badges
  const onlineBadge = document.getElementById('breaker-online-badge');
  if (onlineBadge) {
    onlineBadge.className = isOnline ? 'badge badge-success' : 'badge';
    onlineBadge.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
  }

  // Device Info
  document.getElementById('breaker-device-name').textContent = reading.deviceName || 'Wi-Fi Smart Circuit Breaker';
  document.getElementById('breaker-ip-meta').textContent = `IP: ${reading.ip || '192.168.1.164'}`;
  document.getElementById('breaker-mac-meta').textContent = `MAC: ${reading.mac || '30:48:7D:E8:5D:5C'}`;

  // Main Contact State
  const statusText = document.getElementById('breaker-status-text');
  const toggleBtn = document.getElementById('breaker-toggle-btn');
  const contactIcon = document.getElementById('breaker-contact-icon');

  if (isSwitchOn) {
    statusText.textContent = 'CLOSED (ON)';
    statusText.style.color = '#34d399';
    statusText.style.background = 'rgba(16, 185, 129, 0.15)';
    statusText.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    toggleBtn.className = 'btn btn-breaker-on';
    toggleBtn.textContent = 'Trip Breaker (Open Contact)';
    contactIcon.style.borderColor = 'rgba(16, 185, 129, 0.5)';
    contactIcon.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.4)';
  } else {
    statusText.textContent = 'OPEN / TRIPPED (OFF)';
    statusText.style.color = '#f87171';
    statusText.style.background = 'rgba(239, 68, 68, 0.15)';
    statusText.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    toggleBtn.className = 'btn btn-breaker-off';
    toggleBtn.textContent = 'Close Breaker (Turn ON)';
    contactIcon.style.borderColor = 'rgba(239, 68, 68, 0.5)';
    contactIcon.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.4)';
  }

  // Metric Values
  document.getElementById('val-voltage').innerHTML = `${Number(decoded.voltage_v || 0).toFixed(1)} <span class="metric-unit">V</span>`;
  document.getElementById('val-current').innerHTML = `${Number(decoded.current_a || 0).toFixed(2)} <span class="metric-unit">A</span>`;
  document.getElementById('val-power').innerHTML = `${Number(decoded.power_w || 0).toFixed(1)} <span class="metric-unit">W</span>`;
  document.getElementById('val-energy').innerHTML = `${Number(decoded.total_energy_kwh || 0).toFixed(2)} <span class="metric-unit">kWh</span>`;
  document.getElementById('val-freq').innerHTML = `${Number(decoded.frequency_hz || 50.0).toFixed(1)} <span class="metric-unit">Hz</span>`;
  document.getElementById('val-temp').innerHTML = `${Number(decoded.temperature_c || 0).toFixed(1)} <span class="metric-unit">°C</span>`;
  document.getElementById('val-leakage').innerHTML = `${Number(decoded.leakage_current_ma || 0).toFixed(1)} <span class="metric-unit">mA</span>`;
  document.getElementById('val-pf').textContent = Number(decoded.power_factor || 0.99).toFixed(2);
  document.getElementById('val-childlock').textContent = decoded.child_lock ? 'LOCKED' : 'UNLOCKED';

  // Limits
  document.getElementById('limit-current').textContent = decoded.overcurrent_limit_a || 32;
  document.getElementById('limit-temp').textContent = decoded.high_temp_threshold_c || 90;
  document.getElementById('limit-leakage').textContent = decoded.leakage_threshold_ma || 30;
}

async function toggleBreakerSwitch() {
  if (!breakerData) return;
  const currentSwitch = Boolean(breakerData.decoded?.switch_state);
  const newSwitch = !currentSwitch;

  const btn = document.getElementById('breaker-toggle-btn');
  if (btn) btn.textContent = 'Sending command...';

  try {
    const res = await fetch('/api/breaker/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: newSwitch })
    });
    const result = await res.json();
    if (result.success) {
      if (breakerData.decoded) breakerData.decoded.switch_state = newSwitch;
      renderBreakerUI(breakerData);
      showToast(`Breaker switched ${newSwitch ? 'CLOSED (ON)' : 'TRIPPED (OFF)'}`);
    } else {
      showToast(`Breaker command failed: ${result.error}`, true);
      refreshBreaker();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
    refreshBreaker();
  }
}

// === RENDER SENSORS ===
function renderSensors() {
  const container = document.getElementById('sensors-grid');
  let allSensors = [];

  nodesData.forEach(node => {
    if (Array.isArray(node.sensors)) {
      node.sensors.forEach(s => {
        allSensors.push({
          nodeName: node.name,
          nodeId: node.nodeId,
          ...s
        });
      });
    }
  });

  if (allSensors.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🌡️</div>
        <p>No auxiliary sensors active.</p>
      </div>`;
    return;
  }

  container.innerHTML = allSensors.map(s => `
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-icon">📊</span>
        <span class="metric-label">${escapeHtml(s.name || s.type)}</span>
      </div>
      <div class="metric-value">
        ${s.value !== undefined ? s.value : '--'} <span class="metric-unit">${s.unit || ''}</span>
      </div>
      <div class="metric-footer">${escapeHtml(s.nodeName)}</div>
    </div>
  `).join('');
}

// === RENDER AUTOMATIONS ===
function renderAutomations() {
  const container = document.getElementById('automations-list');

  if (automationsData.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚙️</div>
        <p>No automation rules configured yet. Click "New Rule" to create one.</p>
      </div>`;
    return;
  }

  container.innerHTML = automationsData.map(rule => {
    let triggerText = '';
    if (rule.trigger?.type === 'SENSOR_THRESHOLD') {
      triggerText = `When ${rule.trigger.sensorType} is ${rule.trigger.operator} ${rule.trigger.value}`;
    } else if (rule.trigger?.type === 'TIME_SCHEDULE') {
      triggerText = `Daily at ${rule.trigger.time}`;
    }

    let actionText = '';
    if (rule.action?.type === 'SET_BREAKER') {
      actionText = `Turn Breaker ${rule.action.value ? 'ON' : 'OFF'}`;
    } else if (rule.action?.type === 'SET_CHANNEL') {
      actionText = `Turn Channel #${rule.action.channelId} ${rule.action.value ? 'ON' : 'OFF'}`;
    }

    return `
      <div class="automation-item">
        <div>
          <div class="auto-title">${escapeHtml(rule.name)}</div>
          <div class="auto-rule-desc">
            <b>IF</b> ${escapeHtml(triggerText)} &rarr; <b>THEN</b> ${escapeHtml(actionText)}
          </div>
          ${rule.lastTriggered ? `<div class="metric-footer" style="margin-top:4px;">Last triggered: ${new Date(rule.lastTriggered).toLocaleTimeString()}</div>` : ''}
        </div>

        <div class="auto-actions">
          <button 
            class="btn ${rule.enabled ? 'btn-primary' : 'btn-secondary'}" 
            onclick="toggleRule('${rule.id}', ${!rule.enabled})">
            ${rule.enabled ? 'Enabled' : 'Disabled'}
          </button>
          <button class="btn btn-secondary" onclick="deleteRule('${rule.id}')" title="Delete Rule">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleRule(ruleId, enabled) {
  try {
    const res = await fetch(`/api/automations/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    if (res.ok) {
      loadAutomations();
      showToast(`Rule ${enabled ? 'enabled' : 'disabled'}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  }
}

async function deleteRule(ruleId) {
  if (!confirm('Are you sure you want to delete this automation rule?')) return;
  try {
    const res = await fetch(`/api/automations/${ruleId}`, { method: 'DELETE' });
    if (res.ok) {
      loadAutomations();
      showToast('Rule deleted');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  }
}

// === AUTOMATION MODAL ===
function openNewRuleModal() {
  document.getElementById('rule-modal').style.display = 'flex';
  updateRuleFormFields();
}

function closeRuleModal() {
  document.getElementById('rule-modal').style.display = 'none';
}

function updateRuleFormFields() {
  const triggerType = document.getElementById('rule-trigger-type').value;
  document.getElementById('trigger-fields-sensor').style.display = triggerType === 'SENSOR_THRESHOLD' ? 'block' : 'none';
  document.getElementById('trigger-fields-time').style.display = triggerType === 'TIME_SCHEDULE' ? 'block' : 'none';
}

async function handleRuleSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('rule-name').value.trim();
  const triggerType = document.getElementById('rule-trigger-type').value;
  const actionType = document.getElementById('rule-action-type').value;
  const actionVal = Number(document.getElementById('rule-action-val').value);

  const payload = {
    name,
    enabled: true,
    trigger: { type: triggerType },
    action: {
      type: actionType,
      value: actionVal
    }
  };

  if (triggerType === 'SENSOR_THRESHOLD') {
    payload.trigger.sensorType = document.getElementById('rule-sensor-type').value;
    payload.trigger.operator = document.getElementById('rule-operator').value;
    payload.trigger.value = Number(document.getElementById('rule-threshold').value);
  } else if (triggerType === 'TIME_SCHEDULE') {
    payload.trigger.time = document.getElementById('rule-time').value;
  }

  try {
    const res = await fetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closeRuleModal();
      loadAutomations();
      showToast('Automation rule created');
    }
  } catch (err) {
    showToast(`Failed: ${err.message}`, true);
  }
}

// === UTILITIES ===
function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (isError) toast.style.borderColor = 'rgba(239,68,68,0.5)';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
