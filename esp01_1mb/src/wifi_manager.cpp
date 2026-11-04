#include "wifi_manager.h"
#include "storage_manager.h"
#include "automation.h"

WifiManager::WifiManager()
    : _apActive(false),
      _isConnecting(false),
      _connectStartTime(0),
      _lastWatchdogCheck(0),
      _wifiConnectedTime(0) {
    _config.mode = WIFI_MODE_AP_ROUTER;
    _config.apSsid = DEFAULT_AP_SSID;
    _config.apPassword = DEFAULT_AP_PASS;
    _config.staSsid = "";
    _config.staPassword = "";
    _config.isConfigured = false;
    _config.useStaticIp = false;
    _config.staticIp = "";
    _config.staticGateway = "";
    _config.staticSubnet = "255.255.255.0";
    _config.staticDns1 = "8.8.8.8";
    _config.staticDns2 = "1.1.1.1";
}

WifiManager& WifiManager::getInstance() {
    static WifiManager instance;
    return instance;
}

bool WifiManager::begin() {
    loadFromStorage();

    WiFi.persistent(false);
    WiFi.disconnect(true);
    delay(100);

    Serial.printf("[WIFI] Initializing Wi-Fi. Mode: %u, Configured: %s\n",
                  _config.mode, _config.isConfigured ? "YES" : "NO");

    if (!_config.isConfigured || _config.mode == WIFI_MODE_AP_ONLY) {
        // No saved Wi-Fi or AP ONLY mode -> Start AP
        WiFi.mode(WIFI_AP);
        startAP();
    } else if (_config.mode == WIFI_MODE_ROUTER_ONLY) {
        WiFi.mode(WIFI_AP_STA); // Start in AP_STA initially as fallback
        startAP();
        connectToRouter(_config.staSsid, _config.staPassword, false);
    } else { // WIFI_MODE_AP_ROUTER (Default)
        WiFi.mode(WIFI_AP_STA);
        startAP();
        connectToRouter(_config.staSsid, _config.staPassword, false);
    }

    return true;
}

void WifiManager::startAP() {
    WiFi.softAPConfig(DEFAULT_AP_IP, DEFAULT_AP_IP, DEFAULT_AP_SUBNET);
    bool ok;
    if (_config.apPassword.length() >= 8) {
        ok = WiFi.softAP(_config.apSsid.c_str(), _config.apPassword.c_str(), DEFAULT_AP_CHANNEL);
    } else {
        ok = WiFi.softAP(_config.apSsid.c_str(), nullptr, DEFAULT_AP_CHANNEL);
    }

    if (ok) {
        _apActive = true;
        _dnsServer.stop();
        _dnsServer.start(DNS_PORT, "*", DEFAULT_AP_IP);
        Serial.printf("[WIFI] Access Point '%s' started at IP: %s\n",
                      _config.apSsid.c_str(), WiFi.softAPIP().toString().c_str());
    } else {
        Serial.println(F("[WIFI] Failed to start Access Point!"));
    }
}

void WifiManager::stopAP() {
    if (_apActive) {
        _dnsServer.stop();
        WiFi.softAPdisconnect(true);
        _apActive = false;
        Serial.println(F("[WIFI] Access Point stopped."));
    }
}

void WifiManager::applyIpConfig() {
    if (_config.useStaticIp && _config.staticIp.length() > 0) {
        IPAddress ip, gw, mask, dns1, dns2;
        if (ip.fromString(_config.staticIp) &&
            gw.fromString(_config.staticGateway) &&
            mask.fromString(_config.staticSubnet)) {

            if (_config.staticDns1.length() > 0 && dns1.fromString(_config.staticDns1)) {
                if (_config.staticDns2.length() > 0 && dns2.fromString(_config.staticDns2)) {
                    WiFi.config(ip, gw, mask, dns1, dns2);
                } else {
                    WiFi.config(ip, gw, mask, dns1);
                }
            } else {
                WiFi.config(ip, gw, mask, gw);
            }
            Serial.printf("[WIFI] Static IP configured: %s, GW: %s, Subnet: %s\n",
                          ip.toString().c_str(), gw.toString().c_str(), mask.toString().c_str());
            return;
        }
    }
    // DHCP Client mode
    WiFi.config(0U, 0U, 0U);
    Serial.println(F("[WIFI] Configured as DHCP Client (Automatic IP)"));
}

bool WifiManager::connectToRouter(const String& ssid, const String& password, bool save,
                                 bool useStatic, const String& staticIp, const String& gateway,
                                 const String& subnet, const String& dns1, const String& dns2) {
    if (ssid.length() == 0) return false;

    Serial.printf("[WIFI] Connecting to router '%s' (IP Mode: %s)...\n",
                  ssid.c_str(), useStatic ? "Static IP" : "DHCP");
    _isConnecting = true;
    _connectStartTime = millis();

    if (save) {
        _config.staSsid = ssid;
        _config.staPassword = password;
        _config.isConfigured = true;
        _config.useStaticIp = useStatic;
        if (useStatic) {
            _config.staticIp = staticIp;
            _config.staticGateway = gateway;
            _config.staticSubnet = (subnet.length() > 0) ? subnet : F("255.255.255.0");
            _config.staticDns1 = (dns1.length() > 0) ? dns1 : F("8.8.8.8");
            _config.staticDns2 = (dns2.length() > 0) ? dns2 : F("1.1.1.1");
        }
        saveToStorage();
    }

    applyIpConfig();
    WiFi.begin(ssid.c_str(), password.c_str());
    return true;
}

void WifiManager::setIpConfig(bool useStatic, const String& staticIp, const String& gateway,
                              const String& subnet, const String& dns1, const String& dns2) {
    _config.useStaticIp = useStatic;
    _config.staticIp = staticIp;
    _config.staticGateway = gateway;
    _config.staticSubnet = (subnet.length() > 0) ? subnet : F("255.255.255.0");
    _config.staticDns1 = (dns1.length() > 0) ? dns1 : F("8.8.8.8");
    _config.staticDns2 = (dns2.length() > 0) ? dns2 : F("1.1.1.1");
    saveToStorage();
    applyIpConfig();

    if (isSTAConnected()) {
        Serial.println(F("[WIFI] Reconnecting to router to apply new IP settings..."));
        WiFi.disconnect(false);
        WiFi.begin(_config.staSsid.c_str(), _config.staPassword.c_str());
        _isConnecting = true;
        _connectStartTime = millis();
    }
}

void WifiManager::disconnectRouter() {
    WiFi.disconnect(false);
    Serial.println(F("[WIFI] Disconnected from router."));
}

void WifiManager::loop() {
    if (_apActive) {
        _dnsServer.processNextRequest();
    }

    unsigned long now = millis();

    // Track connection uptime
    if (WiFi.status() == WL_CONNECTED) {
        if (_wifiConnectedTime == 0) {
            _wifiConnectedTime = now;
        }
    } else {
        _wifiConnectedTime = 0;
    }

    // Check connecting state timeout
    if (_isConnecting) {
        if (WiFi.status() == WL_CONNECTED) {
            _isConnecting = false;
            _wifiConnectedTime = now;
            Serial.printf("[WIFI] Connected to router! IP: %s, RSSI: %d dBm\n",
                          WiFi.localIP().toString().c_str(), WiFi.RSSI());

            // Trigger immediate NTP synchronization with Indian / Google servers
            AutomationEngine::getInstance().syncNtp();

            if (_config.mode == WIFI_MODE_ROUTER_ONLY) {
                // In ROUTER ONLY mode, disable AP once successfully connected
                stopAP();
                WiFi.mode(WIFI_STA);
            }
        } else if (now - _connectStartTime >= STA_CONNECT_TIMEOUT_MS) {
            _isConnecting = false;
            Serial.println(F("[WIFI] Connection to router timed out."));

            // Recovery: Ensure AP is running so user can access dashboard
            if (!_apActive) {
                WiFi.mode(WIFI_AP_STA);
                startAP();
            }
        }
    }

    // Periodic watchdog check (every 10 seconds)
    if (now - _lastWatchdogCheck >= 10000) {
        _lastWatchdogCheck = now;

        if (_config.isConfigured && _config.mode != WIFI_MODE_AP_ONLY) {
            if (WiFi.status() != WL_CONNECTED && !_isConnecting) {
                Serial.println(F("[WIFI] Connection lost, fallback AP active. Attempting reconnect..."));
                if (!_apActive) {
                    WiFi.mode(WIFI_AP_STA);
                    startAP();
                }
                WiFi.begin(_config.staSsid.c_str(), _config.staPassword.c_str());
                _isConnecting = true;
                _connectStartTime = now;
            }
        }
    }
}

void WifiManager::setMode(uint8_t mode) {
    if (mode > WIFI_MODE_AP_ROUTER) mode = WIFI_MODE_AP_ROUTER;
    _config.mode = mode;
    saveToStorage();

    if (mode == WIFI_MODE_AP_ONLY) {
        disconnectRouter();
        WiFi.mode(WIFI_AP);
        startAP();
    } else if (mode == WIFI_MODE_ROUTER_ONLY) {
        if (isSTAConnected()) {
            stopAP();
            WiFi.mode(WIFI_STA);
        } else {
            // Keep AP until connected
            WiFi.mode(WIFI_AP_STA);
            startAP();
            if (_config.isConfigured) {
                connectToRouter(_config.staSsid, _config.staPassword, false);
            }
        }
    } else { // AP + ROUTER
        WiFi.mode(WIFI_AP_STA);
        startAP();
        if (_config.isConfigured && !isSTAConnected()) {
            connectToRouter(_config.staSsid, _config.staPassword, false);
        }
    }
}

void WifiManager::setApConfig(const String& ssid, const String& password) {
    if (ssid.length() > 0) {
        _config.apSsid = ssid;
        _config.apPassword = password;
        saveToStorage();
        if (_apActive) {
            startAP(); // Re-apply with new settings
        }
    }
}

bool WifiManager::isSTAConnected() const {
    return (WiFi.status() == WL_CONNECTED);
}

String WifiManager::getSTAIP() const {
    return isSTAConnected() ? WiFi.localIP().toString() : F("0.0.0.0");
}

String WifiManager::getAPIP() const {
    return _apActive ? WiFi.softAPIP().toString() : F("0.0.0.0");
}

String WifiManager::getSTAGateway() const {
    return isSTAConnected() ? WiFi.gatewayIP().toString() : F("0.0.0.0");
}

String WifiManager::getSTASubnet() const {
    return isSTAConnected() ? WiFi.subnetMask().toString() : F("0.0.0.0");
}

int32_t WifiManager::getSTARSSI() const {
    return isSTAConnected() ? WiFi.RSSI() : 0;
}

String WifiManager::getConnectedSSID() const {
    return isSTAConnected() ? WiFi.SSID() : F("");
}

uint32_t WifiManager::getWifiUptimeSec() const {
    if (isSTAConnected() && _wifiConnectedTime > 0) {
        return (millis() - _wifiConnectedTime) / 1000UL;
    }
    return 0;
}

String WifiManager::getEncryptionName(uint8_t type) {
    switch (type) {
        case ENC_TYPE_NONE: return F("Open");
        case ENC_TYPE_WEP:  return F("WEP");
        case ENC_TYPE_TKIP: return F("WPA/PSK");
        case ENC_TYPE_CCMP: return F("WPA2/PSK");
        case ENC_TYPE_AUTO: return F("WPA/WPA2");
        default:            return F("Unknown");
    }
}

void WifiManager::getStatusJson(JsonObject& obj) {
    obj["mode"] = _config.mode;
    obj["apActive"] = _apActive;
    obj["apSsid"] = _config.apSsid;
    obj["apIp"] = getAPIP();
    obj["staConnected"] = isSTAConnected();
    obj["isConnecting"] = _isConnecting;
    obj["staSsid"] = getConnectedSSID();
    obj["staIp"] = getSTAIP();
    obj["gateway"] = getSTAGateway();
    obj["subnet"] = getSTASubnet();
    obj["rssi"] = getSTARSSI();
    obj["wifiUptimeSec"] = getWifiUptimeSec();
    obj["isConfigured"] = _config.isConfigured;

    // IP Mode Diagnostics (DHCP vs Static IP)
    obj["useStaticIp"] = _config.useStaticIp;
    obj["ipMode"] = _config.useStaticIp ? F("Static IP") : F("DHCP Client");
    obj["staticIp"] = (_config.staticIp.length() > 0) ? _config.staticIp : getSTAIP();
    obj["staticGateway"] = (_config.staticGateway.length() > 0) ? _config.staticGateway : getSTAGateway();
    obj["staticSubnet"] = (_config.staticSubnet.length() > 0) ? _config.staticSubnet : getSTASubnet();
    obj["staticDns1"] = (_config.staticDns1.length() > 0) ? _config.staticDns1 : F("8.8.8.8");
    obj["staticDns2"] = (_config.staticDns2.length() > 0) ? _config.staticDns2 : F("1.1.1.1");
    obj["dns1"] = WiFi.dnsIP(0).toString();
    obj["dns2"] = WiFi.dnsIP(1).toString();
}

void WifiManager::resetWifiCredentials() {
    Serial.println(F("[WIFI] Clearing saved Wi-Fi credentials..."));
    _config.staSsid = "";
    _config.staPassword = "";
    _config.isConfigured = false;
    _config.useStaticIp = false;
    _config.staticIp = "";
    _config.staticGateway = "";
    _config.staticSubnet = "255.255.255.0";
    _config.staticDns1 = "8.8.8.8";
    _config.staticDns2 = "1.1.1.1";
    _config.mode = WIFI_MODE_AP_ONLY;
    saveToStorage();

    WiFi.disconnect(true);
    WiFi.mode(WIFI_AP);
    startAP();
}

void WifiManager::loadFromStorage() {
    DynamicJsonDocument doc(512);
    if (StorageManager::getInstance().loadJsonFile(FILE_WIFI_CONFIG, doc)) {
        _config.mode = doc["mode"] | (uint8_t)WIFI_MODE_AP_ROUTER;
        _config.apSsid = doc["apSsid"].as<String>();
        if (_config.apSsid.length() == 0) _config.apSsid = DEFAULT_AP_SSID;
        _config.apPassword = doc["apPassword"].as<String>();
        _config.staSsid = doc["staSsid"].as<String>();
        _config.staPassword = doc["staPassword"].as<String>();
        _config.isConfigured = doc["isConfigured"] | false;

        _config.useStaticIp = doc["useStaticIp"] | false;
        _config.staticIp = doc["staticIp"] | "";
        _config.staticGateway = doc["staticGateway"] | "";
        _config.staticSubnet = doc["staticSubnet"] | "255.255.255.0";
        _config.staticDns1 = doc["staticDns1"] | "8.8.8.8";
        _config.staticDns2 = doc["staticDns2"] | "1.1.1.1";
    }
}

void WifiManager::saveToStorage() {
    DynamicJsonDocument doc(512);
    doc["mode"] = _config.mode;
    doc["apSsid"] = _config.apSsid;
    doc["apPassword"] = _config.apPassword;
    doc["staSsid"] = _config.staSsid;
    doc["staPassword"] = _config.staPassword;
    doc["isConfigured"] = _config.isConfigured;

    doc["useStaticIp"] = _config.useStaticIp;
    doc["staticIp"] = _config.staticIp;
    doc["staticGateway"] = _config.staticGateway;
    doc["staticSubnet"] = _config.staticSubnet;
    doc["staticDns1"] = _config.staticDns1;
    doc["staticDns2"] = _config.staticDns2;

    StorageManager::getInstance().saveJsonFile(FILE_WIFI_CONFIG, doc);
}
