# 🔌 SmartHome Controller - ESP-01 / ESP-01S + PCF8574T I2C Expander (1MB Flash)

A dedicated, high-efficiency smart-home controller firmware tailored specifically for the **ESP8266 ESP-01 / ESP-01S (1MB Flash)** paired with the **PCF8574T 8-bit I2C I/O Expander**. 

By interfacing the PCF8574T over I2C using ESP-01's GPIO 0 (SDA) and GPIO 2 (SCL), this solution expands the ESP-01 from just 2 native relay channels up to **8 full isolated relay channels** while maintaining **dual-slot Over-The-Air (OTA) updates** on 1MB flash hardware!

---

## 🌟 Key Features

1. **8 Extended Relay Channels via PCF8574T**:
   - Expands 2 pins into 8 independent digital outputs (P0–P7 mapped to virtual pins `100` to `107`).
   - Hardware-level **Active-Low** optocoupler relay control (prevents boot clicking).
   - Auto-scans and auto-detects PCF8574 / PCF8574T (`0x20`–`0x27`) and PCF8574A / PCF8574AT (`0x38`–`0x3F`).

2. **Dual-Slot OTA Guaranteed on 1MB Flash**:
   - Compiled binary size: **345.7 KB (33.8%)** of 1MB Flash.
   - Headroom: **> 66% free flash space**, safely preserving dual-slot Over-The-Air (OTA) updates.

3. **Optimized Central Server Architecture**:
   - Synchronizes telemetry and relay states seamlessly with `central_server_js` via HTTP POST and raw TCP sockets.
   - Sized JSON memory pools (`doc(3072)`) to prevent deserialization truncations with 8+ channels.

---

## 🔌 Hardware Wiring & Pinout Guide

### 1. ESP-01 Header Reference
```text
        +---------------+
    GND | [1]       [2] | GPIO 2 (SCL)
  GPIO 0| [3]       [4] | RXD (GPIO 3)
 (SDA)  |               |
    TXD | [5]       [6] | CH_PD (EN -> 3.3V)
    RST | [7]       [8] | VCC (3.3V)
        +---------------+
```

### 2. ESP-01 to PCF8574T Wiring
| ESP-01 Pin | PCF8574T Pin | Description |
| :--- | :--- | :--- |
| **GPIO 0 (Pin 3)** | **SDA** | I2C Serial Data line *(requires 4.7k pull-up to 3.3V)* |
| **GPIO 2 (Pin 2)** | **SCL** | I2C Serial Clock line *(requires 4.7k pull-up to 3.3V)* |
| **VCC (Pin 8)** | **VCC** | 3.3V DC (or 5V if module has level-shifter) |
| **GND (Pin 1)** | **GND** | Common System Ground |
| **CH_PD (Pin 6)** | - | Tied to **3.3V** (Chip Enable) |

> [!TIP]
> Both GPIO 0 and GPIO 2 must be held **HIGH** during ESP8266 boot. I2C pull-up resistors (4.7kΩ to 3.3V) naturally satisfy this requirement!

---

### 3. PCF8574T to 8-Channel Relay Module Wiring
| PCF8574T Pin | Virtual Pin ID | Default Relay Mapping | Description |
| :--- | :--- | :--- | :--- |
| **P0** | `100` | Channel 1 (`Relay 1`) | Active-Low Relay 1 |
| **P1** | `101` | Channel 2 (`Relay 2`) | Active-Low Relay 2 |
| **P2** | `102` | Channel 3 (`Relay 3`) | Active-Low Relay 3 |
| **P3** | `103` | Channel 4 (`Relay 4`) | Active-Low Relay 4 |
| **P4** | `104` | Channel 5 (`Relay 5`) | Active-Low Relay 5 |
| **P5** | `105` | Channel 6 (`Relay 6`) | Active-Low Relay 6 |
| **P6** | `106` | Channel 7 (`Relay 7`) | Active-Low Relay 7 |
| **P7** | `107` | Channel 8 (`Relay 8`) | Active-Low Relay 8 |

---

## 🛠️ Building & Flashing

### Step 1: Navigate to Project Directory
```powershell
cd "esp-01 pcf8574t"
```

### Step 2: Compile Firmware
```powershell
pio run
```

### Step 3: Flash Firmware Binary to ESP-01
```powershell
pio run --target upload
```

### Step 4: Flash LittleFS Filesystem (Initial 8-channel Configuration)
```powershell
pio run --target uploadfs
```
