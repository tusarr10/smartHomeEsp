#ifndef GPIO_MANAGER_H
#define GPIO_MANAGER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>
#include "config.h"

// Forward declaration
class AutomationEngine;

enum GpioInitialMode {
    INITIAL_MODE_RESTORE_LAST = 0, // Default: Persist and restore last state across reboots
    INITIAL_MODE_OFF          = 1, // Explicitly force OFF on boot
    INITIAL_MODE_ON           = 2  // Explicitly force ON on boot
};

struct GpioChannel {
    uint8_t id;
    uint8_t pin;
    String name;
    String room;
    String function;
    bool activeLow;
    uint8_t initialMode;
    bool enabled;
    bool currentState;          // Logical state: true = ON/Active, false = OFF/Inactive
    unsigned long pulseEndTime; // 0 = no pulse active
};

typedef void (*GpioStateChangeCallback)(uint8_t id, bool newState);

class GpioManager {
public:
    static GpioManager& getInstance();

    bool begin();
    void loop();

    bool isPinSafe(uint8_t pin, String& note, bool& bootSensitive);
    bool isPinAssigned(uint8_t pin, uint8_t excludeId = 0);

    bool addChannel(uint8_t pin, const String& name, const String& room, const String& function,
                    bool activeLow, uint8_t initialMode, String& outError);
    bool updateChannel(uint8_t id, const String& name, const String& room, const String& function,
                       bool activeLow, uint8_t initialMode, bool enabled, String& outError);
    bool removeChannel(uint8_t id);

    bool setState(uint8_t id, bool logicalState);
    bool toggle(uint8_t id);
    bool pulse(uint8_t id, unsigned long durationMs);

    GpioChannel* getChannel(uint8_t id);
    std::vector<GpioChannel>& getChannels() { return _channels; }

    void registerStateChangeCallback(GpioStateChangeCallback cb) { _stateCallback = cb; }

    void toJson(JsonArray& arr);
    bool fromJson(JsonArray& arr);

private:
    GpioManager();
    std::vector<GpioChannel> _channels;
    GpioStateChangeCallback _stateCallback;
    uint8_t _nextId;

    void applyPhysicalPin(const GpioChannel& channel);
    void loadFromStorage();
    void saveToStorage();
};

#endif // GPIO_MANAGER_H
