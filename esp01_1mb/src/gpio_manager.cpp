#include "gpio_manager.h"
#include "storage_manager.h"

GpioManager::GpioManager() : _stateCallback(nullptr) {
    _channels[0] = { 1, 0, "Relay 1", false, 0 }; // GPIO 0 (active-low optical relay)
    _channels[1] = { 2, 2, "Relay 2", false, 0 }; // GPIO 2 (active-low optical relay)
}

GpioManager& GpioManager::getInstance() {
    static GpioManager instance;
    return instance;
}

void GpioManager::applyPhysicalPin(size_t index) {
    if (index >= 2) return;
    // Active low: currentState true -> LOW, false -> HIGH
    digitalWrite(_channels[index].pin, _channels[index].currentState ? LOW : HIGH);
    pinMode(_channels[index].pin, OUTPUT);
}

bool GpioManager::begin() {
    DynamicJsonDocument doc(256);
    if (StorageManager::getInstance().loadJsonFile(FILE_GPIO_CONFIG, doc)) {
        JsonArrayConst arr = doc.as<JsonArrayConst>();
        for (JsonObjectConst ch : arr) {
            uint8_t pin = ch["pin"] | 255;
            bool st = ch["state"] | false;
            if (pin == 0) _channels[0].currentState = st;
            else if (pin == 2) _channels[1].currentState = st;
        }
    }

    applyPhysicalPin(0);
    applyPhysicalPin(1);
    Serial.printf("[GPIO] Hardware ready: Relay 1 (Pin 0)=%s, Relay 2 (Pin 2)=%s\n",
                  _channels[0].currentState ? "ON" : "OFF",
                  _channels[1].currentState ? "ON" : "OFF");
    return true;
}

void GpioManager::saveStates() {
    StaticJsonDocument<128> doc;
    JsonArray arr = doc.to<JsonArray>();
    JsonObject c1 = arr.createNestedObject();
    c1["pin"] = 0;
    c1["state"] = _channels[0].currentState;
    JsonObject c2 = arr.createNestedObject();
    c2["pin"] = 2;
    c2["state"] = _channels[1].currentState;
    StorageManager::getInstance().saveJsonFile(FILE_GPIO_CONFIG, doc);
}

void GpioManager::loop() {
    unsigned long now = millis();
    for (size_t i = 0; i < 2; i++) {
        if (_channels[i].pulseEndTime > 0 && now >= _channels[i].pulseEndTime) {
            _channels[i].pulseEndTime = 0;
            _channels[i].currentState = false;
            applyPhysicalPin(i);
            saveStates();
            if (_stateCallback) {
                _stateCallback(_channels[i].id, false);
            }
        }
    }
}

bool GpioManager::setState(uint8_t id, bool logicalState) {
    size_t idx = (id == 1) ? 0 : ((id == 2) ? 1 : 255);
    if (idx >= 2) return false;

    if (_channels[idx].currentState != logicalState) {
        _channels[idx].currentState = logicalState;
        _channels[idx].pulseEndTime = 0;
        applyPhysicalPin(idx);
        saveStates();
        if (_stateCallback) {
            _stateCallback(_channels[idx].id, logicalState);
        }
    }
    return true;
}

bool GpioManager::toggle(uint8_t id) {
    size_t idx = (id == 1) ? 0 : ((id == 2) ? 1 : 255);
    if (idx >= 2) return false;
    return setState(id, !_channels[idx].currentState);
}

bool GpioManager::pulse(uint8_t id, unsigned long durationMs) {
    size_t idx = (id == 1) ? 0 : ((id == 2) ? 1 : 255);
    if (idx >= 2) return false;

    if (durationMs == 0) durationMs = 500;
    _channels[idx].currentState = true;
    _channels[idx].pulseEndTime = millis() + durationMs;
    applyPhysicalPin(idx);
    saveStates();
    if (_stateCallback) {
        _stateCallback(_channels[idx].id, true);
    }
    return true;
}

void GpioManager::toJson(JsonArray& arr) {
    for (size_t i = 0; i < 2; i++) {
        JsonObject obj = arr.createNestedObject();
        obj["id"] = _channels[i].id;
        obj["pin"] = _channels[i].pin;
        obj["name"] = _channels[i].name;
        obj["state"] = _channels[i].currentState;
        obj["enabled"] = true;
    }
}
