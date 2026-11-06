# DEVICE 02 TARGET GPIO MAPPING & PIN SAFETY MATRIX: ESP32

**Target Hardware**: ESP32-WROOM-32 (38-Pin DevKit)  
**Standard**: Recommended Architecture for Multi-Channel Relay Deployment  

---

## 1. Pin Assignment & Safety Classification

The ESP32 features rich I/O, but specific pins must be carefully assigned to prevent boot failures or ADC Wi-Fi contention:

| Pin | Function / Target | Relay Safe? | Boot Sensitive? | Restrictions / Notes |
|---|---|---|---|---|
| **GPIO 0** | Boot Config / Button | NO | **YES** | Boot strapping pin. Must be HIGH at boot. Connected to EN/BOOT button. |
| **GPIO 2** | Onboard LED / Strapping | NO | **YES** | Boot strapping pin. Must be LOW or floating at boot. |
| **GPIO 4** | Relay Channel 1 | **YES** | NO | Safe output. Boot-neutral. |
| **GPIO 5** | Strapping / CS | NO | **YES** | Boot strapping pin (SDIO timing). Must be HIGH at boot. |
| **GPIO 12** | MTDI / Flash Voltage | NO | **YES** | **CRITICAL**: Strapping pin for SPI flash voltage (VDD_SDIO). Must NOT be pulled HIGH at boot, or 3.3V flash receives 1.8V and bricks boot. |
| **GPIO 13** | Relay Channel 2 | **YES** | NO | Safe output. Boot-neutral. |
| **GPIO 14** | Relay Channel 3 | **YES** | NO | Safe output. Boot-neutral. |
| **GPIO 15** | Strapping / Debug | NO | **YES** | Boot strapping pin. Outputs debug PWM at boot. |
| **GPIO 16** | Relay Channel 4 | **YES** | NO | Safe output. Boot-neutral. |
| **GPIO 17** | Relay Channel 5 | **YES** | NO | Safe output. Boot-neutral. |
| **GPIO 18** | Relay Channel 6 | **YES** | NO | Safe output (SPI SCK). |
| **GPIO 19** | Relay Channel 7 | **YES** | NO | Safe output (SPI MISO). |
| **GPIO 21** | I2C SDA (Sensors) | **YES** | NO | Wire SDA for BME280 / BH1750 environmental sensors. |
| **GPIO 22** | I2C SCL (Sensors) | **YES** | NO | Wire SCL for BME280 / BH1750 environmental sensors. |
| **GPIO 23** | Relay Channel 8 | **YES** | NO | Safe output (SPI MOSI). |
| **GPIO 25** | Relay Channel 9 (DAC1)| **YES** | NO | Safe output. |
| **GPIO 26** | Relay Channel 10 (DAC2)| **YES** | NO | Safe output. |
| **GPIO 27** | Relay Channel 11 | **YES** | NO | Safe output. |
| **GPIO 32** | Analog ADC1_CH4 | Input Only | NO | Safe for analog sensors (Current CT clamp, LDR). |
| **GPIO 33** | Analog ADC1_CH5 | Input Only | NO | Safe for analog sensors (Temperature thermistor). |
| **GPIO 34** | Input Only (GPI) | NO | NO | Input only. No internal pull-up or pull-down. |
| **GPIO 35** | Input Only (GPI) | NO | NO | Input only. No internal pull-up or pull-down. |
| **GPIO 36** | Input Only (SENSOR_VP)| NO | NO | Input only (ADC1_CH0). |
| **GPIO 39** | Input Only (SENSOR_VN)| NO | NO | Input only (ADC1_CH3). |

---

## 2. ADC2 Wi-Fi Restriction Warning

> [!WARNING]
> On the ESP32, **ADC2 pins (GPIO 0, 2, 4, 12, 13, 14, 15, 25, 26, 27)** cannot be used for analog reads while Wi-Fi is active. The Wi-Fi driver takes exclusive ownership of ADC2 SAR controller.
> Any analog sensor integration (e.g. current clamps, gas sensors) **MUST** use **ADC1 pins (GPIO 32, 33, 34, 35, 36, 39)**.
