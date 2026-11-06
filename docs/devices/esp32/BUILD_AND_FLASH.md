# DEVICE 02 BUILD & FLASH SPECIFICATION (TARGET): ESP32

**Target Platform**: PlatformIO (`espressif32`)  
**Recommended Environment**: `esp32dev`  

---

## 1. Recommended `platformio.ini` Blueprint

```ini
[env:esp32dev]
platform = espressif32 @ ^6.5.0
board = esp32dev
framework = arduino
monitor_speed = 115200
upload_speed = 921600
board_build.partitions = default_4MB_dual_ota.csv
board_build.filesystem = littlefs

lib_deps =
    bblanchon/ArduinoJson @ ^6.21.3
    me-no-dev/AsyncTCP @ ^1.1.1
    https://github.com/me-no-dev/ESPAsyncWebServer.git

build_flags =
    -D CORE_DEBUG_LEVEL=2
    -D CONFIG_ASYNC_TCP_RUNNING_CORE=0
    -D ARDUINO_RUNNING_CORE=1
```

---

## 2. Compilation and Flashing Procedure

When the `esp32` firmware directory is implemented:

```powershell
# 1. Compile firmware
pio run -e esp32dev

# 2. Upload firmware binary via USB
pio run -e esp32dev --target upload

# 3. Upload LittleFS web partition
pio run -e esp32dev --target uploadfs

# 4. Monitor serial logs
pio device monitor -b 115200
```
