# SMART HOME ECOSYSTEM MASTER DOCUMENTATION

**Unified Technical Documentation System**  
**Version**: `1.6.0`  
**Last Audited**: 2026-11-07  
**Auditor**: Senior Embedded Systems & IoT Software Architect  

---

## 1. Ecosystem Overview

The Smart Home Automation Ecosystem is an enterprise-grade distributed IoT control platform consisting of heterogeneous edge microcontrollers and a centralized fleet coordinator:

```
+-----------------------------------------------------------------------------------------+
|                                    OPERATOR BROWSER                                     |
|                       17-Section Dark Mode Dashboard SPA (HTML5 / Vanilla JS)           |
+-----------------------------------------------------------------------------------------+
                                      ▲                 │
              WebSocket Real-Time Feed│                 │ HTTP REST Commands & Config
                                      │                 ▼
+-----------------------------------------------------------------------------------------+
|                               CENTRAL FLEET SERVER (Node.js)                            |
|             Port 9100 (HTTP / WS)   •   Port 2000 (Raw TCP Telemetry Stream)            |
|       SQLite (WAL Mode, 28 Tables)  •  RBAC Engine  •  Managed OTA  •  Config Sync       |
+-----------------------------------------------------------------------------------------+
               ▲                                        │
 Outbound TCP  │ Heartbeat & State Transitions          │ Direct HTTP Commands /
 Port 2000     │ with Application ACKs                  │ Socket Command Piggyback
               │                                        ▼
+-------------------------------------+   +-----------------------------------------------+
|      DEVICE 01: ESP8266 (4MB)       |   |           DEVICE 03: ESP-01 (1MB)             |
|   NodeMCU Multi-Channel Controller  |   |        Compact Dual-Relay Satellite           |
|  8x Relays • 2MB LittleFS • NTP IST |   |   2x Relays • 64KB LittleFS • PROGMEM Gzip    |
|   Local Rules Engine • Captive AP   |   |   Offloaded Automation • Zero-Heap Actuator   |
+-------------------------------------+   +-----------------------------------------------+
                                      [ DEVICE 02: ESP32 ]
                                    (Planned / Specification)
```

---

## 2. Master Navigation Directory

### [📁 Audit & Forensic Reports](file:///d:/ai/Homeautomation_server/docs/audit)
- [**COMPLETE_AUDIT_REPORT.md**](file:///d:/ai/Homeautomation_server/docs/audit/COMPLETE_AUDIT_REPORT.md) – Executive summary, repository inventory, device audit summary, API summary, security findings, and prioritized development roadmap.
- [**REPOSITORY_INVENTORY.md**](file:///d:/ai/Homeautomation_server/docs/audit/REPOSITORY_INVENTORY.md) – Inventory table of all projects, directories, frameworks, and build configurations.
- [**PROJECT_STRUCTURE.md**](file:///d:/ai/Homeautomation_server/docs/audit/PROJECT_STRUCTURE.md) – Detailed workspace folder tree and architectural module boundaries.
- [**CROSS_DEVICE_GAP_ANALYSIS.md**](file:///d:/ai/Homeautomation_server/docs/audit/CROSS_DEVICE_GAP_ANALYSIS.md) – Forensic discrepancy analysis across devices and server.
- [**SECURITY_AUDIT.md**](file:///d:/ai/Homeautomation_server/docs/audit/SECURITY_AUDIT.md) – Static vulnerability analysis (plaintext passwords, backdoors, auth bypass).
- [**RELIABILITY_AUDIT.md**](file:///d:/ai/Homeautomation_server/docs/audit/RELIABILITY_AUDIT.md) – Memory profile, heap fragmentation analysis, and watchdog recovery.
- [**TECHNICAL_DEBT.md**](file:///d:/ai/Homeautomation_server/docs/audit/TECHNICAL_DEBT.md) – Architectural debt, duplicate codebases, and refactoring priorities.
- [**DOCUMENTATION_VALIDATION.md**](file:///d:/ai/Homeautomation_server/docs/audit/DOCUMENTATION_VALIDATION.md) – Quality assurance checklist verifying all links, evidence, and citations.

### [📁 System Architecture](file:///d:/ai/Homeautomation_server/docs/architecture)
- [**SYSTEM_ARCHITECTURE.md**](file:///d:/ai/Homeautomation_server/docs/architecture/SYSTEM_ARCHITECTURE.md) – End-to-end physical and logical ecosystem topology.
- [**DEVICE_COMMUNICATION.md**](file:///d:/ai/Homeautomation_server/docs/architecture/DEVICE_COMMUNICATION.md) – Specifications for all 8 communication trajectories.
- [**DATA_FLOW.md**](file:///d:/ai/Homeautomation_server/docs/architecture/DATA_FLOW.md) – Step-by-step sequence diagrams for relay actuation, OTA, and telemetry.
- [**DATA_MODELS.md**](file:///d:/ai/Homeautomation_server/docs/architecture/DATA_MODELS.md) – TypeScript interface definitions for Node, Relay, Command, and Telemetry.
- [**CONFIGURATION_STANDARD.md**](file:///d:/ai/Homeautomation_server/docs/architecture/CONFIGURATION_STANDARD.md) – Naming standards, validation rules, and JSON schemas.
- [**VERSION_COMPATIBILITY.md**](file:///d:/ai/Homeautomation_server/docs/architecture/VERSION_COMPATIBILITY.md) – Version compatibility matrix and migration guidelines.

### [📁 Hardware Devices](file:///d:/ai/Homeautomation_server/docs/devices)
- [**esp8266/**](file:///d:/ai/Homeautomation_server/docs/devices/esp8266/README.md) – Flagship 4MB NodeMCU Controller (10 detailed technical documents).
- [**esp32/**](file:///d:/ai/Homeautomation_server/docs/devices/esp32/README.md) – High-Density Dual-Core Controller Architecture & Implementation Gap Analysis.
- [**esp01/**](file:///d:/ai/Homeautomation_server/docs/devices/esp01/README.md) – Lean Satellite 1MB ESP-01 Controller (10 detailed technical documents).

### [📁 Central Server](file:///d:/ai/Homeautomation_server/docs/server)
- [**SERVER_AUDIT.md**](file:///d:/ai/Homeautomation_server/docs/server/SERVER_AUDIT.md) – Complete subsystem and frontend view inventory.
- [**BACKEND_ARCHITECTURE.md**](file:///d:/ai/Homeautomation_server/docs/server/BACKEND_ARCHITECTURE.md) – Node.js processes, workers, and background pollers.
- [**FRONTEND_ARCHITECTURE.md**](file:///d:/ai/Homeautomation_server/docs/server/FRONTEND_ARCHITECTURE.md) – 17-section zero-dependency dark-mode SPA architecture.
- [**DATABASE_SCHEMA.md**](file:///d:/ai/Homeautomation_server/docs/server/DATABASE_SCHEMA.md) – Exhaustive DDL reference for all 28 SQLite tables.
- [**AUTHENTICATION.md**](file:///d:/ai/Homeautomation_server/docs/server/AUTHENTICATION.md) – Salted PBKDF2 hashing, session tokens, and 26-permission RBAC.
- [**DEPLOYMENT.md**](file:///d:/ai/Homeautomation_server/docs/server/DEPLOYMENT.md) – Production deployment on Windows and Linux systemd.
- [**CONFIGURATION.md**](file:///d:/ai/Homeautomation_server/docs/server/CONFIGURATION.md) – Complete `config.json` parameter dictionary.
- [**LOGGING_AND_ERRORS.md**](file:///d:/ai/Homeautomation_server/docs/server/LOGGING_AND_ERRORS.md) – Audit logging, system events, and error recovery.

### [📁 API Specifications](file:///d:/ai/Homeautomation_server/docs/api)
- [**API_INDEX.md**](file:///d:/ai/Homeautomation_server/docs/api/API_INDEX.md) – Master protocol directory.
- [**REST_API_REFERENCE.md**](file:///d:/ai/Homeautomation_server/docs/api/REST_API_REFERENCE.md) – Complete REST reference for Central Server and Microcontrollers.
- [**TCP_PROTOCOL.md**](file:///d:/ai/Homeautomation_server/docs/api/TCP_PROTOCOL.md) – Raw TCP socket streaming specification (Port 2000).
- [**WEBSOCKET_PROTOCOL.md**](file:///d:/ai/Homeautomation_server/docs/api/WEBSOCKET_PROTOCOL.md) – Real-time event streaming and handshake specifications.
- [**MQTT_PROTOCOL.md**](file:///d:/ai/Homeautomation_server/docs/api/MQTT_PROTOCOL.md) – Forensic verification of MQTT absence and proposed future spec.
- [**AUTHENTICATION_API.md**](file:///d:/ai/Homeautomation_server/docs/api/AUTHENTICATION_API.md) – Login, logout, and token endpoints.
- [**ERROR_CODES.md**](file:///d:/ai/Homeautomation_server/docs/api/ERROR_CODES.md) – Standardized error structures and fault codes.

### [📁 Master Features](file:///d:/ai/Homeautomation_server/docs/features)
- [**FEATURE_INDEX.md**](file:///d:/ai/Homeautomation_server/docs/features/FEATURE_INDEX.md) – Comprehensive feature comparison matrix across all components.
- [**F001–F014**](file:///d:/ai/Homeautomation_server/docs/features/) – Detailed 18-section architectural specifications for every system capability.

### [📁 Development & Operations](file:///d:/ai/Homeautomation_server/docs/development)
- [**DEVELOPMENT_GUIDE.md**](file:///d:/ai/Homeautomation_server/docs/development/DEVELOPMENT_GUIDE.md) – Developer workflow, setup, and local environment.
- [**BUILD_GUIDE.md**](file:///d:/ai/Homeautomation_server/docs/development/BUILD_GUIDE.md) – PlatformIO and Node.js compilation procedures.
- [**TESTING_GUIDE.md**](file:///d:/ai/Homeautomation_server/docs/development/TESTING_GUIDE.md) – Hardware test suites, stress testing, and RBAC verification.
- [**CONTRIBUTING.md**](file:///d:/ai/Homeautomation_server/docs/development/CONTRIBUTING.md) – Contribution guidelines and code standards.
- [**CHANGELOG.md**](file:///d:/ai/Homeautomation_server/docs/development/CHANGELOG.md) – Complete version release history.
- [**IMPLEMENTATION_STATUS.md**](file:///d:/ai/Homeautomation_server/docs/development/IMPLEMENTATION_STATUS.md) – Live tracking of implemented vs pending components.

### [📁 Engineering Templates](file:///d:/ai/Homeautomation_server/docs/templates)
- [**FEATURE_TEMPLATE.md**](file:///d:/ai/Homeautomation_server/docs/templates/FEATURE_TEMPLATE.md) – 18-section standardized feature template.
- [**DEVICE_TEMPLATE.md**](file:///d:/ai/Homeautomation_server/docs/templates/DEVICE_TEMPLATE.md) – Hardware device documentation template.
- [**API_TEMPLATE.md**](file:///d:/ai/Homeautomation_server/docs/templates/API_TEMPLATE.md) – Endpoint documentation template.
- [**AUDIT_TEMPLATE.md**](file:///d:/ai/Homeautomation_server/docs/templates/AUDIT_TEMPLATE.md) – Security and reliability audit template.
- [**CHANGELOG_TEMPLATE.md**](file:///d:/ai/Homeautomation_server/docs/templates/CHANGELOG_TEMPLATE.md) – Release changelog template.
