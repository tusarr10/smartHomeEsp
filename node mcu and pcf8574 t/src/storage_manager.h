#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include <Arduino.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "config.h"

class StorageManager {
public:
    static StorageManager& getInstance();

    bool begin();
    bool saveJsonFile(const char* path, const JsonDocument& doc);
    bool loadJsonFile(const char* path, DynamicJsonDocument& doc);
    bool fileExists(const char* path);
    bool removeFile(const char* path);

    void factoryReset();

    size_t getFlashTotalBytes();
    size_t getFlashUsedBytes();
    size_t getFlashFreeBytes();

    uint32_t getBootCount() const { return _bootCount; }

private:
    StorageManager();
    bool _initialized;
    uint32_t _bootCount;
    void ensureConfigDir();
    void incrementBootCount();
};

#endif // STORAGE_MANAGER_H
