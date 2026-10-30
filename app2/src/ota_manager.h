#ifndef OTA_MANAGER_H
#define OTA_MANAGER_H

#include <Arduino.h>
#include <ESP8266WebServer.h>
#include <ArduinoOTA.h>
#include "config.h"

class OtaManager {
public:
    static OtaManager& getInstance();

    bool begin(const String& hostname);
    void loop();

    // Web OTA Handlers
    void handleUploadStart(const String& filename);
    void handleUploadWrite(uint8_t* data, size_t len);
    void handleUploadFinish();
    void handleUploadAbort();
    void handleUploadEnd(ESP8266WebServer& server);

    bool isUpdating() const { return _isUpdating; }
    size_t getWrittenSize() const { return _writtenSize; }
    String getLastError() const { return _lastError; }

private:
    OtaManager();
    bool _isUpdating;
    int _command;
    String _lastError;
    size_t _writtenSize;
    bool _updateSuccess;
};

#endif // OTA_MANAGER_H
