#ifndef GPIO_MANAGER_H
#define GPIO_MANAGER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"

struct GpioChannel {
    uint8_t id;
    uint8_t pin;
    const char* name;
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

    void registerStateChangeCallback(GpioStateChangeCallback cb) { _stateCallback = cb; }
    void toJson(JsonArray& arr);

private:
    GpioManager();
    GpioStateChangeCallback _stateCallback;
    GpioChannel _channels[2];

    void applyPhysicalPin(size_t index);
    void saveStates();
};

#endif // GPIO_MANAGER_H
