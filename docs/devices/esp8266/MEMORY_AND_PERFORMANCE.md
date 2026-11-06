# DEVICE 01 MEMORY & PERFORMANCE AUDIT: ESP8266 / NODEMCU (4MB)

**Empirical Hardware Evidence**: [`stress_test/combined_stress_report.md`](file:///d:/ai/Homeautomation_server/stress_test/combined_stress_report.md), [`doc/memory_audit_report.md`](file:///d:/ai/Homeautomation_server/doc/memory_audit_report.md)  
**Target Hardware Tested**: NodeMCU ESP8266 (`192.168.1.105`)  
**Firmware**: `SmartHome-NodeMCU v1.6.0`  

---

## 1. Runtime Memory Profile

| Memory Metric | Value Measured on Hardware | Safe Operating Threshold |
|---|---|---|
| **Baseline Free Heap** | **25,304 bytes** (~24.7 KB) | > 15,000 bytes |
| **Minimum Free Heap (Under Peak Concurrency)** | **25,144 bytes** (~24.6 KB) | > 10,000 bytes (Hard Safety Floor) |
| **Safety Margin Above Safety Floor** | **+15,144 bytes** | — |
| **Largest Free Allocatable Block (Lowest)** | **19,888 bytes** (~19.4 KB) | > 12,000 bytes |
| **Peak Heap Fragmentation** | **21.95%** | < 30.0% |
| **Memory Reclamation After Bursts** | **100% Reclaimed** (25,288 B recovered) | 100% |
| **Total Crashes / Reboots Observed** | **0** (Boot counter constant at 12) | 0 |

---

## 2. Multi-Client Concurrency Stress Analysis

Empirical testing exercised the single-threaded Xtensa LX106 core across 40 parallel HTTP requests:

```text
Concurrent Clients | Requests | Success Rate | Mean Latency | Peak Latency | Heap Dip
-------------------|----------|--------------|--------------|--------------|----------
2 Clients          | 8        | 100% (8/8)   | 108.3 ms     | 248.0 ms     | ~150 B
3 Clients          | 12       | 100% (12/12) | 100.4 ms     | 195.3 ms     | ~280 B
5 Clients          | 20       | 100% (20/20) | 543.1 ms     | 1206.2 ms    | ~420 B
```

### Architectural Insights:
1. **Queueing in lwIP**: At 5 concurrent clients, the ESP8266 does not crash or drop connections. The lwIP TCP stack queues connections in the TCP listening backlog, processing them in FIFO order.
2. **Deterministic Heap Management**: Each inbound HTTP connection allocates an ephemeral client buffer that is destroyed immediately upon `client.stop()`.
3. **No Dynamic String Leaks**: Heap dip during bursts was restricted to ~420 bytes, fully reclaimed upon request completion.

---

## 3. Outbound TCP Socket Telemetry Memory Profile

Measured over 5 consecutive outbound telemetry push cycles to host `192.168.1.10:2000`:

```text
Cycle | Total Socket RTT | Node Internals | Heap Before | Heap After | Net Shift | Largest Block
------|------------------|----------------|-------------|------------|-----------|--------------
#1    | 689.6 ms         | 665 ms         | 25,192 B    | 25,112 B   | -80 B     | 21,232 B
#2    | 1017.5 ms        | 999 ms         | 25,224 B    | 25,256 B   | +32 B     | 21,232 B
#3    | 744.8 ms         | 695 ms         | 25,336 B    | 25,432 B   | +96 B     | 21,232 B
#4    | 1766.8 ms        | 1742 ms        | 25,208 B    | 25,336 B   | +128 B    | 21,232 B
#5    | 2162.5 ms        | 2120 ms        | 25,320 B    | 24,792 B   | -528 B    | 21,232 B
```

### Protocol Efficiency:
- Telemetry payload is serialized directly into `WiFiClient` via `serializeJson(doc, _tcpClient)`, completely avoiding intermediate heap String allocation.
- Inbound response is read into a fixed stack buffer `char _rxBuf[256]` with zero dynamic heap allocation.
- Socket teardown is deterministic (`_tcpClient.stop(10)`).

---

## 4. Flash Wear & LittleFS Geometry

- **Total LittleFS Space**: 2,097,152 bytes (2MB)
- **Sector Size**: 4096 bytes (4KB)
- **Typical Used Space**: ~120 KB (Web UI SPA assets + 5 configuration JSONs)
- **Available Margin**: > 1.9 MB free
- **Wear-Leveling Performance**: LittleFS dynamically redistributes write blocks across sectors during relay state commits, ensuring flash endurance of over 100,000 write cycles per sector.
