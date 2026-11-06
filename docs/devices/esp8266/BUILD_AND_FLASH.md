# DEVICE 01 BUILD & FLASH GUIDE: ESP8266 / NODEMCU (4MB)

**Toolchain**: PlatformIO Core / CLI  
**Environment**: `nodemcuv2`  
**Configuration File**: [`esp8266_4mb/platformio.ini`](file:///d:/ai/Homeautomation_server/esp8266_4mb/platformio.ini)  

---

## 1. Build Environment Configuration

The `platformio.ini` specification:

```ini
[env:nodemcuv2]
platform = espressif8266
board = nodemcuv2
framework = arduino
monitor_speed = 115200
upload_speed = 921600
board_build.filesystem = littlefs
board_build.ldscript = eagle.flash.4m2m.ld

lib_deps =
    bblanchon/ArduinoJson @ ^6.21.3

build_flags =
    -fno-exceptions
    -fno-rtti
    -D PIO_FRAMEWORK_ARDUINO_LWIP2_LOW_MEMORY
```

### Compiler Optimization Flags Explained:
- `-fno-exceptions` & `-fno-rtti`: Strips C++ runtime type information and exception tables, saving ~18 KB of flash code space and eliminating exception unwinding stack overhead.
- `-D PIO_FRAMEWORK_ARDUINO_LWIP2_LOW_MEMORY`: Configures the lwIP v2 TCP/IP stack in minimal RAM footprint mode, freeing ~4 KB of critical heap for application JSON parsing.
- `board_build.ldscript = eagle.flash.4m2m.ld`: Sets partition boundaries to 2MB executable sketch / 2MB LittleFS filesystem.

---

## 2. Compilation & Flashing Procedures

### Step 1: Navigate to Project Directory
```powershell
cd d:\ai\Homeautomation_server\esp8266_4mb
```

### Step 2: Compile Firmware Binary
```powershell
pio run -e nodemcuv2
```

### Step 3: Flash Firmware via USB Serial
Connect the NodeMCU via micro-USB, verify the COM port in Device Manager, then upload:
```powershell
pio run -e nodemcuv2 --target upload
```

### Step 4: Build & Upload Web Filesystem (LittleFS)
This compiles all files in `data/` (`index.html`, `app.js`, `style.css`) into a LittleFS binary image and flashes it to offset `0x200000`:
```powershell
pio run -e nodemcuv2 --target uploadfs
```

> [!IMPORTANT]
> If `uploadfs` is skipped, the device will boot into fallback mode and serve the PROGMEM compressed dashboard from `dashboard_html.h`. For the full SPA experience, `uploadfs` must be executed.

### Step 5: Open Serial Monitor
```powershell
pio device monitor -b 115200
```

---

## 3. Over-The-Air (OTA) Flashing

### Method A: PlatformIO ArduinoOTA (Port 8266)
```powershell
pio run -t upload --upload-port 192.168.1.105
```

### Method B: Web UI / Central Server Multipart Flash
POST compiled `firmware.bin` to `/api/ota/upload`:
```powershell
curl -X POST "http://192.168.1.105/api/ota/upload" -F "file=@.pio/build/nodemcuv2/firmware.bin"
```
Or initiate automated OTA deployment directly from the Central Server dashboard.
