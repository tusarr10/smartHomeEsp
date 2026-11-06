# DEVICE 02 MEMORY & PERFORMANCE BENCHMARKS (TARGET): ESP32

**Target Hardware**: ESP32 Dual-Core @ 240 MHz  
**Target Profile**: FreeRTOS Architecture  

---

## 1. Projected Memory Envelope

| Memory Region | Available Physical | Projected Usage | Free Margin |
|---|---|---|---|
| **FreeRTOS Heap** | ~320,000 bytes (~312 KB) | ~45,000 bytes | **~275,000 bytes** (~88% Headroom) |
| **PRO_CPU Task Stack (Core 0)** | 8,192 bytes | ~4,200 bytes | ~3,992 bytes |
| **APP_CPU Task Stack (Core 1)** | 8,192 bytes | ~3,100 bytes | ~5,092 bytes |
| **Flash Sketch Partition** | 1,310,720 bytes (1.25 MB) | ~850,000 bytes | ~460,000 bytes |
| **LittleFS Web Partition** | 1,441,792 bytes (1.37 MB) | ~140,000 bytes | ~1.30 MB |

---

## 2. Performance Comparison: ESP32 vs ESP8266

| Benchmark Task | ESP8266 (Measured) | ESP32 (Projected) | Improvement Factor |
|---|---|---|---|
| **JSON Serialization (2KB Doc)** | 4.2 ms | **0.4 ms** | **10.5x faster** |
| **SHA-256 Hash Computation** | 12.8 ms (Software loops) | **0.08 ms** (Hardware engine) | **160x faster** |
| **Peak Concurrent HTTP Requests** | 5 clients (543 ms avg latency) | **20 clients** (< 40 ms latency) | **4x capacity, 13x lower latency** |
| **Maximum Relay Switching Frequency** | ~100 Hz (limited by core loop) | **> 10,000 Hz** (Hardware PWM/LEDC) | **100x frequency** |
