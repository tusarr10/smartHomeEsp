class AutomationEngine {
  constructor(nodeStore, breakerClient) {
    this.nodeStore = nodeStore;
    this.breakerClient = breakerClient;
    this.timer = null;
    this.cooldowns = new Map(); // ruleId -> timestamp

    this.init();
  }

  init() {
    // Listen for real-time sensor updates
    this.nodeStore.on('sensors_updated', ({ nodeId, sensors }) => {
      this.evaluateSensorTriggers(nodeId, sensors);
    });

    if (this.breakerClient) {
      this.breakerClient.on('reading', (reading) => {
        if (reading && reading.decoded) {
          this.evaluateBreakerTriggers(reading.decoded);
        }
      });
    }

    // Background timer for time-based triggers (evaluates once every 10 seconds)
    this.timer = setInterval(() => {
      this.evaluateTimeTriggers();
    }, 10000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  evaluateSensorTriggers(nodeId, sensors) {
    const rules = this.nodeStore.getAutomations();
    for (const rule of rules) {
      if (!rule.enabled || rule.trigger?.type !== 'SENSOR_THRESHOLD') continue;
      
      const targetSensor = sensors.find(s => s.type === rule.trigger.sensorType || s.name === rule.trigger.sensorName);
      if (!targetSensor) continue;

      const curVal = Number(targetSensor.value);
      const thresh = Number(rule.trigger.value);
      if (isNaN(curVal) || isNaN(thresh)) continue;

      let matched = false;
      if (rule.trigger.operator === '>' && curVal > thresh) matched = true;
      else if (rule.trigger.operator === '<' && curVal < thresh) matched = true;
      else if (rule.trigger.operator === '>=' && curVal >= thresh) matched = true;
      else if (rule.trigger.operator === '<=' && curVal <= thresh) matched = true;
      else if (rule.trigger.operator === '==' && curVal === thresh) matched = true;

      if (matched) {
        this.executeAction(rule, `Sensor ${targetSensor.name} (${curVal}) ${rule.trigger.operator} ${thresh}`);
      }
    }
  }

  evaluateBreakerTriggers(decoded) {
    const rules = this.nodeStore.getAutomations();
    for (const rule of rules) {
      if (!rule.enabled || rule.trigger?.type !== 'SENSOR_THRESHOLD') continue;

      let curVal = null;
      if (rule.trigger.sensorType === 'TEMPERATURE') curVal = decoded.temperature_c;
      else if (rule.trigger.sensorType === 'VOLTAGE') curVal = decoded.voltage_v;
      else if (rule.trigger.sensorType === 'CURRENT') curVal = decoded.current_a;
      else if (rule.trigger.sensorType === 'POWER') curVal = decoded.power_w;
      else if (rule.trigger.sensorType === 'LEAKAGE_CURRENT') curVal = decoded.leakage_current_ma;

      if (curVal === null || curVal === undefined) continue;

      const thresh = Number(rule.trigger.value);
      let matched = false;
      if (rule.trigger.operator === '>' && curVal > thresh) matched = true;
      else if (rule.trigger.operator === '<' && curVal < thresh) matched = true;

      if (matched) {
        this.executeAction(rule, `Breaker ${rule.trigger.sensorType} (${curVal}) ${rule.trigger.operator} ${thresh}`);
      }
    }
  }

  evaluateTimeTriggers() {
    const now = new Date();
    const currentHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    const rules = this.nodeStore.getAutomations();
    for (const rule of rules) {
      if (!rule.enabled || rule.trigger?.type !== 'TIME_SCHEDULE') continue;
      if (rule.trigger.time === currentHHMM) {
        this.executeAction(rule, `Scheduled time reached (${currentHHMM})`);
      }
    }
  }

  executeAction(rule, reason) {
    const now = Date.now();
    const lastRun = this.cooldowns.get(rule.id) || 0;
    // 30-second cooldown per rule to prevent flapping
    if (now - lastRun < 30000) return;

    this.cooldowns.set(rule.id, now);
    rule.lastTriggered = new Date().toISOString();
    this.nodeStore.saveAutomations();

    console.log(`[AutomationEngine] Triggered rule "${rule.name}" -> ${reason}`);

    if (rule.action?.type === 'SET_CHANNEL') {
      const { nodeId, channelId, value } = rule.action;
      if (nodeId && channelId !== undefined) {
        this.nodeStore.setChannelState(nodeId, channelId, Boolean(value));
      }
    } else if (rule.action?.type === 'SET_BREAKER') {
      const { value } = rule.action;
      if (this.breakerClient) {
        this.breakerClient.setSwitch(Boolean(value));
      }
    }
  }
}

module.exports = AutomationEngine;
