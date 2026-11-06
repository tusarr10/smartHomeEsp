# DEVICE 02 HARDWARE SPECIFICATION (TARGET): ESP32

**Target Module**: ESP32-WROOM-32 / ESP32-WROOM-32D / ESP32-DevKitC  
**Silicon**: Espressif Systems ESP32-D0WDQ6 (Dual Tensilica Xtensa 32-bit LX6 @ 240 MHz)  
**Implementation Status**: Planned / Specification for Implementation  

---

## 1. Silicon Architecture & Comparison with Device 01

| Parameter | Device 01 (ESP8266) | Target Device 02 (ESP32) | Benefit for Smart Home Fleet |
|---|---|---|---|
| **CPU Cores** | 1 Core (Tensilica L106 @ 80 MHz) | **2 Cores** (Tensilica LX6 @ 240 MHz) | Core 0 dedicated to Wi-Fi/TCP; Core 1 for real-time control |
| **SRAM** | ~80 KB (25 KB free heap) | **520 KB SRAM** (~320 KB free heap) | 12x RAM headroom; prevents heap exhaustion |
| **Flash Memory** | 4MB External SPI | **4MB to 16MB External SPI** | Supports dual 1.5MB OTA partitions + LittleFS |
| **Hardware Crypto** | None (Soft SHA-256 in C++) | **Hardware AES, SHA-256, RSA, RNG** | Hardware line-rate encryption for HTTPS & TLS |
| **Usable GPIOs** | 5 to 7 pins | **22 to 28 pins** | Supports 8, 12, or 16 relay channels on one board |
| **Analog Inputs** | 1 ADC (0-1.0V, uncalibrated) | **18 ADC channels** (12-bit SAR ADC) | Current CT clamps, lux sensors, analog thermistors |
| **PWM Channels** | Software PWM | **16 hardware LEDC PWM channels** | High-precision light dimming and fan speed regulation |
| **Bluetooth** | None | **Bluetooth 4.2 BR/EDR & BLE** | Bluetooth beacon presence detection & phone pairing |
| **RTOS Support** | Non-preemptive cooperative loop | **Preemptive FreeRTOS** (SMP) | Real-time task preemption and priority scheduling |

---

## 2. Power Supply Requirements

> [!CAUTION]
> The ESP32 consumes substantial current during Wi-Fi transmission bursts (up to 380 mA peak @ 3.3V).
> Powering an ESP32 and an 8-channel relay board directly from a low-dropout (LDO) USB regulator can cause voltage drops below 2.7V, triggering the internal ESP32 Brownout Detector (`rst:0x10 (RTCWDT_RTC_RESET)`).
> A dedicated 5V 2A external DC power supply with a dedicated 3.3V 1A buck regulator (e.g. MP1584 or AMS1117-3.3 with 100uF tantalum capacitors) is strictly required.
