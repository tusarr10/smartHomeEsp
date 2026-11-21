#include "automation.h"
#include "gpio_manager.h"
#include "storage_manager.h"
#include "wifi_manager.h"

AutomationEngine::AutomationEngine()
    : _nextId(1),
      _tzOffsetSec(19800), // Default to Indian Standard Time (IST UTC+5:30)
      _lastNtpSyncAttempt(0) {}

AutomationEngine& AutomationEngine::getInstance() {
    static AutomationEngine instance;
    return instance;
}

bool AutomationEngine::begin() {
    loadFromStorage();
    syncNtp();
    return true;
}

void AutomationEngine::syncNtp() {
    if (WifiManager::getInstance().isSTAConnected()) {
        Serial.printf("[AUTO] Configuring NTP time synchronization (Offset: %+ld sec = %+0.1fh)...\n",
                      (long)_tzOffsetSec, (float)_tzOffsetSec / 3600.0f);
        // Use Google and reliable Asian/Indian NTP pools
        configTime(_tzOffsetSec, 0, "time.google.com", "in.pool.ntp.org", "asia.pool.ntp.org");
    }
}

bool AutomationEngine::isTimeSynced() const {
    time_t now = time(nullptr);
    return (now > 1600000000); // Valid timestamp after year 2020
}

String AutomationEngine::getFormattedTime() const {
    time_t now = time(nullptr);
    if (!isTimeSynced()) return F("Time not synced");

    struct tm* timeinfo = localtime(&now);
    char buf[48];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", timeinfo);
    if (_tzOffsetSec == 19800) {
        return String(buf) + F(" (IST)");
    }
    return String(buf);
}

void AutomationEngine::setTimezoneOffset(int32_t offsetSeconds) {
    _tzOffsetSec = offsetSeconds;
    syncNtp();
}

void AutomationEngine::notifyGpioStateChanged(uint8_t gpioId, bool newState) {
    for (auto& rule : _rules) {
        if (!rule.enabled) continue;

        if (rule.type == RULE_TIMER_AUTO_OFF) {
            if (rule.targetGpioId == gpioId) {
                if (newState) {
                    rule.timerExpiry = millis() + ((unsigned long)rule.param1 * 1000UL);
                    Serial.printf("[AUTO] Timer rule '%s' started: %u sec\n", rule.name.c_str(), rule.param1);
                } else {
                    rule.timerExpiry = 0; // Cancel if turned off manually
                }
            }
        } else if (rule.type == RULE_INTERLOCK) {
            if (rule.sourceGpioId == gpioId && newState == rule.conditionState) {
                Serial.printf("[AUTO] Interlock rule '%s' triggered\n", rule.name.c_str());
                GpioManager::getInstance().setState(rule.targetGpioId, rule.targetState);
                rule.executionCount++;
                saveToStorage();
            }
        }
    }
}

void AutomationEngine::loop() {
    unsigned long nowMs = millis();

    // Periodic NTP check (every 10s until synced, then every 30 minutes)
    unsigned long ntpInterval = isTimeSynced() ? 1800000UL : 10000UL;
    if (nowMs - _lastNtpSyncAttempt >= ntpInterval) {
        _lastNtpSyncAttempt = nowMs;
        if (WifiManager::getInstance().isSTAConnected()) {
            syncNtp();
        }
    }

    // Process Timer Rules
    for (auto& rule : _rules) {
        if (!rule.enabled) continue;

        if (rule.type == RULE_TIMER_AUTO_OFF && rule.timerExpiry > 0) {
            if (nowMs >= rule.timerExpiry) {
                rule.timerExpiry = 0;
                Serial.printf("[AUTO] Auto-off timer expired for '%s'\n", rule.name.c_str());
                GpioManager::getInstance().setState(rule.targetGpioId, false);
                rule.executionCount++;
                saveToStorage();
            }
        }
    }

    // Process Daily Schedule Rules (checked every second)
    static unsigned long lastScheduleCheck = 0;
    if (nowMs - lastScheduleCheck >= 1000) {
        lastScheduleCheck = nowMs;

        if (isTimeSynced()) {
            time_t nowTime = time(nullptr);
            struct tm* tinfo = localtime(&nowTime);
            uint32_t currentMinOfDay = tinfo->tm_hour * 60 + tinfo->tm_min;

            for (auto& rule : _rules) {
                if (!rule.enabled || rule.type != RULE_DAILY_SCHEDULE) continue;

                if (rule.param1 == currentMinOfDay) {
                    if (rule.lastTriggeredDay != tinfo->tm_yday) {
                        rule.lastTriggeredDay = tinfo->tm_yday;
                        Serial.printf("[AUTO] Schedule rule '%s' triggered at %02d:%02d\n",
                                      rule.name.c_str(), tinfo->tm_hour, tinfo->tm_min);
                        GpioManager::getInstance().setState(rule.targetGpioId, rule.targetState);
                        rule.executionCount++;
                        saveToStorage();
                    }
                }
            }
        }
    }
}

bool AutomationEngine::addRule(const String& name, uint8_t type, uint8_t sourceId, uint8_t targetId,
                              bool condState, bool targetState, uint32_t param1, String& outError) {
    if (_rules.size() >= MAX_AUTOMATION_RULES) {
        outError = F("Maximum automation rules reached (limit: 10)");
        return false;
    }

    if (type == RULE_INTERLOCK && sourceId == targetId) {
        outError = F("Source and Target GPIO cannot be identical in Interlock rule");
        return false;
    }

    AutomationRule r;
    r.id = _nextId++;
    r.name = (name.length() > 0) ? name : String(F("Rule ")) + String(r.id);
    r.type = type;
    r.enabled = true;
    r.sourceGpioId = sourceId;
    r.targetGpioId = targetId;
    r.conditionState = condState;
    r.targetState = targetState;
    r.param1 = param1;
    r.timerExpiry = 0;
    r.lastTriggeredDay = -1;
    r.executionCount = 0;

    _rules.push_back(r);
    saveToStorage();
    Serial.printf("[AUTO] Added Rule ID %u: %s\n", r.id, r.name.c_str());
    return true;
}

bool AutomationEngine::updateRule(uint8_t id, const String& name, bool enabled, uint8_t sourceId, uint8_t targetId,
                                 bool condState, bool targetState, uint32_t param1, String& outError) {
    for (auto& r : _rules) {
        if (r.id == id) {
            r.name = name;
            r.enabled = enabled;
            r.sourceGpioId = sourceId;
            r.targetGpioId = targetId;
            r.conditionState = condState;
            r.targetState = targetState;
            r.param1 = param1;
            saveToStorage();
            return true;
        }
    }
    outError = F("Rule ID not found");
    return false;
}

bool AutomationEngine::removeRule(uint8_t id) {
    for (auto it = _rules.begin(); it != _rules.end(); ++it) {
        if (it->id == id) {
            _rules.erase(it);
            saveToStorage();
            Serial.printf("[AUTO] Removed Rule ID %u\n", id);
            return true;
        }
    }
    return false;
}

bool AutomationEngine::toggleRule(uint8_t id) {
    for (auto& r : _rules) {
        if (r.id == id) {
            r.enabled = !r.enabled;
            r.timerExpiry = 0;
            saveToStorage();
            return true;
        }
    }
    return false;
}

void AutomationEngine::toJson(JsonArray& arr) {
    for (const auto& r : _rules) {
        JsonObject obj = arr.createNestedObject();
        obj["id"] = r.id;
        obj["name"] = r.name;
        obj["type"] = r.type;
        obj["enabled"] = r.enabled;
        obj["sourceGpioId"] = r.sourceGpioId;
        obj["targetGpioId"] = r.targetGpioId;
        obj["condState"] = r.conditionState;
        obj["targetState"] = r.targetState;
        obj["param1"] = r.param1;
        obj["execCount"] = r.executionCount;
    }
}

void AutomationEngine::loadFromStorage() {
    // Load timezone from system config
    DynamicJsonDocument sysDoc(512);
    if (StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, sysDoc)) {
        if (sysDoc.containsKey("tzOffset")) {
            _tzOffsetSec = sysDoc["tzOffset"].as<int32_t>();
        } else {
            _tzOffsetSec = 19800; // Default to IST (UTC+5:30)
        }
    } else {
        _tzOffsetSec = 19800;
    }

    DynamicJsonDocument doc(2048);
    if (!StorageManager::getInstance().loadJsonFile(FILE_RULES_CONFIG, doc)) {
        return;
    }

    _rules.clear();
    uint8_t maxId = 0;
    JsonArray arr = doc.as<JsonArray>();
    for (JsonObject obj : arr) {
        AutomationRule r;
        r.id = obj["id"] | 1;
        r.name = obj["name"] | "Rule";
        r.type = obj["type"] | 0;
        r.enabled = obj["enabled"] | true;
        r.sourceGpioId = obj["sourceGpioId"] | 0;
        r.targetGpioId = obj["targetGpioId"] | 0;
        r.conditionState = obj["condState"] | true;
        r.targetState = obj["targetState"] | false;
        r.param1 = obj["param1"] | 0;
        r.timerExpiry = 0;
        r.lastTriggeredDay = -1;
        r.executionCount = obj["execCount"] | 0;

        if (r.id > maxId) maxId = r.id;
        _rules.push_back(r);
    }
    _nextId = maxId + 1;
}

void AutomationEngine::saveToStorage() {
    DynamicJsonDocument doc(2048);
    JsonArray arr = doc.to<JsonArray>();
    toJson(arr);
    StorageManager::getInstance().saveJsonFile(FILE_RULES_CONFIG, doc);
}
