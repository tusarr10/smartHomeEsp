#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <Arduino.h>
#include <ESP8266WebServer.h>
#include <ArduinoJson.h>
#include "config.h"

class Logger {
public:
    static void log(const String& msg) { Serial.println(msg); }
    static void log(const __FlashStringHelper* msg) { Serial.println(msg); }
};

class WebServerManager {
public:
    static WebServerManager& getInstance();

    bool begin();
    void loop();

    String getDeviceName() const { return _deviceName; }
    void setDeviceName(const String& name);

    // Authentication verification helper
    bool isAuthorized(bool allowUnauthenticatedDiscovery = false);

private:
    WebServerManager();
    ESP8266WebServer _server;
    String _deviceName;

    void registerRoutes();
    void registerCaptiveRoutes();
    void registerApiRoutes();
    void registerStaticRoutes();

    void sendJsonResponse(int code, bool success, const String& message);

    // HTTP Handlers
    void handleStatus();
    void handleCommand();
    void handleSaveGpioConfig();

    // Built-in minimalist ESP-01 setup portal (Login, Wi-Fi Setup, Firmware Upload)
    void serveEmbeddedDashboard();
};

#endif // WEB_SERVER_H
