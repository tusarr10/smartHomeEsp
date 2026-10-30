#include "ota_manager.h"
#include <LittleFS.h>

extern "C" uint32_t _FS_start;
extern "C" uint32_t _FS_end;

OtaManager::OtaManager()
    : _isUpdating(false),
      _command(U_FLASH),
      _lastError(""),
      _writtenSize(0),
      _updateSuccess(false) {}

OtaManager& OtaManager::getInstance() {
    static OtaManager instance;
    return instance;
}

bool OtaManager::begin(const String& hostname) {
    ArduinoOTA.setHostname(hostname.c_str());

    ArduinoOTA.onStart([]() {
        String type = (ArduinoOTA.getCommand() == U_FLASH) ? "sketch" : "filesystem";
        Serial.println("[OTA] ArduinoOTA Update Starting: " + type);
    });

    ArduinoOTA.onEnd([]() {
        Serial.println(F("\n[OTA] ArduinoOTA Complete"));
    });

    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        Serial.printf("[OTA] Progress: %u%%\r", (progress / (total / 100)));
    });

    ArduinoOTA.onError([](ota_error_t error) {
        Serial.printf("[OTA] Error [%u]: ", error);
        if (error == OTA_AUTH_ERROR) Serial.println(F("Auth Failed"));
        else if (error == OTA_BEGIN_ERROR) Serial.println(F("Begin Failed"));
        else if (error == OTA_CONNECT_ERROR) Serial.println(F("Connect Failed"));
        else if (error == OTA_RECEIVE_ERROR) Serial.println(F("Receive Failed"));
        else if (error == OTA_END_ERROR) Serial.println(F("End Failed"));
    });

    ArduinoOTA.begin();
    Serial.printf("[OTA] ArduinoOTA ready on hostname: %s\n", hostname.c_str());
    return true;
}

void OtaManager::loop() {
    ArduinoOTA.handle();
}

void OtaManager::handleUploadStart(const String& filename) {
    _isUpdating = true;
    _lastError = "";
    _writtenSize = 0;
    _updateSuccess = false;
    Serial.printf("[OTA] Web upload started: %s\n", filename.c_str());

    String lower = filename;
    lower.toLowerCase();
    uint32_t maxSpace = 0;

    if (lower.indexOf("littlefs") >= 0 || lower.indexOf("spiffs") >= 0 || lower.indexOf("fs.bin") >= 0) {
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
        // Verify ESP8266 flash binary magic byte (0xE9) only for sketch firmware
        if (_command == U_FLASH && data[0] != 0xE9) {
            _lastError = F("Invalid firmware binary (magic byte 0xE9 not found)");
            Serial.printf("[OTA] ERROR: First byte is 0x%02X, expected 0xE9\n", data[0]);
            Update.end();
            return;
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
        String typeStr = (_command == U_FS) ? F("Filesystem") : F("Firmware");
        Serial.printf("[OTA] %s successfully updated: %u bytes!\n", typeStr.c_str(), (unsigned int)_writtenSize);
    } else {
        _lastError = String(F("Update.end failed: ")) + String(Update.getErrorString());
        Update.printError(Serial);
        _isUpdating = false;
    }
}

void OtaManager::handleUploadAbort() {
    Update.end();
    _isUpdating = false;
    _lastError = F("Upload aborted by client");
    Serial.println(F("[OTA] Upload aborted by client"));
}

void OtaManager::handleUploadEnd(ESP8266WebServer& server) {
    if (_updateSuccess) {
        String typeStr = (_command == U_FS) ? F("Filesystem") : F("Firmware");
        server.send(200, "application/json", "{\"success\":true,\"message\":\"" + typeStr + " flashed successfully! Device will reboot in 2 seconds.\"}");
        delay(1000);
        ESP.restart();
    } else {
        String err = (_lastError.length() > 0) ? _lastError : F("Unknown update error");
        server.send(400, "application/json", "{\"success\":false,\"error\":\"" + err + "\"}");
        _isUpdating = false;
    }
}
