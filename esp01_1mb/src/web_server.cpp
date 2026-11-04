#include "web_server.h"
#include "storage_manager.h"
#include "auth_manager.h"
#include "wifi_manager.h"
#include "gpio_manager.h"
#include "automation.h"
#include "ota_manager.h"
#include "receiver_client.h"
#include <LittleFS.h>

// Initialize static circular Logger ring buffer
LogEntry Logger::_logs[LOG_RING_CAPACITY];
size_t Logger::_head = 0;
size_t Logger::_count = 0;

void Logger::log(const String& msg) {
    Serial.println(msg);

    size_t writeIdx;
    if (_count < LOG_RING_CAPACITY) {
        writeIdx = (_head + _count) % LOG_RING_CAPACITY;
        _count++;
    } else {
        writeIdx = _head;
        _head = (_head + 1) % LOG_RING_CAPACITY;
    }

    _logs[writeIdx].timestampMs = millis();
    strncpy(_logs[writeIdx].message, msg.c_str(), LOG_MSG_MAX_LEN - 1);
    _logs[writeIdx].message[LOG_MSG_MAX_LEN - 1] = '\0';
}

void Logger::log(const __FlashStringHelper* msg) {
    Serial.println(msg);

    size_t writeIdx;
    if (_count < LOG_RING_CAPACITY) {
        writeIdx = (_head + _count) % LOG_RING_CAPACITY;
        _count++;
    } else {
        writeIdx = _head;
        _head = (_head + 1) % LOG_RING_CAPACITY;
    }

    _logs[writeIdx].timestampMs = millis();
    strncpy_P(_logs[writeIdx].message, (PGM_P)msg, LOG_MSG_MAX_LEN - 1);
    _logs[writeIdx].message[LOG_MSG_MAX_LEN - 1] = '\0';
}

void Logger::getLogsJson(JsonArray& arr) {
    for (size_t i = 0; i < _count; i++) {
        size_t idx = (_head + i) % LOG_RING_CAPACITY;
        JsonObject obj = arr.createNestedObject();
        obj["uptimeMs"] = _logs[idx].timestampMs;
        obj["msg"] = _logs[idx].message;
    }
}

void Logger::clear() {
    _head = 0;
    _count = 0;
}

WebServerManager::WebServerManager() : _server(80), _deviceName(FIRMWARE_NAME) {}

WebServerManager& WebServerManager::getInstance() {
    static WebServerManager instance;
    return instance;
}

bool WebServerManager::begin() {
    DynamicJsonDocument doc(512);
    if (StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, doc)) {
        if (doc.containsKey("deviceName")) {
            _deviceName = doc["deviceName"].as<String>();
        }
    }

    const char* headerKeys[] = { "Cookie", "Authorization", "X-Session-Token", "X-File-MD5" };
    _server.collectHeaders(headerKeys, sizeof(headerKeys) / sizeof(char*));

    registerRoutes();
    _server.begin();
    Logger::log(F("[HTTP] Web server started on port 80"));
    return true;
}

void WebServerManager::loop() {
    _server.handleClient();
}

void WebServerManager::setDeviceName(const String& name) {
    if (name.length() > 0) {
        _deviceName = name;
        DynamicJsonDocument doc(512);
        StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, doc);
        doc["deviceName"] = _deviceName;
        StorageManager::getInstance().saveJsonFile(FILE_SYSTEM_CONFIG, doc);
    }
}

bool WebServerManager::checkAuthOrReject() {
    const ReceiverConfig& rcfg = ReceiverClient::getInstance().getConfig();
    if (rcfg.authToken.length() == 0) return true; // LAN trust if no token configured

    // Direct AP connection is trusted for captive portal setup
    if (WifiManager::getInstance().isAPActive()) {
        IPAddress clientIp = _server.client().remoteIP();
        IPAddress apIp = WiFi.softAPIP();
        if (clientIp[0] == apIp[0] && clientIp[1] == apIp[1] && clientIp[2] == apIp[2]) {
            return true;
        }
    }

    if (_server.hasHeader("Authorization")) {
        String authHeader = _server.header("Authorization");
        if (authHeader == ("Bearer " + rcfg.authToken)) return true;
    }
    if (_server.hasArg("token") && _server.arg("token") == rcfg.authToken) return true;
    if (_server.hasHeader("Cookie") && _server.header("Cookie").indexOf(rcfg.authToken) >= 0) return true;

    if (rcfg.enabled && rcfg.serverHost.length() > 0) {
        if (_server.client().remoteIP().toString() == rcfg.serverHost) return true;
    }

    if (AuthManager::getInstance().authenticate(_server)) return true;

    _server.send(401, "application/json", F("{\"error\":\"Unauthorized\"}"));
    return false;
}

void WebServerManager::sendJsonResponse(int code, bool success, const String& message) {
    String out = String(F("{\"success\":")) + (success ? F("true") : F("false")) +
                 F(",\"") + (success ? F("message") : F("error")) + F("\":\"") + message + F("\"}");
    _server.send(code, "application/json", out);
}

void WebServerManager::registerRoutes() {
    registerCaptiveRoutes();
    registerApiRoutes();
    registerStaticRoutes();

    // 404 Handler with Captive Portal Redirect
    _server.onNotFound([this]() {
        if (WifiManager::getInstance().isAPActive() && !WifiManager::getInstance().isSTAConnected()) {
            _server.sendHeader(F("Location"), String(F("http://")) + WiFi.softAPIP().toString() + F("/"), true);
            _server.send(302, F("text/plain"), F("Redirecting to captive setup..."));
            return;
        }

        _server.send(404, F("application/json"), F("{\"error\":\"Not Found\"}"));
    });
}

void WebServerManager::registerCaptiveRoutes() {
    auto captiveRedirect = [this]() {
        String target = String(F("http://")) + (WifiManager::getInstance().isAPActive() ? WiFi.softAPIP().toString() : WiFi.localIP().toString()) + F("/");
        _server.sendHeader(F("Location"), target, true);
        _server.send(302, F("text/plain"), F(""));
    };

    _server.on("/generate_204", captiveRedirect);
    _server.on("/gen_204", captiveRedirect);
    _server.on("/ncsi.txt", captiveRedirect);
    _server.on("/hotspot-detect.html", captiveRedirect);
    _server.on("/canonical.html", captiveRedirect);
    _server.on("/connecttest.txt", captiveRedirect);
    _server.on("/redirect", captiveRedirect);
    _server.on("/success.txt", captiveRedirect);
}

void WebServerManager::registerApiRoutes() {
    // === AUTHENTICATION ===
    _server.on("/api/auth/login", HTTP_POST, [this]() {
        StaticJsonDocument<256> doc;
        DeserializationError err = deserializeJson(doc, _server.arg("plain"));
        if (err) {
            sendJsonResponse(400, false, F("Invalid JSON payload"));
            return;
        }

        String user = doc["username"] | "";
        String pass = doc["password"] | "";
        String token;

        if (AuthManager::getInstance().login(user, pass, token)) {
            _server.sendHeader(F("Set-Cookie"), String(F("session=")) + token + F("; Path=/; HttpOnly"));
            StaticJsonDocument<256> resp;
            resp["success"] = true;
            resp["token"] = token;
            resp["username"] = user;
            String out;
            serializeJson(resp, out);
            _server.send(200, "application/json", out);
            Logger::log(String(F("[AUTH] User '")) + user + F("' authenticated"));
        } else {
            sendJsonResponse(401, false, F("Invalid username or password"));
        }
    });

    _server.on("/api/auth/check", HTTP_GET, [this]() {
        bool authed = AuthManager::getInstance().authenticate(_server);
        StaticJsonDocument<128> resp;
        resp["authenticated"] = authed;
        resp["adminUser"] = AuthManager::getInstance().getAdminUsername();
        String out;
        serializeJson(resp, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/auth/logout", HTTP_POST, [this]() {
        AuthManager::getInstance().logout(_server);
        _server.sendHeader(F("Set-Cookie"), F("session=; Path=/; Max-Age=0"));
        sendJsonResponse(200, true, F("Logged out successfully"));
    });

    // === SYSTEM OVERVIEW & DIAGNOSTICS STATUS ===
    _server.on("/api/status", HTTP_GET, [this]() {
        static uint32_t s_minFreeHeap = 0;
        uint32_t freeHeap = ESP.getFreeHeap();
        if (s_minFreeHeap == 0 || freeHeap < s_minFreeHeap) {
            s_minFreeHeap = freeHeap;
        }

        DynamicJsonDocument doc(1152);
        doc["deviceName"] = _deviceName;
        doc["firmwareVersion"] = FIRMWARE_VERSION;
        doc["hardware"] = HARDWARE_TARGET;
        doc["coreVersion"] = ESP.getCoreVersion();
        doc["sdkVersion"] = ESP.getSdkVersion();

        // System Uptime & Boot Counters
        doc["uptimeSec"] = millis() / 1000UL;
        doc["bootCount"] = StorageManager::getInstance().getBootCount();
        doc["cpuFreq"] = ESP.getCpuFreqMHz();
        doc["mac"] = WiFi.macAddress();
        doc["formattedTime"] = AutomationEngine::getInstance().getFormattedTime();

        // Reset Diagnostics
        doc["resetReason"] = ESP.getResetReason();
        doc["resetRaw"] = ESP.getResetInfo();
        doc["resetDetails"] = ESP.getResetReason();

        // Heap Memory Diagnostics
        doc["freeHeap"] = freeHeap;
        doc["minFreeHeap"] = s_minFreeHeap;
        doc["maxFreeBlock"] = ESP.getMaxFreeBlockSize();
        doc["heapFragPercent"] = ESP.getHeapFragmentation();

        // Flash Hardware Diagnostics
        doc["flashSize"] = ESP.getFlashChipRealSize();
        doc["flashConfigSize"] = ESP.getFlashChipSize();
        doc["flashSpeed"] = ESP.getFlashChipSpeed();
        doc["flashMode"] = F("DOUT");
        doc["flashChipId"] = String(ESP.getFlashChipId(), HEX);
        doc["sketchSize"] = ESP.getSketchSize();
        doc["freeSketchSpace"] = ESP.getFreeSketchSpace();

        // LittleFS Storage Diagnostics
        size_t fsTotal = StorageManager::getInstance().getFlashTotalBytes();
        size_t fsUsed = StorageManager::getInstance().getFlashUsedBytes();
        size_t fsFree = StorageManager::getInstance().getFlashFreeBytes();
        doc["fsTotal"] = fsTotal;
        doc["fsUsed"] = fsUsed;
        doc["fsFree"] = fsFree;
        doc["fsPercent"] = (fsTotal > 0) ? (fsUsed * 100) / fsTotal : 0;

        // Network & IP Diagnostics
        doc["wifiMode"] = WifiManager::getInstance().getMode();
        doc["apActive"] = WifiManager::getInstance().isAPActive();
        doc["apSsid"] = WifiManager::getInstance().getApSsid();
        doc["apIp"] = WifiManager::getInstance().getAPIP();
        doc["staConnected"] = WifiManager::getInstance().isSTAConnected();
        doc["staSsid"] = WifiManager::getInstance().getConnectedSSID();
        doc["staIp"] = WifiManager::getInstance().getSTAIP();
        doc["ip"] = doc["staConnected"] ? doc["staIp"] : doc["apIp"];
        doc["staGateway"] = WifiManager::getInstance().getSTAGateway();
        doc["staSubnet"] = WifiManager::getInstance().getSTASubnet();
        doc["rssi"] = WifiManager::getInstance().getSTARSSI();
        doc["wifiUptimeSec"] = WifiManager::getInstance().getWifiUptimeSec();
        doc["useStaticIp"] = WifiManager::getInstance().isStaticIp();
        doc["ipMode"] = WifiManager::getInstance().isStaticIp() ? F("Static IP") : F("DHCP Client");
        doc["dns1"] = WiFi.dnsIP(0).toString();
        doc["dns2"] = WiFi.dnsIP(1).toString();
        doc["ntpSynced"] = AutomationEngine::getInstance().isTimeSynced();
        doc["tzOffset"] = AutomationEngine::getInstance().getTimezoneOffset();
        doc["receiverEnabled"] = ReceiverClient::getInstance().getConfig().enabled;
        doc["receiverServer"] = ReceiverClient::getInstance().getConfig().serverHost + ":" + String(ReceiverClient::getInstance().getConfig().serverPort);

        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    // === API DISCOVERY & CATALOG ===
    _server.on("/api/all", HTTP_GET, [this]() {
        _server.send(200, "application/json", F("{\"title\":\"SmartHome ESP-01 Satellite API\",\"version\":\"" FIRMWARE_VERSION "\",\"endpoints\":[\"/api/status\",\"/api/gpio\",\"/api/gpio/state\",\"/api/wifi/status\",\"/api/wifi/scan\",\"/api/wifi/connect\",\"/api/receiver\",\"/api/ota/upload\"]}"));
    });

    // === WI-FI MANAGEMENT ===
    _server.on("/api/wifi/status", HTTP_GET, [this]() {
        DynamicJsonDocument doc(512);
        JsonObject obj = doc.to<JsonObject>();
        WifiManager::getInstance().getStatusJson(obj);
        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/wifi/scan", HTTP_GET, [this]() {
        if (!checkAuthOrReject()) return;

        std::vector<ScannedNetwork> list;
        WifiManager::getInstance().scanNetworks(list);

        DynamicJsonDocument doc(2048);
        JsonArray arr = doc.to<JsonArray>();
        for (const auto& n : list) {
            JsonObject o = arr.createNestedObject();
            o["ssid"] = n.ssid;
            o["rssi"] = n.rssi;
            o["channel"] = n.channel;
            o["isHidden"] = n.isHidden;
            switch (n.encryptionType) {
                case ENC_TYPE_NONE: o["encryption"] = "Open"; break;
                case ENC_TYPE_WEP:  o["encryption"] = "WEP"; break;
                case ENC_TYPE_TKIP: o["encryption"] = "WPA/PSK"; break;
                case ENC_TYPE_CCMP: o["encryption"] = "WPA2/PSK"; break;
                case ENC_TYPE_AUTO: o["encryption"] = "WPA/WPA2"; break;
                default:            o["encryption"] = "Secured"; break;
            }
        }
        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/wifi/connect", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(512);
        deserializeJson(doc, _server.arg("plain"));
        String ssid = doc["ssid"] | "";
        String pass = doc["password"] | "";
        bool useStatic = doc["useStaticIp"] | false;
        String staticIp = doc["staticIp"] | "";
        String gateway = doc["staticGateway"] | "";
        String subnet = doc["staticSubnet"] | "255.255.255.0";
        String dns1 = doc["staticDns1"] | "8.8.8.8";
        String dns2 = doc["staticDns2"] | "1.1.1.1";

        if (ssid.length() == 0) {
            sendJsonResponse(400, false, F("SSID cannot be empty"));
            return;
        }

        sendJsonResponse(200, true, F("Connecting to Wi-Fi. Please check status shortly."));
        _server.client().flush();
        WifiManager::getInstance().connectToRouter(ssid, pass, true, useStatic, staticIp, gateway, subnet, dns1, dns2);
        Logger::log(String(F("[WIFI] Saved credentials for '")) + ssid + F("' (IP Mode: ") + (useStatic ? F("Static IP") : F("DHCP")) + F(")"));
    });

    _server.on("/api/wifi/ip", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(512);
        deserializeJson(doc, _server.arg("plain"));
        bool useStatic = doc["useStaticIp"] | false;
        String staticIp = doc["staticIp"] | "";
        String gateway = doc["staticGateway"] | "";
        String subnet = doc["staticSubnet"] | "255.255.255.0";
        String dns1 = doc["staticDns1"] | "8.8.8.8";
        String dns2 = doc["staticDns2"] | "1.1.1.1";

        sendJsonResponse(200, true, F("IP configuration saved and applied."));
        _server.client().flush();
        WifiManager::getInstance().setIpConfig(useStatic, staticIp, gateway, subnet, dns1, dns2);
        Logger::log(String(F("[WIFI] Updated IP settings: Mode=")) + (useStatic ? F("Static IP") : F("DHCP")));
    });

    _server.on("/api/wifi/mode", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        StaticJsonDocument<128> doc;
        deserializeJson(doc, _server.arg("plain"));
        uint8_t mode = doc["mode"] | (uint8_t)WIFI_MODE_AP_ROUTER;

        WifiManager::getInstance().setMode(mode);
        Logger::log(String(F("[WIFI] Operating mode changed to ")) + String(mode));
        sendJsonResponse(200, true, F("Wi-Fi mode updated successfully"));
    });

    _server.on("/api/wifi/reset", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;
        WifiManager::getInstance().resetWifiCredentials();
        Logger::log(F("[WIFI] Wi-Fi credentials reset to factory defaults"));
        sendJsonResponse(200, true, F("Wi-Fi credentials erased. Started setup AP."));
    });

    // === GPIO / RELAY MANAGEMENT ===
    _server.on("/api/gpio", HTTP_GET, [this]() {
        _server.sendHeader(F("Cache-Control"), F("no-cache, no-store, must-revalidate"));
        DynamicJsonDocument doc(1536);
        JsonArray arr = doc.to<JsonArray>();
        GpioManager::getInstance().toJson(arr);
        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/gpio", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(512);
        deserializeJson(doc, _server.arg("plain"));

        uint8_t pin = doc["pin"] | 255;
        String name = doc["name"] | "";
        String room = doc["room"] | "";
        String func = doc["function"] | "Relay";
        bool activeLow = doc["activeLow"] | true;
        uint8_t initMode = doc["initialMode"] | 0;

        String err;
        if (GpioManager::getInstance().addChannel(pin, name, room, func, activeLow, initMode, err)) {
            Logger::log(String(F("[GPIO] Added new channel: ")) + name + F(" on pin ") + String(pin));
            sendJsonResponse(200, true, F("GPIO channel added"));
        } else {
            sendJsonResponse(400, false, err);
        }
    });

    _server.on("/api/gpio/update", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(512);
        deserializeJson(doc, _server.arg("plain"));

        uint8_t id = doc["id"] | 0;
        String name = doc["name"] | "";
        String room = doc["room"] | "";
        String func = doc["function"] | "Relay";
        bool activeLow = doc["activeLow"] | true;
        uint8_t initMode = doc["initialMode"] | 0;
        bool enabled = doc["enabled"] | true;

        String err;
        if (GpioManager::getInstance().updateChannel(id, name, room, func, activeLow, initMode, enabled, err)) {
            Logger::log(String(F("[GPIO] Updated channel ID: ")) + String(id));
            sendJsonResponse(200, true, F("GPIO channel updated"));
        } else {
            sendJsonResponse(400, false, err);
        }
    });

    _server.on("/api/gpio/delete", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        StaticJsonDocument<128> doc;
        deserializeJson(doc, _server.arg("plain"));
        uint8_t id = doc["id"] | 0;

        if (GpioManager::getInstance().removeChannel(id)) {
            Logger::log(String(F("[GPIO] Deleted channel ID: ")) + String(id));
            sendJsonResponse(200, true, F("GPIO channel removed"));
        } else {
            sendJsonResponse(404, false, F("Channel ID not found"));
        }
    });

    _server.on("/api/gpio/state", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        StaticJsonDocument<256> doc;
        deserializeJson(doc, _server.arg("plain"));

        uint8_t id = doc["id"] | 0;
        String action = doc["action"] | "";

        bool ok = false;
        if (action.equalsIgnoreCase("toggle")) {
            ok = GpioManager::getInstance().toggle(id);
        } else if (action.equalsIgnoreCase("pulse")) {
            unsigned long dur = doc["duration"] | 500;
            ok = GpioManager::getInstance().pulse(id, dur);
        } else if (doc.containsKey("state")) {
            bool state = doc["state"].as<bool>();
            ok = GpioManager::getInstance().setState(id, state);
        }

        if (ok) {
            sendJsonResponse(200, true, F("State updated"));
        } else {
            sendJsonResponse(400, false, F("Failed to set state or channel disabled"));
        }
    });

    // === DIRECT COMMAND EXECUTION & ACKNOWLEDGEMENT ===
    _server.on("/api/commands/execute", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        StaticJsonDocument<384> doc;
        if (deserializeJson(doc, _server.arg("plain"))) {
            sendJsonResponse(400, false, F("Invalid JSON command"));
            return;
        }

        String cmdId = doc["commandId"] | doc["command_uuid"] | "";
        String action = doc["action"] | doc["command_type"] | "";
        uint8_t gpioId = doc["id"] | (uint8_t)(doc["channel_id"] | 0);

        bool ok = false;
        if (action.equalsIgnoreCase("reboot")) {
            sendJsonResponse(200, true, F("Rebooting ESP-01..."));
            delay(500);
            ESP.restart();
            return;
        } else if (action.equalsIgnoreCase("setState")) {
            bool state = doc["state"] | false;
            ok = GpioManager::getInstance().setState(gpioId, state);
        } else if (action.equalsIgnoreCase("toggle")) {
            ok = GpioManager::getInstance().toggle(gpioId);
        } else if (action.equalsIgnoreCase("pulse")) {
            unsigned long dur = doc["duration"] | 500;
            ok = GpioManager::getInstance().pulse(gpioId, dur);
        } else if (action.equalsIgnoreCase("readInfo")) {
            ok = true;
        }

        String out = String(F("{\"success\":")) + (ok ? F("true") : F("false")) +
                     F(",\"commandId\":\"") + cmdId +
                     F("\",\"status\":\"") + (ok ? F("ACKNOWLEDGED") : F("FAILED")) + F("\"}");
        _server.send(ok ? 200 : 400, "application/json", out);
    });

    // === AUTOMATION RULES (Offloaded to Central Server) ===
    _server.on("/api/automation", HTTP_GET, [this]() {
        _server.send(200, "application/json", F("[]"));
    });

    _server.on("/api/automation", HTTP_POST, [this]() {
        sendJsonResponse(200, true, F("Automations managed by Central Server"));
    });

    _server.on("/api/automation/toggle", HTTP_POST, [this]() {
        sendJsonResponse(200, true, F("Automations managed by Central Server"));
    });

    _server.on("/api/automation/delete", HTTP_POST, [this]() {
        sendJsonResponse(200, true, F("Automations managed by Central Server"));
    });

    // === SETTINGS & MAINTENANCE ===
    _server.on("/api/settings", HTTP_GET, [this]() {
        DynamicJsonDocument doc(512);
        doc["deviceName"] = _deviceName;
        doc["apSsid"] = WifiManager::getInstance().getApSsid();
        doc["apPass"] = ""; // Never leak password in GET
        doc["timezoneOffset"] = AutomationEngine::getInstance().getTimezoneOffset();

        DynamicJsonDocument stored(512);
        if (StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, stored)) {
            if (stored.containsKey("tzOffset")) {
                doc["timezoneOffset"] = stored["tzOffset"].as<int32_t>();
            }
        }
        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/settings/ntp-sync", HTTP_POST, [this]() {
        sendJsonResponse(200, true, F("Time synchronized with Central Server"));
    });

    _server.on("/api/settings", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(512);
        deserializeJson(doc, _server.arg("plain"));

        if (doc.containsKey("deviceName")) {
            setDeviceName(doc["deviceName"].as<String>());
        }

        if (doc.containsKey("apSsid")) {
            String apSsid = doc["apSsid"].as<String>();
            String apPass = doc["apPass"] | "";
            WifiManager::getInstance().setApConfig(apSsid, apPass);
        }

        if (doc.containsKey("timezoneOffset")) {
            int32_t tz = doc["timezoneOffset"].as<int32_t>();
            AutomationEngine::getInstance().setTimezoneOffset(tz);
            DynamicJsonDocument sysDoc(512);
            StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, sysDoc);
            sysDoc["tzOffset"] = tz;
            StorageManager::getInstance().saveJsonFile(FILE_SYSTEM_CONFIG, sysDoc);
        }

        Logger::log(F("[SYS] System settings updated"));
        sendJsonResponse(200, true, F("Settings saved"));
    });

    _server.on("/api/settings/password", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        StaticJsonDocument<256> doc;
        deserializeJson(doc, _server.arg("plain"));

        String curr = doc["currentPassword"] | "";
        String next = doc["newPassword"] | "";

        if (AuthManager::getInstance().changePassword(curr, next)) {
            Logger::log(F("[AUTH] Administrator password updated"));
            sendJsonResponse(200, true, F("Password changed"));
        } else {
            sendJsonResponse(400, false, F("Current password incorrect or new password too short"));
        }
    });

    // === CENTRAL RECEIVER & MULTI-NODE TELEMETRY ===
    _server.on("/api/receiver", HTTP_GET, [this]() {
        DynamicJsonDocument doc(1024);
        JsonObject obj = doc.to<JsonObject>();
        ReceiverClient::getInstance().getStatusJson(obj);
        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/receiver", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(1024);
        deserializeJson(doc, _server.arg("plain"));

        ReceiverConfig cfg = ReceiverClient::getInstance().getConfig();
        if (doc.containsKey("enabled")) cfg.enabled = doc["enabled"].as<bool>();
        if (doc.containsKey("serverHost")) cfg.serverHost = doc["serverHost"].as<String>();
        if (doc.containsKey("serverPort")) cfg.serverPort = doc["serverPort"].as<uint16_t>();
        if (doc.containsKey("protocol")) cfg.protocol = (ReceiverProtocol)doc["protocol"].as<int>();
        if (doc.containsKey("httpPath")) cfg.httpPath = doc["httpPath"].as<String>();
        if (doc.containsKey("reportIntervalSec")) cfg.reportIntervalSec = doc["reportIntervalSec"].as<uint32_t>();
        if (doc.containsKey("sendOnStateChange")) cfg.sendOnStateChange = doc["sendOnStateChange"].as<bool>();
        if (doc.containsKey("nodeId") && doc["nodeId"].as<String>().length() > 0) cfg.nodeId = doc["nodeId"].as<String>();
        if (doc.containsKey("nodeName")) cfg.nodeName = doc["nodeName"].as<String>();
        if (doc.containsKey("authToken")) cfg.authToken = doc["authToken"].as<String>();

        ReceiverClient::getInstance().setConfig(cfg);
        Logger::log(String(F("[RECEIVER] Config updated: Host=")) + cfg.serverHost + ":" + String(cfg.serverPort) + " Enabled=" + String(cfg.enabled));
        sendJsonResponse(200, true, F("Receiver server configuration saved successfully"));
    });

    _server.on("/api/receiver/test", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        unsigned long startMs = millis();
        String result;
        int code = 0;
        bool ok = ReceiverClient::getInstance().pushTelemetry("test_ping", result, code);
        unsigned long dur = millis() - startMs;

        DynamicJsonDocument resp(512);
        resp["success"] = ok;
        resp["code"] = code;
        resp["durationMs"] = dur;
        resp["response"] = result;
        if (ok) {
            resp["message"] = String(F("Successfully connected! Server responded in ")) + String(dur) + F("ms");
        } else {
            resp["message"] = String(F("Test failed: ")) + result;
        }

        String out;
        serializeJson(resp, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/receiver/push", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        String result;
        int code = 0;
        bool ok = ReceiverClient::getInstance().pushTelemetry("manual_push", result, code);

        DynamicJsonDocument resp(512);
        resp["success"] = ok;
        resp["code"] = code;
        resp["response"] = result;
        resp["message"] = ok ? F("Telemetry pushed successfully") : F("Failed to push telemetry");

        String out;
        serializeJson(resp, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/logs", HTTP_GET, [this]() {
        DynamicJsonDocument doc(512);
        JsonArray arr = doc.to<JsonArray>();
        Logger::getLogsJson(arr);
        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/system/reboot", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;
        sendJsonResponse(200, true, F("Rebooting ESP8266..."));
        delay(500);
        ESP.restart();
    });

    _server.on("/api/system/factory-reset", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;
        Logger::log(F("[SYS] Factory reset triggered by administrator!"));
        StorageManager::getInstance().factoryReset();
        sendJsonResponse(200, true, F("Factory reset executed. Rebooting..."));
        delay(1000);
        ESP.restart();
    });

    // === OTA FIRMWARE / FILESYSTEM UPLOAD ===
    _server.on("/api/ota/upload", HTTP_POST, [this]() {
        OtaManager::getInstance().handleUploadEnd(_server);
    }, [this]() {
        HTTPUpload& upload = _server.upload();
        if (upload.status == UPLOAD_FILE_START) {
            String typeParam = _server.hasArg("type") ? _server.arg("type") : "";
            if (_server.hasHeader("X-File-MD5")) {
                OtaManager::getInstance().setExpectedMD5(_server.header("X-File-MD5"));
            }
            OtaManager::getInstance().handleUploadStart(upload.filename, typeParam);
        } else if (upload.status == UPLOAD_FILE_WRITE) {
            OtaManager::getInstance().handleUploadWrite(upload.buf, upload.currentSize);
        } else if (upload.status == UPLOAD_FILE_END) {
            OtaManager::getInstance().handleUploadFinish();
        } else if (upload.status == UPLOAD_FILE_ABORTED) {
            OtaManager::getInstance().handleUploadAbort();
        }
    });

    // === LITTLEFS FILESYSTEM MANAGEMENT API ===
    _server.on("/api/fs/list", HTTP_GET, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(2048);
        JsonArray files = doc.createNestedArray("files");

        Dir dir = LittleFS.openDir("/");
        while (dir.next()) {
            JsonObject f = files.createNestedObject();
            f["name"] = dir.fileName();
            f["size"] = dir.fileSize();
        }

        FSInfo fsInfo;
        bool hasFsInfo = LittleFS.info(fsInfo);
        size_t totalBytes = hasFsInfo ? fsInfo.totalBytes : 262144;
        size_t usedBytes = hasFsInfo ? fsInfo.usedBytes : 0;
        size_t freeBytes = (totalBytes > usedBytes) ? (totalBytes - usedBytes) : 0;

        doc["success"] = true;
        doc["totalBytes"] = totalBytes;
        doc["usedBytes"] = usedBytes;
        doc["freeBytes"] = freeBytes;

        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/fs/download", HTTP_GET, [this]() {
        if (!checkAuthOrReject()) return;

        String path = _server.hasArg("path") ? _server.arg("path") : "";
        if (path.length() == 0 || path.indexOf("..") >= 0) {
            sendJsonResponse(400, false, F("Invalid file path"));
            return;
        }
        if (!path.startsWith("/")) path = "/" + path;

        if (!LittleFS.exists(path)) {
            sendJsonResponse(404, false, F("File not found on LittleFS"));
            return;
        }

        File file = LittleFS.open(path, "r");
        String filename = path.substring(path.lastIndexOf('/') + 1);
        _server.sendHeader(F("Content-Disposition"), "attachment; filename=\"" + filename + "\"");
        _server.sendHeader(F("Cache-Control"), F("no-cache"));
        _server.streamFile(file, "application/octet-stream");
        file.close();
    });

    _server.on("/api/fs/upload", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;
        sendJsonResponse(200, true, F("File uploaded successfully"));
    }, [this]() {
        HTTPUpload& upload = _server.upload();
        static File uploadFile;
        if (upload.status == UPLOAD_FILE_START) {
            String filename = upload.filename;
            if (!filename.startsWith("/")) filename = "/" + filename;
            if (filename.indexOf("..") >= 0) return;
            uploadFile = LittleFS.open(filename, "w");
        } else if (upload.status == UPLOAD_FILE_WRITE) {
            if (uploadFile) {
                uploadFile.write(upload.buf, upload.currentSize);
            }
        } else if (upload.status == UPLOAD_FILE_END) {
            if (uploadFile) {
                uploadFile.close();
            }
        }
    });

    _server.on("/api/fs/delete", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(256);
        deserializeJson(doc, _server.arg("plain"));
        String path = doc["path"] | "";

        if (path.length() == 0 || path.indexOf("..") >= 0) {
            sendJsonResponse(400, false, F("Invalid or prohibited file path"));
            return;
        }
        if (!path.startsWith("/")) path = "/" + path;

        if (!LittleFS.exists(path)) {
            sendJsonResponse(404, false, F("File does not exist"));
            return;
        }

        if (LittleFS.remove(path)) {
            sendJsonResponse(200, true, F("File deleted successfully"));
        } else {
            sendJsonResponse(500, false, F("Failed to delete file from LittleFS"));
        }
    });

    _server.on("/api/fs/rename", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(512);
        deserializeJson(doc, _server.arg("plain"));
        String oldPath = doc["oldPath"] | "";
        String newPath = doc["newPath"] | "";

        if (oldPath.length() == 0 || newPath.length() == 0 || oldPath.indexOf("..") >= 0 || newPath.indexOf("..") >= 0) {
            sendJsonResponse(400, false, F("Invalid file paths"));
            return;
        }
        if (!oldPath.startsWith("/")) oldPath = "/" + oldPath;
        if (!newPath.startsWith("/")) newPath = "/" + newPath;

        if (!LittleFS.exists(oldPath)) {
            sendJsonResponse(404, false, F("Source file does not exist"));
            return;
        }

        if (LittleFS.rename(oldPath, newPath)) {
            sendJsonResponse(200, true, F("File renamed successfully"));
        } else {
            sendJsonResponse(500, false, F("Failed to rename file on LittleFS"));
        }
    });

    // === DIRECT COMMAND EXECUTION & ACKNOWLEDGEMENT ===
    _server.on("/api/commands/execute", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(1024);
        DeserializationError err = deserializeJson(doc, _server.arg("plain"));
        if (err) {
            sendJsonResponse(400, false, F("Invalid JSON command"));
            return;
        }

        String cmdId = doc["commandId"] | doc["command_uuid"] | "";
        String action = doc["action"] | doc["command_type"] | "";
        uint8_t gpioId = doc["id"] | (uint8_t)(doc["channel_id"] | 0);

        DynamicJsonDocument resp(512);
        resp["commandId"] = cmdId;
        resp["nodeId"] = ReceiverClient::getInstance().getConfig().nodeId;
        resp["status"] = "ACKNOWLEDGED";

        bool ok = false;
        if (action.equalsIgnoreCase("reboot")) {
            resp["success"] = true;
            resp["message"] = F("Node will restart");
            String out; serializeJson(resp, out);
            _server.send(200, "application/json", out);
            delay(500);
            ESP.restart();
            return;
        } else if (action.equalsIgnoreCase("setState")) {
            bool state = doc["state"] | false;
            ok = GpioManager::getInstance().setState(gpioId, state);
            resp["success"] = ok;
            resp["state"] = state;
        } else if (action.equalsIgnoreCase("toggle")) {
            ok = GpioManager::getInstance().toggle(gpioId);
            resp["success"] = ok;
        } else if (action.equalsIgnoreCase("pulse")) {
            unsigned long dur = doc["duration"] | 500;
            ok = GpioManager::getInstance().pulse(gpioId, dur);
            resp["success"] = ok;
        } else if (action.equalsIgnoreCase("readInfo")) {
            resp["success"] = true;
            resp["freeHeap"] = ESP.getFreeHeap();
            resp["uptimeSec"] = millis() / 1000UL;
            ok = true;
        } else {
            resp["success"] = false;
            resp["error"] = F("Unknown command action");
        }

        String out;
        serializeJson(resp, out);
        _server.send(ok ? 200 : 400, "application/json", out);
    });
}

void WebServerManager::registerStaticRoutes() {
    _server.on("/", HTTP_GET, [this]() {
        serveEmbeddedDashboard();
    });

    _server.on("/index.html", HTTP_GET, [this]() {
        serveEmbeddedDashboard();
    });
}

// Built-in lightweight ESP-01 Satellite Portal
void WebServerManager::serveEmbeddedDashboard() {
    String html = F("<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                    "<title>ESP-01 Satellite</title><style>"
                    "body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;margin:0;padding:16px;}"
                    ".c{background:#1e293b;border-radius:12px;padding:20px;max-width:440px;margin:20px auto;border:1px solid #334155;}"
                    "h2,h3{color:#38bdf8;margin:0 0 12px 0;font-size:1.25rem;}label{font-size:0.85rem;color:#94a3b8;display:block;margin-top:10px;}"
                    "input,button{width:100%;padding:10px;margin:6px 0;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#fff;box-sizing:border-box;}"
                    "button{background:#0284c7;border:none;font-weight:600;cursor:pointer;margin-top:12px;}"
                    "button:hover{background:#0369a1;}.btn-off{background:#475569;}.btn-on{background:#16a34a;}"
                    ".grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;}"
                    ".badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.75rem;background:#334155;color:#38bdf8;}"
                    ".status{font-size:0.85rem;color:#94a3b8;line-height:1.5;margin:8px 0;}"
                    "</style></head><body><div class='c'>"
                    "<h2>⚡ ESP-01 Satellite Node</h2>"
                    "<div class='status'>IP: <span class='badge' id='st'>Connecting...</span> &bull; Free Heap: <span id='hp'>-</span></div>"
                    "<div class='grid'>"
                    "<button id='r1' onclick='t(1)' class='btn-off'>Relay 1: ...</button>"
                    "<button id='r2' onclick='t(2)' class='btn-off'>Relay 2: ...</button>"
                    "</div>"
                    "<h3>🌐 Wi-Fi & Central Server</h3>"
                    "<form onsubmit='event.preventDefault();cf();'>"
                    "<label>Wi-Fi SSID:</label><input id='ssid' placeholder='Router SSID' required>"
                    "<label>Wi-Fi Password:</label><input type='password' id='pass' placeholder='Password'>"
                    "<label>Central Server (IP:Port):</label><input id='srv' placeholder='e.g. 192.168.1.12:2000'>"
                    "<button type='submit'>Save & Connect</button>"
                    "</form>"
                    "<h3>🚀 Firmware OTA</h3>"
                    "<form method='POST' action='/api/ota/upload' enctype='multipart/form-data'>"
                    "<input type='file' name='update' accept='.bin' required>"
                    "<button type='submit' style='background:#7c3aed;'>Flash Firmware (.bin)</button>"
                    "</form>"
                    "</div><script>"
                    "function u(){fetch('/api/status').then(r=>r.json()).then(d=>{"
                    "document.getElementById('st').innerText=d.ip||'AP Mode';"
                    "document.getElementById('hp').innerText=d.freeHeap+' B';});"
                    "fetch('/api/gpio').then(r=>r.json()).then(d=>{"
                    "d.forEach(c=>{let b=document.getElementById('r'+c.id);"
                    "if(b){b.innerText=c.name+': '+(c.state?'ON':'OFF');b.className=c.state?'btn-on':'btn-off';}});"
                    "});}"
                    "function t(id){fetch('/api/gpio/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,action:'toggle'})}).then(()=>u());}"
                    "function cf(){let p=document.getElementById('srv').value.split(':');"
                    "fetch('/api/wifi/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ssid:document.getElementById('ssid').value,password:document.getElementById('pass').value})});"
                    "if(p[0]){fetch('/api/receiver',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,serverHost:p[0],serverPort:parseInt(p[1]||'2000')})});}"
                    "alert('Settings sent! ESP-01 is connecting...');}"
                    "u();setInterval(u,3000);"
                    "</script></body></html>");
    _server.send(200, "text/html; charset=UTF-8", html);
}
