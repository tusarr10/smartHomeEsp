#include "ota_manager.h"
#include <LittleFS.h>

extern "C" uint32_t _FS_start;
extern "C" uint32_t _FS_end;

OtaManager::OtaManager()
    : _isUpdating(false),
      _command(U_FLASH),
      _lastError(""),
      _writtenSize(0),
      _updateSuccess(false),
      _targetType("") {}

OtaManager& OtaManager::getInstance() {
    static OtaManager instance;
    return instance;
}

bool OtaManager::begin(const String& hostname) {
    Serial.printf("[OTA] Web OTA ready on hostname: %s\n", hostname.c_str());
    return true;
}

void OtaManager::loop() {
    // Web OTA is driven by HTTP POST requests (/api/ota/upload)
}

void OtaManager::setExpectedMD5(const String& md5) {
    if (md5.length() == 32) {
        Update.setMD5(md5.c_str());
        Serial.printf("[OTA] Expected MD5 registered: %s\n", md5.c_str());
    }
}

void OtaManager::handleUploadStart(const String& filename, const String& targetType) {
    _isUpdating = true;
    _lastError = "";
    _writtenSize = 0;
    _updateSuccess = false;
    _targetType = targetType;
    Serial.printf("[OTA] Web upload started: %s (Type: %s)\n", filename.c_str(), targetType.c_str());

    String lower = filename;
    lower.toLowerCase();
    uint32_t maxSpace = 0;

    // Explicit type override takes highest priority; filename heuristics as fallback
    if (targetType.equalsIgnoreCase("fs") || lower.indexOf("littlefs") >= 0 || lower.indexOf("spiffs") >= 0 || lower.indexOf("fs.bin") >= 0) {
        _command = U_FS;
        LittleFS.end();
        maxSpace = ((size_t)&_FS_end - (size_t)&_FS_start);
        Serial.printf("[OTA] Initializing Filesystem Update (U_FS) max space: %u bytes\n", (unsigned int)maxSpace);
    } else {
        _command = U_FLASH;
        maxSpace = (ESP.getFreeSketchSpace() - 0x1000) & ~0xFFF;
        Serial.printf("[OTA] Initializing Firmware Update (U_FLASH) max space: %u bytes\n", (unsigned int)maxSpace);
    }

    if (!Update.begin(maxSpace, _command)) {
        _lastError = String(F("Update.begin failed: ")) + String(Update.getErrorString());
        Update.printError(Serial);
    }
}

void OtaManager::handleUploadWrite(uint8_t* data, size_t len) {
    if (_lastError.length() > 0) return;

    if (_writtenSize == 0 && len > 0) {
        // Verification 1: Sketch Firmware must start with ESP8266 magic byte 0xE9
        if (_command == U_FLASH) {
            if (data[0] != 0xE9) {
                _lastError = F("Verification failed: Magic byte 0xE9 not found. This is not a valid ESP8266 firmware binary.");
                Serial.printf("[OTA] ERROR: First byte is 0x%02X, expected 0xE9\n", data[0]);
                Update.end();
                return;
            }
        }
        // Verification 2: LittleFS image must NOT be a sketch binary (prevents accidental firmware flash to FS)
        else if (_command == U_FS) {
            if (data[0] == 0xE9) {
                _lastError = F("Verification failed: Detected firmware binary (0xE9) in LittleFS upload. Did you select firmware.bin by mistake?");
                Serial.println(F("[OTA] ERROR: Attempted to flash firmware binary into LittleFS partition"));
                Update.end();
                return;
            }
        }
    }

    if (Update.write(data, len) != len) {
        _lastError = String(F("Update.write failed: ")) + String(Update.getErrorString());
        Update.printError(Serial);
        return;
    }

    _writtenSize += len;
}

void OtaManager::handleUploadFinish() {
    if (_lastError.length() > 0) return;

    if (Update.end(true)) {
        _updateSuccess = true;
        _isUpdating = false;
        String typeStr = (_command == U_FS) ? F("Filesystem (LittleFS)") : F("Application Firmware");
        Serial.printf("[OTA] %s successfully verified and flashed: %u bytes!\n", typeStr.c_str(), (unsigned int)_writtenSize);
    } else {
        _lastError = String(F("Verification/Flash failed: ")) + String(Update.getErrorString());
        Update.printError(Serial);
        _isUpdating = false;
    }
}

void OtaManager::handleUploadAbort() {
    Update.end();
    _isUpdating = false;
    _lastError = F("Upload aborted by client or network drop");
    Serial.println(F("[OTA] Upload aborted by client"));
}

void OtaManager::handleUploadEnd(ESP8266WebServer& server) {
    if (_updateSuccess) {
        String typeStr = (_command == U_FS) ? F("LittleFS Filesystem") : F("Application Firmware");
        server.send(200, "application/json", "{\"success\":true,\"message\":\"" + typeStr + " verified and flashed successfully! Device will reboot in 2 seconds.\"}");
        delay(1000);
        ESP.restart();
    } else {
        String err = (_lastError.length() > 0) ? _lastError : F("Unknown update verification error");
        server.send(400, "application/json", "{\"success\":false,\"error\":\"" + err + "\"}");
        _isUpdating = false;
    }
}
