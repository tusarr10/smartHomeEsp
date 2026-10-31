#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <Arduino.h>
#include <ESP8266WebServer.h>
#include <ArduinoJson.h>
#include <vector>
#include "config.h"

struct LogEntry {
    unsigned long timestampMs;
    String message;
};

class Logger {
public:
    static void log(const String& msg);
    static void getLogsJson(JsonArray& arr);
private:
    static std::vector<LogEntry> _logs;
};

class WebServerManager {
public:
    static WebServerManager& getInstance();

    bool begin();
    void loop();

    String getDeviceName() const { return _deviceName; }
    void setDeviceName(const String& name);

private:
    WebServerManager();
    ESP8266WebServer _server;
    String _deviceName;
    File _fsUploadFile;

    void registerRoutes();
    void registerCaptiveRoutes();
    void registerApiRoutes();
    void registerStaticRoutes();

    bool handleFileRead(String path);
    void sendJsonResponse(int code, bool success, const String& message);
    bool checkAuthOrReject();

    // Embedded Fallback Web Assets in PROGMEM
    void serveEmbeddedDashboard();
};

#endif // WEB_SERVER_H
