#include "automation.h"
#include "gpio_manager.h"
#include "receiver_client.h"

// Streamlined Thin-Satellite Automation Engine:
// Complex cron schedules and daily timer rules are offloaded to Central Server (central_server_js).
// The ESP-01 acts as a lean hardware actuator and forwards state transitions to the Central Server.

AutomationEngine::AutomationEngine()
    : _nextId(1),
      _tzOffsetSec(19800),
      _lastNtpSyncAttempt(0) {}

AutomationEngine& AutomationEngine::getInstance() {
    static AutomationEngine instance;
    return instance;
}

bool AutomationEngine::begin() {
    return true;
}

void AutomationEngine::syncNtp() {
    // Clock management offloaded to Central Server
}

bool AutomationEngine::isTimeSynced() const {
    return false;
}

String AutomationEngine::getFormattedTime() const {
    char buf[24];
    unsigned long up = millis() / 1000UL;
    snprintf_P(buf, sizeof(buf), PSTR("Up %lu s"), up);
    return String(buf);
}

void AutomationEngine::setTimezoneOffset(int32_t offsetSeconds) {
    _tzOffsetSec = offsetSeconds;
}

void AutomationEngine::notifyGpioStateChanged(uint8_t gpioId, bool newState) {
    // Notify central telemetry receiver client immediately
    ReceiverClient::getInstance().onGpioStateChanged(gpioId, newState);
}

void AutomationEngine::loop() {
    // Automation loops offloaded to central server
}

bool AutomationEngine::addRule(const String&, uint8_t, uint8_t, uint8_t, bool, bool, uint32_t, String& outError) {
    outError = F("Automations managed by Central Server");
    return false;
}

bool AutomationEngine::updateRule(uint8_t, const String&, bool, uint8_t, uint8_t, bool, bool, uint32_t, String& outError) {
    outError = F("Automations managed by Central Server");
    return false;
}

bool AutomationEngine::removeRule(uint8_t) {
    return true;
}

bool AutomationEngine::toggleRule(uint8_t) {
    return true;
}

void AutomationEngine::toJson(JsonArray&) {
    // Return empty array [] - automations are tracked in Central Server database
}

void AutomationEngine::loadFromStorage() {}
void AutomationEngine::saveToStorage() {}
