#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// Firmware Information
#define FIRMWARE_NAME       "SmartHome-NodeMCU-PCF8574"
#define FIRMWARE_VERSION    "1.6.0"
#define HARDWARE_TARGET     "ESP8266 NodeMCU + PCF8574T"

// Default Access Point Settings
#define DEFAULT_AP_SSID     "SmartHome-NodeMCU-PCF8574"
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
#ifndef SD2
#define SD2 9
#endif
#ifndef SD3
#define SD3 10
#endif

// PCF8574T I2C Bus Configuration for NodeMCU (Standard D2 = SDA, D1 = SCL)
#define NODEMCU_I2C_SDA       D2            // Pin D2 (GPIO 4) I2C Data
#define NODEMCU_I2C_SCL       D1            // Pin D1 (GPIO 5) I2C Clock
#define PCF8574_DEFAULT_ADDR  0x27          // Standard PCF8574T I2C address (probes 0x20-0x27, 0x38-0x3F)
#define PCF_PIN_BASE          100           // Virtual pin numbers: 100 = P0 ... 107 = P7
#define IS_PCF_PIN(p)         ((p) >= PCF_PIN_BASE && (p) <= (PCF_PIN_BASE + 7))
#define PCF_PIN_INDEX(p)      ((p) - PCF_PIN_BASE)

// Physical Factory Reset Button (NodeMCU Flash button is D3 / GPIO 0)
#define FACTORY_RESET_PIN       D3
#define FACTORY_RESET_HOLD_MS   5000

// Onboard LED (D4 / GPIO 2, Active-Low on NodeMCU)
#define ONBOARD_LED_PIN         D4

// System Constraints
#define MAX_GPIO_CHANNELS       24
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

// NodeMCU + PCF8574T Pin Reference Matrix
static const PinSafetyInfo PIN_SAFETY_MAP[] = {
    // 8 Extended PCF8574T I2C Expander Pins (100-107)
    { 100, "P0 (PCF8574 Relay 1)", true,  false, "I2C Expander Pin P0 (Safe isolated relay output)" },
    { 101, "P1 (PCF8574 Relay 2)", true,  false, "I2C Expander Pin P1 (Safe isolated relay output)" },
    { 102, "P2 (PCF8574 Relay 3)", true,  false, "I2C Expander Pin P2 (Safe isolated relay output)" },
    { 103, "P3 (PCF8574 Relay 4)", true,  false, "I2C Expander Pin P3 (Safe isolated relay output)" },
    { 104, "P4 (PCF8574 Relay 5)", true,  false, "I2C Expander Pin P4 (Safe isolated relay output)" },
    { 105, "P5 (PCF8574 Relay 6)", true,  false, "I2C Expander Pin P5 (Safe isolated relay output)" },
    { 106, "P6 (PCF8574 Relay 7)", true,  false, "I2C Expander Pin P6 (Safe isolated relay output)" },
    { 107, "P7 (PCF8574 Relay 8)", true,  false, "I2C Expander Pin P7 (Safe isolated relay output)" },

    // Dedicated I2C Lines (D2 = SDA, D1 = SCL)
    { D1,  "D1 (GPIO5 / SCL)",     false, false, "Dedicated I2C SCL bus for PCF8574T" },
    { D2,  "D2 (GPIO4 / SDA)",     false, false, "Dedicated I2C SDA bus for PCF8574T" },

    // Available NodeMCU Native GPIOs
    { D5,  "D5 (GPIO14)",          true,  false, "Safe SPI CLK, boot-neutral" },
    { D6,  "D6 (GPIO12)",          true,  false, "Safe SPI MISO, boot-neutral" },
    { D7,  "D7 (GPIO13)",          true,  false, "Safe SPI MOSI, boot-neutral" },
    { D0,  "D0 (GPIO16)",          true,  true,  "WAKE pin, HIGH at boot" },
    { D8,  "D8 (GPIO15)",          true,  true,  "Boot config (pulled LOW), must be LOW at boot" },
    { D3,  "D3 (GPIO0)",           true,  true,  "Boot config (Flash button), must be HIGH at boot" },
    { D4,  "D4 (GPIO2)",           true,  true,  "Boot config (TXD1/LED), must be HIGH at boot" },
    { RX,  "RX (GPIO3)",           true,  true,  "UART0 RX, serial debug input" },
    { TX,  "TX (GPIO1)",           true,  true,  "UART0 TX, serial debug output (HIGH at boot)" },
    { SD2, "SD2 (GPIO9)",          true,  true,  "Flash IO SD2 (usable in DIO/DOUT mode)" },
    { SD3, "SD3 (GPIO10)",         true,  true,  "Flash IO SD3 (usable in DIO/DOUT mode)" }
};
static const size_t PIN_SAFETY_MAP_COUNT = sizeof(PIN_SAFETY_MAP) / sizeof(PIN_SAFETY_MAP[0]);

#endif // CONFIG_H
