#include "gpio_manager.h"
#include "storage_manager.h"

GpioManager::GpioManager() : _stateCallback(nullptr), _channelCount(2) {
    // Default channels for ESP-01 / ESP-01S hardware
    _channels[0] = { 1, ESP01_GPIO0, "Relay 1", "General", "Relay", true, 0, true, false, 0 };
    _channels[1] = { 2, ESP01_GPIO2, "Relay 2", "General", "Relay", true, 0, true, false, 0 };
}

GpioManager& GpioManager::getInstance() {
    static GpioManager instance;
    return instance;
}

void GpioManager::applyPhysicalPin(size_t index) {
    if (index >= _channelCount) return;
    uint8_t pin = _channels[index].pin;
    if (pin > 16) return;
    bool activeLow = _channels[index].activeLow;
    bool logicalState = _channels[index].currentState;
    
    // Active low: currentState true -> LOW, false -> HIGH
    digitalWrite(pin, logicalState ? (activeLow ? LOW : HIGH) : (activeLow ? HIGH : LOW));
    pinMode(pin, OUTPUT);
}

bool GpioManager::begin() {
    DynamicJsonDocument doc(1024);
    if (StorageManager::getInstance().loadJsonFile(FILE_GPIO_CONFIG, doc)) {
        JsonArrayConst arr;
        if (doc.is<JsonArrayConst>()) {
            arr = doc.as<JsonArrayConst>();
        } else if (doc.containsKey("channels") && doc["channels"].is<JsonArrayConst>()) {
            arr = doc["channels"].as<JsonArrayConst>();
        }

        if (!arr.isNull() && arr.size() > 0) {
            size_t count = 0;
            for (JsonObjectConst ch : arr) {
                if (count >= MAX_GPIO_CHANNELS) break;
                uint8_t id = ch["id"] | (count + 1);
                uint8_t pin = ch["pin"] | 255;
                if (pin == 255) continue;

                String name = ch["name"] | ("Relay " + String(id));
                String room = ch["room"] | "General";
                String func = ch["function"] | "Relay";
                bool activeLow = ch.containsKey("activeLow") ? ch["activeLow"].as<bool>() : (ch.containsKey("active_low") ? ch["active_low"].as<bool>() : true);
                uint8_t initMode = ch["initialMode"] | ch["initial_mode"] | 0;
                bool enabled = ch.containsKey("enabled") ? ch["enabled"].as<bool>() : true;

                bool st = false;
                if (initMode == 2) st = true;       // Boot ON
                else if (initMode == 1) st = false; // Boot OFF
                else if (ch.containsKey("state")) st = ch["state"].as<bool>(); // Restore last state

                _channels[count] = { id, pin, name, room, func, activeLow, initMode, enabled, st, 0 };
                count++;
            }
            if (count > 0) {
                _channelCount = count;
            }
        }
    }

    for (size_t i = 0; i < _channelCount; i++) {
        applyPhysicalPin(i);
        Serial.printf("[GPIO] Hardware ready: Channel %u (%s) on Pin %u = %s\n",
                      _channels[i].id, _channels[i].name.c_str(), _channels[i].pin,
                      _channels[i].currentState ? "ON" : "OFF");
    }
    return true;
}

void GpioManager::saveConfiguration() {
    DynamicJsonDocument doc(1024);
    JsonArray arr = doc.to<JsonArray>();
    for (size_t i = 0; i < _channelCount; i++) {
        JsonObject obj = arr.createNestedObject();
        obj["id"] = _channels[i].id;
        obj["pin"] = _channels[i].pin;
        obj["name"] = _channels[i].name;
        obj["room"] = _channels[i].room;
        obj["function"] = _channels[i].function;
        obj["activeLow"] = _channels[i].activeLow;
        obj["initialMode"] = _channels[i].initialMode;
        obj["enabled"] = _channels[i].enabled;
        obj["state"] = _channels[i].currentState;
    }
    StorageManager::getInstance().saveJsonFile(FILE_GPIO_CONFIG, doc);
}

void GpioManager::saveStates() {
    saveConfiguration();
}

bool GpioManager::saveChannels(const JsonArrayConst& channels) {
    size_t count = 0;
    for (JsonObjectConst ch : channels) {
        if (count >= MAX_GPIO_CHANNELS) break;
        uint8_t id = ch["id"] | (count + 1);
        uint8_t pin = ch["pin"] | 255;
        if (pin == 255) continue;

        String name = ch["name"] | ("Relay " + String(id));
        String room = ch["room"] | "General";
        String func = ch["function"] | "Relay";
        bool activeLow = ch.containsKey("activeLow") ? ch["activeLow"].as<bool>() : (ch.containsKey("active_low") ? ch["active_low"].as<bool>() : true);
        uint8_t initMode = ch["initialMode"] | ch["initial_mode"] | 0;
        bool enabled = ch.containsKey("enabled") ? ch["enabled"].as<bool>() : true;

        bool st = false;
        if (initMode == 2) st = true;
        else if (initMode == 1) st = false;
        else if (ch.containsKey("state")) st = ch["state"].as<bool>();
        else {
            for (size_t j = 0; j < _channelCount; j++) {
                if (_channels[j].id == id || _channels[j].pin == pin) {
                    st = _channels[j].currentState;
                    break;
                }
            }
        }

        _channels[count] = { id, pin, name, room, func, activeLow, initMode, enabled, st, 0 };
        applyPhysicalPin(count);
        count++;
    }

    if (count > 0) {
        _channelCount = count;
        saveConfiguration();
        return true;
    }
    return false;
}

bool GpioManager::addOrUpdateChannel(uint8_t id, uint8_t pin, const String& name, const String& room,
                                     const String& function, bool activeLow, uint8_t initialMode, bool enabled) {
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].id == id) {
            _channels[i].pin = pin;
            _channels[i].name = name;
            _channels[i].room = room;
            _channels[i].function = function;
            _channels[i].activeLow = activeLow;
            _channels[i].initialMode = initialMode;
            _channels[i].enabled = enabled;
            applyPhysicalPin(i);
            saveConfiguration();
            return true;
        }
    }

    if (_channelCount < MAX_GPIO_CHANNELS) {
        size_t idx = _channelCount++;
        _channels[idx] = { id, pin, name, room, function, activeLow, initialMode, enabled, false, 0 };
        applyPhysicalPin(idx);
        saveConfiguration();
        return true;
    }
    return false;
}

bool GpioManager::removeChannel(uint8_t id) {
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].id == id) {
            for (size_t j = i; j < _channelCount - 1; j++) {
                _channels[j] = _channels[j + 1];
            }
            _channelCount--;
            saveConfiguration();
            return true;
        }
    }
    return false;
}

void GpioManager::loop() {
    unsigned long now = millis();
    for (size_t i = 0; i < _channelCount; i++) {
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
    size_t idx = 255;
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].id == id) {
            idx = i;
            break;
        }
    }
    if (idx == 255 && id > 0 && id <= _channelCount) {
        idx = id - 1;
    }
    if (idx >= _channelCount) return false;

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
    size_t idx = 255;
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].id == id) {
            idx = i;
            break;
        }
    }
    if (idx == 255 && id > 0 && id <= _channelCount) {
        idx = id - 1;
    }
    if (idx >= _channelCount) return false;

    return setState(_channels[idx].id, !_channels[idx].currentState);
}

bool GpioManager::pulse(uint8_t id, unsigned long durationMs) {
    size_t idx = 255;
    for (size_t i = 0; i < _channelCount; i++) {
        if (_channels[i].id == id) {
            idx = i;
            break;
        }
    }
    if (idx == 255 && id > 0 && id <= _channelCount) {
        idx = id - 1;
    }
    if (idx >= _channelCount) return false;

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
    for (size_t i = 0; i < _channelCount; i++) {
        JsonObject obj = arr.createNestedObject();
        obj["id"] = _channels[i].id;
        obj["pin"] = _channels[i].pin;
        obj["name"] = _channels[i].name;
        obj["room"] = _channels[i].room;
        obj["function"] = _channels[i].function;
        obj["activeLow"] = _channels[i].activeLow;
        obj["initialMode"] = _channels[i].initialMode;
        obj["enabled"] = _channels[i].enabled;
        obj["state"] = _channels[i].currentState;
    }
}
