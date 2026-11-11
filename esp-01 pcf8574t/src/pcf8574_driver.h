#ifndef PCF8574_DRIVER_H
#define PCF8574_DRIVER_H

#include <Arduino.h>
#include <Wire.h>
#include "config.h"

class Pcf8574Driver {
public:
    static Pcf8574Driver& getInstance();

    bool begin(uint8_t sdaPin = ESP01_I2C_SDA, uint8_t sclPin = ESP01_I2C_SCL, uint8_t defaultAddr = PCF8574_DEFAULT_ADDR);
    bool setPin(uint8_t pinIndex, bool physicalLevel);
    bool getPin(uint8_t pinIndex) const;
    uint8_t readInputs();

    bool writeByte(uint8_t byteVal);

    bool isDetected() const { return _detected; }
    uint8_t getAddress() const { return _i2cAddress; }
    uint8_t getOutputByte() const { return _outputByte; }

private:
    Pcf8574Driver();
    bool _detected;
    uint8_t _i2cAddress;
    uint8_t _outputByte;
    uint8_t _sdaPin;
    uint8_t _sclPin;

    uint8_t scanAddress(uint8_t preferredAddr);
};

#endif // PCF8574_DRIVER_H
