#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// Firmware Information
#define FIRMWARE_NAME       "SmartHome-ESP01"
#define FIRMWARE_VERSION    "1.6.0"
#define HARDWARE_TARGET     "ESP8266 ESP-01 / ESP-01S (1MB)"

// Default Access Point Settings
#define DEFAULT_AP_SSID     "SmartHome-ESP01"
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

// Hardware Pin Definitions for ESP-01 / ESP-01S
#define ESP01_GPIO0           0   // Pin 5: Boot pin / Relay 1 Output
#define ESP01_GPIO2           2   // Pin 3: Boot pin / Relay 2 Output / ESP-01S Blue LED
#define ESP01_GPIO3_RX        3   // Pin 8: UART0 RX / Optional GPIO
#define ESP01_GPIO1_TX        1   // Pin 1: UART0 TX / Optional GPIO

// Compatibility aliases
#ifndef D3
#define D3 0
#define D4 2
#define RX 3
#define TX 1
#endif

// Physical Factory Reset Button
// Set to 255 (disabled) by default on ESP-01 to prevent relay actuation on GPIO 0 from triggering a reset.
#define FACTORY_RESET_PIN       255
#define FACTORY_RESET_HOLD_MS   5000

// Onboard LED (GPIO 2, Active-Low on ESP-01S)
#define ONBOARD_LED_PIN         ESP01_GPIO2

// System Constraints (ESP-01 has 4 physical GPIO pins: 0, 2, 3, 1)
#define MAX_GPIO_CHANNELS       4
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

// ESP-01 Pin Reference Matrix
static const PinSafetyInfo PIN_SAFETY_MAP[] = {
    { ESP01_GPIO0,    "GPIO 0 (Relay 1)",       true, true,  "Boot pin (must be HIGH at boot). Standard ESP-01 relay control pin." },
    { ESP01_GPIO2,    "GPIO 2 (Relay 2 / LED)", true, true,  "Boot pin (must be HIGH at boot). ESP-01S onboard LED / Relay 2." },
    { ESP01_GPIO3_RX, "GPIO 3 (RX / Input)",    true, false, "UART0 RX. Can be used as input or relay if Serial is disabled." },
    { ESP01_GPIO1_TX, "GPIO 1 (TX / Output)",   true, false, "UART0 TX. Can be used as relay output if Serial is disabled." }
};
static const size_t PIN_SAFETY_MAP_COUNT = sizeof(PIN_SAFETY_MAP) / sizeof(PIN_SAFETY_MAP[0]);

#endif // CONFIG_H
