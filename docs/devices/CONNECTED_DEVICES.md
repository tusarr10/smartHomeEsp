# Connected Hardware Devices Log

**File Location**: `docs/devices/CONNECTED_DEVICES.md`  
**Purpose**: Central engineering inventory of physical microcontrollers connected, probed, and diagnosed via serial interface on this workstation.

---

## Device Registry

### Device 1: NodeMCU ESP8266 (COM6)

* **Probed Date & Time**: `2026-11-17 21:52:00 IST` (UTC +5:30)
* **Serial Port**: `COM6`
* **USB-to-UART Bridge**: FTDI FT232R (`USB VID:PID = 0403:6001`, Serial: `A5069RR4A`)
* **Microcontroller (SoC)**: **ESP8266EX**
* **Crystal Frequency**: 26 MHz
* **Silicon Chip ID**: `0x0057A6FA`
* **Hardware MAC Address**: `8C:4F:00:57:A6:FA`
* **Auto Hardware Node ID**: `NODE-8C4F0057A6FA`
* **Default SoftAP SSID**: `SmartHome-NodeMCU-A6FA` (Derived from last 4 MAC chars)

#### Flash Memory Diagnostics:
* **Detected Flash Size**: **4 MB** (32 MBit / 4,194,304 bytes)
* **Flash Manufacturer ID**: `0x5E` (ZB / ZBIT Semiconductor)
* **Flash Device ID**: `0x4016` (JEDEC standard $2^{16} \times 64 = 4\text{ MB}$)

#### Firmware & Partition Suitability:
* **Target Project Directory**: [`esp8266_4mb`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb)
* **PlatformIO Target Board**: `nodemcuv2`
* **Partition Layout Script**: `eagle.flash.4m2m.ld` (2MB Firmware + 2MB LittleFS)
* **Flash Upload Command**:
  ```powershell
  & "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" -m platformio run -d "esp8266_4mb" -t upload --upload-port COM6
  ```
* **Filesystem Upload Command**:
  ```powershell
  & "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" -m platformio run -d "esp8266_4mb" -t uploadfs --upload-port COM6
  ```
* **Status**: **Flashed & Operational** (v1.6.0 Firmware + LittleFS verified)

---

### Device 2: NodeMCU / ESP8266 Module (COM6)

* **Probed Date & Time**: `2026-11-17 21:58:20 IST` (UTC +5:30)
* **Serial Port**: `COM6`
* **USB-to-UART Bridge**: FTDI FT232R (`USB VID:PID = 0403:6001`, Serial: `A5069RR4A`)
* **Microcontroller (SoC)**: **ESP8266EX**
* **Crystal Frequency**: 26 MHz
* **Silicon Chip ID**: `0x00F4247F`
* **Hardware MAC Address**: `1C:8F:57:F4:24:7F`
* **Auto Hardware Node ID**: `NODE-1C8F57F4247F`
* **Default SoftAP SSID**: `SmartHome-NodeMCU-247F` (Derived from last 4 MAC chars)

#### Flash Memory Diagnostics:
* **Detected Flash Size**: **4 MB** (32 MBit / 4,194,304 bytes)
* **Flash Manufacturer ID**: `0xC4` (GigaDevice GD25Q32)
* **Flash Device ID**: `0x6016` (JEDEC standard $2^{16} \times 64 = 4\text{ MB}$)

#### Firmware & Partition Suitability:
* **Target Project Directory**: [`esp8266_4mb`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb)
* **PlatformIO Target Board**: `nodemcuv2`
* **Partition Layout Script**: `eagle.flash.4m2m.ld` (2MB Firmware + 2MB LittleFS)
* **Flash Upload Command**:
  ```powershell
  & "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" -m platformio run -d "esp8266_4mb" -t upload --upload-port COM6
  ```
* **Filesystem Upload Command**:
  ```powershell
  & "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" -m platformio run -d "esp8266_4mb" -t uploadfs --upload-port COM6
  ```
* **Status**: **Flashed & Operational** (v1.6.0 Firmware + LittleFS verified)

---

### Device 3: NodeMCU ESP8266 (COM5)

* **Probed Date & Time**: `2026-11-17 22:00:00 IST` (UTC +5:30)
* **Serial Port**: `COM5`
* **USB-to-UART Bridge**: Silicon Labs CP210x (`USB VID:PID = 10C4:EA60`, Serial: `0001`)
* **Microcontroller (SoC)**: **ESP8266EX**
* **Crystal Frequency**: 26 MHz
* **Silicon Chip ID**: `0x0023386C`
* **Hardware MAC Address**: `BC:DD:C2:23:38:6C`
* **Auto Hardware Node ID**: `NODE-BCDDC223386C`
* **Default SoftAP SSID**: `SmartHome-NodeMCU-386C` (Derived from last 4 MAC chars)

#### Flash Memory Diagnostics:
* **Detected Flash Size**: **4 MB** (32 MBit / 4,194,304 bytes)
* **Flash Manufacturer ID**: `0x68` (BoyaMicro / BY25Q32)
* **Flash Device ID**: `0x4016` (JEDEC standard $2^{16} \times 64 = 4\text{ MB}$)

#### Firmware & Partition Suitability:
* **Target Project Directory**: [`esp8266_4mb`](file:///e:/projectSmartHome/admincontrol/Portal-Controll-main/esp8266_4mb)
* **PlatformIO Target Board**: `nodemcuv2`
* **Partition Layout Script**: `eagle.flash.4m2m.ld` (2MB Firmware + 2MB LittleFS)
* **Flash Upload Command**:
  ```powershell
  & "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" -m platformio run -d "esp8266_4mb" -t upload --upload-port COM5
  ```
* **Filesystem Upload Command**:
  ```powershell
  & "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" -m platformio run -d "esp8266_4mb" -t uploadfs --upload-port COM5
  ```

---
