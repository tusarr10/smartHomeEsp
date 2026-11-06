# DEVICE 03 HARDWARE SPECIFICATION: ESP-01 / ESP-01S (1MB)

**Board**: ESP8266 ESP-01 (Black/Blue PCB) / ESP-01S  
**Flash Memory**: 1,048,576 bytes (1MB / 8 MBit) SPI Flash (`eagle.flash.1m.ld`)  
**Flash SPI Mode**: Dual Output (`flash_mode = dout`)  
**Evidence Source**: [`esp01_1mb/platformio.ini`](file:///d:/ai/Homeautomation_server/esp01_1mb/platformio.ini), [`esp01_1mb/src/config.h`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/config.h)  

---

## 1. Technical Specifications

| Parameter | Specification | Evidence / Notes |
|---|---|---|
| **SoC** | Espressif ESP8266EX | Tensilica Xtensa L106 @ 80 MHz |
| **Flash Capacity** | 1,048,576 bytes (1MB / 8 MBit) | `eagle.flash.1m.ld` |
| **Flash Mode** | DOUT (Dual Output) @ 40 MHz | Essential for 1MB chips (PUYA / Winbond / GigaDevice) |
| **Executable Binary Space** | ~480 KB max | Dual OTA requires sketch < 480 KB |
| **Filesystem Partition** | ~64 KB LittleFS | Minimal partition for JSON configs |
| **Physical Pin Count** | 8 pins total (2x4 standard 2.54mm header) | Standard ESP-01 form factor |
| **Usable GPIO Pins** | 2 primary (GPIO0, GPIO2); 2 secondary (GPIO1, GPIO3) | `config.h` lines 38-41 |
| **Operating Voltage** | 3.0V – 3.6V DC (Nominal: 3.3V) | **Strict**: 5V on VCC destroys the ESP8266 |
| **Peak Operating Current**| ~250 mA (Wi-Fi TX bursts) | External 3.3V 500mA LDO recommended |

---

## 2. 8-Pin Header Layout (Top View)

```text
       +-------+
   GND | 1   2 | GPIO 1 (TXD0)
GPIO 2 | 3   4 | CH_PD (EN - Chip Enable, Pull HIGH)
  GPIO 0 | 5   6 | RST (Reset, Active LOW)
GPIO 3 | 7   8 | VCC (3.3V DC Power)
       +-------+
```

| Pin | Identifier | Normal Operating State | Connection Requirement |
|---|---|---|---|
| **1** | GND | Ground (0V) | Common power ground |
| **2** | GPIO 1 (TX) | Serial Debug / Output | Connects to USB-UART RX or optional Relay 4 |
| **3** | GPIO 2 | Boot Strapping / Relay 2 | Must be HIGH at boot. Connected to Relay 2 / Blue LED. |
| **4** | CH_PD (EN) | Chip Enable | **Must be pulled HIGH to 3.3V** via 10k resistor. |
| **5** | GPIO 0 | Boot Mode / Relay 1 | Must be HIGH at boot. Connected to Relay 1 optocoupler. |
| **6** | RST | External Reset | Pulled HIGH to 3.3V via 10k resistor. Ground to reset. |
| **7** | GPIO 3 (RX) | Serial Debug / Input | Connects to USB-UART TX or optional Relay 3 |
| **8** | VCC | 3.3V Power | Clean 3.3V DC power supply with 10uF filter capacitor. |

---

## 3. Shift Register 74HC595 Analysis

> [!NOTE]
> The audit confirms that **no 74HC595 shift register is implemented or supported** in `esp01_1mb`.
> The firmware controls relays exclusively through direct GPIO pin driving (`digitalWrite(pin, level)`).
> Standard commercial ESP-01 relay modules (single-channel and dual-channel) connect directly to GPIO 0 and GPIO 2.
