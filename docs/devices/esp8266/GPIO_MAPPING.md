# DEVICE 01 GPIO MAPPING & PIN SAFETY MATRIX

**Board**: NodeMCU v2 (ESP-12E / ESP-12F)  
**Evidence Source**: [`esp8266_4mb/src/config.h`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/config.h#L37-L87) and [`esp8266_4mb/src/gpio_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp#L17-L35)  

---

## 1. Pin Safety Matrix (`PIN_SAFETY_MAP`)

Firmware defines an authoritative hardware safety table used by `GpioManager::isPinSafe()` to validate channel assignments:

| Pin Label | GPIO Number | Safe for Relay? | Boot Sensitive? | Boot Condition / Hardware Note | Recommended Function |
|---|---|---|---|---|---|
| **D1** | GPIO 5 | **YES** | **NO** | Safe I2C SCL, boot-neutral, default pull-up | **Relay Channel 1** |
| **D2** | GPIO 4 | **YES** | **NO** | Safe I2C SDA, boot-neutral, default pull-up | **Relay Channel 2** |
| **D5** | GPIO 14 | **YES** | **NO** | Safe SPI CLK, boot-neutral | **Relay Channel 3** |
| **D6** | GPIO 12 | **YES** | **NO** | Safe SPI MISO, boot-neutral | **Relay Channel 4** |
| **D7** | GPIO 13 | **YES** | **NO** | Safe SPI MOSI, boot-neutral | **Relay Channel 5** |
| **D0** | GPIO 16 | **YES** | **YES** | Deep Sleep WAKE pin; outputs HIGH during boot | **Relay Channel 6** (Observe glitch on boot) |
| **D3** | GPIO 0 | **NO** | **YES** | Boot config (Flash button). **Must be HIGH at boot**. Grounding enters flash download mode. Used for 5s Factory Reset button. | **Factory Reset Button** |
| **D4** | GPIO 2 | **NO** | **YES** | Boot config (TXD1). **Must be HIGH at boot**. Connected to onboard Blue LED (Active-Low). | **System Status LED** |
| **D8** | GPIO 15 | **NO** | **YES** | Boot config. **Must be LOW at boot**. If pulled high externally, ESP fails to boot from SPI flash. | **General Input / Pulled-down** |
| **RX** | GPIO 3 | Conditional | Conditional | UART0 RXD. Connected to USB-UART bridge. | **Serial Debugging / Input** |
| **TX** | GPIO 1 | Conditional | Conditional | UART0 TXD. Outputs bootloader debug info at 74880 baud. | **Serial Console Output** |

---

## 2. Bootstrapping Pin Rules

The ESP8266 hardware bootloader samples pins on the rising edge of reset:

```text
GPIO15 (D8) = LOW
GPIO0  (D3) = HIGH  ===> Normal Boot from SPI Flash (RUN MODE)
GPIO2  (D4) = HIGH

GPIO15 (D8) = LOW
GPIO0  (D3) = LOW   ===> UART Download Mode (FLASH MODE)
GPIO2  (D4) = HIGH

GPIO15 (D8) = HIGH  ===> SDIO Boot Mode (INVALID - BOOT FAILS)
```

> [!WARNING]
> Never connect an active-low relay coil or pull-up resistor directly to **D8 (GPIO15)**. Doing so pulls the pin HIGH at power-up, causing the ESP8266 to hang and enter SDIO mode instead of booting firmware.
> Never connect an external sensor that grounds **D3 (GPIO0)** or **D4 (GPIO2)** at power-on.

---

## 3. Relay Polarity and Initial State Logic

Each configured channel in `GpioManager` supports:
- **`activeLow`** (bool):
  - `true` (standard for opto-isolated relay modules): Logic `true` (ON) writes `digitalWrite(pin, LOW)`. Logic `false` (OFF) writes `digitalWrite(pin, HIGH)`.
  - `false` (active-high transistor drivers): Logic `true` writes `HIGH`, logic `false` writes `LOW`.
- **`initialMode`**:
  - `0` (`INITIAL_MODE_RESTORE_LAST`): Reads last state from LittleFS `/config/gpio.json` and reapplies.
  - `1` (`INITIAL_MODE_OFF`): Always boots with relay open/de-energized.
  - `2` (`INITIAL_MODE_ON`): Always boots with relay closed/energized.
- **Safety Pin Initialization Sequence**:
  In [`GpioManager::applyPhysicalPin()`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/gpio_manager.cpp#L198-L208), the physical pin output state is applied **before** calling `pinMode(pin, OUTPUT)`. This prevents momentary relay chatter or relay clicking during microcontroller boot initialization.
