# DEVICE 01 HARDWARE SPECIFICATIONS: ESP8266 / NODEMCU (4MB)

**Board**: NodeMCU Amica / Lolin v2 / ESP-12E / ESP-12F  
**Silicon**: Espressif Systems ESP8266EX (Tensilica Xtensa 32-bit LX106 @ 80 MHz / 160 MHz)  
**Reference Document**: [`esp8266_4mb/src/config.h`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/config.h)  

---

## 1. Technical Specifications

| Parameter | Specification | Source Evidence |
|---|---|---|
| **CPU Architecture** | 32-bit Tensilica Xtensa L106 single-core | PlatformIO `platform = espressif8266` |
| **Clock Frequency** | 80 MHz (Configurable to 160 MHz) | ESP8266 default clock |
| **Internal SRAM** | 80 KB Instruction RAM + 48 KB Data RAM | Hardware datasheet & `ESP.getFreeHeap()` |
| **Observed Free Heap** | ~25 KB to ~28 KB available at runtime | `stress_test/combined_stress_report.md` |
| **External SPI Flash** | 4,194,304 bytes (4MB / 32 MBit) | `config.h` line 9, `web_server.cpp` line 240 |
| **Flash SPI Mode** | QIO / DIO @ 40 MHz / 80 MHz | `web_server.cpp` line 241-248 |
| **Flash Partition Script** | `eagle.flash.4m2m.ld` | [`platformio.ini`](file:///d:/ai/Homeautomation_server/esp8266_4mb/platformio.ini#L8) |
| **Program Binary Space** | ~1,048,576 bytes (~1MB) | `eagle.flash.4m2m.ld` |
| **Filesystem Partition** | 2,097,152 bytes (2MB LittleFS) | `board_build.filesystem = littlefs` |
| **Wi-Fi Protocol** | IEEE 802.11 b/g/n (2.4 GHz) | ESP8266 integrated PHY & Baseband |
| **Operating Voltage** | 3.3V DC (NodeMCU includes onboard 5V-to-3.3V LDO regulator) | Standard NodeMCU schematic |
| **Logic Level** | 3.3V LVTTL (5V tolerance not officially rated by Espressif) | Hardware design guideline |
| **Maximum GPIO Output**| 12 mA per pin (Recommended: 6 mA) | Espressif hardware design guide |

---

## 2. Flash Memory Partition Layout (`eagle.flash.4m2m.ld`)

```text
+-----------------------+ 0x00000000 (0 MB)
| Firmware Binary (OTA) | ~1048 KB (Active executable sketch)
+-----------------------+ 0x00100000 (1 MB)
| OTA Update Reserve    | ~1048 KB (Temporary staging for OTA flashing)
+-----------------------+ 0x00200000 (2 MB)
|                       |
| LittleFS Partition    | 2097 KB (Filesystem for configs, web SPA, logs)
|                       |
+-----------------------+ 0x003FC000 (3.98 MB)
| RF Calibration & WiFi | 16 KB (SDK RF calibration data)
+-----------------------+ 0x00400000 (4.00 MB Flash End)
```

---

## 3. Physical Hardware Interfaces

1. **Micro-USB Connector**:
   - Driven by onboard USB-to-UART bridge (CP2102 or CH340G).
   - Provides 5V DC power and full-duplex UART communications on GPIO1 (TXD0) and GPIO3 (RXD0).
2. **Onboard Reset Button (RST)**:
   - Tied directly to the active-low `EXT_RSTB` pin on the ESP8266.
   - Grounding triggers a complete hardware power-on reboot.
3. **Onboard Flash Button (D3 / GPIO0)**:
   - Used during boot to enter UART download mode if held to GND.
   - Utilized by running firmware as a **Physical Factory Recovery Button**: Holding for 5 seconds triggers credential erasure and reboot (monitored in [`main.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/main.cpp#L16-L44)).
4. **Onboard Blue LED (D4 / GPIO2)**:
   - Tied to GPIO2 (Active-Low).
   - Rapidly pulsed during factory reset recovery; illuminated during boot transitions.
5. **Relay Actuation Interface**:
   - Microcontroller GPIO pins output 3.3V logic signals.
   - Must connect to relay boards via optocoupler-isolated inputs (active-low relays recommended for 3.3V compatibility).
