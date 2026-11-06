# DEVICE 03 BUILD & FLASH GUIDE: ESP-01 / ESP-01S (1MB)

**PlatformIO Environment**: `esp01_1m`  
**Configuration File**: [`esp01_1mb/platformio.ini`](file:///d:/ai/Homeautomation_server/esp01_1mb/platformio.ini)  
**Custom Scripts**: `compress_dashboard.py`, `strip_floats.py`  

---

## 1. PlatformIO Configuration (`platformio.ini`)

```ini
[env:esp01_1m]
platform = espressif8266
board = esp01_1m
framework = arduino
monitor_speed = 115200
upload_speed = 115200
board_build.ldscript = eagle.flash.1m.ld
board_build.flash_mode = dout
extra_scripts = post:strip_floats.py

lib_deps =
    bblanchon/ArduinoJson @ ^6.21.3

build_flags =
    -Os
    -fno-exceptions
    -fno-rtti
    -ffunction-sections
    -fdata-sections
    -Wl,--gc-sections
    -D PIO_FRAMEWORK_ARDUINO_LWIP2_LOW_MEMORY_LOW_FLASH
    -D PIO_FRAMEWORK_ARDUINO_ESPRESSIF_SDK221
    -D NO_GLOBAL_MDNS
    -D NO_EXTRA_4K_MUST_HAVE_PBUF
    -D ARDUINOJSON_USE_DOUBLE=0
    -D ARDUINOJSON_USE_LONG_LONG=0
    -D ARDUINOJSON_ENABLE_STD_STRING=0
    -D ARDUINOJSON_ENABLE_STD_STREAM=0
    -Wl,-Map=.pio/build/esp01_1m/firmware.map
```

---

## 2. Compilation and Flashing Steps

### Step 1: Regenerate Compressed Dashboard (If Modified)
```powershell
cd d:\ai\Homeautomation_server\esp01_1mb
python compress_dashboard.py
```
This updates `src/dashboard_html.h` with the latest minified and gzip-compressed dashboard C-array.

### Step 2: Compile Firmware
```powershell
pio run -e esp01_1m
```
The post-script `strip_floats.py` executes automatically after compilation.

### Step 3: Flash to ESP-01 via USB-UART Adapter
Place the ESP-01 into **UART Flash Mode** by grounding GPIO 0 during power-on:
1. Connect GPIO 0 to GND.
2. Plug the USB programmer into your PC.
3. Execute upload:
   ```powershell
   pio run -e esp01_1m --target upload
   ```
4. Disconnect GPIO 0 from GND and power-cycle to boot into RUN mode.
