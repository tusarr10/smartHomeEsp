#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// Firmware Information
#define FIRMWARE_NAME       "SmartHome-NodeMCU"
#define FIRMWARE_VERSION    "1.6.0"
#define HARDWARE_TARGET     "ESP8266 (ESP-12E/F) NodeMCU"

// Default Access Point Settings
#define DEFAULT_AP_SSID     "SmartHome-Setup"
#define DEFAULT_AP_PASS     ""               // Blank by default for captive setup
#define DEFAULT_AP_CHANNEL  1
#define DEFAULT_AP_IP       IPAddress(192, 168, 4, 1)
#define DEFAULT_AP_SUBNET   IPAddress(255, 255, 255, 0)
#define DNS_PORT            53

// Default Administrative Credentials
#define DEFAULT_ADMIN_USER  "admin"
#define DEFAULT_ADMIN_PASS  "admin"

// Wi-Fi Connection Modes
enum WifiSystemMode {
    WIFI_MODE_AP_ONLY     = 0,
    WIFI_MODE_ROUTER_ONLY = 1,
    WIFI_MODE_AP_ROUTER   = 2   // Default
};

// Storage Paths in LittleFS
#define FILE_SYSTEM_CONFIG    "/config/system.json"
#define FILE_WIFI_CONFIG      "/config/wifi.json"
#define FILE_GPIO_CONFIG      "/config/gpio.json"
#define FILE_RULES_CONFIG     "/config/rules.json"
#define FILE_RECEIVER_CONFIG  "/config/receiver.json"

// Hardware Pin Definitions for NodeMCU ESP-12E/F
#ifndef D0
#define D0 16
#define D1 5
#define D2 4
#define D3 0
#define D4 2
#define D5 14
#define D6 12
#define D7 13
#define D8 15
#define RX 3
#define TX 1
#endif

// Physical Factory Reset Button (NodeMCU Flash button is D3 / GPIO 0)
#define FACTORY_RESET_PIN       D3
#define FACTORY_RESET_HOLD_MS   5000

// Onboard LED (D4 / GPIO 2, Active-Low on NodeMCU)
#define ONBOARD_LED_PIN         D4

// System Constraints
#define MAX_GPIO_CHANNELS       8
#define MAX_AUTOMATION_RULES    10
#define LOG_BUFFER_CAPACITY     50
#define SESSION_TIMEOUT_SEC     3600
#define STA_CONNECT_TIMEOUT_MS  20000

// Structure for Pin Metadata and Safety Validation
struct PinSafetyInfo {
    uint8_t gpio;
    const char* label;
    bool isSafeRelay;
    bool isBootSensitive;
    const char* bootNote;
};

// NodeMCU Pin Reference Matrix
static const PinSafetyInfo PIN_SAFETY_MAP[] = {
    { D1, "D1 (GPIO5)",  true,  false, "Safe I2C SCL, boot-neutral" },
    { D2, "D2 (GPIO4)",  true,  false, "Safe I2C SDA, boot-neutral" },
    { D5, "D5 (GPIO14)", true,  false, "Safe SPI CLK, boot-neutral" },
    { D6, "D6 (GPIO12)", true,  false, "Safe SPI MISO, boot-neutral" },
    { D7, "D7 (GPIO13)", true,  false, "Safe SPI MOSI, boot-neutral" },
    { D0, "D0 (GPIO16)", true,  true,  "WAKE pin, HIGH at boot" },
    { D3, "D3 (GPIO0)",  false, true,  "Boot config (Flash button), must be HIGH at boot" },
    { D4, "D4 (GPIO2)",  false, true,  "Boot config (TXD1/LED), must be HIGH at boot" },
    { D8, "D8 (GPIO15)", false, true,  "Boot config (pulled LOW), must be LOW at boot" }
};
static const size_t PIN_SAFETY_MAP_COUNT = sizeof(PIN_SAFETY_MAP) / sizeof(PIN_SAFETY_MAP[0]);

#endif // CONFIG_H
