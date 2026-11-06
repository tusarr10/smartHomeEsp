# ECOSYSTEM COMPILATION & BUILD GUIDE

**Scope**: Build Commands, Compiler Flags, and Asset Compilation  

---

## 1. ESP8266 4MB Build Pipeline

```powershell
cd d:\ai\Homeautomation_server\esp8266_4mb

# Clean prior artifacts
pio run -t clean

# Compile C++ source
pio run -e nodemcuv2

# Build and package LittleFS partition (data/ -> littlefs.bin)
pio run -e nodemcuv2 -t buildfs
```
- Firmware binary output: `.pio/build/nodemcuv2/firmware.bin` (~480 KB)
- Filesystem image output: `.pio/build/nodemcuv2/littlefs.bin` (~2 MB)

---

## 2. ESP-01 1MB Build Pipeline

```powershell
cd d:\ai\Homeautomation_server\esp01_1mb

# 1. Regenerate PROGMEM gzip dashboard header
python compress_dashboard.py

# 2. Compile firmware binary with strip_floats.py post-script
pio run -e esp01_1m
```
- Output binary: `.pio/build/esp01_1m/firmware.bin` (< 420 KB)
- Map file: `.pio/build/esp01_1m/firmware.map` (Memory layout verification)

---

## 3. Central Server Build Pipeline

Central Server uses vanilla JavaScript and requires zero compilation:
```powershell
cd d:\ai\Homeautomation_server\central_server_js
npm install
npm test
```
