#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"

struct PersistentConfig {
    uint16_t magic;           // 0xA55A
    uint16_t version;         // 1
    char deviceName[36];
    char adminUser[16];
    char adminPass[32];
    uint32_t bootCount;

    // WiFi
    uint8_t wifiMode;
    bool wifiConfigured;
    char staSsid[33];
    char staPass[65];
    char apSsid[33];
    char apPass[33];

    // Receiver / Central Server
    bool rcvrEnabled;
    char rcvrHost[48];
    uint16_t rcvrPort;
    char rcvrToken[33];

    // GPIO States (Relay 1 = Pin 0, Relay 2 = Pin 2)
    bool gpio0State;
    bool gpio2State;
};

class StorageManager {
public:
    static StorageManager& getInstance();

    bool begin();
    bool saveJsonFile(const char* path, const JsonDocument& doc);
    bool loadJsonFile(const char* path, DynamicJsonDocument& doc);
    bool fileExists(const char* path);
    bool removeFile(const char* path);

    void factoryReset();

    size_t getFlashTotalBytes() { return 1048576; }
    size_t getFlashUsedBytes()  { return ESP.getSketchSize(); }
    size_t getFlashFreeBytes()  { return ESP.getFreeSketchSpace(); }

    uint32_t getBootCount() const { return _cfg.bootCount; }

private:
    StorageManager();
    bool _initialized;
    PersistentConfig _cfg;

    void loadFromEeprom();
    void saveToEeprom();
    void setDefaultConfig();
};

#endif // STORAGE_MANAGER_H
