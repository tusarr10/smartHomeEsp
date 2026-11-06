# DEVICE 03 GPIO MAPPING & PIN SAFETY: ESP-01 / ESP-01S (1MB)

**Evidence Source**: [`esp01_1mb/src/config.h`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/config.h#L37-L82)  

---

## 1. Pin Reference Matrix (`PIN_SAFETY_MAP`)

| Pin Identifier | GPIO | Safe for Relay? | Boot Sensitive? | Boot Condition / Hardware Details |
|---|---|---|---|---|
| **ESP01_GPIO0** | GPIO 0 | **YES** | **YES** | **Must be HIGH at boot**. Standard commercial ESP-01 single/dual relay driver pin. If grounded at boot, enters UART flash mode. |
| **ESP01_GPIO2** | GPIO 2 | **YES** | **YES** | **Must be HIGH at boot**. Tied to ESP-01S onboard Blue LED (Active-Low). Controls Relay 2. |
| **ESP01_GPIO3_RX**| GPIO 3 | **YES** | **NO** | UART0 RXD. Boot-neutral. Can be repurposed as relay output or digital input if `Serial` is disabled. |
| **ESP01_GPIO1_TX**| GPIO 1 | **YES** | **NO** | UART0 TXD. Outputs bootloader debug info at 74880 baud during power-on. Can be repurposed for Relay 4. |

---

## 2. Factory Reset Pin Configuration

In [`esp01_1mb/src/config.h`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/config.h#L51-L54):

```cpp
// Physical Factory Reset Button
// Set to 255 (disabled) by default on ESP-01 to prevent relay actuation on GPIO 0 from triggering a reset.
#define FACTORY_RESET_PIN       255
#define FACTORY_RESET_HOLD_MS   5000
```

### Critical Hardware Insight:
On NodeMCU boards, GPIO 0 is wired to a physical momentary switch ("FLASH button"). On ESP-01 modules, GPIO 0 is wired directly to the relay coil optocoupler.
If `FACTORY_RESET_PIN` were configured as GPIO 0 on an ESP-01, switching the relay LOW for more than 5 seconds would inadvertently trigger a factory reset and erase Wi-Fi credentials!
Disabling the physical reset button (`FACTORY_RESET_PIN = 255`) is an essential architectural protection specifically designed for ESP-01 hardware.

---

## 3. Relay Module Wiring & Power-On Glitch Mitigation

Commercial ESP-01 relay modules typically use active-low PNP transistor or optocoupler inputs:
1. At power-on, the ESP8266 internal weak pull-up resistor keeps GPIO 0 and GPIO 2 HIGH, allowing the chip to boot into RUN mode.
2. In [`GpioManager::applyPhysicalPin()`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/gpio_manager.cpp#L15-L25), `digitalWrite()` is called **before** `pinMode(pin, OUTPUT)` to ensure the relay never glitches or clicks during boot initialization:
   ```cpp
   digitalWrite(pin, logicalState ? (activeLow ? LOW : HIGH) : (activeLow ? HIGH : LOW));
   pinMode(pin, OUTPUT);
   ```
