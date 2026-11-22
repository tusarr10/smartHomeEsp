// Smart Circuit Breaker Local Test Application Client

const DP_CATALOG = {
  "17": { code: "add_ele / forward_energy", type: "Integer", unit: "kWh", desc: "Forward incremental energy meter" },
  "26": { code: "fault", type: "Bitmap", unit: "Bitmask", desc: "Hardware safety fault & trip diagnostic register" },
  "38": { code: "relay_status", type: "Enum", unit: "0/1/2/memory", desc: "Power-on recovery state after AC mains power cut" },
  "40": { code: "child_lock", type: "Boolean", unit: "bool", desc: "Maintenance Lock - inhibits remote closing during electrical work" },
  "101": { code: "total_forward_energy", type: "Integer", unit: "0.01 kWh", desc: "Permanent cumulative forward energy reading" },
  "102": { code: "phase_telemetry", type: "Raw / Base64", unit: "V, A, W", desc: "High-speed 8-byte live telemetry stream" },
  "103": { code: "switch", type: "Boolean", unit: "bool", desc: "Main Breaker Contact state (True = Closed/ON, False = Open/OFF)" },
  "105": { code: "reactive_power", type: "Integer", unit: "VAr", desc: "Reactive power reading" },
  "107": { code: "reverse_energy", type: "Integer", unit: "kWh", desc: "Reverse energy export / solar generation total" },
  "108": { code: "breaker_ready", type: "Boolean", unit: "bool", desc: "Internal controller readiness & self-test OK" },
  "111": { code: "hardware_model", type: "String", unit: "str", desc: "Internal factory model revision string (KB-A1H-A)" },
  "112": { code: "supply_frequency", type: "Integer", unit: "0.1 Hz", desc: "AC Mains line frequency (e.g. 500 = 50.0 Hz)" },
  "113": { code: "phase_angle", type: "Integer", unit: "deg", desc: "Phase angle displacement" },
  "114": { code: "temperature", type: "Integer", unit: "°C", desc: "Internal circuit breaker heatsink / core temperature" },
  "115": { code: "signal_quality", type: "Integer", unit: "%", desc: "Internal Wi-Fi signal & bus telemetry health" },
  "116": { code: "surge_count", type: "Integer", unit: "count", desc: "Recorded voltage transient / surge events" },
  "117": { code: "trip_count", type: "Integer", unit: "count", desc: "Permanent mechanical trip & switching cycle count" },
  "118": { code: "reclosing_recovery_sec", type: "Integer", unit: "seconds", desc: "Auto-reclose delay time parameter" },
  "119": { code: "reclosing_enable", type: "Boolean", unit: "bool", desc: "Auto-reclosing function master enable" },
  "121": { code: "overvoltage_threshold", type: "Integer", unit: "V", desc: "Over-voltage trip threshold value" },
  "123": { code: "undervoltage_threshold", type: "Integer", unit: "V", desc: "Under-voltage trip threshold value" },
  "126": { code: "leakage_current_ma", type: "Integer", unit: "mA", desc: "Residual earth leakage current measurement" },
  "127": { code: "leakage_protect_enable", type: "Boolean", unit: "bool", desc: "Earth leakage trip protection master enable" },
  "129": { code: "leakage_recovery_sec", type: "Integer", unit: "seconds", desc: "Leakage alarm recovery delay before reclosing" },
  "130": { code: "overcurrent_threshold", type: "Integer", unit: "A", desc: "Continuous overcurrent trip limit" },
  "131": { code: "overcurrent_trip_delay", type: "Integer", unit: "seconds", desc: "Overcurrent trip delay timer" },
  "132": { code: "leakage_trip_threshold", type: "Integer", unit: "mA", desc: "Earth leakage current trip threshold (e.g. 30 mA)" },
  "133": { code: "reclose_max_times", type: "Integer", unit: "count", desc: "Maximum allowable auto-reclosing attempts" }
};

let currentStatus = null;
let pendingToggleState = null;
let pollTimer = null;

// Initialize Dashboard
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupEventListeners();
  loadStatus();
  // Poll every 4 seconds
  pollTimer = setInterval(loadStatus, 4000);
});

function setupTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

      tab.classList.add("active");
      const target = document.getElementById(tab.getAttribute("data-tab"));
      if (target) target.classList.add("active");
    });
  });
}

function setupEventListeners() {
  document.getElementById("refresh-btn").addEventListener("click", () => {
    forceRefresh();
  });

  document.getElementById("settings-btn").addEventListener("click", openSettingsModal);

  document.getElementById("dismiss-banner").addEventListener("click", () => {
    document.getElementById("banner-notice").style.display = "none";
  });

  document.getElementById("breaker-toggle-btn").addEventListener("click", () => {
    const isCurrentlyOn = currentStatus?.reading?.decoded?.switch_state ?? true;
    promptBreakerToggle(!isCurrentlyOn);
  });

  document.getElementById("safety-modal-confirm-btn").addEventListener("click", () => {
    if (pendingToggleState !== null) {
      executeToggle(pendingToggleState);
      closeSafetyModal();
    }
  });

  document.getElementById("lock-toggle-btn").addEventListener("click", toggleChildLock);

  document.getElementById("power-on-select").addEventListener("change", (e) => {
    sendControl("38", e.target.value);
  });

  document.getElementById("countdown-set-btn").addEventListener("click", () => {
    const val = parseInt(document.getElementById("countdown-val").value);
    if (!isNaN(val) && val > 0) {
      sendControl("countdown", val);
      alert(`Countdown timer set for ${val} seconds.`);
    }
  });

  document.getElementById("apply-thresholds-btn").addEventListener("click", applyThresholds);

  document.getElementById("send-custom-dp-btn").addEventListener("click", () => {
    const dp = document.getElementById("custom-dp-id").value.trim();
    const valStr = document.getElementById("custom-dp-val").value.trim();
    if (!dp) return;
    let val = valStr;
    if (valStr.toLowerCase() === "true") val = true;
    else if (valStr.toLowerCase() === "false") val = false;
    else if (!isNaN(Number(valStr))) val = Number(valStr);

    sendControl(dp, val);
  });

  document.getElementById("settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettings();
  });
}

async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) throw new Error("Failed to fetch status");
    currentStatus = await res.json();
    renderUI(currentStatus);
  } catch (err) {
    console.error("Poll error:", err);
  }
}

async function forceRefresh() {
  const btn = document.getElementById("refresh-btn");
  btn.disabled = true;
  btn.innerText = "⏳ Polling...";
  try {
    const res = await fetch("/api/refresh", { method: "POST" });
    const data = await res.json();
    if (data.reading) {
      currentStatus.reading = data.reading;
      renderUI(currentStatus);
    }
  } catch (err) {
    console.error("Refresh error:", err);
  } finally {
    btn.disabled = false;
    btn.innerText = "🔄 Refresh Now";
  }
}

function renderUI(data) {
  const cfg = data.config || {};
  const rd = data.reading || {};
  const dec = rd.decoded || {};
  const dps = rd.dps || {};

  // Device headers
  document.getElementById("device-title").innerHTML = `${cfg.device_name || "Wi-Fi Smart Circuit Breaker"} <span id="model-badge" class="badge badge-ref">${dec.model_str || "KB-A1H-A"}</span>`;
  document.getElementById("device-ip-label").innerText = `IP: ${cfg.ip_address || "—"}`;
  document.getElementById("device-id-label").innerText = `ID: ${cfg.device_id || "—"}`;

  // Connection badge
  const connBadge = document.getElementById("conn-badge");
  const connText = document.getElementById("conn-status-text");
  if (rd.online) {
    connBadge.className = "badge badge-live";
    connText.innerText = "Live LAN (Local)";
  } else {
    connBadge.className = "badge badge-ref";
    connText.innerText = cfg.simulation_mode ? "Simulated Mode" : "Reference Data";
  }

  // Telemetry timestamp
  document.getElementById("telemetry-time").innerText = rd.timestamp || new Date().toLocaleTimeString();

  // Breaker Switch State
  const switchBtn = document.getElementById("breaker-toggle-btn");
  const switchStateText = document.getElementById("switch-state-text");
  const switchDesc = document.getElementById("switch-desc");

  const isOn = dec.switch_state ?? true;
  if (isOn) {
    switchBtn.className = "breaker-power-btn state-on";
    switchStateText.innerText = "CIRCUIT CLOSED (ON)";
    switchStateText.style.color = "#34d399";
    switchDesc.innerText = "Main contacts are closed. Mains electricity is flowing safely through the breaker.";
  } else {
    switchBtn.className = "breaker-power-btn state-off";
    switchStateText.innerText = "CIRCUIT OPEN (TRIPPED / OFF)";
    switchStateText.style.color = "#f87171";
    switchDesc.innerText = "Main contacts are disconnected. Power to downstream appliances is cut.";
  }

  // Maintenance Lock (Child Lock)
  const lockBtn = document.getElementById("lock-toggle-btn");
  if (dec.child_lock) {
    lockBtn.className = "btn btn-danger";
    lockBtn.innerText = "🔒 Locked (Maintenance Active)";
  } else {
    lockBtn.className = "btn";
    lockBtn.innerText = "🔓 Unlocked (Normal)";
  }

  // Power-on behavior dropdown
  const pwrSelect = document.getElementById("power-on-select");
  if (dec.power_on_behavior) {
    pwrSelect.value = dec.power_on_behavior;
  }

  // Live Metrics
  document.getElementById("metric-voltage").innerText = dec.voltage_v != null ? dec.voltage_v.toFixed(1) : "—";
  document.getElementById("metric-current").innerText = dec.current_a != null ? dec.current_a.toFixed(3) : "—";
  
  // Leakage Current (mA)
  const leakageVal = dec.leakage_current_ma != null ? dec.leakage_current_ma : (dps["126"] != null ? parseInt(dps["126"]) : 0);
  const leakageThresh = dec.leakage_threshold_ma || (dps["132"] != null ? parseInt(dps["132"]) : 30);
  document.getElementById("metric-leakage").innerText = leakageVal;
  document.getElementById("leakage-limit-tag").innerText = leakageThresh;
  const leakageTag = document.getElementById("leakage-status-tag");
  if (leakageVal >= leakageThresh && leakageThresh > 0) {
    leakageTag.innerHTML = `<span style="color: #ef4444; font-weight: bold;">⚠️ TRIP (&ge; ${leakageThresh}mA)</span>`;
  } else {
    leakageTag.innerHTML = `Safe (&lt; ${leakageThresh}mA)`;
    leakageTag.style.color = "#34d399";
  }

  document.getElementById("metric-power-kw").innerText = dec.power_kw != null ? dec.power_kw.toFixed(3) : "—";
  document.getElementById("metric-power-w").innerText = `${dec.power_w ?? "—"} W`;
  document.getElementById("metric-energy").innerText = dec.total_energy_kwh != null ? dec.total_energy_kwh.toFixed(2) : "—";
  document.getElementById("metric-frequency").innerText = dec.frequency_hz != null ? dec.frequency_hz.toFixed(1) : "—";
  document.getElementById("metric-temp").innerText = dec.temperature_c ?? "—";
  document.getElementById("metric-pf").innerText = dec.power_factor != null ? dec.power_factor.toFixed(3) : "—";
  document.getElementById("metric-va").innerText = dec.apparent_power_va != null ? dec.apparent_power_va.toFixed(1) : "—";

  // Update Threshold Inputs if not focused
  if (document.activeElement !== document.getElementById("th-leakage") && dps["132"] != null) {
    document.getElementById("th-leakage").value = dps["132"];
  }
  if (document.activeElement !== document.getElementById("th-leakage-delay") && dps["129"] != null) {
    document.getElementById("th-leakage-delay").value = dps["129"];
  }
  if (document.activeElement !== document.getElementById("th-overcurrent") && dps["130"] != null) {
    document.getElementById("th-overcurrent").value = dps["130"];
  }
  if (document.activeElement !== document.getElementById("th-reclose-times") && dps["133"] != null) {
    document.getElementById("th-reclose-times").value = dps["133"];
  }
  if (document.activeElement !== document.getElementById("th-reclose-delay") && dps["118"] != null) {
    document.getElementById("th-reclose-delay").value = dps["118"];
  }

  // Alarms & Faults Grid (DP 26)
  renderAlarms(dec.fault_raw, dec.faults || {});

  // DP Explorer Table
  renderDpTable(dps);
}

function renderAlarms(faultRaw, faults) {
  document.getElementById("fault-raw-label").innerText = `Raw Register: 0x${(faultRaw || 0).toString(16).toUpperCase().padStart(4, "0")} (${faultRaw || 0})`;

  const alarmMap = {
    "leakage_alarm": "alarm-leakage",
    "overcurrent_alarm": "alarm-overcurrent",
    "overvoltage_alarm": "alarm-overvoltage",
    "undervoltage_alarm": "alarm-undervoltage",
    "high_temp_alarm": "alarm-high-temp",
    "overpower_alarm": "alarm-overload",
    "phase_loss_alarm": "alarm-phase-loss",
    "unbalance_alarm": "alarm-unbalance",
    "outage_alarm": "alarm-outage",
    "relay_failure_alarm": "alarm-relay-fault"
  };

  for (const [key, elementId] of Object.entries(alarmMap)) {
    const el = document.getElementById(elementId);
    if (el) {
      if (faults[key]) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    }
  }
}

function renderDpTable(dps) {
  const tbody = document.getElementById("dp-table-body");
  const keys = Object.keys(dps).sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  let html = "";
  for (const dp of keys) {
    const val = dps[dp];
    const cat = DP_CATALOG[dp] || {
      code: `DP_${dp}`,
      type: typeof val,
      unit: "—",
      desc: "Device datapoint"
    };

    html += `
      <tr>
        <td><span class="dp-code">DP ${dp}</span></td>
        <td><strong>${cat.code}</strong></td>
        <td><span style="color: var(--text-muted);">${cat.type}</span></td>
        <td><strong style="color: #38bdf8;">${JSON.stringify(val)}</strong></td>
        <td>${cat.unit}</td>
        <td><small style="color: var(--text-muted);">${cat.desc}</small></td>
      </tr>
    `;
  }
  tbody.innerHTML = html;
}

// Switching with Safety Modal
function promptBreakerToggle(targetState) {
  pendingToggleState = targetState;
  const modal = document.getElementById("safety-modal");
  const title = document.getElementById("safety-modal-title");
  const msg = document.getElementById("safety-modal-msg");
  const confirmBtn = document.getElementById("safety-modal-confirm-btn");

  if (targetState === true) {
    title.innerText = "⚠️ Confirm Closing Circuit (Power ON)";
    msg.innerText = "Turning the circuit breaker ON will energize all downstream electrical lines. Please confirm that NO electrical maintenance or appliance wiring is in progress!";
    confirmBtn.className = "btn btn-primary";
    confirmBtn.innerText = "⚡ Close Breaker (Turn ON)";
  } else {
    title.innerText = "⚠️ Confirm Opening Circuit (Power OFF)";
    msg.innerText = "Turning the circuit breaker OFF will cut electrical power to all downstream devices in this circuit. Are you sure you want to shut down power now?";
    confirmBtn.className = "btn btn-danger";
    confirmBtn.innerText = "🛑 Trip / Open Breaker (Turn OFF)";
  }

  modal.classList.add("open");
}

function closeSafetyModal() {
  document.getElementById("safety-modal").classList.remove("open");
  pendingToggleState = null;
}

async function executeToggle(state) {
  try {
    const res = await fetch("/api/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(`Action blocked: ${result.detail || "Error"}`);
    } else {
      loadStatus();
    }
  } catch (err) {
    alert(`Failed to execute toggle: ${err}`);
  }
}

async function toggleChildLock() {
  const current = currentStatus?.reading?.decoded?.child_lock ?? false;
  const newLock = !current;
  if (newLock && !confirm("Activating Maintenance Lock will FORCE the breaker OFF and prohibit closing until unlocked. Proceed?")) {
    return;
  }
  await sendControl("40", newLock);
  if (newLock) {
    // If locked, also open the breaker
    await sendControl("103", false);
  }
}

async function sendControl(dp, value) {
  try {
    const res = await fetch("/api/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dp, value })
    });
    const result = await res.json();
    loadStatus();
    return result;
  } catch (err) {
    console.error("Control error:", err);
  }
}

async function applyThresholds() {
  const overcurr = parseInt(document.getElementById("th-overcurrent").value);
  const overcurrDelay = parseInt(document.getElementById("th-overcurrent-delay").value);
  const leakage = parseInt(document.getElementById("th-leakage").value);
  const leakageDelay = parseInt(document.getElementById("th-leakage-delay").value);
  const recloseTimes = parseInt(document.getElementById("th-reclose-times").value);
  const recloseDelay = parseInt(document.getElementById("th-reclose-delay").value);

  const btn = document.getElementById("apply-thresholds-btn");
  btn.disabled = true;
  btn.innerText = "⏳ Applying...";

  try {
    if (!isNaN(leakage)) await sendControl("132", leakage);
    if (!isNaN(leakageDelay)) await sendControl("129", leakageDelay);
    if (!isNaN(overcurr)) await sendControl("130", overcurr);
    if (!isNaN(overcurrDelay)) await sendControl("131", overcurrDelay);
    if (!isNaN(recloseTimes)) await sendControl("133", recloseTimes);
    if (!isNaN(recloseDelay)) await sendControl("118", recloseDelay);

    alert(`✅ Successfully updated hardware thresholds on breaker:\n- Residual Leakage: ${leakage} mA\n- Leakage Recovery Delay: ${leakageDelay} s\n- Overcurrent Limit: ${overcurr} A\n- Reclosing Max Count: ${recloseTimes}`);
  } catch (err) {
    alert(`Failed to apply thresholds: ${err}`);
  } finally {
    btn.disabled = false;
    btn.innerText = "💾 Save & Apply Thresholds Locally";
    loadStatus();
  }
}

// Settings Modal
function openSettingsModal() {
  const cfg = currentStatus?.config || {};
  document.getElementById("cfg-ip").value = cfg.ip_address || "192.168.1.164";
  document.getElementById("cfg-id").value = cfg.device_id || "d7298b9bb3bcdd3d26wfpj";
  document.getElementById("cfg-key").value = cfg.local_key || ">U>Si=K$<|1[J$')";
  document.getElementById("cfg-ver").value = String(cfg.protocol_version || "3.5");
  document.getElementById("cfg-sim").checked = Boolean(cfg.simulation_mode);

  document.getElementById("settings-modal").classList.add("open");
}

function closeSettingsModal() {
  document.getElementById("settings-modal").classList.remove("open");
}

async function saveSettings() {
  const ip = document.getElementById("cfg-ip").value.trim();
  const id = document.getElementById("cfg-id").value.trim();
  const key = document.getElementById("cfg-key").value.trim();
  const ver = parseFloat(document.getElementById("cfg-ver").value);
  const sim = document.getElementById("cfg-sim").checked;

  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ip_address: ip,
        device_id: id,
        local_key: key,
        protocol_version: ver,
        simulation_mode: sim
      })
    });
    if (res.ok) {
      closeSettingsModal();
      loadStatus();
      alert("Settings updated successfully!");
    }
  } catch (err) {
    alert(`Failed to save settings: ${err}`);
  }
}
