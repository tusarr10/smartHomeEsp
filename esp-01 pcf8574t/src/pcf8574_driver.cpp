#include "pcf8574_driver.h"

Pcf8574Driver::Pcf8574Driver()
    : _detected(false),
      _i2cAddress(PCF8574_DEFAULT_ADDR),
      _outputByte(0xFF), // 0xFF: all pins HIGH (active-low relays de-energized / OFF)
      _sdaPin(ESP01_I2C_SDA),
      _sclPin(ESP01_I2C_SCL) {}

Pcf8574Driver& Pcf8574Driver::getInstance() {
    static Pcf8574Driver instance;
    return instance;
}

uint8_t Pcf8574Driver::scanAddress(uint8_t preferredAddr) {
    // 1. Probe preferred address first
    Wire.beginTransmission(preferredAddr);
    if (Wire.endTransmission() == 0) {
        return preferredAddr;
    }

    // 2. Scan standard PCF8574 range (0x20 to 0x27)
    for (uint8_t addr = 0x20; addr <= 0x27; addr++) {
        if (addr == preferredAddr) continue;
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
            return addr;
        }
    }

    // 3. Scan PCF8574A range (0x38 to 0x3F)
    for (uint8_t addr = 0x38; addr <= 0x3F; addr++) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
            return addr;
        }
    }

    return 0; // Not detected
}

bool Pcf8574Driver::begin(uint8_t sdaPin, uint8_t sclPin, uint8_t defaultAddr) {
    _sdaPin = sdaPin;
    _sclPin = sclPin;

    Wire.begin(_sdaPin, _sclPin);
    Wire.setClock(100000); // 100 kHz standard I2C clock

    uint8_t foundAddr = scanAddress(defaultAddr);
    if (foundAddr != 0) {
        _i2cAddress = foundAddr;
        _detected = true;
        Serial.printf("[PCF8574] Expander detected at I2C address 0x%02X (SDA=GPIO%u, SCL=GPIO%u)\n",
                      _i2cAddress, _sdaPin, _sclPin);
    } else {
        _i2cAddress = defaultAddr;
        _detected = false;
        Serial.printf("[PCF8574] Warning: No PCF8574 found at 0x%02X (SDA=GPIO%u, SCL=GPIO%u). Will retry on write.\n",
                      defaultAddr, _sdaPin, _sclPin);
    }

    // Set initial output state (0xFF = all HIGH / relays de-energized)
    writeByte(_outputByte);
    return _detected;
}

bool Pcf8574Driver::writeByte(uint8_t byteVal) {
    _outputByte = byteVal;
    Wire.beginTransmission(_i2cAddress);
    Wire.write(_outputByte);
    uint8_t err = Wire.endTransmission();
    if (err == 0) {
        _detected = true;
        return true;
    } else {
        // Attempt quick rediscovery if previously lost
        uint8_t recheck = scanAddress(_i2cAddress);
        if (recheck != 0) {
            _i2cAddress = recheck;
            _detected = true;
            Wire.beginTransmission(_i2cAddress);
            Wire.write(_outputByte);
            return (Wire.endTransmission() == 0);
        }
        _detected = false;
        return false;
    }
}

bool Pcf8574Driver::setPin(uint8_t pinIndex, bool physicalLevel) {
    if (pinIndex > 7) return false;

    if (physicalLevel) {
        _outputByte |= (1 << pinIndex);   // HIGH
    } else {
        _outputByte &= ~(1 << pinIndex);  // LOW
    }

    return writeByte(_outputByte);
}

bool Pcf8574Driver::getPin(uint8_t pinIndex) const {
    if (pinIndex > 7) return false;
    return (_outputByte & (1 << pinIndex)) != 0;
}

uint8_t Pcf8574Driver::readInputs() {
    Wire.requestFrom(_i2cAddress, (uint8_t)1);
    if (Wire.available()) {
        return Wire.read();
    }
    return _outputByte;
}
