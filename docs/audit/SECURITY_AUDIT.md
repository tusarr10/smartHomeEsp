# ECOSYSTEM SECURITY AUDIT & VULNERABILITY ASSESSMENT

**Audit Date**: 2026-11-07  
**Scope**: Static Code Analysis & Architecture Security Review across Microcontrollers and Central Server  
**Auditor**: Senior Embedded IoT Security Architect  

---

## 1. Executive Summary & Findings Overview

| Finding ID | Severity | Affected Component | Source Location | Description |
|---|---|---|---|---|
| **SEC-001** | **CRITICAL** | Edge Microcontroller | [`esp8266_4mb/src/auth_manager.cpp#L122`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/auth_manager.cpp#L122) | Plaintext administrative password saved directly to LittleFS flash. |
| **SEC-002** | **CRITICAL** | Edge Microcontroller | [`esp8266_4mb/src/auth_manager.cpp#L187`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/auth_manager.cpp#L187) | Hardcoded backdoor fallback passwords accepted during authentication. |
| **SEC-003** | **HIGH** | Edge Microcontroller | [`esp8266_4mb/src/web_server.cpp#L125-L130`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L125-L130) | Source IP address authentication bypass without cryptographic token verification. |
| **SEC-004** | **HIGH** | Central Server Frontend| [`central_server_js/public/assets/app.js#L37`](file:///d:/ai/Homeautomation_server/central_server_js/public/assets/app.js#L37) | Hardcoded default admin credentials in transparent fetch interceptor. |
| **SEC-005** | **MEDIUM** | Network Transport | All components | Unencrypted plaintext HTTP and raw TCP communication on local LAN. |
| **SEC-006** | **LOW** | Edge Microcontroller | [`esp01_1mb/src/auth_manager.cpp#L8-L11`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/auth_manager.cpp#L8-L11) | Dummy SHA-256 stub returning plaintext password string on ESP-01. |

---

## 2. In-Depth Vulnerability Forensic Reports

### Finding SEC-001: Plaintext Admin Password Stored in LittleFS Flash
- **Severity**: **CRITICAL**
- **Affected Component**: ESP8266 Firmware (`esp8266_4mb` & `app2`)
- **Source Location**: [`esp8266_4mb/src/auth_manager.cpp: lines 122-124`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/auth_manager.cpp#L122-L124)
- **Code Evidence**:
  ```cpp
  void AuthManager::saveToStorage() {
      DynamicJsonDocument doc(512);
      StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, doc);
      doc["adminUser"] = _adminUser;
      doc["adminPass"] = _adminPass; // Raw plaintext password written to flash!
      doc["adminPassHash"] = _adminPasswordHash;
      StorageManager::getInstance().saveJsonFile(FILE_SYSTEM_CONFIG, doc);
  }
  ```
- **Impact**: Any user with LAN access who calls `GET /api/backup/download` or `GET /api/fs/download?path=/config/system.json` receives the cleartext administrator password. An attacker with physical access to the flash chip can read the password directly.
- **Recommended Correction**: Delete line 123 completely. Never serialize `adminPass` into flash storage; store only the one-way `adminPassHash` (SHA-256 / PBKDF2).
- **Status**: **VERIFIED IN SOURCE CODE**.

---

### Finding SEC-002: Hardcoded Fallback Passwords in Authentication Logic
- **Severity**: **CRITICAL**
- **Affected Component**: ESP8266 Firmware (`esp8266_4mb` & `app2`)
- **Source Location**: [`esp8266_4mb/src/auth_manager.cpp: lines 187-189 & lines 215-217`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/auth_manager.cpp#L187-L189)
- **Code Evidence**:
  ```cpp
  // Line 186-189:
  if (server.authenticate(adminUser.c_str(), adminPass.c_str()) ||
      server.authenticate(DEFAULT_ADMIN_USER, DEFAULT_ADMIN_PASS) ||
      server.authenticate(DEFAULT_ADMIN_USER, "admin123")) {
      return true;
  }
  // Line 214-219:
  if (cleanPass.equals(_adminPass) ||
      cleanPass.equals(DEFAULT_ADMIN_PASS) ||
      cleanPass.equals("admin123") || ...
  ```
- **Impact**: Even if an administrator changes their password to a strong 32-character passphrase, the device continues to grant full administrative access to anyone entering default credentials.
- **Recommended Correction**: Remove all hardcoded default credential checks from `authenticate()` and `login()`. Validate solely against stored hash.
- **Status**: **VERIFIED IN SOURCE CODE**.

---

### Finding SEC-003: Source IP Address Authentication Bypass
- **Severity**: **HIGH**
- **Affected Component**: ESP8266 & ESP-01 Firmware
- **Source Location**: [`esp8266_4mb/src/web_server.cpp: lines 125-130`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/web_server.cpp#L125-L130)
- **Code Evidence**:
  ```cpp
  if (rcfg.enabled && rcfg.serverHost.length() > 0) {
      String clientIp = _server.client().remoteIP().toString();
      if (clientIp == rcfg.serverHost) {
          return true; // Bypass authentication based solely on IP!
      }
  }
  ```
- **Impact**: Any malicious device on the Wi-Fi LAN that performs ARP spoofing or adopts the IP address of the Central Server automatically gains unrestricted control over all relays, firmware flashing, and filesystems without credentials.
- **Recommended Correction**: Remove IP-based authentication bypass. Require HMAC or Bearer `authToken` in all inter-device requests.
- **Status**: **VERIFIED IN SOURCE CODE**.

---

### Finding SEC-004: Hardcoded Credentials in Transparent Frontend Fetch Interceptor
- **Severity**: **HIGH**
- **Affected Component**: Central Server Frontend SPA
- **Source Location**: [`central_server_js/public/assets/app.js: lines 37 & 76`](file:///d:/ai/Homeautomation_server/central_server_js/public/assets/app.js#L37)
- **Code Evidence**:
  ```javascript
  if (res.status === 401 && !urlStr.includes('/auth/login')) {
    const loginRes = await _nativeFetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
  ```
- **Impact**: Hardcoded credentials leak in client-side JavaScript. If the admin password is changed on the server, frontend requests loop endlessly on 401 errors, spamming auth audit logs.
- **Recommended Correction**: Remove hardcoded credentials. Redirect the user to a dedicated login modal upon 401 session expiration.
- **Status**: **VERIFIED IN SOURCE CODE**.

---

### Finding SEC-005: Unencrypted Plaintext Communication on Local LAN
- **Severity**: **MEDIUM**
- **Affected Component**: Inter-Device Communication (TCP:2000, HTTP:9100, HTTP:80)
- **Impact**: Network eavesdroppers on the same Wi-Fi SSID can inspect telemetry packets, pin states, and relay switching commands.
- **Recommended Correction**: Isolate IoT microcontrollers on a dedicated, isolated IoT VLAN with Client Isolation enabled at the Wi-Fi router.
- **Status**: **VERIFIED ARCHITECTURAL BEHAVIOR**.
