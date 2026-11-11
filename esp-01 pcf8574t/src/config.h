#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// Firmware Information
#define FIRMWARE_NAME       "SmartHome-ESP01-PCF8574"
#define FIRMWARE_VERSION    "1.6.0"
#define HARDWARE_TARGET     "ESP8266 ESP-01 + PCF8574T (1MB)"

// Default Access Point Settings
#define DEFAULT_AP_SSID     "SmartHome-ESP01-PCF8574"
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
#define ESP01_GPIO0           0   // Pin 5: Boot pin / Default I2C SDA
#define ESP01_GPIO2           2   // Pin 3: Boot pin / Default I2C SCL / ESP-01S Blue LED
#define ESP01_GPIO3_RX        3   // Pin 8: UART0 RX / Optional GPIO
#define ESP01_GPIO1_TX        1   // Pin 1: UART0 TX / Optional GPIO

// PCF8574T I2C Bus Configuration
#define ESP01_I2C_SDA         ESP01_GPIO0   // Pin 5: I2C Data
#define ESP01_I2C_SCL         ESP01_GPIO2   // Pin 3: I2C Clock
#define PCF8574_DEFAULT_ADDR  0x27          // Standard PCF8574T I2C address (probe 0x20-0x27, 0x38-0x3F)
#define PCF_PIN_BASE          100           // Virtual pin numbers: 100 = P0 ... 107 = P7
#define IS_PCF_PIN(p)         ((p) >= PCF_PIN_BASE && (p) <= (PCF_PIN_BASE + 7))
#define PCF_PIN_INDEX(p)      ((p) - PCF_PIN_BASE)

// Compatibility aliases
#ifndef D3
#define D3 0
#define D4 2
#define RX 3
#define TX 1
#endif

// Physical Factory Reset Button
// Set to 255 (disabled) by default on ESP-01 to prevent conflicts with I2C bus on GPIO 0
#define FACTORY_RESET_PIN       255
#define FACTORY_RESET_HOLD_MS   5000

// Onboard LED (GPIO 2, Active-Low on ESP-01S)
#define ONBOARD_LED_PIN         ESP01_GPIO2

// System Constraints (8 PCF8574 pins + optional native pins)
#define MAX_GPIO_CHANNELS       12
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

// ESP-01 + PCF8574T Pin Reference Matrix
static const PinSafetyInfo PIN_SAFETY_MAP[] = {
    { 100,            "P0 (PCF8574 Relay 1)",   true,  false, "I2C Expander Pin P0 (Safe isolated relay output)" },
    { 101,            "P1 (PCF8574 Relay 2)",   true,  false, "I2C Expander Pin P1 (Safe isolated relay output)" },
    { 102,            "P2 (PCF8574 Relay 3)",   true,  false, "I2C Expander Pin P2 (Safe isolated relay output)" },
    { 103,            "P3 (PCF8574 Relay 4)",   true,  false, "I2C Expander Pin P3 (Safe isolated relay output)" },
    { 104,            "P4 (PCF8574 Relay 5)",   true,  false, "I2C Expander Pin P4 (Safe isolated relay output)" },
    { 105,            "P5 (PCF8574 Relay 6)",   true,  false, "I2C Expander Pin P5 (Safe isolated relay output)" },
    { 106,            "P6 (PCF8574 Relay 7)",   true,  false, "I2C Expander Pin P6 (Safe isolated relay output)" },
    { 107,            "P7 (PCF8574 Relay 8)",   true,  false, "I2C Expander Pin P7 (Safe isolated relay output)" },
    { ESP01_GPIO0,    "GPIO 0 (I2C SDA)",       false, true,  "Dedicated I2C SDA bus for PCF8574T (must be HIGH at boot)" },
    { ESP01_GPIO2,    "GPIO 2 (I2C SCL / LED)", false, true,  "Dedicated I2C SCL bus for PCF8574T (must be HIGH at boot)" },
    { ESP01_GPIO3_RX, "GPIO 3 (RX / Native)",   true,  false, "UART0 RX. Can be used as native GPIO if Serial is disabled." },
    { ESP01_GPIO1_TX, "GPIO 1 (TX / Native)",   true,  false, "UART0 TX. Can be used as native GPIO if Serial is disabled." }
};
static const size_t PIN_SAFETY_MAP_COUNT = sizeof(PIN_SAFETY_MAP) / sizeof(PIN_SAFETY_MAP[0]);

#endif // CONFIG_H
