#include "storage_manager.h"

StorageManager::StorageManager() : _initialized(false), _bootCount(1) {}

StorageManager& StorageManager::getInstance() {
    static StorageManager instance;
    return instance;
}

bool StorageManager::begin() {
    if (_initialized) return true;

    Serial.println(F("[STORAGE] Initializing LittleFS..."));
    if (!LittleFS.begin()) {
        Serial.println(F("[STORAGE] LittleFS mount failed, formatting flash..."));
        if (!LittleFS.format()) {
            Serial.println(F("[STORAGE] LittleFS format failed!"));
            return false;
        }
        if (!LittleFS.begin()) {
            Serial.println(F("[STORAGE] LittleFS mount failed after format!"));
            return false;
        }
    }

    _initialized = true;
    ensureConfigDir();
    incrementBootCount();

    FSInfo fs_info;
    LittleFS.info(fs_info);
    Serial.printf("[STORAGE] LittleFS mounted. Total: %u KB, Used: %u KB\n",
                  (unsigned int)(fs_info.totalBytes / 1024),
                  (unsigned int)(fs_info.usedBytes / 1024));

    return true;
}

void StorageManager::ensureConfigDir() {
    if (!LittleFS.exists("/config")) {
        File dirFile = LittleFS.open("/config/.keep", "w");
        if (dirFile) {
            dirFile.print("1");
            dirFile.close();
        }
    }
}

void StorageManager::incrementBootCount() {
    DynamicJsonDocument doc(512);
    loadJsonFile(FILE_SYSTEM_CONFIG, doc);
    _bootCount = doc["bootCount"] | 0;
    _bootCount++;
    doc["bootCount"] = _bootCount;
    saveJsonFile(FILE_SYSTEM_CONFIG, doc);
    Serial.printf("[STORAGE] Device Boot Count: %u\n", _bootCount);
}

bool StorageManager::saveJsonFile(const char* path, const JsonDocument& doc) {
    if (!_initialized && !begin()) return false;

    String tmpPath = String(path) + ".tmp";
    File file = LittleFS.open(tmpPath.c_str(), "w");
    if (!file) {
        Serial.printf("[STORAGE] Failed to open %s for write\n", tmpPath.c_str());
        return false;
    }

    size_t bytesWritten = serializeJson(doc, file);
    file.flush();
    file.close();

    if (bytesWritten == 0) {
        Serial.printf("[STORAGE] Error serializing JSON to %s\n", tmpPath.c_str());
        LittleFS.remove(tmpPath.c_str());
        return false;
    }

    // Atomic replace
    if (LittleFS.exists(path)) {
        LittleFS.remove(path);
    }
    if (!LittleFS.rename(tmpPath.c_str(), path)) {
        Serial.printf("[STORAGE] Failed to rename %s to %s, falling back to direct write\n", tmpPath.c_str(), path);
        File directFile = LittleFS.open(path, "w");
        if (directFile) {
            serializeJson(doc, directFile);
            directFile.flush();
            directFile.close();
        }
        LittleFS.remove(tmpPath.c_str());
    }

    return true;
}

bool StorageManager::loadJsonFile(const char* path, DynamicJsonDocument& doc) {
    if (!_initialized && !begin()) return false;

    if (!LittleFS.exists(path)) {
        return false;
    }

    File file = LittleFS.open(path, "r");
    if (!file) {
        Serial.printf("[STORAGE] Failed to open %s for read\n", path);
        return false;
    }

    DeserializationError error = deserializeJson(doc, file);
    file.close();

    if (error) {
        Serial.printf("[STORAGE] Failed to parse %s: %s\n", path, error.c_str());
        return false;
    }

    return true;
}

bool StorageManager::fileExists(const char* path) {
    if (!_initialized && !begin()) return false;
    return LittleFS.exists(path);
}

bool StorageManager::removeFile(const char* path) {
    if (!_initialized && !begin()) return false;
    return LittleFS.remove(path);
}

void StorageManager::factoryReset() {
    Serial.println(F("[STORAGE] Performing Factory Reset..."));
    _bootCount = 1;
    removeFile(FILE_SYSTEM_CONFIG);
    removeFile(FILE_WIFI_CONFIG);
    removeFile(FILE_GPIO_CONFIG);
    removeFile(FILE_RULES_CONFIG);
    Serial.println(F("[STORAGE] Configuration files wiped."));
}

size_t StorageManager::getFlashTotalBytes() {
    FSInfo fs_info;
    if (LittleFS.info(fs_info)) {
        return fs_info.totalBytes;
    }
    return 0;
}

size_t StorageManager::getFlashUsedBytes() {
    FSInfo fs_info;
    if (LittleFS.info(fs_info)) {
        return fs_info.usedBytes;
    }
    return 0;
}

size_t StorageManager::getFlashFreeBytes() {
    FSInfo fs_info;
    if (LittleFS.info(fs_info)) {
        return (fs_info.totalBytes > fs_info.usedBytes) ? (fs_info.totalBytes - fs_info.usedBytes) : 0;
    }
    return 0;
}
