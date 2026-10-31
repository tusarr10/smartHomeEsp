#ifndef RECEIVER_CLIENT_H
#define RECEIVER_CLIENT_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"

enum ReceiverProtocol {
    RECEIVER_PROTO_HTTP = 0,   // HTTP/REST POST JSON
    RECEIVER_PROTO_TCP  = 1    // Raw TCP Socket JSON Stream (e.g. port 2000)
};

struct ReceiverConfig {
    bool enabled = false;
    String serverHost = "192.168.1.10";
    uint16_t serverPort = 2000;
    ReceiverProtocol protocol = RECEIVER_PROTO_HTTP;
    String httpPath = "/api/node/telemetry";
    uint32_t reportIntervalSec = 10;
    bool sendOnStateChange = true;
    String nodeId = "";
    String nodeName = "SmartHome-Node";
    String authToken = "";
};

class ReceiverClient {
public:
    static ReceiverClient& getInstance();

    void begin();
    void loop();

    // Trigger an immediate transmission with an event type ("heartbeat", "gpio_change", "boot", "test", "manual_push")
    bool pushTelemetry(const String& eventType, String& outResult, int& outCode);

    // Configuration
    const ReceiverConfig& getConfig() const { return _config; }
    void setConfig(const ReceiverConfig& cfg);
    void toJson(JsonObject& obj) const;
    void getStatusJson(JsonObject& obj) const;

    // Load & Save to LittleFS
    bool loadFromStorage();
    bool saveToStorage();

    // Event hooks
    void onGpioStateChanged(uint8_t gpioId, bool newState);

private:
    ReceiverClient();
    ReceiverClient(const ReceiverClient&) = delete;
    ReceiverClient& operator=(const ReceiverClient&) = delete;

    String buildTelemetryPayload(const String& eventType);
    bool sendHttp(const String& payload, String& outResponse, int& outCode);
    bool sendTcp(const String& payload, String& outResponse, int& outCode);
    void processServerCommands(const String& response);

    ReceiverConfig _config;
    unsigned long _lastReportTime;
    unsigned long _lastStateChangePushTime;
    bool _pendingStateChange;

    // Telemetry Statistics
    unsigned long _packetsSent;
    unsigned long _packetsFailed;
    String _lastSyncTimestamp;
    String _lastSyncStatus;
    String _lastServerResponse;
    int _lastStatusCode;
};

#endif // RECEIVER_CLIENT_H
