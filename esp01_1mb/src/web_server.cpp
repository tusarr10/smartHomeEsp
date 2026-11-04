#include "web_server.h"
#include "storage_manager.h"
#include "auth_manager.h"
#include "wifi_manager.h"
#include "gpio_manager.h"
#include "ota_manager.h"
#include "receiver_client.h"
#include "dashboard_html.h"

WebServerManager::WebServerManager() : _server(80), _deviceName(FIRMWARE_NAME) {}

WebServerManager& WebServerManager::getInstance() {
    static WebServerManager instance;
    return instance;
}

bool WebServerManager::begin() {
    DynamicJsonDocument doc(256);
    if (StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, doc)) {
        if (doc.containsKey("deviceName")) {
            _deviceName = doc["deviceName"].as<String>();
        }
    }

    const char* headerKeys[] = { "Cookie", "Authorization", "X-Session-Token", "X-File-MD5" };
    _server.collectHeaders(headerKeys, sizeof(headerKeys) / sizeof(char*));

    registerRoutes();
    _server.begin();
    Logger::log(F("[HTTP] Minimal Satellite Web Server active on port 80"));
    return true;
}

void WebServerManager::loop() {
    _server.handleClient();
}

void WebServerManager::setDeviceName(const String& name) {
    if (name.length() > 0) {
        _deviceName = name;
        DynamicJsonDocument doc(256);
        StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, doc);
        doc["deviceName"] = _deviceName;
        StorageManager::getInstance().saveJsonFile(FILE_SYSTEM_CONFIG, doc);
    }
}

bool WebServerManager::checkAuthOrReject() {
    const ReceiverConfig& rcfg = ReceiverClient::getInstance().getConfig();
    if (rcfg.authToken.length() == 0) return true; // Direct LAN trust if no token set

    // AP connection is trusted for local onboarding
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

    // 404 Handler / Captive Portal Redirect
    _server.onNotFound([this]() {
        if (WifiManager::getInstance().isAPActive() && !WifiManager::getInstance().isSTAConnected()) {
            _server.sendHeader(F("Location"), String(F("http://")) + WiFi.softAPIP().toString() + F("/"), true);
            _server.send(302, F("text/plain"), F(""));
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
        if (deserializeJson(doc, _server.arg("plain"))) {
            sendJsonResponse(400, false, F("Invalid JSON"));
            return;
        }

        String user = doc["username"] | "";
        String pass = doc["password"] | "";
        String token;

        if (AuthManager::getInstance().login(user, pass, token)) {
            _server.sendHeader(F("Set-Cookie"), String(F("session=")) + token + F("; Path=/; HttpOnly"));
            StaticJsonDocument<128> resp;
            resp["success"] = true;
            resp["token"] = token;
            resp["username"] = user;
            String out;
            serializeJson(resp, out);
            _server.send(200, "application/json", out);
        } else {
            sendJsonResponse(401, false, F("Invalid credentials"));
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
        sendJsonResponse(200, true, F("Logged out"));
    });

    _server.on("/api/auth/password", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;
        StaticJsonDocument<256> doc;
        if (deserializeJson(doc, _server.arg("plain"))) {
            sendJsonResponse(400, false, F("Invalid JSON"));
            return;
        }
        String curr = doc["currentPassword"] | "";
        String next = doc["newPassword"] | "";
        if (AuthManager::getInstance().changePassword(curr, next)) {
            sendJsonResponse(200, true, F("Password updated successfully"));
        } else {
            sendJsonResponse(400, false, F("Current password incorrect or new password too short (min 4 chars)"));
        }
    });

    // === STATUS (Compact for Central Server & Dashboard) ===
    _server.on("/api/status", HTTP_GET, [this]() {
        DynamicJsonDocument doc(512);
        doc["deviceName"] = _deviceName;
        doc["firmwareVersion"] = FIRMWARE_VERSION;
        doc["hardware"] = HARDWARE_TARGET;
        doc["uptimeSec"] = millis() / 1000UL;
        doc["freeHeap"] = ESP.getFreeHeap();
        doc["sketchSize"] = ESP.getSketchSize();
        doc["freeSketchSpace"] = ESP.getFreeSketchSpace();
        doc["mac"] = WiFi.macAddress();
        doc["staConnected"] = WifiManager::getInstance().isSTAConnected();
        doc["ip"] = WifiManager::getInstance().isSTAConnected() ? WifiManager::getInstance().getSTAIP() : WifiManager::getInstance().getAPIP();
        doc["ssid"] = WifiManager::getInstance().getConnectedSSID();
        doc["rssi"] = WifiManager::getInstance().getSTARSSI();
        doc["receiverEnabled"] = ReceiverClient::getInstance().getConfig().enabled;
        doc["receiverServer"] = ReceiverClient::getInstance().getConfig().serverHost + ":" + String(ReceiverClient::getInstance().getConfig().serverPort);

        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    // === WI-FI & CENTRAL SERVER SETUP ===
    _server.on("/api/wifi/connect", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(512);
        if (deserializeJson(doc, _server.arg("plain"))) {
            sendJsonResponse(400, false, F("Invalid JSON"));
            return;
        }

        String ssid = doc["ssid"] | "";
        String pass = doc["password"] | "";
        String srvHost = doc["serverHost"] | "";
        uint16_t srvPort = doc["serverPort"] | 2000;

        if (ssid.length() == 0) {
            sendJsonResponse(400, false, F("SSID cannot be empty"));
            return;
        }

        if (srvHost.length() > 0) {
            ReceiverConfig cfg = ReceiverClient::getInstance().getConfig();
            cfg.enabled = true;
            cfg.serverHost = srvHost;
            cfg.serverPort = srvPort;
            ReceiverClient::getInstance().setConfig(cfg);
        }

        sendJsonResponse(200, true, F("Connecting to Wi-Fi..."));
        _server.client().flush();
        WifiManager::getInstance().connectToRouter(ssid, pass, true);
    });

    _server.on("/api/wifi/scan", HTTP_GET, [this]() {
        if (!checkAuthOrReject()) return;
        int n = WiFi.scanNetworks(false, false);
        DynamicJsonDocument doc(1024);
        JsonArray arr = doc.to<JsonArray>();
        if (n > 0) {
            for (int i = 0; i < n && i < 16; i++) {
                String s = WiFi.SSID(i);
                if (s.length() == 0) continue;
                JsonObject o = arr.createNestedObject();
                o["ssid"] = s;
                o["rssi"] = WiFi.RSSI(i);
                o["enc"] = (WiFi.encryptionType(i) != ENC_TYPE_NONE);
            }
        }
        WiFi.scanDelete();
        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    // === GPIO / RELAY REST ENDPOINTS (Central Server Access) ===
    _server.on("/api/gpio", HTTP_GET, [this]() {
        _server.sendHeader(F("Cache-Control"), F("no-cache"));
        DynamicJsonDocument doc(512);
        JsonArray arr = doc.to<JsonArray>();
        GpioManager::getInstance().toJson(arr);
        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/gpio/state", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        StaticJsonDocument<256> doc;
        if (deserializeJson(doc, _server.arg("plain"))) {
            sendJsonResponse(400, false, F("Invalid JSON"));
            return;
        }

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

        sendJsonResponse(ok ? 200 : 400, ok, ok ? F("State updated") : F("Failed to set state"));
    });

    // === UNIFIED DIRECT COMMAND DISPATCHER (Central Server) ===
    _server.on("/api/commands/execute", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        StaticJsonDocument<256> doc;
        if (deserializeJson(doc, _server.arg("plain"))) {
            sendJsonResponse(400, false, F("Invalid JSON"));
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

    // === RECEIVER CONFIG ===
    _server.on("/api/receiver", HTTP_GET, [this]() {
        DynamicJsonDocument doc(512);
        JsonObject obj = doc.to<JsonObject>();
        ReceiverClient::getInstance().getStatusJson(obj);
        String out;
        serializeJson(doc, out);
        _server.send(200, "application/json", out);
    });

    _server.on("/api/receiver", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;

        DynamicJsonDocument doc(512);
        if (deserializeJson(doc, _server.arg("plain"))) {
            sendJsonResponse(400, false, F("Invalid JSON"));
            return;
        }

        ReceiverConfig cfg = ReceiverClient::getInstance().getConfig();
        if (doc.containsKey("enabled")) cfg.enabled = doc["enabled"].as<bool>();
        if (doc.containsKey("serverHost")) cfg.serverHost = doc["serverHost"].as<String>();
        if (doc.containsKey("serverPort")) cfg.serverPort = doc["serverPort"].as<uint16_t>();
        if (doc.containsKey("authToken")) cfg.authToken = doc["authToken"].as<String>();

        ReceiverClient::getInstance().setConfig(cfg);
        sendJsonResponse(200, true, F("Receiver config updated"));
    });

    // === SYSTEM REBOOT ===
    _server.on("/api/system/reboot", HTTP_POST, [this]() {
        if (!checkAuthOrReject()) return;
        sendJsonResponse(200, true, F("Rebooting..."));
        delay(500);
        ESP.restart();
    });

    // === OTA FIRMWARE UPLOAD ===
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
}

void WebServerManager::registerStaticRoutes() {
    _server.on("/", HTTP_GET, [this]() {
        serveEmbeddedDashboard();
    });
    _server.on("/index.html", HTTP_GET, [this]() {
        serveEmbeddedDashboard();
    });
}

// Built-in minimalist ESP-01 setup portal (Login, Wi-Fi Setup, Firmware Upload)
void WebServerManager::serveEmbeddedDashboard() {
    _server.sendHeader(F("Content-Encoding"), F("gzip"));
    _server.send_P(200, "text/html; charset=UTF-8", (const char*)DASHBOARD_HTML_GZ, DASHBOARD_HTML_GZ_LEN);
}
