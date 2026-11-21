#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <DNSServer.h>
#include <ArduinoJson.h>
#include <vector>
#include "config.h"

struct ScannedNetwork {
    String ssid;
    int32_t rssi;
    uint8_t encryptionType;
    int32_t channel;
    bool isHidden;
};

struct WifiConfig {
    uint8_t mode;               // WifiSystemMode (AP_ONLY, ROUTER_ONLY, AP_ROUTER)
    String apSsid;
    String apPassword;
    String staSsid;
    String staPassword;
    bool isConfigured;          // True if valid router credentials stored
    bool useStaticIp;           // False = DHCP Client, True = Static IP
    String staticIp;
    String staticGateway;
    String staticSubnet;
    String staticDns1;
    String staticDns2;
};

class WifiManager {
public:
    static WifiManager& getInstance();

    bool begin();
    void loop();

    void startAP();
    void stopAP();
    bool connectToRouter(const String& ssid, const String& password, bool save = true,
                         bool useStatic = false, const String& staticIp = "",
                         const String& gateway = "", const String& subnet = "",
                         const String& dns1 = "", const String& dns2 = "");
    void setIpConfig(bool useStatic, const String& staticIp, const String& gateway,
                     const String& subnet, const String& dns1, const String& dns2);
    void applyIpConfig();
    void disconnectRouter();

    void scanNetworks(std::vector<ScannedNetwork>& outList);
    void setMode(uint8_t mode);
    uint8_t getMode() const { return _config.mode; }

    bool isSTAConnected() const;
    bool isAPActive() const { return _apActive; }
    bool isStaticIp() const { return _config.useStaticIp; }
    bool isConfigured() const { return _config.isConfigured; }

    String getSTAIP() const;
    String getAPIP() const;
    String getSTAGateway() const;
    String getSTASubnet() const;
    int32_t getSTARSSI() const;
    String getConnectedSSID() const;
    uint32_t getWifiUptimeSec() const;

    String getApSsid() const { return _config.apSsid; }
    void setApConfig(const String& ssid, const String& password);

    void getStatusJson(JsonObject& obj);
    void resetWifiCredentials();

private:
    WifiManager();
    WifiConfig _config;
    DNSServer _dnsServer;
    bool _apActive;
    bool _isConnecting;
    unsigned long _connectStartTime;
    unsigned long _lastWatchdogCheck;
    unsigned long _wifiConnectedTime;

    void loadFromStorage();
    void saveToStorage();
    void applyMode();
    static String getEncryptionName(uint8_t type);
};

#endif // WIFI_MANAGER_H
