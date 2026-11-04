#include <Arduino.h>
#include "config.h"
#include "storage_manager.h"
#include "auth_manager.h"
#include "gpio_manager.h"
#include "wifi_manager.h"
#include "automation.h"
#include "ota_manager.h"
#include "web_server.h"
#include "receiver_client.h"

// Hardware Reset Button State
unsigned long resetBtnPressStart = 0;
bool resetBtnPressed = false;

void checkResetButton() {
#if defined(FACTORY_RESET_PIN) && (FACTORY_RESET_PIN < 17)
    // Physical button is pulled HIGH; pressing pulls to GND (LOW)
    if (digitalRead(FACTORY_RESET_PIN) == LOW) {
        if (!resetBtnPressed) {
            resetBtnPressed = true;
            resetBtnPressStart = millis();
        } else {
            unsigned long heldDuration = millis() - resetBtnPressStart;
            if (heldDuration >= FACTORY_RESET_HOLD_MS) {
                Serial.println(F("\n[RESET] Physical factory reset triggered via 5s button hold!"));
                
                // Rapidly blink onboard LED as visual feedback
                pinMode(ONBOARD_LED_PIN, OUTPUT);
                for (int i = 0; i < 10; i++) {
                    digitalWrite(ONBOARD_LED_PIN, (i % 2 == 0) ? LOW : HIGH);
                    delay(80);
                }

                WifiManager::getInstance().resetWifiCredentials();
                Serial.println(F("[RESET] Wi-Fi credentials erased. Rebooting..."));
                delay(500);
                ESP.restart();
            }
        }
    } else {
        resetBtnPressed = false;
        resetBtnPressStart = 0;
    }
#endif
}

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println();
    Serial.println(F("=================================================="));
    Serial.printf ("    %s v%s\n", FIRMWARE_NAME, FIRMWARE_VERSION);
    Serial.printf ("    Target: %s\n", HARDWARE_TARGET);
    Serial.println(F("=================================================="));

    // Configure Reset Button Pin with Internal Pull-Up (if configured)
#if defined(FACTORY_RESET_PIN) && (FACTORY_RESET_PIN < 17)
    pinMode(FACTORY_RESET_PIN, INPUT_PULLUP);
#endif
    pinMode(ONBOARD_LED_PIN, OUTPUT);
    digitalWrite(ONBOARD_LED_PIN, HIGH); // Off initially (Active-Low)

    // 1. Initialize Persistent Storage (LittleFS)
    if (!StorageManager::getInstance().begin()) {
        Serial.println(F("[FATAL] Flash storage initialization failed!"));
    }

    // 2. Initialize Authentication Subsystem
    AuthManager::getInstance().begin();

    // 3. Connect GPIO State Change Callback to Automation Engine & Central Receiver
    GpioManager::getInstance().registerStateChangeCallback([](uint8_t id, bool newState) {
        AutomationEngine::getInstance().notifyGpioStateChanged(id, newState);
        ReceiverClient::getInstance().onGpioStateChanged(id, newState);
    });

    // 4. Initialize Hardware GPIO Channels
    GpioManager::getInstance().begin();

    // 5. Initialize Wi-Fi Subsystem & Captive Portal
    WifiManager::getInstance().begin();

    // 6. Initialize Automation Rule Engine
    AutomationEngine::getInstance().begin();

    // 7. Initialize Central Receiver & Multi-Node Telemetry Client
    ReceiverClient::getInstance().begin();

    // 8. Initialize OTA Updates
    OtaManager::getInstance().begin(WifiManager::getInstance().getApSsid());

    // 9. Initialize Embedded Web Server & REST API
    WebServerManager::getInstance().begin();

    Serial.println(F("[INIT] SmartHome Controller is fully ready!"));
    Serial.printf ("[INIT] Setup Access Point IP: %s (SSID: %s)\n",
                   WiFi.softAPIP().toString().c_str(),
                   WifiManager::getInstance().getApSsid().c_str());
    if (WifiManager::getInstance().isSTAConnected()) {
        Serial.printf("[INIT] Home Router IP: %s\n", WiFi.localIP().toString().c_str());
    }
}

void loop() {
    // Run modular non-blocking subsystems
    WifiManager::getInstance().loop();
    WebServerManager::getInstance().loop();
    GpioManager::getInstance().loop();
    AutomationEngine::getInstance().loop();
    ReceiverClient::getInstance().loop();
    OtaManager::getInstance().loop();

    // Physical recovery reset button monitor
    checkResetButton();

    yield();
}
