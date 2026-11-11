#include "ota_manager.h"

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
    // Driven by HTTP POST requests (/api/ota/upload)
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
    Serial.printf("[OTA] Web upload started: %s\n", filename.c_str());

    _command = U_FLASH;
    uint32_t maxSpace = (ESP.getFreeSketchSpace() - 0x1000) & ~0xFFF;
    Serial.printf("[OTA] Initializing Firmware Update max space: %u bytes\n", (unsigned int)maxSpace);

    if (!Update.begin(maxSpace, _command)) {
        _lastError = String(F("Update.begin failed: ")) + String(Update.getErrorString());
        Update.printError(Serial);
    }
}

void OtaManager::handleUploadWrite(uint8_t* data, size_t len) {
    if (_lastError.length() > 0) return;

    if (_writtenSize == 0 && len > 0) {
        // Verification: Sketch Firmware must start with ESP8266 magic byte 0xE9
        if (data[0] != 0xE9) {
            _lastError = F("Verification failed: Magic byte 0xE9 not found. Not a valid ESP8266 firmware binary.");
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
        Serial.printf("[OTA] Application Firmware successfully verified and flashed: %u bytes!\n", (unsigned int)_writtenSize);
    } else {
        _lastError = String(F("Verification/Flash failed: ")) + String(Update.getErrorString());
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
        server.send(200, "application/json", F("{\"success\":true,\"message\":\"Firmware flashed successfully! Rebooting in 2 seconds...\"}"));
        delay(1000);
        ESP.restart();
    } else {
        String err = (_lastError.length() > 0) ? _lastError : F("Unknown update verification error");
        server.send(400, "application/json", "{\"success\":false,\"error\":\"" + err + "\"}");
        _isUpdating = false;
    }
}
