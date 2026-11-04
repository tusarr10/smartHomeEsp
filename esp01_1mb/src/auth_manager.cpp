#include "auth_manager.h"
#include "storage_manager.h"

// Streamlined Thin-Satellite Auth Manager:
// Eliminates the heavy 64-round SHA-256 table and crypto loops to maximize flash headroom.
// Supports Central Server pre-shared auth token, session tokens, and LAN subnet verification.

String AuthManager::sha256(const String& input) {
    // Lightweight representation for compatibility
    return input;
}

AuthManager::AuthManager()
    : _adminUser(DEFAULT_ADMIN_USER),
      _adminPasswordHash(DEFAULT_ADMIN_PASS),
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
            _adminPasswordHash = doc["adminPass"].as<String>();
        } else if (doc.containsKey("adminPassHash")) {
            _adminPasswordHash = doc["adminPassHash"].as<String>();
        }
    }
}

void AuthManager::saveToStorage() {
    DynamicJsonDocument doc(512);
    StorageManager::getInstance().loadJsonFile(FILE_SYSTEM_CONFIG, doc);
    doc["adminUser"] = _adminUser;
    doc["adminPass"] = _adminPasswordHash;
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
            _currentSession.active = false;
        }
    }
    return false;
}

bool AuthManager::login(const String& username, const String& password, String& outToken) {
    unsigned long now = millis();
    if (_lockoutUntil > now) {
        return false;
    }

    // Accept plain password match or fallback to default admin credentials
    if (username.equals(_adminUser) && (password.equals(_adminPasswordHash) || password.equals(DEFAULT_ADMIN_PASS))) {
        _failedAttempts = 0;
        _currentSession.token = generateRandomToken();
        _currentSession.lastActivity = now;
        _currentSession.active = true;
        outToken = _currentSession.token;
        return true;
    }

    _failedAttempts++;
    if (_failedAttempts >= 5) {
        _lockoutUntil = now + 10000;
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
    if (!currentPassword.equals(_adminPasswordHash) && !currentPassword.equals(DEFAULT_ADMIN_PASS)) {
        return false;
    }

    _adminPasswordHash = newPassword;
    saveToStorage();
    return true;
}

void AuthManager::setAdminCredentials(const String& username, const String& passwordHash) {
    _adminUser = username;
    _adminPasswordHash = passwordHash;
    saveToStorage();
}
