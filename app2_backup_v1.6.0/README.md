# 🏠 SmartHome Controller - ESP8266 NodeMCU Firmware

A modular, enterprise-grade smart-home controller firmware for the **NodeMCU ESP8266 (ESP-12E / ESP-12F)** with a local, mobile-first web dashboard, dynamic GPIO/relay management, automation rule engine, captive portal Wi-Fi setup, and OTA updates.

---

## 🌟 Key Features

1. **Self-Contained Wi-Fi Management**
   - **First-Boot Hotspot**: Starts in Access Point mode (`SmartHome-Setup`) with captive portal at `http://192.168.4.1`.
   - **Wi-Fi Scanner**: Real-time signal strength (RSSI), channel, security type, and support for hidden SSIDs.
   - **3 Selectable Modes**:
     - `AP ONLY`: Standalone hotspot.
     - `ROUTER ONLY`: Connects to home Wi-Fi; disables AP after connection.
     - `AP + ROUTER` *(Default)*: Operates both interfaces simultaneously so dashboard is always reachable.
   - **Automatic Fallback Recovery**: If router connection drops, starts the setup AP automatically.
   - **Physical Factory Reset Button**: Holding NodeMCU FLASH button (D3 / GPIO 0) for 5 seconds clears Wi-Fi credentials with visual LED confirmation.

2. **Mobile-First Responsive Dashboard**
   - Modern card-based UI with Dark / Light theme toggle.
   - Zero external cloud or CDN dependencies; 100% locally hosted on the ESP8266.
   - Multi-tab navigation: Overview, Wi-Fi Setup, GPIO / Relays, Automation, Settings, Firmware (OTA), System Info, Account, Logs.

3. **Dynamic GPIO & Relay Management**
   - Add, edit, and delete GPIO outputs without modifying C++ code.
   - Name outputs, assign rooms (Living Room, Bedroom, Kitchen, etc.), and select functions (Light, Fan, Relay, Pump).
   - Configurable **Active-Low** (standard optical relay modules) or **Active-High**.
   - Power-on initial state: *Always OFF*, *Always ON*, or *Restore Last State*.
   - Instant manual ON/OFF toggle and non-blocking pulse button (e.g. 500ms for garage doors/gates).
   - NodeMCU Pin Safety Validator prevents conflicting pin assignments and warns about boot-sensitive pins.

4. **Automation Rule Engine**
   - **Auto-Off Timer**: Automatically turns a relay off after $N$ seconds/minutes.
   - **Interlock / Link**: Synchronizes one relay based on another relay's state.
   - **Daily Schedule**: Triggers relay ON/OFF at a configured 24-hour time (HH:MM) synchronized via NTP.
   - Stored in persistent flash with live trigger execution counters.

5. **Security & Authentication**
   - Administrator login with SHA-256 password hashing.
   - Session token authentication via cookies (`session=...`) and HTTP headers (`Authorization: Bearer`).
   - Anti-brute-force rate limiting with exponential backoff on repeated failed logins.
   - Passwords and session tokens never leaked in logs or GET endpoints.

6. **Web OTA Firmware Updates**
   - Upload compiled `.bin` firmware file directly in the browser with real-time percentage progress bar.
   - Pre-flash ESP8266 magic byte (`0xE9`) validation.
   - LittleFS partition preserved across firmware updates.
   - Also supports standard `ArduinoOTA` via local network port.

7. **Storage & Diagnostics**
   - Atomic file write pattern (`.tmp` $\rightarrow$ target) ensures immunity against corruption on sudden power loss.
   - Circular memory log buffer viewable in real-time on the web dashboard.

---

## 🔌 Hardware Pinout & Pin Safety Matrix

NodeMCU ESP8266 pins have specific hardware bootstrapping requirements during boot. The firmware enforces this safety matrix:

| NodeMCU Pin | GPIO | Function / Usage | Boot State Requirement | Safety Classification |
| :--- | :--- | :--- | :--- | :--- |
| **D1** | GPIO 5 | I2C SCL / Relay Output | Neutral | 🟢 **Safe Output (Recommended)** |
| **D2** | GPIO 4 | I2C SDA / Relay Output | Neutral | 🟢 **Safe Output (Recommended)** |
| **D5** | GPIO 14 | SPI SCLK / Relay Output | Neutral | 🟢 **Safe Output (Recommended)** |
| **D6** | GPIO 12 | SPI MISO / Relay Output | Neutral | 🟢 **Safe Output (Recommended)** |
| **D7** | GPIO 13 | SPI MOSI / Relay Output | Neutral | 🟢 **Safe Output (Recommended)** |
| **D0** | GPIO 16 | WAKE pin / Relay Output | HIGH at boot | 🟡 Boot-Sensitive (High at boot) |
| **D3** | GPIO 0 | FLASH Button / Input / Output | Must be HIGH | 🟡 Boot-Sensitive (Recovery Reset) |
| **D4** | GPIO 2 | TXD1 / Onboard LED | Must be HIGH | 🟡 Boot-Sensitive (Active-Low LED) |
| **D8** | GPIO 15 | Pulled down 10k | Must be LOW | 🔴 Boot-Sensitive (Fails if pulled HIGH) |
| **RX / TX** | GPIO 3 / 1 | Serial Debug Console | UART0 | 🚫 **Reserved (Do Not Use)** |

> [!IMPORTANT]
> Always prefer **D1, D2, D5, D6, and D7** for connecting relay control inputs. Standard relay modules that pull inputs HIGH at boot should **never** be connected to D8 (GPIO 15), as this will prevent the ESP8266 from booting.

---

## 🛠️ Building & Flashing Firmware

### Prerequisites
- [PlatformIO Core](https://platformio.org/) or PlatformIO IDE for VS Code.
- Micro-USB cable connected to NodeMCU.

### Step 1: Clone and Open Project
Navigate to the `app2` folder:
```bash
cd app2
```

### Step 2: Compile Firmware
```bash
pio run
```

### Step 3: Flash Firmware via Serial
Connect the NodeMCU via USB and run:
```bash
pio run --target upload
```

### Step 4: Upload Web Dashboard Assets to LittleFS
```bash
pio run --target uploadfs
```
*(Note: If you flash only the firmware without running `uploadfs`, the controller automatically serves an embedded fallback setup page from flash memory!)*

---

## 📱 Wi-Fi Setup Guide

1. Power on the NodeMCU.
2. On your smartphone or laptop, open Wi-Fi settings and connect to:
   - **SSID:** `SmartHome-Setup`
   - **Password:** *(None - Open Hotspot)*
3. Your device will automatically open the captive portal. If not, open your browser and navigate to:
   - `http://192.168.4.1`
4. Log in using default administrator credentials:
   - **Username:** `admin`
   - **Password:** `admin`
5. Go to the **Wi-Fi Setup** tab, click **Scan Networks**, select your home Wi-Fi, enter its password, and click **Connect & Save**.
6. The controller connects to your router and displays the assigned IP address (e.g., `192.168.1.150`).
7. You can now access the dashboard from any device on your home network!

---

## 🔄 Physical Reset Button Operation

- The firmware monitors the **NodeMCU FLASH button (D3 / GPIO 0)**.
- **Normal press / Short hold**: Ignored (prevents accidental resets).
- **Hold for 5 seconds**: Triggers Wi-Fi credential erase. The onboard LED will flash rapidly 10 times, and the device will restart in setup AP mode (`SmartHome-Setup`).

---

## 🌐 REST API Reference

All administrative endpoints require authentication via cookie or `Authorization: Bearer <token>` header:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/status` | System metrics (uptime, heap, flash, Wi-Fi, IP, time) |
| `POST` | `/api/auth/login` | Log in and receive session token |
| `GET` | `/api/auth/check` | Verify current session authentication |
| `POST` | `/api/auth/logout` | Terminate session |
| `GET` | `/api/wifi/status` | Current Wi-Fi state and connection details |
| `GET` | `/api/wifi/scan` | Scan nearby Wi-Fi networks |
| `POST` | `/api/wifi/connect` | Connect to network `{ssid, password}` |
| `POST` | `/api/wifi/mode` | Set operating mode (0=AP, 1=Router, 2=AP+Router) |
| `POST` | `/api/wifi/reset` | Clear stored Wi-Fi credentials |
| `GET` | `/api/gpio` | List all configured GPIO channels |
| `POST` | `/api/gpio` | Add new GPIO channel `{pin, name, room, function, activeLow, initialMode}` |
| `POST` | `/api/gpio/update` | Update existing channel `{id, name, room, function, ...}` |
| `POST` | `/api/gpio/delete` | Remove channel `{id}` |
| `POST` | `/api/gpio/state` | Toggle, pulse, or set state `{id, action, state, duration}` |
| `GET` | `/api/automation` | List all automation rules |
| `POST` | `/api/automation` | Add automation rule |
| `POST` | `/api/automation/toggle` | Enable/disable rule `{id}` |
| `POST` | `/api/automation/delete` | Delete rule `{id}` |
| `GET` | `/api/settings` | Get device settings |
| `POST` | `/api/settings` | Save device name, AP credentials, timezone |
| `POST` | `/api/settings/password` | Change administrator password |
| `GET` | `/api/logs` | Fetch in-memory diagnostic logs |
| `POST` | `/api/system/reboot` | Soft reboot microcontroller |
| `POST` | `/api/system/factory-reset` | Wipe all LittleFS configuration files |
| `POST` | `/api/ota/upload` | Multipart form-data firmware upload |
