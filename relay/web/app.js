// SmartHome Go Edge Broker Web Dashboard
let nodes = [];
let breaker = null;
let ws = null;

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  fetchNodes();
  fetchBreaker();
  fetchDiagnostics();
  connectWebSocket();
  setInterval(fetchDiagnostics, 5000);
});

function setupTabs() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
      if (tab === 'events') fetchEvents();
    });
  });
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/v1/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    document.getElementById('ws-status-text').textContent = 'WS: Connected';
    document.getElementById('ws-status').className = 'pill pill-online';
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'pin_update' || msg.type === 'node_status') {
        fetchNodes();
      } else if (msg.type === 'breaker_update') {
        renderBreaker(msg.data);
      }
    } catch (err) {}
  };

  ws.onclose = () => {
    document.getElementById('ws-status-text').textContent = 'WS: Reconnecting...';
    document.getElementById('ws-status').className = 'pill pill-offline';
    setTimeout(connectWebSocket, 3000);
  };
}

async function fetchNodes() {
  try {
    const res = await fetch('/api/v1/nodes');
    const data = await res.json();
    nodes = data.nodes || [];
    renderSwitches();
    updateCentralStatus(data.centralOnline);
  } catch (err) {}
}

function renderSwitches() {
  const container = document.getElementById('switches-grid');
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

  document.getElementById('switch-count').textContent = channels.length;

  if (channels.length === 0) {
    container.innerHTML = '<div class="empty">Waiting for ESP8266 node telemetry on port 2000...</div>';
    return;
  }

  container.innerHTML = channels.map(ch => {
    const isOn = Boolean(ch.state);
    return `
      <div class="card">
        <div>
          <div class="card-title">${escapeHtml(ch.name || 'Switch')}</div>
          <div class="card-sub">${escapeHtml(ch.nodeName)} &bull; Pin ${ch.pin || ch.id}</div>
        </div>
        <button class="switch-btn ${isOn ? 'on' : 'off'}" onclick="toggleChannel('${ch.nodeId}', ${ch.id || ch.channelId}, ${!isOn})">
          ${isOn ? 'TURN OFF' : 'TURN ON'}
        </button>
      </div>
    `;
  }).join('');
}

async function toggleChannel(nodeId, chId, state) {
  try {
    const res = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: chId, state: state })
    });
    if (res.ok) {
      toast(`Switched channel ${state ? 'ON' : 'OFF'}`);
      fetchNodes();
    }
  } catch (err) {
    toast(`Command error: ${err.message}`);
  }
}

async function fetchBreaker() {
  try {
    const res = await fetch('/api/v1/breaker');
    const data = await res.json();
    renderBreaker(data.reading);
    updateCentralStatus(data.centralOnline);
  } catch (err) {}
}

function renderBreaker(b) {
  if (!b || !b.decoded) return;
  breaker = b;
  const d = b.decoded;
  const isClosed = Boolean(d.switch_state);

  document.getElementById('breaker-name').textContent = b.deviceName || 'Smart Circuit Breaker';
  document.getElementById('breaker-ip').textContent = `IP: ${b.ip || '192.168.1.164'} • Status: ${b.online ? 'Online' : 'Offline'}`;

  const stateText = document.getElementById('breaker-state-text');
  const tripBtn = document.getElementById('breaker-trip-btn');

  if (isClosed) {
    stateText.textContent = 'CLOSED (ON)';
    stateText.style.color = '#34d399';
    tripBtn.textContent = 'Trip Breaker';
    tripBtn.className = 'btn btn-trip';
  } else {
    stateText.textContent = 'TRIPPED (OFF)';
    stateText.style.color = '#f87171';
    tripBtn.textContent = 'Close Contact';
    tripBtn.className = 'btn';
  }

  document.getElementById('val-v').innerHTML = `${Number(d.voltage_v || 230).toFixed(1)} <small>V</small>`;
  document.getElementById('val-i').innerHTML = `${Number(d.current_a || 0).toFixed(2)} <small>A</small>`;
  document.getElementById('val-p').innerHTML = `${Number(d.power_w || 0).toFixed(1)} <small>W</small>`;
  document.getElementById('val-e').innerHTML = `${Number(d.total_energy_kwh || 0).toFixed(2)} <small>kWh</small>`;
  document.getElementById('val-f').innerHTML = `${Number(d.frequency_hz || 50).toFixed(1)} <small>Hz</small>`;
  document.getElementById('val-t').innerHTML = `${Number(d.temperature_c || 0).toFixed(1)} <small>°C</small>`;
  document.getElementById('val-l').innerHTML = `${Number(d.leakage_current_ma || 0).toFixed(1)} <small>mA</small>`;
}

async function toggleBreaker() {
  if (!breaker) return;
  const target = !breaker.decoded.switch_state;
  try {
    const res = await fetch('/api/v1/breaker/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: target })
    });
    if (res.ok) {
      toast(`Breaker contact switched ${target ? 'CLOSED' : 'TRIPPED'}`);
      fetchBreaker();
    }
  } catch (err) {}
}

async function fetchEvents() {
  try {
    const res = await fetch('/api/v1/events');
    const events = await res.json();
    const box = document.getElementById('events-list');
    if (!events || events.length === 0) {
      box.innerHTML = '<div class="empty">No events in persistent spool.</div>';
      return;
    }
    box.innerHTML = events.reverse().map(e => `
      <div class="event-row">
        <b>[${new Date(e.timestamp * 1000).toLocaleTimeString()}]</b> 
        <span style="color:#38bdf8">${e.type}</span> &bull; Node: ${e.nodeId} &bull; ${JSON.stringify(e.data)}
      </div>
    `).join('');
  } catch (err) {}
}

async function fetchDiagnostics() {
  try {
    const res = await fetch('/api/v1/edge/status');
    const d = await res.json();
    document.getElementById('diag-mem').textContent = d.memoryMb || '--';
    document.getElementById('diag-uptime').textContent = `${d.uptimeSec}s`;
    document.getElementById('diag-central').textContent = d.centralOnline ? 'ONLINE (Proxying)' : 'STANDALONE (Fallback)';
    document.getElementById('diag-nodes').textContent = d.nodesCount || 0;
    updateCentralStatus(d.centralOnline);
  } catch (err) {}
}

function updateCentralStatus(online) {
  const p = document.getElementById('central-status');
  const t = document.getElementById('central-status-text');
  if (online) {
    p.className = 'pill pill-online';
    t.textContent = 'Central: Online';
  } else {
    p.className = 'pill pill-offline';
    t.textContent = 'Central: Standalone';
  }
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3000);
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
