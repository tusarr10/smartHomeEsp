#ifndef GPIO_MANAGER_H
#define GPIO_MANAGER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"

struct GpioChannel {
    uint8_t id;
    uint8_t pin;
    String name;
    String room;
    String function;
    bool activeLow;
    uint8_t initialMode;
    bool enabled;
    bool currentState;
    unsigned long pulseEndTime;
};

typedef void (*GpioStateChangeCallback)(uint8_t id, bool newState);

class GpioManager {
public:
    static GpioManager& getInstance();

    bool begin();
    void loop();

    bool setState(uint8_t id, bool logicalState);
    bool toggle(uint8_t id);
    bool pulse(uint8_t id, unsigned long durationMs);

    bool saveChannels(const JsonArrayConst& channels);
    bool addOrUpdateChannel(uint8_t id, uint8_t pin, const String& name, const String& room,
                            const String& function, bool activeLow, uint8_t initialMode, bool enabled);
    bool removeChannel(uint8_t id);
    size_t getChannelCount() const { return _channelCount; }

    void registerStateChangeCallback(GpioStateChangeCallback cb) { _stateCallback = cb; }
    void toJson(JsonArray& arr);

    bool isPcfDetected() const;
    uint8_t getPcfAddress() const;
    uint8_t getPcfOutputByte() const;

private:
    GpioManager();
    GpioStateChangeCallback _stateCallback;
    GpioChannel _channels[MAX_GPIO_CHANNELS];
    size_t _channelCount;

    void applyPhysicalPin(size_t index);
    void saveStates();
    void saveConfiguration();
};

#endif // GPIO_MANAGER_H
