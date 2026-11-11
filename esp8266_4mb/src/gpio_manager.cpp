#include "gpio_manager.h"
#include "storage_manager.h"

GpioManager::GpioManager() : _stateCallback(nullptr), _nextId(1) {}

GpioManager& GpioManager::getInstance() {
    static GpioManager instance;
    return instance;
}

bool GpioManager::isPinSafe(uint8_t pin, String& note, bool& bootSensitive) {
    for (size_t i = 0; i < PIN_SAFETY_MAP_COUNT; i++) {
        if (PIN_SAFETY_MAP[i].gpio == pin) {
            note = PIN_SAFETY_MAP[i].bootNote;
            bootSensitive = PIN_SAFETY_MAP[i].isBootSensitive;
            return true;
        }
    }
    note = F("Pin is reserved by ESP8266 system/SPI-flash/UART");
    bootSensitive = true;
    return false;
}

bool GpioManager::isPinAssigned(uint8_t pin, uint8_t excludeId) {
    for (const auto& ch : _channels) {
        if (ch.pin == pin && ch.id != excludeId) {
            return true;
        }
    }
    return false;
}

void GpioManager::applyPhysicalPin(const GpioChannel& channel) {
    if (!channel.enabled) {
        // Disabled channel defaults to safe off (high-impedance input)
        pinMode(channel.pin, INPUT);
        return;
    }

    // Set output level register BEFORE configuring pinMode to OUTPUT
    // This prevents any microsecond glitch/click on active-low optical relays during boot
    int physicalLevel = channel.activeLow ? (channel.currentState ? LOW : HIGH) : (channel.currentState ? HIGH : LOW);
    digitalWrite(channel.pin, physicalLevel);
    pinMode(channel.pin, OUTPUT);
}

bool GpioManager::begin() {
    loadFromStorage();
    if (_channels.empty()) {
        // Only create initial default safe outputs if /config/gpio.json does NOT exist on flash
        if (!LittleFS.exists(FILE_GPIO_CONFIG)) {
            Serial.println(F("[GPIO] No saved config found, creating initial default outputs (D1 & D2)"));
            String err;
            addChannel(D1, F("Living Room Light"), F("Living Room"), F("Light"), true, INITIAL_MODE_RESTORE_LAST, err);
            addChannel(D2, F("Bedroom Fan"), F("Bedroom"), F("Fan"), true, INITIAL_MODE_RESTORE_LAST, err);
        } else {
            Serial.println(F("[GPIO] Existing gpio.json file found but 0 channels loaded. Preserving file."));
        }
    } else {
        // Initialize all loaded channels according to power-on behavior
        for (auto& ch : _channels) {
            if (ch.initialMode == INITIAL_MODE_OFF) {
                ch.currentState = false;
            } else if (ch.initialMode == INITIAL_MODE_ON) {
                ch.currentState = true;
            } else if (ch.initialMode == INITIAL_MODE_RESTORE_LAST) {
                // ch.currentState loaded from LittleFS (/config/gpio.json) persists across reboots
                Serial.printf("[GPIO] Channel %u (%s): Restored last state -> %s\n",
                              ch.id, ch.name.c_str(), ch.currentState ? "ON" : "OFF");
            }
            applyPhysicalPin(ch);
        }
    }
    return true;
}

void GpioManager::loop() {
    unsigned long now = millis();
    for (auto& ch : _channels) {
        if (ch.pulseEndTime > 0 && now >= ch.pulseEndTime) {
            ch.pulseEndTime = 0;
            ch.currentState = false;
            applyPhysicalPin(ch);
            Serial.printf("[GPIO] Channel %u (%s) pulse expired -> OFF\n", ch.id, ch.name.c_str());
            if (_stateCallback) {
                _stateCallback(ch.id, false);
            }
            saveToStorage();
        }
    }
}

bool GpioManager::addChannel(uint8_t pin, const String& name, const String& room, const String& function,
                            bool activeLow, uint8_t initialMode, String& outError) {
    if (_channels.size() >= MAX_GPIO_CHANNELS) {
        outError = String(F("Maximum GPIO channels reached (limit: ")) + String(MAX_GPIO_CHANNELS) + F(")");
        return false;
    }

    String note;
    bool bootSens;
    if (!isPinSafe(pin, note, bootSens)) {
        outError = note;
        return false;
    }

    if (isPinAssigned(pin)) {
        outError = F("Pin is already assigned to another channel");
        return false;
    }

    GpioChannel ch;
    ch.id = _nextId++;
    ch.pin = pin;
    ch.name = (name.length() > 0) ? name : String(F("Output ")) + String(ch.id);
    ch.room = (room.length() > 0) ? room : F("General");
    ch.function = (function.length() > 0) ? function : F("Relay");
    ch.activeLow = activeLow;
    ch.initialMode = initialMode;
    ch.enabled = true;
    ch.currentState = (initialMode == INITIAL_MODE_ON);
    ch.pulseEndTime = 0;

    applyPhysicalPin(ch);
    _channels.push_back(ch);
    saveToStorage();

    Serial.printf("[GPIO] Added Channel ID %u: Pin GPIO%u, Name: %s\n", ch.id, ch.pin, ch.name.c_str());
    return true;
}

bool GpioManager::updateChannel(uint8_t id, const String& name, const String& room, const String& function,
                               bool activeLow, uint8_t initialMode, bool enabled, String& outError) {
    for (auto& ch : _channels) {
        if (ch.id == id) {
            if (name.length() > 0) ch.name = name;
            if (room.length() > 0) ch.room = room;
            if (function.length() > 0) ch.function = function;
            ch.activeLow = activeLow;
            ch.initialMode = initialMode;
            ch.enabled = enabled;
            applyPhysicalPin(ch);
            saveToStorage();
            return true;
        }
    }
    outError = F("Channel ID not found");
    return false;
}

bool GpioManager::removeChannel(uint8_t id) {
    for (auto it = _channels.begin(); it != _channels.end(); ++it) {
        if (it->id == id) {
            // Set hardware pin to safe input before deleting
            pinMode(it->pin, INPUT);
            _channels.erase(it);
            saveToStorage();
            Serial.printf("[GPIO] Removed Channel ID %u\n", id);
            return true;
        }
    }
    return false;
}

bool GpioManager::setState(uint8_t id, bool logicalState) {
    for (auto& ch : _channels) {
        if (ch.id == id && ch.enabled) {
            // Flash wear reduction: avoid rewriting flash if logical state is already set
            if (ch.currentState == logicalState && ch.pulseEndTime == 0) {
                return true;
            }

            ch.pulseEndTime = 0; // Cancel any active pulse
            ch.currentState = logicalState;
            applyPhysicalPin(ch);
            Serial.printf("[GPIO] Channel %u (%s) -> %s\n", ch.id, ch.name.c_str(), logicalState ? "ON" : "OFF");
            if (_stateCallback) {
                _stateCallback(ch.id, logicalState);
            }
            saveToStorage(); // Atomic LittleFS write
            return true;
        }
    }
    return false;
}

bool GpioManager::toggle(uint8_t id) {
    for (auto& ch : _channels) {
        if (ch.id == id && ch.enabled) {
            return setState(id, !ch.currentState);
        }
    }
    return false;
}

bool GpioManager::pulse(uint8_t id, unsigned long durationMs) {
    for (auto& ch : _channels) {
        if (ch.id == id && ch.enabled) {
            ch.currentState = true;
            applyPhysicalPin(ch);
            ch.pulseEndTime = millis() + ((durationMs > 0) ? durationMs : 500);
            Serial.printf("[GPIO] Channel %u (%s) pulsed for %lu ms\n", ch.id, ch.name.c_str(), durationMs);
            if (_stateCallback) {
                _stateCallback(ch.id, true);
            }
            return true;
        }
    }
    return false;
}

GpioChannel* GpioManager::getChannel(uint8_t id) {
    for (auto& ch : _channels) {
        if (ch.id == id) return &ch;
    }
    return nullptr;
}

void GpioManager::toJson(JsonArray& arr) {
    for (const auto& ch : _channels) {
        JsonObject obj = arr.createNestedObject();
        obj["id"] = ch.id;
        obj["pin"] = ch.pin;
        obj["enabled"] = ch.enabled;
        obj["state"] = ch.currentState;

        // Find pin label
        String label = String("GPIO") + String(ch.pin);
        String note = "";
        bool bootSens = false;
        for (size_t i = 0; i < PIN_SAFETY_MAP_COUNT; i++) {
            if (PIN_SAFETY_MAP[i].gpio == ch.pin) {
                label = PIN_SAFETY_MAP[i].label;
                note = PIN_SAFETY_MAP[i].bootNote;
                bootSens = PIN_SAFETY_MAP[i].isBootSensitive;
                break;
            }
        }
        obj["label"] = label;
        obj["note"] = note;
        obj["bootSensitive"] = bootSens;
        obj["name"] = (ch.name.length() > 0) ? ch.name : String(F("Output ")) + String(ch.id);
        obj["room"] = (ch.room.length() > 0) ? ch.room : F("General");
        obj["function"] = (ch.function.length() > 0) ? ch.function : F("Relay");
        obj["activeLow"] = ch.activeLow;
        obj["initialMode"] = ch.initialMode;
    }
}

void GpioManager::loadFromStorage() {
    DynamicJsonDocument doc(4096);
    if (!StorageManager::getInstance().loadJsonFile(FILE_GPIO_CONFIG, doc)) {
        return;
    }

    _channels.clear();
    uint8_t maxId = 0;
    JsonArray arr = doc.as<JsonArray>();
    for (JsonObject obj : arr) {
        GpioChannel ch;
        ch.id = obj["id"] | (uint8_t)(obj["channel_id"] | (maxId + 1));
        ch.pin = obj["pin"] | D1;
        String loadedName = obj["name"] | "";
        ch.name = (loadedName.length() > 0) ? loadedName : String(F("Output ")) + String(ch.id);
        String loadedRoom = obj["room"] | "";
        ch.room = (loadedRoom.length() > 0) ? loadedRoom : F("General");
        String loadedFunc = obj["function"] | "";
        ch.function = (loadedFunc.length() > 0) ? loadedFunc : F("Relay");
        ch.activeLow = obj.containsKey("activeLow") ? obj["activeLow"].as<bool>() : (obj.containsKey("active_low") ? obj["active_low"].as<bool>() : true);
        ch.initialMode = obj.containsKey("initialMode") ? obj["initialMode"].as<uint8_t>() : (obj.containsKey("initial_mode") ? obj["initial_mode"].as<uint8_t>() : 0);
        ch.enabled = obj.containsKey("enabled") ? obj["enabled"].as<bool>() : true;
        ch.currentState = obj.containsKey("state") ? obj["state"].as<bool>() : false;
        ch.pulseEndTime = 0;

        if (ch.id > maxId) maxId = ch.id;
        _channels.push_back(ch);
    }
    _nextId = maxId + 1;
    Serial.printf("[GPIO] Loaded %u channel(s) from LittleFS storage.\n", (unsigned int)_channels.size());
}

void GpioManager::saveToStorage() {
    DynamicJsonDocument doc(4096);
    JsonArray arr = doc.to<JsonArray>();
    toJson(arr);
    StorageManager::getInstance().saveJsonFile(FILE_GPIO_CONFIG, doc);
}

bool GpioManager::fromJson(JsonArray& arr) {
    _channels.clear();
    uint8_t maxId = 0;
    for (JsonObject obj : arr) {
        GpioChannel ch;
        ch.id = obj["id"] | (uint8_t)(obj["channel_id"] | (maxId + 1));
        ch.pin = obj["pin"] | D1;
        String loadedName = obj["name"] | "";
        ch.name = (loadedName.length() > 0) ? loadedName : String(F("Output ")) + String(ch.id);
        String loadedRoom = obj["room"] | "";
        ch.room = (loadedRoom.length() > 0) ? loadedRoom : F("General");
        String loadedFunc = obj["function"] | "";
        ch.function = (loadedFunc.length() > 0) ? loadedFunc : F("Relay");
        ch.activeLow = obj.containsKey("activeLow") ? obj["activeLow"].as<bool>() : (obj.containsKey("active_low") ? obj["active_low"].as<bool>() : true);
        ch.initialMode = obj.containsKey("initialMode") ? obj["initialMode"].as<uint8_t>() : (obj.containsKey("initial_mode") ? obj["initial_mode"].as<uint8_t>() : 0);
        ch.enabled = obj.containsKey("enabled") ? obj["enabled"].as<bool>() : true;
        ch.currentState = obj.containsKey("state") ? obj["state"].as<bool>() : false;
        ch.pulseEndTime = 0;

        pinMode(ch.pin, OUTPUT);
        applyPhysicalPin(ch);

        if (ch.id > maxId) maxId = ch.id;
        _channels.push_back(ch);
    }
    _nextId = maxId + 1;
    saveToStorage();
    return true;
}
