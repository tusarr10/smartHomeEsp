#ifndef AUTOMATION_H
#define AUTOMATION_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>
#include <time.h>
#include "config.h"

enum RuleType {
    RULE_TIMER_AUTO_OFF = 0,    // When Target turns ON, turn it OFF after param1 seconds
    RULE_INTERLOCK      = 1,    // When Source becomes condState, set Target to targetState
    RULE_DAILY_SCHEDULE = 2     // Every day at param1 (minutes from 00:00), set Target to targetState
};

struct AutomationRule {
    uint8_t id;
    String name;
    uint8_t type;               // RuleType
    bool enabled;
    uint8_t sourceGpioId;       // Used for Interlock
    uint8_t targetGpioId;       // Target GPIO channel
    bool conditionState;        // Trigger condition
    bool targetState;           // Target outcome
    uint32_t param1;            // Timer seconds or minutes past midnight (0..1439)
    unsigned long timerExpiry;  // Internal runtime state (0 = inactive)
    int lastTriggeredDay;       // To avoid re-triggering within the same minute
    uint32_t executionCount;
};

class AutomationEngine {
public:
    static AutomationEngine& getInstance();

    bool begin();
    void loop();

    void notifyGpioStateChanged(uint8_t gpioId, bool newState);

    bool addRule(const String& name, uint8_t type, uint8_t sourceId, uint8_t targetId,
                 bool condState, bool targetState, uint32_t param1, String& outError);
    bool updateRule(uint8_t id, const String& name, bool enabled, uint8_t sourceId, uint8_t targetId,
                    bool condState, bool targetState, uint32_t param1, String& outError);
    bool removeRule(uint8_t id);
    bool toggleRule(uint8_t id);

    void toJson(JsonArray& arr);
    std::vector<AutomationRule>& getRules() { return _rules; }

    // NTP Time Configuration
    void setTimezoneOffset(int32_t offsetSeconds);
    int32_t getTimezoneOffset() const { return _tzOffsetSec; }
    void syncNtp();
    bool isTimeSynced() const;
    String getFormattedTime() const;

private:
    AutomationEngine();
    std::vector<AutomationRule> _rules;
    uint8_t _nextId;
    int32_t _tzOffsetSec;
    unsigned long _lastNtpSyncAttempt;

    void loadFromStorage();
    void saveToStorage();
};

#endif // AUTOMATION_H
