# 🔌 SmartHome Controller - ESP8266 ESP-01 / ESP-01S (1MB) Firmware

A high-efficiency smart-home controller firmware tailored specifically for the **ESP8266 ESP-01 / ESP-01S (1MB Flash)** module. Optimized using a **Central Server Thin Satellite Architecture**, offloading heavy cron schedulers, local web dashboards, and audit logs to the Central Server (`central_server_js`), enabling **seamless wireless dual-slot Over-The-Air (OTA) updates** on 1MB flash hardware.

---

## 🌟 Key Architectural Features for ESP-01 / ESP-01S

1. **Dual-Slot OTA Guaranteed on 1MB Flash**:
   - Compiled binary size: **396.8 KB (44.4%)** out of 892.9 KB available application space (`eagle.flash.1m128.ld`).
   - Free sketch headroom: **496.1 KB** (> 55% free space).
   - Because sketch size is strictly less than 50% ($396.8 \text{ KB} < 446.4 \text{ KB}$), **wireless dual-slot Over-The-Air (OTA) flashing is 100% supported** without needing a USB serial cable for future updates!

2. **Central Server Thin-Satellite Offloading**:
   - **Centralized Dashboard**: Rich multi-room dashboard, graphs, and audit history run on the Central Server (`central_server_js/public`).
   - **Centralized Automation**: Complex 24h cron rules, timers, and interlocks execute on the Central Server, freeing microcontroller CPU and eliminating NTP drift.
   - **Embedded Setup Portal**: Lightweight fallback portal embedded directly in flash memory for initial Wi-Fi and Central Server pairing.
   - **Zero Filesystem UI Bloat**: LittleFS contains only tiny JSON configs (~2 KB), preserving flash and allowing partition resizing down to 128 KB or 64 KB.

3. **Relay Shield Ready (GPIO 0 & GPIO 2)**:
   - Preconfigured out-of-the-box for standard 1-channel and 2-channel ESP-01 relay shields.
   - **Active-Low / Active-High** selectable per channel (prevents boot-time relay clicking).
   - Configurable power-on state (*Always OFF*, *Always ON*, or *Restore Last State*).

4. **Safety & Stability on 1MB Hardware**:
   - Physical factory reset pin disabled (`255`) to prevent active-low relay activation on GPIO 0 from wiping credentials after 5 seconds.
   - Low-memory LWIP stack (`PIO_FRAMEWORK_ARDUINO_LWIP2_LOW_MEMORY`) preserves **> 46 KB of free SRAM (heap)** for network stability.
   - Floating-point I/O linker optimization (`strip_floats.py`) strips forced libc float printf/scanf, saving 16.8 KB of flash.

---

## 🔌 ESP-01 / ESP-01S Hardware Pinout & Safety Matrix

The ESP-01 / ESP-01S header has 8 pins:

```
        +---------------+
    GND | [1]       [2] | GPIO 2
  GPIO 0| [3]       [4] | RXD (GPIO 3)
   TXD  | [5]       [6] | CH_PD (EN)
   RST  | [7]       [8] | VCC (3.3V)
        +---------------+
```

| Pin | Function / Usage | Boot State Requirement | Notes |
| :--- | :--- | :--- | :--- |
| **GPIO 0** | **Relay 1 Control** | Must be **HIGH** at boot | Pulling LOW during boot enters UART flashing mode. Standard ESP-01 relay shields control this pin. |
| **GPIO 2** | **Relay 2 Control / LED** | Must be **HIGH** at boot | Connected to onboard blue LED on ESP-01S (Active-Low). Used as Relay 2 on 2-channel relay shields. |
| **GPIO 3 (RX)** | UART0 RX / Optional Input | Boot-neutral | Can be used as general input or relay if Serial debugging is disabled. |
| **GPIO 1 (TX)** | UART0 TX / Optional Output | Boot-neutral | Can be used as general output or relay if Serial debugging is disabled. |
| **CH_PD / EN** | Chip Enable | Must be pulled **HIGH** (3.3V) | Module will not boot if left floating. |
| **RST** | Reset | Pulled **HIGH** (3.3V) | Pull momentarily to GND to restart. |
| **VCC / GND** | Power Supply | 3.0V – 3.6V (3.3V typical) | Requires a stable power source capable of delivering at least 250mA peak current. |

> [!IMPORTANT]
> **Relay Shield Compatibility**: Standard 1-Channel ESP-01 relay modules utilize **GPIO 0** with active-low triggering. Standard 2-Channel ESP-01 relay modules utilize **GPIO 0** for Relay 1 and **GPIO 2** for Relay 2.

---

## 🛠️ Building & Flashing

### Prerequisites
- [PlatformIO Core](https://platformio.org/) installed (`pio` command line).
- USB-to-UART Adapter (FTDI, CP2102, CH340, or dedicated ESP-01 USB programmer).

### Wiring for Flashing (UART Flash Mode)

| ESP-01 Pin | USB Programmer Pin |
| :--- | :--- |
| **VCC** | 3.3V *(Never 5V!)* |
| **GND** | GND |
| **TXD** (GPIO 1) | RXD |
| **RXD** (GPIO 3) | TXD |
| **CH_PD (EN)** | 3.3V |
| **GPIO 0** | **GND** *(Connect to GND before powering on to enter flashing mode)* |

*(If using an ESP-01 USB programmer with a toggle switch, flip the switch to `PROG` / `BOOT` mode).*

---

### Step 1: Navigate to Project Directory
```bash
cd esp01_1mb
```

### Step 2: Compile Firmware
```bash
pio run
```

### Step 3: Flash Firmware Binary
```bash
pio run --target upload
```

### Step 4: Upload LittleFS Filesystem (Configuration Storage)
```bash
pio run --target uploadfs
```

> [!TIP]
> After flashing both firmware and LittleFS, **disconnect GPIO 0 from GND** (or flip the programmer switch to `RUN` / `UART`) and power-cycle the module to start standard execution.

---

## 📦 Flash Memory Layout & OTA Update Verification

Partitioned using `eagle.flash.1m128.ld`:
- **0x000000 - 0x0DA000 (~892 KB)**: Application Sketch space (Slot 1 & Slot 2)
- **0x0DA000 - 0x0FA000 (128 KB)**: LittleFS partition
- **0x0FA000 - 0x100000 (24 KB)**: EEPROM, RF calibration, and SDK Wi-Fi settings

### Dual-Slot Over-The-Air (OTA) Updates:
Because the sketch binary is **396.8 KB**:
$$\text{Sketch Space} = 892.9 \text{ KB} \implies \text{OTA Partition Limit} = \frac{892.9}{2} = 446.45 \text{ KB}$$
$$396.8 \text{ KB} < 446.45 \text{ KB} \quad (\approx 49.6 \text{ KB safety margin})$$

You can update firmware over Wi-Fi directly:
1. Via the Central Server's **OTA Service** (`central_server_js`).
2. Or by navigating to the ESP-01's web portal and uploading `firmware.bin` under the **Firmware OTA** form.

---

## 📱 Quick Setup (Captive Portal & Central Server Pairing)

1. Power on the ESP-01 on a 3.3V power source (or insert into the relay shield).
2. Connect your phone or PC to Wi-Fi:
   - **SSID:** `SmartHome-ESP01`
   - **Password:** *(None - Open Hotspot)*
3. Navigate to `http://192.168.4.1` in your browser.
4. Fill in:
   - **Wi-Fi SSID & Password** for your home router.
   - **Central Server IP & Port** (e.g. `192.168.1.50:2000`).
5. Click **Save & Connect**.
6. The ESP-01 connects to your Wi-Fi router, reports its telemetry to the Central Server, and appears online in the Central Server dashboard!
