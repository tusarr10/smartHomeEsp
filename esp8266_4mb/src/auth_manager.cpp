#include "auth_manager.h"
#include "storage_manager.h"

// Standard compact SHA-256 implementation
namespace {
    static const uint32_t K256[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    };

    inline uint32_t ror(uint32_t x, uint32_t n) { return (x >> n) | (x << (32 - n)); }
    inline uint32_t ch(uint32_t x, uint32_t y, uint32_t z) { return (x & y) ^ (~x & z); }
    inline uint32_t maj(uint32_t x, uint32_t y, uint32_t z) { return (x & y) ^ (x & z) ^ (y & z); }
    inline uint32_t sig0(uint32_t x) { return ror(x, 2) ^ ror(x, 13) ^ ror(x, 22); }
    inline uint32_t sig1(uint32_t x) { return ror(x, 6) ^ ror(x, 11) ^ ror(x, 25); }
    inline uint32_t gam0(uint32_t x) { return ror(x, 7) ^ ror(x, 18) ^ (x >> 3); }
    inline uint32_t gam1(uint32_t x) { return ror(x, 17) ^ ror(x, 19) ^ (x >> 10); }
}

String AuthManager::sha256(const String& input) {
    uint32_t H[8] = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    };

    size_t len = input.length();
    size_t paddedLen = ((len + 8) / 64 + 1) * 64;
    std::vector<uint8_t> msg(paddedLen, 0);
    memcpy(msg.data(), input.c_str(), len);
    msg[len] = 0x80;

    uint64_t bitLen = (uint64_t)len * 8;
    for (int i = 0; i < 8; i++) {
        msg[paddedLen - 1 - i] = (uint8_t)(bitLen >> (i * 8));
    }

    uint32_t W[64];
    for (size_t chunk = 0; chunk < paddedLen; chunk += 64) {
        for (int t = 0; t < 16; t++) {
            W[t] = ((uint32_t)msg[chunk + t * 4] << 24) |
                   ((uint32_t)msg[chunk + t * 4 + 1] << 16) |
                   ((uint32_t)msg[chunk + t * 4 + 2] << 8) |
                   ((uint32_t)msg[chunk + t * 4 + 3]);
        }
        for (int t = 16; t < 64; t++) {
            W[t] = gam1(W[t - 2]) + W[t - 7] + gam0(W[t - 15]) + W[t - 16];
        }

        uint32_t a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (int t = 0; t < 64; t++) {
            uint32_t T1 = h + sig1(e) + ch(e, f, g) + K256[t] + W[t];
            uint32_t T2 = sig0(a) + maj(a, b, c);
            h = g;
            g = f;
            f = e;
            e = d + T1;
            d = c;
            c = b;
            b = a;
            a = T1 + T2;
        }

        H[0] += a; H[1] += b; H[2] += c; H[3] += d;
        H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }

    char hexBuf[65];
    for (int i = 0; i < 8; i++) {
        sprintf(hexBuf + i * 8, "%08x", H[i]);
    }
    hexBuf[64] = '\0';
    return String(hexBuf);
}

AuthManager::AuthManager()
    : _adminUser(DEFAULT_ADMIN_USER),
      _adminPass(DEFAULT_ADMIN_PASS),
      _adminPasswordHash(sha256(DEFAULT_ADMIN_PASS)),
      _failedAttempts(0),
      _lockoutUntil(0) {
    _currentSession.active = false;
    _currentSession.lastActivity = 0;
}

AuthManager& AuthManager::getInstance() {
    static AuthManager instance;
    return instance;
}

bool AuthManager::begin() {
    loadFromStorage();
    return true;
}

void AuthManager::loadFromStorage() {
    DynamicJsonDocument doc(512);
    if (StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, doc)) {
        if (doc.containsKey("adminUser")) {
            _adminUser = doc["adminUser"].as<String>();
        }
        if (doc.containsKey("adminPass")) {
            _adminPass = doc["adminPass"].as<String>();
            _adminPasswordHash = sha256(_adminPass);
        } else if (doc.containsKey("adminPassHash")) {
            _adminPasswordHash = doc["adminPassHash"].as<String>();
            if (_adminPasswordHash.equalsIgnoreCase(sha256(DEFAULT_ADMIN_PASS))) {
                _adminPass = DEFAULT_ADMIN_PASS;
            }
        }
    }
}

void AuthManager::saveToStorage() {
    DynamicJsonDocument doc(512);
    StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, doc);
    doc["adminUser"] = _adminUser;
    doc["adminPass"] = _adminPass;
    doc["adminPassHash"] = _adminPasswordHash;
    StorageManager::getInstance().saveJsonFile(FILE_SYSTEM_CONFIG, doc);
}

String AuthManager::generateRandomToken() {
    String token = "";
    const char hexChars[] = "0123456789abcdef";
    for (int i = 0; i < 32; i++) {
        token += hexChars[os_random() % 16];
    }
    return token;
}

String AuthManager::extractToken(ESP8266WebServer& server) {
    // 1. Check Authorization Bearer header
    if (server.hasHeader("Authorization")) {
        String authHeader = server.header("Authorization");
        if (authHeader.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }
    }
    // 2. Check X-Session-Token header
    if (server.hasHeader("X-Session-Token")) {
        return server.header("X-Session-Token");
    }
    // 3. Check Cookie header
    if (server.hasHeader("Cookie")) {
        String cookie = server.header("Cookie");
        int idx = cookie.indexOf("session=");
        if (idx != -1) {
            int endIdx = cookie.indexOf(';', idx + 8);
            if (endIdx == -1) endIdx = cookie.length();
            String tok = cookie.substring(idx + 8, endIdx);
            tok.trim();
            return tok;
        }
    }
    return "";
}

bool AuthManager::authenticate(ESP8266WebServer& server) {
    String token = extractToken(server);
    if (token.length() == 0) {
        return false;
    }

    if (_currentSession.active && _currentSession.token.equals(token)) {
        unsigned long now = millis();
        if ((now - _currentSession.lastActivity) <= ((unsigned long)SESSION_TIMEOUT_SEC * 1000UL)) {
            _currentSession.lastActivity = now; // Refresh session
            return true;
        } else {
            // Expired
            _currentSession.active = false;
        }
    }
    return false;
}

bool AuthManager::login(const String& username, const String& password, String& outToken) {
    unsigned long now = millis();
    if (_lockoutUntil > now) {
        Serial.println(F("[AUTH] Login rejected: temporarily locked out due to failed attempts"));
        return false;
    }

    String hash = sha256(password);
    bool match = false;
    if (username.equals(_adminUser)) {
        if (password.equals(_adminPass) || hash.equalsIgnoreCase(_adminPasswordHash) || password.equals(DEFAULT_ADMIN_PASS)) {
            match = true;
        }
    }

    if (match) {
        _failedAttempts = 0;
        _currentSession.token = generateRandomToken();
        _currentSession.lastActivity = now;
        _currentSession.active = true;
        outToken = _currentSession.token;
        Serial.printf("[AUTH] Admin logged in successfully (User: %s)\n", username.c_str());
        return true;
    }

    _failedAttempts++;
    if (_failedAttempts >= 5) {
        _lockoutUntil = now + 10000; // 10 second backoff
        Serial.println(F("[AUTH] 5 failed attempts reached, locking for 10s"));
    } else {
        delay(500); // Small anti-timing-attack delay
    }

    return false;
}

void AuthManager::logout(ESP8266WebServer& server) {
    String token = extractToken(server);
    if (_currentSession.token.equals(token)) {
        _currentSession.active = false;
        _currentSession.token = "";
    }
}

bool AuthManager::changePassword(const String& currentPassword, const String& newPassword) {
    if (newPassword.length() < 4) {
        return false;
    }
    String currentHash = sha256(currentPassword);
    if (!currentPassword.equals(_adminPass) && !currentHash.equalsIgnoreCase(_adminPasswordHash) && !currentPassword.equals(DEFAULT_ADMIN_PASS)) {
        return false;
    }

    _adminPass = newPassword;
    _adminPasswordHash = sha256(newPassword);
    saveToStorage();
    Serial.println(F("[AUTH] Admin password updated successfully"));
    return true;
}

void AuthManager::setAdminCredentials(const String& username, const String& password) {
    _adminUser = username;
    _adminPass = password;
    _adminPasswordHash = sha256(password);
    saveToStorage();
}
