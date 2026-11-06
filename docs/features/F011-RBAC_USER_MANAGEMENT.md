# F011 – ROLE-BASED ACCESS CONTROL (RBAC) & USER MANAGEMENT

## 1. Feature Information
- **Feature ID**: F011
- **Feature Name**: Enterprise Role-Based Access Control (RBAC) & User Administration
- **Version**: 1.6.0
- **Category**: Security & Identity
- **Priority**: High
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Provides fine-grained identity management, cryptographic credential storage, and authorization boundaries ensuring that operators, developers, and guests have appropriate access permissions.

## 3. Actual Functionality
- **Central Server**: Supports 6 roles (`SUPER_ADMIN`, `ADMIN`, `DEVICE_MANAGER`, `OPERATOR`, `VIEWER`, `DEVELOPER`) and 26 granular permissions. Uses salted PBKDF2 (SHA-512, 100k rounds) password hashing. Supports session tokens with revocation and resource scopes.
- **Edge Devices**: Supports administrative password authentication with SHA-256 hash checks and temporary 10s lockout after 5 failed attempts.

## 4. Architecture
Hierarchical RBAC engine implemented as Express middleware (`requirePermission()`) backed by normalized relational tables in SQLite.

## 5. Workflow
1. Request arrives with `Authorization: Bearer <token>`.
2. Middleware `authenticateUser()` resolves user ID from SQLite `user_sessions`.
3. Middleware `requirePermission(code)` evaluates effective permissions:
   - If user is superuser (`is_superuser = 1`), allows immediately.
   - Queries `user_roles` and `role_permissions` for matching permission code.
   - If missing, halts request with HTTP 403 Forbidden.

## 6. Hardware Requirements
Host PC CPU with cryptographic acceleration for PBKDF2 hashing.

## 7. Device Implementation
- **ESP8266 (4MB)**: Implemented in [`AuthManager`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/auth_manager.cpp) with SHA-256 session tokens.
- **ESP32**: Target specification.
- **ESP-01 (1MB)**: Lightweight token matching in [`esp01_1mb/src/auth_manager.cpp`](file:///d:/ai/Homeautomation_server/esp01_1mb/src/auth_manager.cpp).

## 8. Central Server Implementation
- **Backend**: Implemented in [`central_server_js/src/auth.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/auth.js) and `database.js`.
- **Frontend**: RBAC & Users view in `app.js`.
- **Database**: 7 normalized tables: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `scopes`, `user_sessions`.

## 9. API and Protocol
- Endpoints: `POST /api/v1/auth/login`, `GET /api/v1/admin/users`, `POST /api/v1/admin/users`, `PUT /api/v1/admin/users/:id`, `POST /api/v1/admin/users/:id/revoke-sessions`.

## 10. Data Storage
- SQLite tables: `users`, `user_sessions`, `roles`, `permissions`.

## 11. Configuration
Default admin account created on first startup (`admin` / `admin123`).

## 12. Error Handling
Returns HTTP 401 for invalid tokens; HTTP 403 for insufficient permissions; logs security audits for failed authentication.

## 13. Security
PBKDF2 with 100,000 rounds protects against offline dictionary and rainbow table attacks.

## 14. Testing
Verified user creation, role assignment, permission blocking, and session revocation using `test_rbac_commands_sync.js`.

## 15. Source References
- Server: [`central_server_js/src/auth.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/auth.js)
- Database: [`central_server_js/src/database.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/database.js#L221-L316)

## 16. Known Limitations
Central Server frontend contains an auto-login fallback in `app.js` using default credentials `admin:admin123` upon receiving 401 (identified security risk).

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | PARTIAL | Basic token auth without RBAC roles |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | PARTIAL | Basic token auth without RBAC roles |
| Central Server | IMPLEMENTED | Full 26-permission RBAC engine |
| Dashboard | IMPLEMENTED | RBAC & Users section in `app.js` |

## 18. Future Improvements
Add Multi-Factor Authentication (TOTP via RFC 6238 Google Authenticator).
