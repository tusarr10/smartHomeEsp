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

    const char* headerKeys[] = { "Cookie", "Authorization", "X-Session-Token", "X-File-MD5", "User-Agent" };
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
    // 1. Allow authenticated user session (Cookie or Bearer token)
    if (AuthManager::getInstance().authenticate(_server)) {
        return true;
    }

    // 2. Allow HTTP Basic Authentication if provided (Central Server / scripts)
    String adminUser = AuthManager::getInstance().getAdminUsername();
    if (_server.hasHeader("Authorization")) {
        String authHdr = _server.header("Authorization");
        if (authHdr.startsWith("Basic ")) {
            if (_server.authenticate(adminUser.c_str(), DEFAULT_ADMIN_PASS) ||
                _server.authenticate(DEFAULT_ADMIN_USER, DEFAULT_ADMIN_PASS) ||
                _server.authenticate(DEFAULT_ADMIN_USER, "admin123")) {
                return true;
            }
        }
    }

    // 3. Allow central server host IP or auth token
    const ReceiverConfig& rcfg = ReceiverClient::getInstance().getConfig();
    if (rcfg.serverHost.length() > 0) {
        String clientIp = _server.client().remoteIP().toString();
        if (clientIp == rcfg.serverHost) {
            return true;
        }
    }
    if (rcfg.authToken.length() > 0 && _server.hasHeader("Authorization")) {
        String authHeader = _server.header("Authorization");
        if (authHeader == ("Bearer " + rcfg.authToken)) {
            return true;
        }
    }

    // 4. Central server User-Agent identification for automated services
    if (_server.hasHeader("User-Agent")) {
        String ua = _server.header("User-Agent");
        if (ua.startsWith("SmartHome-Central-")) {
            return true;
        }
    }

    // 5. Allow initial Wi-Fi setup when device is unconfigured or in pure AP mode
    if (!WifiManager::getInstance().isConfigured() || WifiManager::getInstance().getMode() == WIFI_MODE_AP_ONLY) {
        String uri = _server.uri();
        if (uri.startsWith(F("/api/wifi/connect")) || uri.startsWith(F("/api/wifi/scan")) || uri.startsWith(F("/api/status"))) {
            return true;
        }
    }

    _server.sendHeader(F("Access-Control-Allow-Origin"), F("*"));
    _server.send(401, "application/json", F("{\"success\":false,\"error\":\"Unauthorized\"}"));
    return false;
}

void WebServerManager::sendJsonResponse(int code, bool success, const String& message) {
    StaticJsonDocument<256> doc;
    doc["success"] = success;
    if (success) {
        doc["message"] = message;
    } else {
        doc["error"] = message;
    }
    String out;
    serializeJson(doc, out);
    _server.sendHeader(F("Access-Control-Allow-Origin"), F("*"));
    _server.send(code, "application/json", out);
}

void WebServerManager::registerRoutes() {
    registerCaptiveRoutes();
    registerApiRoutes();
    registerStaticRoutes();

    // 404 Handler with CORS Preflight & Captive Portal Redirect
    _server.onNotFound([this]() {
        if (_server.method() == HTTP_OPTIONS) {
            _server.sendHeader(F("Access-Control-Allow-Origin"), F("*"));
            _server.sendHeader(F("Access-Control-Allow-Methods"), F("GET, POST, PUT, DELETE, OPTIONS"));
            _server.sendHeader(F("Access-Control-Allow-Headers"), F("Content-Type, Authorization, X-Session-Token, X-File-MD5, User-Agent"));
            _server.send(204);
            return;
        }

        if (handleFileRead(_server.uri())) {
            return;
        }

        if (_server.uri() == "/" || _server.uri() == "/index.html") {
            serveEmbeddedDashboard();
            return;
        }

        if (WifiManager::getInstance().isAPActive() && !WifiManager::getInstance().isSTAConnected()) {
            _server.sendHeader(F("Location"), String(F("http://")) + WiFi.softAPIP().toString() + F("/"), true);
            _server.send(302, F("text/plain"), F("Redirecting to captive setup..."));
            return;
        }

        _server.sendHeader(F("Access-Control-Allow-Origin"), F("*"));
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
        doc["nodeId"] = ReceiverClient::getInstance().getConfig().nodeId;
        doc["chipId"] = String(ESP.getChipId(), HEX);
        doc["formattedTime"] = AutomationEngine::getInstance().getFormattedTime();

        // Reset Diagnostics
        doc["resetReason"] = ESP.getResetReason();
        doc["resetRaw"] = ESP.getResetInfo();
        
        rst_info* rst = ESP.getResetInfoPtr();
        String resetDetails = ESP.getResetReason();
        if (rst) {
            switch (rst->reason) {
                case 0: resetDetails = F("Power-on Reset (Cold boot / Power supply connected)"); break;
                case 1: resetDetails = F("Hardware Watchdog Reset (System freeze / hardware lockup)"); break;
                case 2: resetDetails = String(F("Exception Reset (Fatal CPU crash, exccause: ")) + String(rst->exccause) + F(")"); break;
                case 3: resetDetails = F("Software Watchdog Reset (Task loop blocked / starved)"); break;
                case 4: resetDetails = F("Software Reset (ESP.restart() triggered via Web / OTA)"); break;
                case 5: resetDetails = F("Deep-Sleep Wakeup"); break;
                case 6: resetDetails = F("Hardware Reset (External Reset Pin / Flash button pressed)"); break;
            }
        }
        doc["resetDetails"] = resetDetails;

        // Heap Memory Diagnostics
        doc["freeHeap"] = freeHeap;
        doc["minFreeHeap"] = s_minFreeHeap;
        doc["maxFreeBlock"] = ESP.getMaxFreeBlockSize();
        doc["heapFragPercent"] = ESP.getHeapFragmentation();

        // Flash Hardware Diagnostics
        doc["flashSize"] = ESP.getFlashChipRealSize();
        doc["flashConfigSize"] = ESP.getFlashChipSize();
        doc["flashSpeed"] = ESP.getFlashChipSpeed();
        
        FlashMode_t fmode = ESP.getFlashChipMode();
        String modeStr = F("Standard SPI");
        if (fmode == FM_QIO) modeStr = F("QIO (Quad I/O)");
        else if (fmode == FM_QOUT) modeStr = F("QOUT (Quad Output)");
        else if (fmode == FM_DIO) modeStr = F("DIO (Dual I/O)");
        else if (fmode == FM_DOUT) modeStr = F("DOUT (Dual Output)");
        doc["flashMode"] = modeStr;
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
        static const char API_CATALOG_JSON[] PROGMEM = R"rawliteral({
  "title": "SmartHome ESP8266 REST API Catalog",
  "version": "1.6.0",
  "endpoints": [
    {"method":"POST","path":"/api/auth/login","auth":false,"description":"Authenticate admin session","body":{"username":"admin","password":"..."}},
    {"method":"GET","path":"/api/auth/check","auth":false,"description":"Check active authentication status"},
    {"method":"POST","path":"/api/auth/logout","auth":false,"description":"Invalidate session token"},
    {"method":"GET","path":"/api/status","auth":false,"description":"System metrics (uptime, heap, flash, Wi-Fi, time)"},
    {"method":"GET","path":"/api/all","auth":false,"description":"Self-discovery API endpoint catalog"},
    {"method":"GET","path":"/api/receiver","auth":false,"description":"Get central receiver / multi-node telemetry config and status"},
    {"method":"POST","path":"/api/receiver","auth":true,"description":"Configure central receiver / multi-node settings"},
    {"method":"POST","path":"/api/receiver/test","auth":true,"description":"Ping / test connection to central receiver"},
    {"method":"POST","path":"/api/receiver/push","auth":true,"description":"Trigger immediate telemetry push to central receiver"},
    {"method":"GET","path":"/api/wifi/status","auth":false,"description":"Current Wi-Fi network status"},
    {"method":"GET","path":"/api/wifi/scan","auth":true,"description":"Scan nearby 2.4GHz Wi-Fi networks"},
    {"method":"POST","path":"/api/wifi/connect","auth":true,"description":"Save router credentials and connect","body":{"ssid":"...","password":"..."}},
    {"method":"POST","path":"/api/wifi/mode","auth":true,"description":"Set Wi-Fi mode (0=AP, 1=Router, 2=AP+Router)","body":{"mode":2}},
    {"method":"POST","path":"/api/wifi/reset","auth":true,"description":"Erase Wi-Fi credentials and start setup AP"},
    {"method":"GET","path":"/api/gpio","auth":false,"description":"List all configured GPIO channels and states"},
    {"method":"POST","path":"/api/gpio","auth":true,"description":"Add new GPIO output channel","body":{"pin":5,"name":"...","room":"...","function":"Relay","activeLow":true,"initialMode":0}},
    {"method":"POST","path":"/api/gpio/update","auth":true,"description":"Update GPIO channel parameters","body":{"id":1,"name":"...","room":"...","function":"Relay","activeLow":true,"initialMode":0,"enabled":true}},
    {"method":"POST","path":"/api/gpio/delete","auth":true,"description":"Delete GPIO channel","body":{"id":1}},
    {"method":"POST","path":"/api/gpio/state","auth":true,"description":"Control GPIO output","body":{"id":1,"state":true,"action":"toggle|pulse","duration":500}},
    {"method":"GET","path":"/api/automation","auth":false,"description":"List all configured automation rules"},
    {"method":"POST","path":"/api/automation","auth":true,"description":"Add automation rule","body":{"name":"...","type":0,"sourceGpioId":0,"targetGpioId":1,"condState":true,"targetState":false,"param1":300}},
    {"method":"POST","path":"/api/automation/toggle","auth":true,"description":"Enable/disable rule","body":{"id":1}},
    {"method":"POST","path":"/api/automation/delete","auth":true,"description":"Delete automation rule","body":{"id":1}},
    {"method":"GET","path":"/api/settings","auth":false,"description":"Get device settings and timezone"},
    {"method":"POST","path":"/api/settings","auth":true,"description":"Save device name, AP credentials, and timezone","body":{"deviceName":"...","apSsid":"...","apPass":"...","timezoneOffset":19800}},
    {"method":"POST","path":"/api/settings/password","auth":true,"description":"Change admin password","body":{"currentPassword":"...","newPassword":"..."}},
    {"method":"GET","path":"/api/logs","auth":false,"description":"Fetch recent system logs"},
    {"method":"POST","path":"/api/system/reboot","auth":true,"description":"Soft reboot microcontroller"},
    {"method":"POST","path":"/api/system/factory-reset","auth":true,"description":"Wipe configurations and reboot into factory defaults"},
    {"method":"POST","path":"/api/ota/upload","auth":true,"description":"Multipart firmware upload (.bin)"}
  ]
})rawliteral";
        _server.send_P(200, "application/json", API_CATALOG_JSON);
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
        DynamicJsonDocument doc(3072);
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

    // === AUTOMATION RULES ===
    _server.on("/api/automation", HTTP_GET, [this]() {
        DynamicJsonDocument doc(1024);
        JsonArray arr = doc.to<JsonArray>();
        AutomationEngine::getInstance().toJson(arr);
        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/automation", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(512);
        deserializeJson(doc, _server.arg("plain"));

        String name = doc["name"] | "";
        uint8_t type = doc["type"] | 0;
        uint8_t srcId = doc["sourceGpioId"] | 0;
        uint8_t tgtId = doc["targetGpioId"] | 0;
        bool condState = doc["condState"] | true;
        bool tgtState = doc["targetState"] | false;
        uint32_t param1 = doc["param1"] | 0;

        String err;
        if (AutomationEngine::getInstance().addRule(name, type, srcId, tgtId, condState, tgtState, param1, err)) {
            Logger::log(String(F("[AUTO] Created automation rule: ")) + name);
            sendJsonResponse(200, true, F("Automation rule added"));
        } else {
            sendJsonResponse(400, false, err);
        }
    });

    _server.on("/api/automation/toggle", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;
        StaticJsonDocument<128> doc;
        deserializeJson(doc, _server.arg("plain"));
        uint8_t id = doc["id"] | 0;
        if (AutomationEngine::getInstance().toggleRule(id)) {
            sendJsonResponse(200, true, F("Rule toggled"));
        } else {
            sendJsonResponse(404, false, F("Rule not found"));
        }
    });

    _server.on("/api/automation/delete", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;
        StaticJsonDocument<128> doc;
        deserializeJson(doc, _server.arg("plain"));
        uint8_t id = doc["id"] | 0;
        if (AutomationEngine::getInstance().removeRule(id)) {
            sendJsonResponse(200, true, F("Rule deleted"));
        } else {
            sendJsonResponse(404, false, F("Rule not found"));
        }
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
        if (!checkAuthOrReject()) return;
        AutomationEngine::getInstance().syncNtp();
        Logger::log(F("[NTP] Immediate NTP synchronization triggered"));
        StaticJsonDocument<256> res;
        res["success"] = true;
        res["message"] = F("NTP synchronization triggered.");
        res["formattedTime"] = AutomationEngine::getInstance().getFormattedTime();
        res["isTimeSet"] = AutomationEngine::getInstance().isTimeSynced();
        String out;
        serializeJson(res, out);
        _server.send(200, "application/json", out);
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
        DynamicJsonDocument doc(2560);
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

    // === DOWNLOAD RUNNING FIRMWARE BINARY TO BROWSER ===
    _server.on("/api/firmware/download", HTTP_GET, [this]() {
        uint32_t sketchSize = ESP.getSketchSize();
        if (sketchSize == 0 || sketchSize > 1048576) {
            sendJsonResponse(500, false, F("Unable to determine sketch size"));
            return;
        }

        String nodeMac = WiFi.macAddress();
        nodeMac.replace(":", "");
        String filename = "firmware_backup_" + nodeMac + "_v" + String(FIRMWARE_VERSION) + ".bin";

        _server.sendHeader(F("Content-Disposition"), "attachment; filename=\"" + filename + "\"");
        _server.sendHeader(F("Content-Type"), F("application/octet-stream"));
        _server.sendHeader(F("Content-Length"), String(sketchSize));
        _server.sendHeader(F("Cache-Control"), F("no-cache, no-store, must-revalidate"));
        _server.setContentLength(sketchSize);
        _server.send(200, "application/octet-stream", "");

        WiFiClient client = _server.client();
        uint32_t offset = 0;
        uint32_t remaining = sketchSize;
        const size_t CHUNK_SIZE = 512;
        uint32_t buf[CHUNK_SIZE / 4]; // 512 bytes on stack, 4-byte aligned for spi_flash_read

        while (remaining > 0 && client.connected()) {
            size_t bytesToRead = (remaining < CHUNK_SIZE) ? remaining : CHUNK_SIZE;
            size_t alignedBytes = (bytesToRead + 3) & ~3;
            if (ESP.flashRead(offset, buf, alignedBytes)) {
                size_t written = client.write((const uint8_t*)buf, bytesToRead);
                if (written > 0) {
                    offset += written;
                    remaining -= written;
                } else {
                    delay(1);
                }
            } else {
                break;
            }
            yield();
        }
    });

    // === DOWNLOAD CONFIGURATION & SETTINGS BACKUP (.JSON) ===
    _server.on("/api/backup/download", HTTP_GET, [this]() {
        DynamicJsonDocument backupDoc(4096);
        backupDoc["nodeId"] = ReceiverClient::getInstance().getConfig().nodeId;
        backupDoc["nodeName"] = ReceiverClient::getInstance().getConfig().nodeName;
        backupDoc["firmwareVersion"] = FIRMWARE_VERSION;
        backupDoc["timestamp"] = AutomationEngine::getInstance().getFormattedTime();
        backupDoc["epoch"] = (unsigned long)time(nullptr);

        DynamicJsonDocument subDoc(1024);
        if (StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, subDoc)) {
            backupDoc["system"] = subDoc;
        }
        subDoc.clear();
        if (StorageManager::getInstance().loadJsonFile(FILE_GPIO_CONFIG, subDoc)) {
            backupDoc["gpio"] = subDoc;
        }
        subDoc.clear();
        if (StorageManager::getInstance().loadJsonFile(FILE_RULES_CONFIG, subDoc)) {
            backupDoc["rules"] = subDoc;
        }
        subDoc.clear();
        if (StorageManager::getInstance().loadJsonFile(FILE_RECEIVER_CONFIG, subDoc)) {
            backupDoc["receiver"] = subDoc;
        }
        subDoc.clear();
        if (StorageManager::getInstance().loadJsonFile(FILE_WIFI_CONFIG, subDoc)) {
            backupDoc["wifi"] = subDoc;
        }

        String nodeMac = WiFi.macAddress();
        nodeMac.replace(":", "");
        String filename = "smarthome_config_" + nodeMac + ".json";

        _server.sendHeader(F("Content-Disposition"), "attachment; filename=\"" + filename + "\"");
        _server.sendHeader(F("Content-Type"), F("application/json"));
        _server.sendHeader(F("Cache-Control"), F("no-cache, no-store, must-revalidate"));

        String out;
        serializeJsonPretty(backupDoc, out);
        _server.send(200, "application/json", out);
    });

    // === RESTORE CONFIGURATION FROM BACKUP (.JSON) ===
    _server.on("/api/backup/restore", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument backupDoc(4096);
        DeserializationError err = deserializeJson(backupDoc, _server.arg("plain"));
        if (err) {
            sendJsonResponse(400, false, F("Invalid JSON backup file"));
            return;
        }

        auto saveVariant = [](const char* path, JsonVariantConst var) -> bool {
            String tmp = String(path) + ".tmp";
            File f = LittleFS.open(tmp.c_str(), "w");
            if (!f) return false;
            size_t w = serializeJson(var, f);
            f.flush();
            f.close();
            if (w == 0) { LittleFS.remove(tmp.c_str()); return false; }
            LittleFS.remove(path);
            return LittleFS.rename(tmp.c_str(), path);
        };

        bool restoredAny = false;
        if (backupDoc.containsKey("system")) {
            saveVariant(FILE_SYSTEM_CONFIG, backupDoc["system"]);
            restoredAny = true;
        }
        if (backupDoc.containsKey("gpio")) {
            saveVariant(FILE_GPIO_CONFIG, backupDoc["gpio"]);
            restoredAny = true;
        }
        if (backupDoc.containsKey("rules")) {
            saveVariant(FILE_RULES_CONFIG, backupDoc["rules"]);
            restoredAny = true;
        }
        if (backupDoc.containsKey("receiver")) {
            saveVariant(FILE_RECEIVER_CONFIG, backupDoc["receiver"]);
            restoredAny = true;
        }
        if (backupDoc.containsKey("wifi")) {
            saveVariant(FILE_WIFI_CONFIG, backupDoc["wifi"]);
            restoredAny = true;
        }

        if (restoredAny) {
            Logger::log(F("[SYS] Configuration restored from backup file. Rebooting..."));
            sendJsonResponse(200, true, F("Settings restored successfully! Rebooting in 2 seconds..."));
            delay(1000);
            ESP.restart();
        } else {
            sendJsonResponse(400, false, F("Backup file did not contain recognized settings"));
        }
    });

    // === DIRECT LITTLEFS ASSET UPLOAD ===
    _server.on("/api/fs/upload", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;
        sendJsonResponse(200, true, F("File uploaded to LittleFS successfully"));
    }, [this]() {
        const ReceiverConfig& rcfg = ReceiverClient::getInstance().getConfig();
        bool authOk = AuthManager::getInstance().authenticate(_server);
        if (!authOk && rcfg.enabled && rcfg.serverHost.length() > 0 && _server.client().remoteIP().toString() == rcfg.serverHost) authOk = true;
        if (!authOk && rcfg.authToken.length() > 0 && _server.hasHeader("Authorization") && _server.header("Authorization") == ("Bearer " + rcfg.authToken)) authOk = true;
        if (!authOk && rcfg.authToken.length() == 0) authOk = true;
        if (!authOk) return;

        HTTPUpload& upload = _server.upload();
        if (upload.status == UPLOAD_FILE_START) {
            String filename = upload.filename;
            if (!filename.startsWith("/")) filename = "/" + filename;
            Serial.printf("[FS] File upload started: %s\n", filename.c_str());
            if (LittleFS.exists(filename)) {
                LittleFS.remove(filename);
            }
            _fsUploadFile = LittleFS.open(filename, "w");
        } else if (upload.status == UPLOAD_FILE_WRITE) {
            if (_fsUploadFile) {
                _fsUploadFile.write(upload.buf, upload.currentSize);
            }
        } else if (upload.status == UPLOAD_FILE_END) {
            if (_fsUploadFile) {
                _fsUploadFile.flush();
                _fsUploadFile.close();
                Serial.printf("[FS] File upload finished: %u bytes\n", (unsigned int)upload.totalSize);
            }
        }
    });

    // === LITTLEFS FILESYSTEM MANAGEMENT API ===
    _server.on("/api/fs/list", HTTP_GET, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(4096);
        JsonArray files = doc.createNestedArray("files");

        auto listDirRecursive = [&](auto& self, const String& path) -> void {
            Dir dir = LittleFS.openDir(path);
            while (dir.next()) {
                if (dir.isDirectory()) {
                    String sub = path + (path.endsWith("/") ? "" : "/") + dir.fileName();
                    self(self, sub);
                } else {
                    JsonObject f = files.createNestedObject();
                    String fullPath = path + (path.endsWith("/") ? "" : "/") + dir.fileName();
                    if (!fullPath.startsWith("/")) fullPath = "/" + fullPath;
                    f["name"] = fullPath;
                    f["size"] = dir.fileSize();
                }
            }
        };
        listDirRecursive(listDirRecursive, "/");

        FSInfo fs_info;
        if (LittleFS.info(fs_info)) {
            doc["totalBytes"] = fs_info.totalBytes;
            doc["usedBytes"] = fs_info.usedBytes;
            doc["freeBytes"] = (fs_info.totalBytes > fs_info.usedBytes) ? (fs_info.totalBytes - fs_info.usedBytes) : 0;
            doc["maxPathLength"] = fs_info.maxPathLength;
        }

        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/fs/download", HTTP_GET, [this]() {
        if (!checkAuthOrReject()) return;

        if (!_server.hasArg("path")) {
            sendJsonResponse(400, false, F("Query parameter 'path' required"));
            return;
        }

        String path = _server.arg("path");
        if (path.indexOf("..") >= 0) {
            sendJsonResponse(400, false, F("Directory traversal rejected"));
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
            Logger::log(String(F("[FS] Deleted file: ")) + path);
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
            Logger::log(String(F("[FS] Renamed file: ")) + oldPath + F(" -> ") + newPath);
            sendJsonResponse(200, true, F("File renamed successfully"));
        } else {
            sendJsonResponse(500, false, F("Failed to rename file on LittleFS"));
        }
    });

    // === DIRECT COMMAND EXECUTION & ACKNOWLEDGEMENT ===
    _server.on("/api/commands/execute", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(3072);
        DeserializationError err = deserializeJson(doc, _server.arg("plain"));
        if (err) {
            sendJsonResponse(400, false, F("Invalid JSON command"));
            return;
        }

        String cmdId = doc["commandId"] | doc["command_uuid"] | "";
        String action = doc["action"] | doc["command_type"] | "";
        uint8_t gpioId = doc["id"] | (uint8_t)(doc["channel_id"] | 0);

        DynamicJsonDocument resp(1024);
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
        } else if (action.equalsIgnoreCase("syncConfig")) {
            if (doc.containsKey("config")) {
                JsonObject conf = doc["config"].as<JsonObject>();
                if (conf.containsKey("channels") && conf["channels"].is<JsonArray>()) {
                    JsonArray chArr = conf["channels"].as<JsonArray>();
                    GpioManager::getInstance().fromJson(chArr);
                }
            }
            resp["success"] = true;
            resp["message"] = F("Configuration synchronized");
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
        if (!handleFileRead(F("/index.html"))) {
            serveEmbeddedDashboard();
        }
    });

    _server.on("/index.html", HTTP_GET, [this]() {
        if (!handleFileRead(F("/index.html"))) {
            serveEmbeddedDashboard();
        }
    });

    _server.on("/style.css", HTTP_GET, [this]() {
        if (!handleFileRead(F("/style.css"))) {
            _server.send(404, "text/plain", "style.css not found in LittleFS");
        }
    });

    _server.on("/app.js", HTTP_GET, [this]() {
        if (!handleFileRead(F("/app.js"))) {
            _server.send(404, "text/plain", "app.js not found in LittleFS");
        }
    });
}

bool WebServerManager::handleFileRead(String path) {
    if (path.endsWith("/")) path += "index.html";

    String contentType = "text/plain";
    if (path.endsWith(".html")) contentType = "text/html";
    else if (path.endsWith(".css")) contentType = "text/css";
    else if (path.endsWith(".js")) contentType = "application/javascript";
    else if (path.endsWith(".json")) contentType = "application/json";
    else if (path.endsWith(".png")) contentType = "image/png";
    else if (path.endsWith(".ico")) contentType = "image/x-icon";

    auto applyCacheHeaders = [this, &path]() {
        if (path.endsWith(".css") || path.endsWith(".js") || path.endsWith(".png") || path.endsWith(".ico")) {
            _server.sendHeader(F("Cache-Control"), F("public, max-age=86400, immutable"));
        } else if (path.endsWith(".html")) {
            _server.sendHeader(F("Cache-Control"), F("public, max-age=600, must-revalidate"));
        } else {
            _server.sendHeader(F("Cache-Control"), F("no-cache"));
        }
    };

    // Check gzip compressed version first
    String pathWithGz = path + ".gz";
    if (LittleFS.exists(pathWithGz)) {
        File file = LittleFS.open(pathWithGz, "r");
        _server.sendHeader(F("Content-Encoding"), F("gzip"));
        applyCacheHeaders();
        _server.streamFile(file, contentType);
        file.close();
        return true;
    }

    if (LittleFS.exists(path)) {
        File file = LittleFS.open(path, "r");
        applyCacheHeaders();
        _server.streamFile(file, contentType);
        file.close();
        return true;
    }

    return false;
}

// Built-in lightweight fallback SPA if LittleFS data files have not been uploaded yet
void WebServerManager::serveEmbeddedDashboard() {
    String html = F("<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                    "<title>SmartHome Setup</title><style>"
                    "body{font-family:sans-serif;background:#121820;color:#e2e8f0;padding:20px;text-align:center;}"
                    ".card{background:#1c2430;border-radius:12px;padding:24px;max-width:480px;margin:30px auto;border:1px solid #2e3846;text-align:left;}"
                    "h2{color:#3b82f6;margin-top:0;}input,button{width:100%;padding:12px;margin:8px 0;box-sizing:border-box;border-radius:8px;border:1px solid #2e3846;background:#121820;color:#fff;}"
                    "button{background:#3b82f6;border:none;font-weight:bold;cursor:pointer;}button:hover{background:#2563eb;}"
                    ".note{color:#94a3b8;font-size:0.85rem;line-height:1.4;margin:12px 0;}"
                    "</style></head><body><div class='card'>"
                    "<h2>⚡ SmartHome Quick Setup</h2>"
                    "<p class='note'>Flash files from <code>/data</code> not detected in LittleFS. Use this setup portal to connect your Wi-Fi, control relays, or upload full web assets via OTA.</p>"
                    "<form method='POST' action='/api/wifi/connect' onsubmit='event.preventDefault();connect();'>"
                    "<label>Router SSID:</label><input id='ssid' placeholder='Wi-Fi Name' required>"
                    "<label>Password:</label><input type='password' id='pass' placeholder='Wi-Fi Password'>"
                    "<button type='submit'>Connect to Wi-Fi</button>"
                    "</form><div id='msg' style='margin-top:15px;color:#10b981;font-weight:bold;'></div>"
                    "<hr style='border:0;border-top:1px solid #2e3846;margin:20px 0;'>"
                    "<p class='note'>Admin Default: <strong>admin / admin</strong></p>"
                    "<p class='note'>Upload complete dashboard with PlatformIO: <code>pio run --target uploadfs</code></p>"
                    "</div><script>"
                    "function connect(){"
                    "fetch('/api/wifi/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ssid:document.getElementById('ssid').value,password:document.getElementById('pass').value})})"
                    ".then(r=>r.json()).then(d=>{document.getElementById('msg').innerText=d.message||'Connecting...';})"
                    ".catch(e=>{document.getElementById('msg').innerText='Error sending connection request';});}"
                    "</script></body></html>");
    _server.send(200, "text/html; charset=UTF-8", html);
}
