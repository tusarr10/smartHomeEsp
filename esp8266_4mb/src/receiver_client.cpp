#include "receiver_client.h"
#include "storage_manager.h"
#include "wifi_manager.h"
#include "gpio_manager.h"
#include "automation.h"
#include "web_server.h" // For Logger
#include <ESP8266HTTPClient.h>

ReceiverClient::ReceiverClient()
    : _lastReportTime(0),
      _lastStateChangePushTime(0),
      _pendingStateChange(false),
      _state(RC_STATE_IDLE),
      _stateStartTime(0),
      _activeEventType(""),
      _rxLen(0),
      _packetsSent(0),
      _packetsFailed(0),
      _lastSyncTimestamp("Never"),
      _lastSyncStatus("Not configured"),
      _lastServerResponse(""),
      _lastStatusCode(0),
      _ackCount(0) {
    _rxBuf[0] = '\0';
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
    _state = RC_STATE_IDLE;
    Serial.println(F("[RECEIVER] Multi-node receiver client initialized (Async TCP enabled)"));
}

void ReceiverClient::loop() {
    if (!WifiManager::getInstance().isSTAConnected()) {
        if (_state != RC_STATE_IDLE) {
            _tcpClient.stop(10);
            _state = RC_STATE_IDLE;
        }
        return;
    }
    if (!_config.enabled) return;

    unsigned long now = millis();

    switch (_state) {
        case RC_STATE_IDLE: {
            // 1. Debounced event push on GPIO state change
            if (_pendingStateChange) {
                if (now - _lastStateChangePushTime >= 400) {
                    _pendingStateChange = false;
                    _lastStateChangePushTime = now;
                    startAsyncPush("gpio_change");
                }
                break;
            }

            // 2. Periodic heartbeat / telemetry reporting (if reportIntervalSec > 0)
            if (_config.reportIntervalSec > 0) {
                unsigned long intervalMs = _config.reportIntervalSec * 1000UL;
                if (now - _lastReportTime >= intervalMs) {
                    _lastReportTime = now;
                    startAsyncPush("heartbeat");
                }
            }
            break;
        }

        case RC_STATE_SENDING: {
            if (!_tcpClient.connected()) {
                _packetsFailed++;
                _lastSyncStatus = F("TCP Dropped before send");
                _lastStatusCode = -2;
                _tcpClient.stop(10);
                _state = RC_STATE_IDLE;
                break;
            }

            // Stream telemetry JSON directly into WiFiClient - zero intermediate String on heap!
            DynamicJsonDocument doc(1536);
            fillTelemetryDoc(doc, _activeEventType.c_str());
            serializeJson(doc, _tcpClient);
            _tcpClient.print('\n');
            _tcpClient.flush(50);

            _rxLen = 0;
            _rxBuf[0] = '\0';
            _state = RC_STATE_AWAITING_REPLY;
            _stateStartTime = now;
            break;
        }

        case RC_STATE_AWAITING_REPLY: {
            // Non-blocking read of available bytes (0ms loop delay)
            while (_tcpClient.available() && _rxLen < (sizeof(_rxBuf) - 1)) {
                char c = (char)_tcpClient.read();
                if (c == '\n' || c == '\r') {
                    if (_rxLen > 0) {
                        _rxBuf[_rxLen] = '\0';
                        finishAsyncPush(true);
                        return;
                    }
                } else {
                    _rxBuf[_rxLen++] = c;
                }
            }

            // Server disconnected after transmission (normal server-side close)
            if (!_tcpClient.connected() && !_tcpClient.available()) {
                _rxBuf[_rxLen] = '\0';
                finishAsyncPush(true);
                return;
            }

            // Timeout after 1500ms
            if (now - _stateStartTime > 1500) {
                _rxBuf[_rxLen] = '\0';
                finishAsyncPush(_rxLen > 0);
                return;
            }
            break;
        }
    }
}

void ReceiverClient::startAsyncPush(const char* eventType) {
    if (_state != RC_STATE_IDLE) return;
    if (!WifiManager::getInstance().isSTAConnected()) return;
    if (_config.serverHost.length() == 0) return;

    if (_config.protocol == RECEIVER_PROTO_HTTP) {
        String res;
        int code = 0;
        sendHttp(eventType, res, code);
        return;
    }

    _activeEventType = eventType;
    _tcpClient.setTimeout(800);
    _stateStartTime = millis();

    if (!_tcpClient.connect(_config.serverHost.c_str(), _config.serverPort)) {
        _packetsFailed++;
        _lastSyncStatus = F("TCP Connection failed");
        _lastStatusCode = -2;
        _tcpClient.stop(10);
        _state = RC_STATE_IDLE;
        return;
    }

    _state = RC_STATE_SENDING;
}

void ReceiverClient::finishAsyncPush(bool ok) {
    _tcpClient.stop(10);
    _lastSyncTimestamp = AutomationEngine::getInstance().getFormattedTime();

    if (ok) {
        _packetsSent++;
        _lastStatusCode = 200;
        _lastSyncStatus = F("OK (Code 200)");
        if (_rxLen > 0) {
            _lastServerResponse = _rxBuf;
            processServerCommands(_rxBuf);
        } else {
            _lastServerResponse = F("OK (No response payload)");
        }
    } else {
        _packetsFailed++;
        _lastStatusCode = -2;
        _lastSyncStatus = F("TCP ACK Timeout");
        _lastServerResponse = F("Timeout waiting for server ACK");
    }

    _state = RC_STATE_IDLE;
}

void ReceiverClient::onGpioStateChanged(uint8_t gpioId, bool newState) {
    (void)gpioId;
    (void)newState;
    if (_config.enabled && _config.sendOnStateChange) {
        _pendingStateChange = true;
    }
}

void ReceiverClient::fillTelemetryDoc(DynamicJsonDocument& doc, const char* eventType) {
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

    // Application-Level Command Acknowledgements
    if (_ackCount > 0) {
        JsonArray acks = doc.createNestedArray("acks");
        for (size_t i = 0; i < _ackCount; i++) {
            JsonObject a = acks.createNestedObject();
            a["command_uuid"] = _pendingAcks[i].commandUuid;
            a["success"] = _pendingAcks[i].success;
            a["status"] = "ACKNOWLEDGED";
        }
        _ackCount = 0;
    }
}

bool ReceiverClient::sendHttp(const char* eventType, String& outResponse, int& outCode) {
    WiFiClient client;
    HTTPClient http;

    client.setTimeout(2500);
    String path = _config.httpPath;
    if (!path.startsWith("/")) path = "/" + path;
    String url = "http://" + _config.serverHost + ":" + String(_config.serverPort) + path;

    if (!http.begin(client, url)) {
        outCode = -1;
        outResponse = F("HTTP client initialization failed");
        return false;
    }

    http.setTimeout(2500);
    http.addHeader(F("Content-Type"), F("application/json"));
    http.addHeader(F("X-Node-ID"), _config.nodeId);
    if (_config.authToken.length() > 0) {
        http.addHeader(F("Authorization"), "Bearer " + _config.authToken);
    }

    DynamicJsonDocument doc(1536);
    fillTelemetryDoc(doc, eventType);
    String payload;
    serializeJson(doc, payload);

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

bool ReceiverClient::sendTcpSync(const char* eventType, String& outResponse, int& outCode) {
    WiFiClient client;
    client.setTimeout(1200);

    if (!client.connect(_config.serverHost.c_str(), _config.serverPort)) {
        outCode = -2;
        outResponse = F("TCP Connection failed (Server unreachable / Connection refused)");
        return false;
    }

    // Direct streaming to socket - no intermediate payload String!
    DynamicJsonDocument doc(1536);
    fillTelemetryDoc(doc, eventType);
    serializeJson(doc, client);
    client.print('\n');
    client.flush(50);

    // Read response line with 1000ms timeout
    unsigned long startWait = millis();
    char respBuf[256];
    size_t respLen = 0;
    respBuf[0] = '\0';

    while (client.connected() && (millis() - startWait < 1000)) {
        while (client.available() && respLen < sizeof(respBuf) - 1) {
            char c = (char)client.read();
            if (c == '\n' || c == '\r') {
                if (respLen > 0) break;
            } else {
                respBuf[respLen++] = c;
            }
        }
        if (respLen > 0) break;
        delay(5);
    }
    respBuf[respLen] = '\0';

    client.stop(10);
    outCode = 200;
    outResponse = (respLen > 0) ? String(respBuf) : String(F("OK (No response payload)"));
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

    // Stop any async connection in flight before doing synchronous push
    if (_state != RC_STATE_IDLE) {
        _tcpClient.stop(10);
        _state = RC_STATE_IDLE;
    }

    bool ok = false;
    if (_config.protocol == RECEIVER_PROTO_HTTP) {
        ok = sendHttp(eventType.c_str(), outResult, outCode);
    } else {
        ok = sendTcpSync(eventType.c_str(), outResult, outCode);
    }

    _lastSyncTimestamp = AutomationEngine::getInstance().getFormattedTime();
    _lastStatusCode = outCode;
    _lastServerResponse = (outResult.length() > 256) ? outResult.substring(0, 256) + "..." : outResult;

    if (ok) {
        _packetsSent++;
        _lastSyncStatus = "OK (Code " + String(outCode) + ")";
        Logger::log(String(F("[RECEIVER] Pushed telemetry (Event: ")) + eventType + F(", Code: ") + String(outCode) + F(")"));
        processServerCommands(outResult.c_str());
    } else {
        _packetsFailed++;
        _lastSyncStatus = "Failed: " + outResult + " (" + String(outCode) + ")";
        Logger::log(String(F("[RECEIVER] Push failed: ")) + outResult + F(" (Code: ") + String(outCode) + F(")"));
    }

    return ok;
}

void ReceiverClient::processServerCommands(const char* response) {
    if (!response || response[0] != '{') return;

    // Fixed stack document: 384 bytes stack (safe on ESP8266 stack, zero heap allocation!)
    StaticJsonDocument<384> doc;
    DeserializationError err = deserializeJson(doc, response);
    if (err) return;

    auto executeCmd = [this](JsonObject cmd) {
        String action = cmd["action"] | cmd["command_type"] | "";
        uint8_t id = cmd["id"] | (uint8_t)(cmd["gpioId"] | (cmd["channel_id"] | 0));
        String cmdUuid = cmd["command_uuid"] | cmd["commandId"] | "";

        bool success = false;
        if (action.equalsIgnoreCase("setState")) {
            bool state = cmd["state"] | false;
            success = GpioManager::getInstance().setState(id, state);
            Logger::log(String(F("[RECEIVER] Remote cmd setState ID=")) + String(id) + F(" State=") + String(state));
        } else if (action.equalsIgnoreCase("toggle")) {
            success = GpioManager::getInstance().toggle(id);
            Logger::log(String(F("[RECEIVER] Remote cmd toggle ID=")) + String(id));
        } else if (action.equalsIgnoreCase("pulse")) {
            unsigned long dur = cmd["duration"] | 500;
            success = GpioManager::getInstance().pulse(id, dur);
            Logger::log(String(F("[RECEIVER] Remote cmd pulse ID=")) + String(id));
        } else if (action.equalsIgnoreCase("reboot")) {
            Logger::log(F("[RECEIVER] Remote cmd reboot triggered by central server"));
            success = true;
            delay(500);
            ESP.restart();
        }

        if (cmdUuid.length() > 0 && _ackCount < MAX_PENDING_ACKS) {
            strncpy(_pendingAcks[_ackCount].commandUuid, cmdUuid.c_str(), sizeof(_pendingAcks[_ackCount].commandUuid) - 1);
            _pendingAcks[_ackCount].commandUuid[sizeof(_pendingAcks[_ackCount].commandUuid) - 1] = '\0';
            _pendingAcks[_ackCount].success = success;
            _ackCount++;
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
