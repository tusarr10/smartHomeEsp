#include "gpio_manager.h"
#include "storage_manager.h"
#include "pcf8574_driver.h"

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
            return PIN_SAFETY_MAP[i].isSafeRelay;
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
        // Disabled channel defaults to safe off (high-impedance input for native pins)
        if (!IS_PCF_PIN(channel.pin) && channel.pin <= 16) {
            pinMode(channel.pin, INPUT);
        }
        return;
    }

    // Active-low: logical ON -> physical LOW; logical OFF -> physical HIGH
    int physicalLevel = channel.activeLow ? (channel.currentState ? LOW : HIGH) : (channel.currentState ? HIGH : LOW);

    if (IS_PCF_PIN(channel.pin)) {
        Pcf8574Driver::getInstance().setPin(PCF_PIN_INDEX(channel.pin), physicalLevel == HIGH);
        return;
    }

    if (channel.pin <= 16) {
        digitalWrite(channel.pin, physicalLevel);
        pinMode(channel.pin, OUTPUT);
    }
}

bool GpioManager::begin() {
    // 1. Initialize PCF8574T I2C Bus & Expander
    Pcf8574Driver::getInstance().begin(NODEMCU_I2C_SDA, NODEMCU_I2C_SCL, PCF8574_DEFAULT_ADDR);

    // 2. Load Channel Configurations from LittleFS Flash
    loadFromStorage();
    if (_channels.empty()) {
        // Only create initial default safe outputs if /config/gpio.json does NOT exist on flash
        if (!LittleFS.exists(FILE_GPIO_CONFIG)) {
            Serial.println(F("[GPIO] No saved config found, creating default 8 PCF8574 channels (P0-P7)"));
            String err;
            for (uint8_t i = 0; i < 8; i++) {
                addChannel(PCF_PIN_BASE + i, "Relay " + String(i + 1), "General", "Relay", true, INITIAL_MODE_RESTORE_LAST, err);
            }
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

    if (initialMode == INITIAL_MODE_ON) {
        ch.currentState = true;
    } else {
        ch.currentState = false;
    }
    ch.pulseEndTime = 0;

    applyPhysicalPin(ch);
    _channels.push_back(ch);
    saveToStorage();
    return true;
}

bool GpioManager::updateChannel(uint8_t id, const String& name, const String& room, const String& function,
                               bool activeLow, uint8_t initialMode, bool enabled, String& outError) {
    GpioChannel* ch = getChannel(id);
    if (!ch) {
        outError = F("Channel ID not found");
        return false;
    }

    ch->name = (name.length() > 0) ? name : ch->name;
    ch->room = (room.length() > 0) ? room : ch->room;
    ch->function = (function.length() > 0) ? function : ch->function;
    ch->activeLow = activeLow;
    ch->initialMode = initialMode;
    ch->enabled = enabled;

    applyPhysicalPin(*ch);
    saveToStorage();
    return true;
}

bool GpioManager::removeChannel(uint8_t id) {
    for (auto it = _channels.begin(); it != _channels.end(); ++it) {
        if (it->id == id) {
            // Restore pin to safe default (relay turned off)
            it->currentState = false;
            applyPhysicalPin(*it);
            if (!IS_PCF_PIN(it->pin) && it->pin <= 16) {
                pinMode(it->pin, INPUT);
            }
            _channels.erase(it);
            saveToStorage();
            return true;
        }
    }
    return false;
}

bool GpioManager::setState(uint8_t id, bool logicalState) {
    GpioChannel* ch = getChannel(id);
    if (!ch || !ch->enabled) return false;

    ch->pulseEndTime = 0; // Cancel any active pulse
    ch->currentState = logicalState;
    applyPhysicalPin(*ch);
    saveToStorage();

    if (_stateCallback) {
        _stateCallback(id, logicalState);
    }
    return true;
}

bool GpioManager::toggle(uint8_t id) {
    GpioChannel* ch = getChannel(id);
    if (!ch || !ch->enabled) return false;
    return setState(id, !ch->currentState);
}

bool GpioManager::pulse(uint8_t id, unsigned long durationMs) {
    GpioChannel* ch = getChannel(id);
    if (!ch || !ch->enabled) return false;

    ch->currentState = true;
    ch->pulseEndTime = millis() + durationMs;
    applyPhysicalPin(*ch);
    saveToStorage();

    if (_stateCallback) {
        _stateCallback(id, true);
    }
    return true;
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
        obj["name"] = ch.name;
        obj["room"] = ch.room;
        obj["function"] = ch.function;
        obj["activeLow"] = ch.activeLow;
        obj["initialMode"] = ch.initialMode;
        obj["enabled"] = ch.enabled;
        obj["state"] = ch.currentState;

        String label = "GPIO " + String(ch.pin);
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
        ch.pin = obj["pin"] | 100;
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
        ch.pin = obj["pin"] | 100;
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

        applyPhysicalPin(ch);

        if (ch.id > maxId) maxId = ch.id;
        _channels.push_back(ch);
    }
    _nextId = maxId + 1;
    saveToStorage();
    return true;
}

bool GpioManager::isPcfDetected() const {
    return Pcf8574Driver::getInstance().isDetected();
}

uint8_t GpioManager::getPcfAddress() const {
    return Pcf8574Driver::getInstance().getAddress();
}

uint8_t GpioManager::getPcfOutputByte() const {
    return Pcf8574Driver::getInstance().getOutputByte();
}
