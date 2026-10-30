const app = {
  token: localStorage.getItem('sh_token') || '',
  channels: [],
  rules: [],
  refreshTimer: null,

  init() {
    this.setupTheme();
    this.setupTabs();
    this.setupEventListeners();
    this.startDashboard();
    this.checkAuth();
  },

  setupTheme() {
    const savedTheme = localStorage.getItem('sh_theme') || 'dark';
    if (savedTheme === 'light') {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
    }
  },

  toggleTheme() {
    if (document.body.classList.contains('light-theme')) {
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
      localStorage.setItem('sh_theme', 'dark');
    } else {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      localStorage.setItem('sh_theme', 'light');
    }
  },

  setupTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        const targetId = tab.getAttribute('data-tab');
        const pane = document.getElementById(targetId);
        if (pane) pane.classList.add('active');

        // Tab specific loading
        if (targetId === 'tab-logs') this.loadLogs();
        if (targetId === 'tab-wifi') this.loadWifiStatus();
        if (targetId === 'tab-settings') this.loadSettings();
        if (targetId === 'tab-sysinfo') this.loadStatus();
      });
    });
  },

  setupEventListeners() {
    document.getElementById('theme-toggle-btn').addEventListener('click', () => this.toggleTheme());
    document.getElementById('logout-btn').addEventListener('click', () => {
      if (this.token) this.logout();
      else this.showLoginModal();
    });

    // Login Form
    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.login();
    });

    // Wi-Fi Mode
    document.getElementById('save-wifi-mode-btn').addEventListener('click', () => this.saveWifiMode());
    document.getElementById('scan-wifi-btn').addEventListener('click', () => this.scanWifi());
    document.getElementById('wifi-connect-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.connectWifi();
    });
    document.getElementById('btn-reset-wifi').addEventListener('click', () => this.resetWifi());

    // GPIO Form
    document.getElementById('open-add-gpio-btn').addEventListener('click', () => this.openAddGpioModal());
    document.getElementById('gpio-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveGpioChannel();
    });

    // Rule Form
    document.getElementById('open-add-rule-btn').addEventListener('click', () => this.openAddRuleModal());
    document.getElementById('rule-type-select').addEventListener('change', (e) => this.handleRuleTypeChange(e.target.value));
    document.getElementById('rule-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveRule();
    });

    // Settings Form
    document.getElementById('settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveSettings();
    });

    // Central Receiver Form
    const recvForm = document.getElementById('receiver-form');
    if (recvForm) {
      recvForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveReceiverSettings();
      });
    }

    // System Maintenance
    document.getElementById('btn-reboot').addEventListener('click', () => this.reboot());
    document.getElementById('btn-factory-reset').addEventListener('click', () => this.factoryReset());

    // Change Password Form
    document.getElementById('change-pass-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.changePassword();
    });

    // OTA Form
    document.getElementById('ota-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.uploadOta();
    });

    // Logs
    document.getElementById('refresh-logs-btn').addEventListener('click', () => this.loadLogs());
  },

  async apiRequest(url, options = {}) {
    options.headers = options.headers || {};
    if (this.token) {
      options.headers['Authorization'] = 'Bearer ' + this.token;
      options.headers['X-Session-Token'] = this.token;
    }

    try {
      const res = await fetch(url, options);
      if (res.status === 401 || res.status === 403) {
        if (!url.includes('/api/auth/login')) {
          this.showLoginModal();
        }
      }
      return res;
    } catch (err) {
      console.error('API Error:', err);
      throw err;
    }
  },

  async checkAuth() {
    try {
      const res = await this.apiRequest('/api/auth/check');
      const data = await res.json();
      const logoutBtn = document.getElementById('logout-btn');
      if (data.authenticated) {
        this.hideLoginModal();
        if (logoutBtn) {
          logoutBtn.title = 'Logout (' + (data.adminUser || 'admin') + ')';
          logoutBtn.innerText = '🚪';
        }
      } else {
        this.token = '';
        localStorage.removeItem('sh_token');
        if (logoutBtn) {
          logoutBtn.title = 'Admin Login';
          logoutBtn.innerText = '🔐';
        }
      }
    } catch (e) {
      this.token = '';
      localStorage.removeItem('sh_token');
    }
  },

  showLoginModal() {
    document.getElementById('login-modal').classList.remove('hidden');
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').classList.add('hidden');
  },

  hideLoginModal() {
    document.getElementById('login-modal').classList.add('hidden');
  },

  async login() {
    const user = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
      });
      const data = await res.json();
      if (data.success && data.token) {
        this.token = data.token;
        localStorage.setItem('sh_token', this.token);
        this.hideLoginModal();
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
          logoutBtn.title = 'Logout (' + (user || 'admin') + ')';
          logoutBtn.innerText = '🚪';
        }
        this.startDashboard();
      } else {
        errEl.innerText = data.error || 'Invalid username or password';
        errEl.classList.remove('hidden');
      }
    } catch (err) {
      errEl.innerText = 'Network error during login';
      errEl.classList.remove('hidden');
    }
  },

  async logout() {
    try {
      await this.apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    this.token = '';
    localStorage.removeItem('sh_token');
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.title = 'Admin Login';
      logoutBtn.innerText = '🔐';
    }
    alert('Logged out of admin session');
  },

  startDashboard() {
    this.refreshAll();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => this.pollStatus(), 3000);
  },

  refreshAll() {
    this.loadStatus();
    this.loadGpios();
    this.loadRules();
    this.loadWifiStatus();
  },

  async pollStatus() {
    try {
      const res = await this.apiRequest('/api/status');
      if (res.ok) {
        const data = await res.json();
        this.renderStatus(data);
        // Also fetch latest GPIO states to reflect instant hardware changes
        this.loadGpios(true);
      }
    } catch (e) {}
  },

  async loadStatus() {
    try {
      const res = await this.apiRequest('/api/status');
      if (res.ok) {
        const data = await res.json();
        this.renderStatus(data);
      }
    } catch (e) {}
  },

  renderStatus(d) {
    if (d.deviceName) {
      document.getElementById('header-device-name').innerText = d.deviceName;
      document.title = d.deviceName + ' - Dashboard';
    }

    const badge = document.getElementById('wifi-badge');
    if (d.staConnected) {
      badge.className = 'badge badge-success';
      badge.innerText = 'Wi-Fi: Connected (' + (d.rssi || 0) + ' dBm)';
    } else if (d.apActive) {
      badge.className = 'badge badge-warning';
      badge.innerText = 'Wi-Fi: Hotspot AP';
    } else {
      badge.className = 'badge badge-danger';
      badge.innerText = 'Wi-Fi: Offline';
    }

    // Stats
    const modeNames = ['AP Only', 'Router Only', 'AP + Router'];
    document.getElementById('stat-mode').innerText = 'Mode: ' + (modeNames[d.wifiMode] || 'AP + Router');
    document.getElementById('stat-ip').innerText = d.staConnected ? d.staIp : d.apIp;
    document.getElementById('stat-ssid').innerText = 'SSID: ' + (d.staConnected ? d.staSsid : d.apSsid);
    
    // Uptime
    const sec = d.uptimeSec || 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    document.getElementById('stat-uptime').innerText = `${h}h ${m}m ${s}s`;
    document.getElementById('stat-time').innerText = 'NTP: ' + (d.formattedTime || 'Not Synced');

    // Heap & Flash
    document.getElementById('stat-heap').innerText = Math.round((d.freeHeap || 0) / 1024) + ' KB';
    const fsUsed = Math.round((d.fsUsed || 0) / 1024);
    const fsTotal = Math.round((d.fsTotal || 0) / 1024);
    document.getElementById('stat-flash').innerText = `Storage: ${fsUsed}/${fsTotal} KB`;

    // System Diagnostics Tab
    const setElem = (id, val, isHtml = false) => {
      const el = document.getElementById(id);
      if (el) {
        if (isHtml) el.innerHTML = val;
        else el.innerText = val;
      }
    };

    const fmtDuration = (sSec) => {
      if (!sSec || sSec <= 0) return '0s';
      const days = Math.floor(sSec / 86400);
      const hours = Math.floor((sSec % 86400) / 3600);
      const mins = Math.floor((sSec % 3600) / 60);
      const secs = sSec % 60;
      const p = [];
      if (days > 0) p.push(`${days}d`);
      if (hours > 0 || days > 0) p.push(`${hours}h`);
      if (mins > 0 || hours > 0 || days > 0) p.push(`${mins}m`);
      p.push(`${secs}s`);
      return p.join(' ');
    };

    // Diagnostics Quick Summary Cards
    setElem('diag-uptime', fmtDuration(d.uptimeSec));
    setElem('diag-uptime-raw', `Raw: ${d.uptimeSec || 0}s`);
    setElem('diag-boot-count', `${d.bootCount || 1}`);
    setElem('diag-heap-cur', `${Math.round((d.freeHeap || 0) / 1024)} KB`);
    setElem('diag-heap-min', `Min: ${Math.round((d.minFreeHeap || d.freeHeap || 0) / 1024)} KB`);
    setElem('diag-fs-summary', `${fsUsed}/${fsTotal} KB`);
    setElem('diag-fs-free-sub', `Free: ${Math.round((d.fsFree || 0) / 1024)} KB (${100 - (d.fsPercent || 0)}%)`);

    // 1. Reset & Boot Diagnostics
    setElem('diag-reset-reason', d.resetReason || 'Unknown');
    setElem('diag-reset-details', d.resetDetails || d.resetReason || 'Normal boot');
    setElem('diag-reset-raw', d.resetRaw || 'None');
    setElem('diag-restarts', `${d.bootCount || 1}`);
    setElem('diag-uptime-full', `${fmtDuration(d.uptimeSec)} (${d.uptimeSec || 0} seconds)`);

    // 2. RAM & Heap Memory Diagnostics
    setElem('diag-free-heap', `${d.freeHeap || 0} bytes (${Math.round((d.freeHeap || 0) / 1024)} KB)`);
    setElem('diag-min-free-heap', `${d.minFreeHeap || d.freeHeap || 0} bytes (${Math.round((d.minFreeHeap || d.freeHeap || 0) / 1024)} KB)`);
    setElem('diag-max-block', `${d.maxFreeBlock || 0} bytes (${Math.round((d.maxFreeBlock || 0) / 1024)} KB)`);
    setElem('diag-heap-frag', `${d.heapFragPercent !== undefined ? d.heapFragPercent : 0}% fragmentation`);

    // 3. Flash & LittleFS Storage
    const flashRealMb = Math.round((d.flashSize || 0) / (1024 * 1024));
    setElem('diag-flash-real', `${Math.round((d.flashSize || 0) / 1024)} KB (${flashRealMb} MB) [Configured: ${Math.round((d.flashConfigSize || 0) / 1024)} KB]`);
    setElem('diag-flash-speed-mode', `${Math.round((d.flashSpeed || 40000000) / 1000000)} MHz &bull; ${d.flashMode || 'QIO'}`, true);
    setElem('diag-flash-id', `0x${d.flashChipId || '0000'}`);
    setElem('diag-sketch-size', `${Math.round((d.sketchSize || 0) / 1024)} KB`);
    setElem('diag-sketch-free', `${Math.round((d.freeSketchSpace || 0) / 1024)} KB`);
    setElem('diag-fs-total', `${fsTotal} KB (${d.fsTotal || 0} bytes)`);
    setElem('diag-fs-used', `${fsUsed} KB (${d.fsUsed || 0} bytes)`);
    setElem('diag-fs-free', `${Math.round((d.fsFree || 0) / 1024)} KB (${d.fsFree || 0} bytes)`);
    setElem('diag-fs-percent', `${d.fsPercent || 0}% used &bull; ${100 - (d.fsPercent || 0)}% available`, true);

    // 4. Wi-Fi & Network Diagnostics
    setElem('diag-wifi-mode', modeNames[d.wifiMode] || 'AP + Router');
    setElem('diag-wifi-ssid', d.staConnected ? d.staSsid : '(Not connected)');
    let rssiQuality = 'N/A';
    if (d.staConnected) {
      const r = d.rssi || 0;
      const qual = r >= -60 ? 'Excellent' : r >= -70 ? 'Good' : r >= -80 ? 'Fair' : 'Weak';
      rssiQuality = `${r} dBm (${qual})`;
    }
    setElem('diag-wifi-rssi', rssiQuality);
    setElem('diag-wifi-uptime', d.staConnected ? fmtDuration(d.wifiUptimeSec) : 'Offline');
    setElem('diag-ip-mode', d.useStaticIp ? 'Static IP (Manual)' : 'DHCP Client (Automatic)');
    setElem('diag-sta-ip', d.staConnected ? d.staIp : 'N/A');
    setElem('diag-gateway', d.staConnected ? (d.staGateway || '0.0.0.0') : 'N/A');
    setElem('diag-subnet', d.staConnected ? (d.staSubnet || '255.255.255.0') : 'N/A');
    const dnsStr = (d.dns1 || d.dns2) ? `${d.dns1 || 'None'} / ${d.dns2 || 'None'}` : 'Router Assigned';
    setElem('diag-dns', dnsStr);
    setElem('diag-ap-info', d.apActive ? `SSID: ${d.apSsid} &bull; IP: ${d.apIp}` : 'AP Disabled', true);
    setElem('diag-mac', d.mac || 'N/A');

    // 5. Microcontroller Platform & Software
    setElem('diag-dev-name', d.deviceName || 'SmartHome-NodeMCU');
    setElem('diag-fw-ver', `v${d.firmwareVersion || '1.5.0'}`);
    setElem('diag-core-ver', `Arduino ESP8266 Core v${d.coreVersion || '3.1.2'}`);
    setElem('diag-sdk-ver', `Espressif Non-OS SDK ${d.sdkVersion || '2.2.2'}`);
    setElem('diag-cpu-freq', `${d.cpuFreq || 80} MHz`);
    setElem('diag-ntp-time', d.formattedTime || 'Not Synced');

    // Legacy Element Fallback (guarantees old cached HTML still displays values)
    setElem('info-fw-ver', `v${d.firmwareVersion || '1.4.0'}`);
    setElem('info-cpu-freq', `${d.cpuFreq || 80} MHz`);
    setElem('info-free-heap', `${d.freeHeap || 0} bytes (${Math.round((d.freeHeap || 0) / 1024)} KB)`);
    setElem('info-flash-total', `${Math.round((d.flashSize || 0) / 1024)} KB`);
    setElem('info-fs-used', `${fsUsed} KB`);
    setElem('info-fs-free', `${Math.round((d.fsFree || 0) / 1024)} KB`);
    setElem('info-mac', d.mac || '-');
    setElem('info-reset-reason', d.resetReason || '-');
  },

  // ==== GPIO MANAGEMENT ====
  async loadGpios(silent = false) {
    try {
      const res = await this.apiRequest('/api/gpio');
      if (res.ok) {
        this.channels = await res.json();
        this.renderGpios();
      }
    } catch (e) {
      if (!silent) console.error(e);
    }
  },

  renderGpios() {
    const overviewContainer = document.getElementById('overview-gpio-grid');
    const manageContainer = document.getElementById('gpio-cards-container');

    if (this.channels.length === 0) {
      overviewContainer.innerHTML = '<p class="placeholder-text">No GPIO outputs configured yet. Go to GPIO / Relays tab to add outputs.</p>';
      manageContainer.innerHTML = '<p class="placeholder-text">No GPIO outputs configured yet.</p>';
      return;
    }

    let ovHtml = '';
    let mgHtml = '';

    this.channels.forEach(ch => {
      const isOn = ch.state;
      const statusClass = isOn ? 'on' : '';
      const cardActiveClass = isOn ? 'active-on' : '';
      const stateText = isOn ? 'ON' : 'OFF';

      // Overview Card
      ovHtml += `
        <div class="gpio-card ${cardActiveClass}">
          <div class="gpio-card-top">
            <div class="gpio-title-group">
              <h4>${ch.name}</h4>
              <span class="gpio-meta">${ch.room} &bull; ${ch.function} (${ch.label})</span>
            </div>
            <div>
              <span class="gpio-status-indicator ${statusClass}"></span>
              <strong>${stateText}</strong>
            </div>
          </div>
          <div class="gpio-controls">
            <button class="btn ${isOn ? 'btn-danger' : 'btn-success'}" onclick="app.toggleGpio(${ch.id})">
              ${isOn ? 'Turn OFF' : 'Turn ON'}
            </button>
            <button class="btn btn-secondary" onclick="app.pulseGpio(${ch.id}, 500)">
              Pulse (0.5s)
            </button>
          </div>
        </div>
      `;

      // Management Card
      mgHtml += `
        <div class="gpio-card ${cardActiveClass}">
          <div class="gpio-card-top">
            <div class="gpio-title-group">
              <h4>${ch.name}</h4>
              <span class="gpio-meta">Pin: <strong>${ch.label}</strong> &bull; Room: <strong>${ch.room}</strong></span>
              <span class="gpio-meta">${ch.activeLow ? 'Active-Low (Relay)' : 'Active-High'} &bull; Boot: <strong>${ch.initialMode === 1 ? 'Always OFF' : ch.initialMode === 2 ? 'Always ON' : 'Restore Last State'}</strong></span>
              ${ch.bootSensitive ? `<span class="hint-text text-warning">⚠️ ${ch.note}</span>` : ''}
            </div>
            <div>
              <span class="gpio-status-indicator ${statusClass}"></span>
              <strong>${stateText}</strong>
            </div>
          </div>
          <div class="gpio-controls">
            <button class="btn ${isOn ? 'btn-danger' : 'btn-success'} btn-sm" onclick="app.toggleGpio(${ch.id})">
              ${isOn ? 'Turn OFF' : 'Turn ON'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="app.editGpio(${ch.id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="app.deleteGpio(${ch.id})">Delete</button>
          </div>
        </div>
      `;
    });

    overviewContainer.innerHTML = ovHtml;
    manageContainer.innerHTML = mgHtml;
  },

  async toggleGpio(id) {
    try {
      await this.apiRequest('/api/gpio/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, action: 'toggle' })
      });
      this.loadGpios(true);
    } catch (e) {}
  },

  async pulseGpio(id, durationMs) {
    try {
      await this.apiRequest('/api/gpio/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, action: 'pulse', duration: durationMs })
      });
      this.loadGpios(true);
    } catch (e) {}
  },

  openAddGpioModal() {
    document.getElementById('gpio-edit-id').value = '';
    document.getElementById('gpio-modal-title').innerText = 'Add New GPIO Channel';
    document.getElementById('gpio-pin-group').style.display = 'block';
    document.getElementById('gpio-name-input').value = '';
    document.getElementById('gpio-room-input').value = '';
    document.getElementById('gpio-func-select').value = 'Light';
    document.getElementById('gpio-active-low').checked = true;
    document.getElementById('gpio-init-mode').value = '0';
    document.getElementById('gpio-modal').classList.remove('hidden');
  },

  editGpio(id) {
    const ch = this.channels.find(c => c.id === id);
    if (!ch) return;

    document.getElementById('gpio-edit-id').value = ch.id;
    document.getElementById('gpio-modal-title').innerText = 'Edit GPIO Channel: ' + ch.name;
    document.getElementById('gpio-pin-group').style.display = 'none'; // Pin cannot be changed while editing
    document.getElementById('gpio-name-input').value = ch.name;
    document.getElementById('gpio-room-input').value = ch.room;
    document.getElementById('gpio-func-select').value = ch.function;
    document.getElementById('gpio-active-low').checked = ch.activeLow;
    document.getElementById('gpio-init-mode').value = ch.initialMode;
    document.getElementById('gpio-modal').classList.remove('hidden');
  },

  async saveGpioChannel() {
    const editId = document.getElementById('gpio-edit-id').value;
    const pin = parseInt(document.getElementById('gpio-pin-select').value);
    const name = document.getElementById('gpio-name-input').value.trim();
    const room = document.getElementById('gpio-room-input').value.trim();
    const func = document.getElementById('gpio-func-select').value;
    const activeLow = document.getElementById('gpio-active-low').checked;
    const initMode = parseInt(document.getElementById('gpio-init-mode').value);

    const payload = {
      name: name,
      room: room,
      function: func,
      activeLow: activeLow,
      initialMode: initMode
    };

    try {
      let res;
      if (editId) {
        payload.id = parseInt(editId);
        payload.enabled = true;
        res = await this.apiRequest('/api/gpio/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        payload.pin = pin;
        res = await this.apiRequest('/api/gpio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();
      if (data.success) {
        this.closeModal('gpio-modal');
        this.loadGpios();
      } else {
        alert(data.error || 'Failed to save channel');
      }
    } catch (e) {
      alert('Error saving GPIO channel');
    }
  },

  async deleteGpio(id) {
    if (!confirm('Are you sure you want to delete this GPIO channel configuration?')) return;
    try {
      const res = await this.apiRequest('/api/gpio/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      });
      const data = await res.json();
      if (data.success) {
        this.loadGpios();
      } else {
        alert(data.error || 'Failed to delete channel');
      }
    } catch (e) {
      alert('Error deleting GPIO channel');
    }
  },

  // ==== AUTOMATION RULES ====
  async loadRules() {
    try {
      const res = await this.apiRequest('/api/automation');
      if (res.ok) {
        this.rules = await res.json();
        this.renderRules();
      }
    } catch (e) {}
  },

  renderRules() {
    const container = document.getElementById('rules-container');
    if (this.rules.length === 0) {
      container.innerHTML = '<p class="placeholder-text">No automation rules created yet.</p>';
      return;
    }

    let html = '<div class="table-responsive"><table class="data-table"><thead><tr><th>Name</th><th>Type</th><th>Target</th><th>Details</th><th>Triggers</th><th>Status</th><th>Action</th></tr></thead><tbody>';

    const typeNames = ['Auto-Off Timer', 'Interlock Link', 'Daily Schedule'];

    this.rules.forEach(r => {
      const targetCh = this.channels.find(c => c.id === r.targetGpioId);
      const targetName = targetCh ? targetCh.name : 'Channel ' + r.targetGpioId;
      let details = '';

      if (r.type === 0) {
        details = `Turn OFF after ${r.param1}s`;
      } else if (r.type === 1) {
        const srcCh = this.channels.find(c => c.id === r.sourceGpioId);
        const srcName = srcCh ? srcCh.name : 'Channel ' + r.sourceGpioId;
        details = `When ${srcName} is ${r.condState ? 'ON' : 'OFF'} &rarr; Set ${r.targetState ? 'ON' : 'OFF'}`;
      } else if (r.type === 2) {
        const hh = String(Math.floor(r.param1 / 60)).padStart(2, '0');
        const mm = String(r.param1 % 60).padStart(2, '0');
        details = `Every day at ${hh}:${mm} &rarr; Turn ${r.targetState ? 'ON' : 'OFF'}`;
      }

      html += `
        <tr>
          <td><strong>${r.name}</strong></td>
          <td>${typeNames[r.type] || 'Rule'}</td>
          <td>${targetName}</td>
          <td>${details}</td>
          <td>${r.execCount || 0}</td>
          <td>
            <button class="btn btn-sm ${r.enabled ? 'btn-success' : 'btn-secondary'}" onclick="app.toggleRule(${r.id})">
              ${r.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="app.deleteRule(${r.id})">Delete</button>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  },

  openAddRuleModal() {
    // Populate select boxes with available GPIO channels
    const targetSel = document.getElementById('rule-target-select');
    const sourceSel = document.getElementById('rule-source-select');

    let opts = '';
    this.channels.forEach(ch => {
      opts += `<option value="${ch.id}">${ch.name} (${ch.room})</option>`;
    });

    targetSel.innerHTML = opts;
    sourceSel.innerHTML = opts;

    document.getElementById('rule-name-input').value = '';
    document.getElementById('rule-type-select').value = '0';
    this.handleRuleTypeChange('0');
    document.getElementById('rule-modal').classList.remove('hidden');
  },

  handleRuleTypeChange(typeVal) {
    const t = parseInt(typeVal);
    document.getElementById('rule-timer-fields').classList.toggle('hidden', t !== 0);
    document.getElementById('rule-interlock-fields').classList.toggle('hidden', t !== 1);
    document.getElementById('rule-schedule-fields').classList.toggle('hidden', t !== 2);
  },

  async saveRule() {
    const name = document.getElementById('rule-name-input').value.trim();
    const type = parseInt(document.getElementById('rule-type-select').value);
    const targetId = parseInt(document.getElementById('rule-target-select').value);

    let sourceId = 0;
    let condState = true;
    let targetState = false;
    let param1 = 0;

    if (type === 0) {
      param1 = parseInt(document.getElementById('rule-seconds-input').value) || 300;
      targetState = false; // Auto-off sets target to false
    } else if (type === 1) {
      sourceId = parseInt(document.getElementById('rule-source-select').value);
      condState = document.getElementById('rule-cond-state').value === '1';
      targetState = document.getElementById('rule-target-action').value === '1';
    } else if (type === 2) {
      const timeVal = document.getElementById('rule-time-input').value; // "HH:MM"
      const parts = timeVal.split(':');
      param1 = (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
      targetState = document.getElementById('rule-sched-action').value === '1';
    }

    try {
      const res = await this.apiRequest('/api/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          type: type,
          sourceGpioId: sourceId,
          targetGpioId: targetId,
          condState: condState,
          targetState: targetState,
          param1: param1
        })
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal('rule-modal');
        this.loadRules();
      } else {
        alert(data.error || 'Failed to save automation rule');
      }
    } catch (e) {
      alert('Error saving rule');
    }
  },

  async toggleRule(id) {
    try {
      await this.apiRequest('/api/automation/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      });
      this.loadRules();
    } catch (e) {}
  },

  async deleteRule(id) {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    try {
      const res = await this.apiRequest('/api/automation/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      });
      this.loadRules();
    } catch (e) {}
  },

  // ==== WI-FI CONFIGURATION ====
  handleIpModeChange(mode) {
    const fields = document.getElementById('static-ip-fields');
    if (!fields) return;
    if (mode === 'static') {
      fields.classList.remove('hidden');
      const curIpEl = document.getElementById('stat-ip');
      const curIp = curIpEl ? curIpEl.innerText : '';
      const ipInput = document.getElementById('wifi-static-ip');
      if (ipInput && (!ipInput.value || ipInput.value === '0.0.0.0') && curIp && curIp !== '0.0.0.0') {
        ipInput.value = curIp;
      }
    } else {
      fields.classList.add('hidden');
    }
  },

  async loadWifiStatus() {
    try {
      const res = await this.apiRequest('/api/wifi/status');
      if (res.ok) {
        const data = await res.json();
        // Set mode radio
        const modeRadio = document.querySelector(`input[name="wifi-mode"][value="${data.mode}"]`);
        if (modeRadio) modeRadio.checked = true;

        // Set IP assignment mode radio
        const isStatic = !!data.useStaticIp;
        const dhcpRadio = document.getElementById('ip-mode-dhcp');
        const staticRadio = document.getElementById('ip-mode-static');
        if (isStatic) {
          if (staticRadio) staticRadio.checked = true;
          this.handleIpModeChange('static');
        } else {
          if (dhcpRadio) dhcpRadio.checked = true;
          this.handleIpModeChange('dhcp');
        }

        if (data.staConnected || data.staSsid) {
          document.getElementById('wifi-ssid').value = data.staSsid || '';
        }

        // Prepopulate static IP configuration fields
        if (document.getElementById('wifi-static-ip')) {
          document.getElementById('wifi-static-ip').value = data.staticIp || (data.staConnected ? data.staIp : '');
        }
        if (document.getElementById('wifi-gateway')) {
          document.getElementById('wifi-gateway').value = data.staticGateway || (data.staConnected ? data.staGateway : '');
        }
        if (document.getElementById('wifi-subnet')) {
          document.getElementById('wifi-subnet').value = data.staticSubnet || (data.staConnected ? data.staSubnet : '255.255.255.0');
        }
        if (document.getElementById('wifi-dns1')) {
          document.getElementById('wifi-dns1').value = data.staticDns1 || data.dns1 || '8.8.8.8';
        }
        if (document.getElementById('wifi-dns2')) {
          document.getElementById('wifi-dns2').value = data.staticDns2 || data.dns2 || '1.1.1.1';
        }
      }
    } catch (e) {}
  },

  async saveWifiMode() {
    const sel = document.querySelector('input[name="wifi-mode"]:checked');
    if (!sel) return;
    const mode = parseInt(sel.value);

    try {
      const res = await this.apiRequest('/api/wifi/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode })
      });
      const data = await res.json();
      alert(data.message || 'Wi-Fi operating mode updated');
    } catch (e) {
      alert('Error updating Wi-Fi mode');
    }
  },

  async scanWifi() {
    const statusEl = document.getElementById('wifi-scan-status');
    const tableEl = document.getElementById('wifi-scan-table');
    const tbody = document.getElementById('wifi-scan-tbody');
    const btn = document.getElementById('scan-wifi-btn');

    btn.disabled = true;
    statusEl.innerText = 'Scanning for nearby Wi-Fi networks (may take 2-4 seconds)...';
    tableEl.classList.add('hidden');

    try {
      const res = await this.apiRequest('/api/wifi/scan');
      const list = await res.json();
      btn.disabled = false;

      if (!list || list.length === 0) {
        statusEl.innerText = 'No Wi-Fi networks found. Try scanning again.';
        return;
      }

      statusEl.innerText = `Found ${list.length} network(s):`;
      let rows = '';
      list.forEach(n => {
        const isSecure = n.encryption !== 'Open';
        rows += `
          <tr>
            <td><strong>${n.ssid}</strong> ${n.isHidden ? '<small>(Hidden)</small>' : ''}</td>
            <td>${n.rssi} dBm</td>
            <td>${isSecure ? '🔒 ' + n.encryption : '🔓 Open'}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="app.selectNetwork('${encodeURIComponent(n.ssid)}')">
                Select
              </button>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = rows;
      tableEl.classList.remove('hidden');
    } catch (e) {
      btn.disabled = false;
      statusEl.innerText = 'Failed to scan networks.';
    }
  },

  selectNetwork(encodedSsid) {
    const ssid = decodeURIComponent(encodedSsid);
    document.getElementById('wifi-ssid').value = ssid;
    document.getElementById('wifi-pass').focus();
  },

  async connectWifi() {
    const ssid = document.getElementById('wifi-ssid').value.trim();
    const pass = document.getElementById('wifi-pass').value;
    const ipModeEl = document.getElementById('ip-mode-static');
    const isStatic = ipModeEl ? ipModeEl.checked : false;
    const btn = document.getElementById('btn-connect-wifi');

    if (!ssid) {
      alert('Please enter or select a Wi-Fi SSID');
      return;
    }

    const getVal = (id, def = '') => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : def;
    };

    const payload = {
      ssid: ssid,
      password: pass,
      useStaticIp: isStatic,
      staticIp: getVal('wifi-static-ip'),
      staticGateway: getVal('wifi-gateway'),
      staticSubnet: getVal('wifi-subnet', '255.255.255.0'),
      staticDns1: getVal('wifi-dns1', '8.8.8.8'),
      staticDns2: getVal('wifi-dns2', '1.1.1.1')
    };

    if (isStatic && !payload.staticIp) {
      alert('Please enter a valid Static IP Address or choose DHCP mode.');
      return;
    }

    btn.disabled = true;
    btn.innerText = 'Connecting...';

    try {
      const res = await this.apiRequest('/api/wifi/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      alert(data.message || 'Connecting to network. Please check status in a few seconds.');
    } catch (e) {
      alert('Error initiating connection');
    } finally {
      btn.disabled = false;
      btn.innerText = 'Connect & Save';
    }
  },

  async saveIpConfigOnly() {
    const ipModeEl = document.getElementById('ip-mode-static');
    const isStatic = ipModeEl ? ipModeEl.checked : false;
    const getVal = (id, def = '') => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : def;
    };

    const payload = {
      useStaticIp: isStatic,
      staticIp: getVal('wifi-static-ip'),
      staticGateway: getVal('wifi-gateway'),
      staticSubnet: getVal('wifi-subnet', '255.255.255.0'),
      staticDns1: getVal('wifi-dns1', '8.8.8.8'),
      staticDns2: getVal('wifi-dns2', '1.1.1.1')
    };

    if (isStatic && !payload.staticIp) {
      alert('Please enter a valid Static IP Address.');
      return;
    }

    const btn = document.getElementById('btn-save-ip-only');
    if (btn) { btn.disabled = true; btn.innerText = 'Applying...'; }

    try {
      const res = await this.apiRequest('/api/wifi/ip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      alert(data.message || 'IP configuration updated.');
      this.loadWifiStatus();
      this.loadStatus();
    } catch (e) {
      alert('Failed to update IP configuration');
    } finally {
      if (btn) { btn.disabled = false; btn.innerText = '💾 Apply IP Settings Only'; }
    }
  },

  async resetWifi() {
    if (!confirm('Are you sure you want to clear saved Wi-Fi credentials? The device will start setup AP mode.')) return;
    try {
      await this.apiRequest('/api/wifi/reset', { method: 'POST' });
      alert('Wi-Fi credentials erased. Connect to "SmartHome-Setup" hotspot at 192.168.4.1.');
    } catch (e) {}
  },

  async syncNtp() {
    try {
      const res = await this.apiRequest('/api/settings/ntp-sync', { method: 'POST' });
      const data = await res.json();
      if (data.formattedTime) {
        alert(`NTP Time Synchronized!\nCurrent Time: ${data.formattedTime}`);
      } else {
        alert(data.message || 'NTP sync requested.');
      }
      this.loadStatus();
    } catch (e) {
      alert('Failed to synchronize NTP time. Check Wi-Fi router internet connection.');
    }
  },

  togglePassVisibility(id) {
    const el = document.getElementById(id);
    if (el) el.type = (el.type === 'password') ? 'text' : 'password';
  },

  // ==== SETTINGS ====
  async loadSettings() {
    this.loadReceiverSettings();
    try {
      const res = await this.apiRequest('/api/settings');
      if (res.ok) {
        const data = await res.json();
        document.getElementById('settings-device-name').value = data.deviceName || '';
        document.getElementById('settings-ap-ssid').value = data.apSsid || '';
        document.getElementById('settings-ap-pass').value = data.apPass || '';
        document.getElementById('settings-tz').value = data.timezoneOffset || '0';
      }
    } catch (e) {}
  },

  async saveSettings() {
    const payload = {
      deviceName: document.getElementById('settings-device-name').value.trim(),
      apSsid: document.getElementById('settings-ap-ssid').value.trim(),
      apPass: document.getElementById('settings-ap-pass').value,
      timezoneOffset: parseInt(document.getElementById('settings-tz').value)
    };

    try {
      const res = await this.apiRequest('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      alert(data.message || 'Settings saved successfully');
      this.loadStatus();
    } catch (e) {
      alert('Error saving settings');
    }
  },

  // ==== CENTRAL RECEIVER & MULTI-NODE TELEMETRY ====
  handleReceiverToggle(enabled) {
    const badge = document.getElementById('receiver-status-badge');
    if (badge) {
      badge.className = enabled ? 'badge badge-success' : 'badge badge-secondary';
      badge.innerText = enabled ? 'Active' : 'Disabled';
    }
  },

  handleReceiverProtoChange(proto) {
    const isHttp = parseInt(proto) === 0;
    const pathGroup = document.getElementById('recv-http-path-group');
    if (pathGroup) {
      pathGroup.style.display = isHttp ? 'block' : 'none';
    }
  },

  generateNodeId() {
    const macEl = document.getElementById('diag-mac');
    const mac = (macEl && macEl.innerText && macEl.innerText !== 'N/A') ? macEl.innerText.replace(/:/g, '') : '';
    const input = document.getElementById('recv-node-id');
    if (input) {
      input.value = mac ? 'NODE-' + mac : 'NODE-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }
  },

  async loadReceiverSettings() {
    try {
      const res = await this.apiRequest('/api/receiver');
      if (res.ok) {
        const d = await res.json();
        const enabledCheck = document.getElementById('recv-enabled');
        if (enabledCheck) enabledCheck.checked = !!d.enabled;
        this.handleReceiverToggle(d.enabled);

        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.value = val;
        };
        const setTxt = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.innerText = val;
        };

        setVal('recv-node-id', d.nodeId || '');
        setVal('recv-node-name', d.nodeName || '');
        setVal('recv-server-host', d.serverHost || '192.168.1.10');
        setVal('recv-server-port', d.serverPort || 2000);
        setVal('recv-http-path', d.httpPath || '/api/node/telemetry');
        setVal('recv-auth-token', d.authToken || '');
        setVal('recv-interval', d.reportIntervalSec || 10);

        const changeCheck = document.getElementById('recv-state-change');
        if (changeCheck) changeCheck.checked = (d.sendOnStateChange !== false);

        const proto = d.protocol || 0;
        const protoRadio = document.querySelector(`input[name="recv-proto"][value="${proto}"]`);
        if (protoRadio) protoRadio.checked = true;
        this.handleReceiverProtoChange(proto);

        // Diagnostics
        setTxt('recv-diag-target', d.serverEndpoint || '-');
        setTxt('recv-diag-status', d.lastSyncStatus || 'Not configured');
        setTxt('recv-diag-time', d.lastSyncTimestamp || 'Never');
        setTxt('recv-diag-sent', d.packetsSent || 0);
        setTxt('recv-diag-failed', d.packetsFailed || 0);
        setTxt('recv-diag-response', d.lastServerResponse || 'None');
      }
    } catch (e) {}
  },

  async saveReceiverSettings() {
    const protoRadio = document.querySelector('input[name="recv-proto"]:checked');
    const protoVal = protoRadio ? parseInt(protoRadio.value) : 0;
    const getVal = (id, def = '') => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : def;
    };

    const host = getVal('recv-server-host');
    if (!host) {
      alert('Please enter a valid Receiver Server Host or IP address');
      return;
    }

    const enabledEl = document.getElementById('recv-enabled');
    const changeEl = document.getElementById('recv-state-change');

    const payload = {
      enabled: enabledEl ? enabledEl.checked : false,
      serverHost: host,
      serverPort: parseInt(getVal('recv-server-port', '2000')) || 2000,
      protocol: protoVal,
      httpPath: getVal('recv-http-path', '/api/node/telemetry'),
      reportIntervalSec: parseInt(getVal('recv-interval', '10')) || 10,
      sendOnStateChange: changeEl ? changeEl.checked : true,
      nodeId: getVal('recv-node-id'),
      nodeName: getVal('recv-node-name'),
      authToken: getVal('recv-auth-token')
    };

    try {
      const res = await this.apiRequest('/api/receiver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      alert(data.message || 'Receiver configuration saved successfully');
      this.loadReceiverSettings();
    } catch (e) {
      alert('Failed to save receiver server settings');
    }
  },

  async testReceiverConnection() {
    const btn = document.getElementById('btn-test-receiver');
    if (btn) { btn.disabled = true; btn.innerText = 'Testing...'; }

    try {
      const res = await this.apiRequest('/api/receiver/test', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(`✅ Connection Successful!\n${data.message}\nServer Response: ${data.response || 'ACK'}`);
      } else {
        alert(`❌ Connection Test Failed!\n${data.message}`);
      }
      this.loadReceiverSettings();
    } catch (e) {
      alert('Error testing connection to receiver server. Make sure central server is listening.');
    } finally {
      if (btn) { btn.disabled = false; btn.innerText = '⚡ Test Connection Now'; }
    }
  },

  async pushTelemetryNow() {
    const btn = document.getElementById('btn-push-receiver');
    if (btn) { btn.disabled = true; btn.innerText = 'Pushing...'; }

    try {
      const res = await this.apiRequest('/api/receiver/push', { method: 'POST' });
      const data = await res.json();
      alert(data.message || (data.success ? 'Telemetry pushed successfully' : 'Push failed'));
      this.loadReceiverSettings();
    } catch (e) {
      alert('Error pushing telemetry');
    } finally {
      if (btn) { btn.disabled = false; btn.innerText = '📤 Push Telemetry Now'; }
    }
  },

  async reboot() {
    if (!confirm('Reboot SmartHome Controller now?')) return;
    try {
      await this.apiRequest('/api/system/reboot', { method: 'POST' });
      alert('Device is rebooting. Please wait 10 seconds and reload page.');
    } catch (e) {}
  },

  async factoryReset() {
    const confirmation = prompt('WARNING: This will wipe all Wi-Fi settings, GPIO channels, and rules!\nType "RESET" to confirm:');
    if (confirmation !== 'RESET') return;

    try {
      await this.apiRequest('/api/system/factory-reset', { method: 'POST' });
      alert('Factory reset complete. The device is restarting in setup AP mode.');
      window.location.reload();
    } catch (e) {}
  },

  // ==== ACCOUNT PASSWORD ====
  async changePassword() {
    const currPass = document.getElementById('curr-pass').value;
    const newPass = document.getElementById('new-pass').value;
    const confPass = document.getElementById('confirm-pass').value;

    if (newPass !== confPass) {
      alert('New passwords do not match');
      return;
    }

    try {
      const res = await this.apiRequest('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currPass, newPassword: newPass })
      });
      const data = await res.json();
      if (data.success) {
        alert('Password changed successfully! Please log in again.');
        this.logout();
      } else {
        alert(data.error || 'Failed to change password');
      }
    } catch (e) {
      alert('Error updating password');
    }
  },

  // ==== OTA FIRMWARE UPLOAD ====
  uploadOta() {
    const fileInput = document.getElementById('ota-file-input');
    const file = fileInput.files[0];
    if (!file) {
      alert('Please select a .bin firmware file');
      return;
    }

    if (!file.name.endsWith('.bin')) {
      alert('Invalid file format. File must end with .bin');
      return;
    }

    const progressContainer = document.getElementById('ota-progress-container');
    const progressBar = document.getElementById('ota-progress-bar');
    const statusMsg = document.getElementById('ota-status-msg');
    const submitBtn = document.getElementById('ota-submit-btn');

    progressContainer.classList.remove('hidden');
    submitBtn.disabled = true;
    statusMsg.innerText = 'Uploading firmware binary...';

    const formData = new FormData();
    formData.append('firmware', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/ota/upload', true);
    if (this.token) {
      xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
      xhr.setRequestHeader('X-Session-Token', this.token);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = pct + '%';
        progressBar.innerText = pct + '%';
      }
    };

    xhr.onload = () => {
      submitBtn.disabled = false;
      if (xhr.status === 200) {
        progressBar.style.width = '100%';
        progressBar.innerText = '100%';
        statusMsg.innerText = '✅ Firmware uploaded successfully! ESP8266 is rebooting now. Reconnecting in 15 seconds...';
        setTimeout(() => {
          window.location.reload();
        }, 15000);
      } else {
        try {
          const res = JSON.parse(xhr.responseText);
          statusMsg.innerText = '❌ Update failed: ' + (res.error || 'Upload error');
        } catch (e) {
          statusMsg.innerText = '❌ Update failed with HTTP ' + xhr.status;
        }
      }
    };

    xhr.onerror = () => {
      submitBtn.disabled = false;
      statusMsg.innerText = '❌ Network error during firmware upload';
    };

    xhr.send(formData);
  },

  // ==== LOGS ====
  async loadLogs() {
    const terminal = document.getElementById('log-terminal');
    try {
      const res = await this.apiRequest('/api/logs');
      if (res.ok) {
        const logs = await res.json();
        if (logs.length === 0) {
          terminal.innerText = 'No logs recorded yet.';
          return;
        }
        let txt = '';
        logs.forEach(l => {
          const sec = Math.floor(l.uptimeMs / 1000);
          txt += `[${sec}s] ${l.msg}\n`;
        });
        terminal.innerText = txt;
        terminal.scrollTop = terminal.scrollHeight;
      }
    } catch (e) {
      terminal.innerText = 'Failed to load system logs.';
    }
  },

  closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
