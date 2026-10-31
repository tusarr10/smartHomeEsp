#include "receiver_client.h"
#include "storage_manager.h"
#include "wifi_manager.h"
#include "gpio_manager.h"
#include "automation.h"
#include "web_server.h" // For Logger
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>

ReceiverClient::ReceiverClient()
    : _lastReportTime(0),
      _lastStateChangePushTime(0),
      _pendingStateChange(false),
      _packetsSent(0),
      _packetsFailed(0),
      _lastSyncTimestamp("Never"),
      _lastSyncStatus("Not configured"),
      _lastServerResponse(""),
      _lastStatusCode(0) {
}

ReceiverClient& ReceiverClient::getInstance() {
    static ReceiverClient instance;
    return instance;
}

void ReceiverClient::begin() {
    // Generate default Node ID from MAC if not set
    String mac = WiFi.macAddress();
    mac.replace(":", "");
    _config.nodeId = "NODE-" + mac;

    loadFromStorage();
    _lastReportTime = millis();
    Serial.println(F("[RECEIVER] Multi-node receiver client initialized"));
}

void ReceiverClient::loop() {
    if (!WifiManager::getInstance().isSTAConnected()) return;
    if (!_config.enabled) return;

    unsigned long now = millis();

    // 1. Check for pending state change events (debounced by 600ms)
    if (_pendingStateChange) {
        if (now - _lastStateChangePushTime >= 600) {
            _pendingStateChange = false;
            _lastStateChangePushTime = now;
            String res;
            int code = 0;
            pushTelemetry("gpio_change", res, code);
        }
    }

    // 2. Periodic heartbeat telemetry reporting
    unsigned long intervalMs = (_config.reportIntervalSec < 2 ? 10 : _config.reportIntervalSec) * 1000UL;
    if (now - _lastReportTime >= intervalMs) {
        _lastReportTime = now;
        String res;
        int code = 0;
        pushTelemetry("heartbeat", res, code);
    }
}

void ReceiverClient::onGpioStateChanged(uint8_t gpioId, bool newState) {
    (void)gpioId;
    (void)newState;
    if (_config.enabled && _config.sendOnStateChange) {
        _pendingStateChange = true;
    }
}

String ReceiverClient::buildTelemetryPayload(const String& eventType) {
    DynamicJsonDocument doc(2048);
    doc["nodeId"] = _config.nodeId;
    doc["nodeName"] = _config.nodeName;
    doc["eventType"] = eventType;
    doc["timestamp"] = AutomationEngine::getInstance().getFormattedTime();
    time_t now = time(nullptr);
    doc["epoch"] = (unsigned long)now;
    doc["ip"] = WiFi.localIP().toString();
    doc["gateway"] = WiFi.gatewayIP().toString();
    doc["mac"] = WiFi.macAddress();
    doc["rssi"] = WiFi.RSSI();
    doc["uptimeSec"] = millis() / 1000UL;
    doc["freeHeap"] = ESP.getFreeHeap();
    doc["firmwareVersion"] = FIRMWARE_VERSION;

    if (_config.authToken.length() > 0) {
        doc["token"] = _config.authToken;
    }

    // Channels payload
    JsonArray gpios = doc.createNestedArray("channels");
    GpioManager::getInstance().toJson(gpios);

    String output;
    serializeJson(doc, output);
    return output;
}

bool ReceiverClient::sendHttp(const String& payload, String& outResponse, int& outCode) {
    WiFiClient client;
    HTTPClient http;

    client.setTimeout(3500);
    String path = _config.httpPath;
    if (!path.startsWith("/")) path = "/" + path;
    String url = "http://" + _config.serverHost + ":" + String(_config.serverPort) + path;

    if (!http.begin(client, url)) {
        outCode = -1;
        outResponse = F("HTTP client initialization failed");
        return false;
    }

    http.setTimeout(3500);
    http.addHeader(F("Content-Type"), F("application/json"));
    http.addHeader(F("X-Node-ID"), _config.nodeId);
    if (_config.authToken.length() > 0) {
        http.addHeader(F("Authorization"), "Bearer " + _config.authToken);
    }

    int httpCode = http.POST(payload);
    outCode = httpCode;

    if (httpCode > 0) {
        outResponse = http.getString();
        http.end();
        return (httpCode >= 200 && httpCode < 300);
    } else {
        outResponse = http.errorToString(httpCode);
        http.end();
        return false;
    }
}

bool ReceiverClient::sendTcp(const String& payload, String& outResponse, int& outCode) {
    WiFiClient client;
    client.setTimeout(3500);

    if (!client.connect(_config.serverHost.c_str(), _config.serverPort)) {
        outCode = -2;
        outResponse = F("TCP Connection failed (Server unreachable / Connection refused)");
        return false;
    }

    // Send JSON telemetry packet with newline delimiter
    client.println(payload);
    client.flush();

    // Read response line if available within 2000ms
    unsigned long startWait = millis();
    String response = "";
    while (client.connected() && (millis() - startWait < 2000)) {
        while (client.available()) {
            char c = client.read();
            if (c == '\n' || c == '\r') {
                if (response.length() > 0) break;
            } else {
                response += c;
            }
        }
        if (response.length() > 0) break;
        delay(10);
    }

    client.stop();
    outCode = 200;
    outResponse = (response.length() > 0) ? response : F("OK (No response payload)");
    return true;
}

bool ReceiverClient::pushTelemetry(const String& eventType, String& outResult, int& outCode) {
    if (!WifiManager::getInstance().isSTAConnected()) {
        outCode = -3;
        outResult = F("Wi-Fi not connected to home router");
        _lastSyncStatus = outResult;
        return false;
    }

    if (_config.serverHost.length() == 0) {
        outCode = -4;
        outResult = F("Server Host/IP is empty");
        _lastSyncStatus = outResult;
        return false;
    }

    String payload = buildTelemetryPayload(eventType);
    String response = "";
    int code = 0;
    bool ok = false;

    if (_config.protocol == RECEIVER_PROTO_HTTP) {
        ok = sendHttp(payload, response, code);
    } else {
        ok = sendTcp(payload, response, code);
    }

    outCode = code;
    outResult = response;

    _lastSyncTimestamp = AutomationEngine::getInstance().getFormattedTime();
    _lastStatusCode = code;
    _lastServerResponse = (response.length() > 256) ? response.substring(0, 256) + "..." : response;

    if (ok) {
        _packetsSent++;
        _lastSyncStatus = "OK (Code " + String(code) + ")";
        Logger::log(String(F("[RECEIVER] Pushed telemetry (Event: ")) + eventType + F(", Code: ") + String(code) + F(")"));
        processServerCommands(response);
    } else {
        _packetsFailed++;
        _lastSyncStatus = "Failed: " + response + " (" + String(code) + ")";
        Logger::log(String(F("[RECEIVER] Push failed: ")) + response + F(" (Code: ") + String(code) + F(")"));
    }

    return ok;
}

void ReceiverClient::processServerCommands(const String& response) {
    if (response.length() == 0 || !response.startsWith("{")) return;

    DynamicJsonDocument doc(1024);
    DeserializationError err = deserializeJson(doc, response);
    if (err) return;

    auto executeCmd = [](JsonObject cmd) {
        String action = cmd["action"] | "";
        uint8_t id = cmd["id"] | (uint8_t)(cmd["gpioId"] | 0);

        if (action.equalsIgnoreCase("setState")) {
            bool state = cmd["state"] | false;
            GpioManager::getInstance().setState(id, state);
            Logger::log(String(F("[RECEIVER] Remote cmd setState ID=")) + String(id) + F(" State=") + String(state));
        } else if (action.equalsIgnoreCase("toggle")) {
            GpioManager::getInstance().toggle(id);
            Logger::log(String(F("[RECEIVER] Remote cmd toggle ID=")) + String(id));
        } else if (action.equalsIgnoreCase("pulse")) {
            unsigned long dur = cmd["duration"] | 500;
            GpioManager::getInstance().pulse(id, dur);
            Logger::log(String(F("[RECEIVER] Remote cmd pulse ID=")) + String(id));
        } else if (action.equalsIgnoreCase("reboot")) {
            Logger::log(F("[RECEIVER] Remote cmd reboot triggered by central server"));
            delay(500);
            ESP.restart();
        }
    };

    if (doc.containsKey("commands") && doc["commands"].is<JsonArray>()) {
        JsonArray commands = doc["commands"].as<JsonArray>();
        for (JsonObject cmd : commands) {
            executeCmd(cmd);
        }
    } else if (doc.containsKey("action")) {
        JsonObject cmd = doc.as<JsonObject>();
        executeCmd(cmd);
    }
}

void ReceiverClient::setConfig(const ReceiverConfig& cfg) {
    _config = cfg;
    saveToStorage();
}

void ReceiverClient::toJson(JsonObject& obj) const {
    obj["enabled"] = _config.enabled;
    obj["serverHost"] = _config.serverHost;
    obj["serverPort"] = _config.serverPort;
    obj["protocol"] = (int)_config.protocol;
    obj["protocolName"] = (_config.protocol == RECEIVER_PROTO_HTTP) ? F("HTTP POST (REST)") : F("Raw TCP Socket (Stream)");
    obj["httpPath"] = _config.httpPath;
    obj["reportIntervalSec"] = _config.reportIntervalSec;
    obj["sendOnStateChange"] = _config.sendOnStateChange;
    obj["nodeId"] = _config.nodeId;
    obj["nodeName"] = _config.nodeName;
    obj["authToken"] = _config.authToken;
}

void ReceiverClient::getStatusJson(JsonObject& obj) const {
    toJson(obj);
    obj["packetsSent"] = _packetsSent;
    obj["packetsFailed"] = _packetsFailed;
    obj["lastSyncTimestamp"] = _lastSyncTimestamp;
    obj["lastSyncStatus"] = _lastSyncStatus;
    obj["lastStatusCode"] = _lastStatusCode;
    obj["lastServerResponse"] = _lastServerResponse;
    obj["staConnected"] = WifiManager::getInstance().isSTAConnected();
    String dest = (_config.protocol == RECEIVER_PROTO_HTTP)
        ? ("http://" + _config.serverHost + ":" + String(_config.serverPort) + _config.httpPath)
        : ("tcp://" + _config.serverHost + ":" + String(_config.serverPort));
    obj["serverEndpoint"] = dest;
}

bool ReceiverClient::loadFromStorage() {
    DynamicJsonDocument doc(1024);
    if (!StorageManager::getInstance().loadJsonFile(FILE_RECEIVER_CONFIG, doc)) {
        return false;
    }

    _config.enabled = doc["enabled"] | false;
    _config.serverHost = doc["serverHost"] | "192.168.1.10";
    _config.serverPort = doc["serverPort"] | 2000;
    _config.protocol = (ReceiverProtocol)(doc["protocol"] | (int)RECEIVER_PROTO_HTTP);
    _config.httpPath = doc["httpPath"] | "/api/node/telemetry";
    _config.reportIntervalSec = doc["reportIntervalSec"] | 10;
    _config.sendOnStateChange = doc.containsKey("sendOnStateChange") ? doc["sendOnStateChange"].as<bool>() : true;
    _config.nodeName = doc["nodeName"] | "SmartHome-Node";
    _config.authToken = doc["authToken"] | "";

    if (doc.containsKey("nodeId") && doc["nodeId"].as<String>().length() > 0) {
        _config.nodeId = doc["nodeId"].as<String>();
    }

    return true;
}

bool ReceiverClient::saveToStorage() {
    DynamicJsonDocument doc(1024);
    JsonObject obj = doc.to<JsonObject>();
    toJson(obj);
    return StorageManager::getInstance().saveJsonFile(FILE_RECEIVER_CONFIG, doc);
}
