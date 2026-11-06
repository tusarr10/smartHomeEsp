# DEVICE 02 TROUBLESHOOTING & RECOVERY (TARGET): ESP32

**Target Hardware**: ESP32 Platform  

---

## 1. Common ESP32 Hardware Faults & Mitigation

### A. Brownout Detector Reset (`rst:0x10 (RTCWDT_RTC_RESET)` or `Brownout detector was triggered`)
- **Root Cause**: Current spike during Wi-Fi RF calibration causes 3.3V rail to dip below 2.7V.
- **Solution**: Add a 100uF low-ESR capacitor between 3.3V and GND near the ESP32 module; use an external power supply capable of delivering 1A continuous.

### B. Flash Voltage Strapping Error (`rst:0x1 (POWERON_RESET),boot:0x12 (SPI_FAST_FLASH_BOOT)`)
- **Root Cause**: GPIO 12 (MTDI) was pulled HIGH at boot by an external relay or resistor. This forces the internal LDO to output 1.8V instead of 3.3V to the external flash chip, crashing the SPI flash controller.
- **Solution**: Keep GPIO 12 completely floating or pulled LOW at boot. Do not attach relay inputs to GPIO 12.

### C. FreeRTOS Task Watchdog Reset (`Task watchdog got triggered. The following tasks did not reset the watchdog: IDLE0`)
- **Root Cause**: A task pinned to Core 0 entered an infinite loop without calling `vTaskDelay()` or yielding, starving the FreeRTOS idle task.
- **Solution**: Ensure all continuous loops include `vTaskDelay(pdMS_TO_TICKS(10))` or event semaphores.
