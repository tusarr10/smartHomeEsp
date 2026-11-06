# DEVICE 03 MEMORY & PERFORMANCE AUDIT: ESP-01 / ESP-01S (1MB)

**Target Hardware**: ESP8266 ESP-01 (1MB Flash)  
**Compiler Optimizations**: `-Os`, `ARDUINOJSON_USE_DOUBLE=0`, `strip_floats.py`  

---

## 1. Flash Footprint Breakdown

To support Over-The-Air (OTA) updates on a 1MB flash chip, the compiled binary must remain strictly below **480 KB** (so that `app0` and `app1` can coexist with LittleFS).

| Firmware Component | Approximate Flash Size | Optimization Applied |
|---|---|---|
| **Core Arduino & lwIP Stack** | ~220 KB | `-D PIO_FRAMEWORK_ARDUINO_LWIP2_LOW_MEMORY_LOW_FLASH` |
| **PROGMEM Web Dashboard** | ~16.8 KB | Pre-compressed gzip byte array via `compress_dashboard.py` |
| **REST API & WebServer** | ~65 KB | Stripped unused LittleFS file explorer routes |
| **ArduinoJson v6 Library** | ~35 KB | Stripped `double`, `long long`, and `std::string` support |
| **Application Logic (GPIO, Telemetry)**| ~55 KB | Static channel arrays, offloaded automation |
| **Total Binary Flash Size** | **~395 KB** | **Well below 480 KB OTA safety threshold** |

---

## 2. Heap Memory Footprint

| Runtime Metric | Measured Value | Safe Threshold |
|---|---|---|
| **Free Heap at Boot** | **~28,500 bytes** | > 15,000 bytes |
| **Free Heap during Active Telemetry**| **~27,800 bytes** | > 10,000 bytes |
| **Zero Dynamic Allocations** | Relay channels allocated in static BSS segment | No heap fragmentation from vectors |
| **Gzip Dashboard Serving** | Streamed directly from flash ROM (`send_P`) | 0 bytes heap buffer allocated |
