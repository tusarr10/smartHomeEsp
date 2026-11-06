# DEVICE 03 TROUBLESHOOTING & RECOVERY: ESP-01 / ESP-01S (1MB)

**Target Hardware**: ESP8266 ESP-01 / ESP-01S  

---

## 1. Common Boot & Hardware Issues

### A. ESP-01 Hangs / Refuses to Boot When Connected to Relay Board
- **Cause**: The relay board's optocoupler or input resistor is pulling **GPIO 0 to GND** during power-up. This forces the ESP8266 into UART Flash Mode instead of booting firmware.
- **Solution**:
  - Add a 10k pull-up resistor between GPIO 0 and 3.3V.
  - Or insert a small 100ms power-delay circuit for the relay board so the ESP8266 boots before the relay circuit energizes.

### B. Flash Mode Mismatch (`fatal exception (28)` or Garbage Serial Output)
- **Cause**: Many ESP-01 modules use PUYA or GigaDevice flash chips that do not support standard Quad SPI (QIO). Flashing with QIO causes the bootloader to read corrupted opcode bytes.
- **Solution**: Verify that `platformio.ini` enforces `board_build.flash_mode = dout`.

### C. Reset Pin Accidental Trigger
- **Observation**: Unlike Device 01, Device 03 has `FACTORY_RESET_PIN = 255` (disabled).
- **Recovery Method**: If the ESP-01 Wi-Fi credentials need to be erased, use the web interface (`POST /api/wifi/connect` with empty credentials) or reflash LittleFS via serial programmer.
