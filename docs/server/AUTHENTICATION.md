# CENTRAL SERVER AUTHENTICATION & RBAC SECURITY

**Implementation**: Salted PBKDF2 Hashing, Session Bearer Tokens, Role-Based Access Control  
**Source Reference**: [`central_server_js/src/auth.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/auth.js)  

---

## 1. Password Hashing Specification

Passwords are cryptographic hashes generated using standard Node.js `node:crypto`:
```javascript
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}
```
- **Algorithm**: PBKDF2 (Password-Based Key Derivation Function 2)
- **Digest**: SHA-512
- **Iterations**: 100,000 rounds
- **Salt**: 16 cryptographically secure random bytes (32 hex characters)
- **Derived Key Length**: 64 bytes (128 hex characters)
- **Storage Format**: `<salt>:<hash>` stored in `users.password_hash` column.

---

## 2. Role-Based Access Control (RBAC) Matrix

The system provides 6 built-in roles mapped to 26 granular permissions:

| Permission Code | Category | SUPER ADMIN | ADMIN | DEVICE MANAGER | OPERATOR | VIEWER | DEVELOPER |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `system:manage` | SYSTEM | **YES** | NO | NO | NO | NO | NO |
| `users:manage` | USERS | **YES** | **YES** | NO | NO | NO | NO |
| `roles:manage` | USERS | **YES** | NO | NO | NO | NO | NO |
| `scopes:manage` | USERS | **YES** | **YES** | NO | NO | NO | NO |
| `devices:view` | DEVICES | **YES** | **YES** | **YES** | **YES** | **YES** | **YES** |
| `devices:manage` | DEVICES | **YES** | **YES** | **YES** | NO | NO | NO |
| `devices:control`| DEVICES | **YES** | **YES** | **YES** | **YES** | NO | **YES** |
| `devices:reboot` | DEVICES | **YES** | **YES** | **YES** | **YES** | NO | **YES** |
| `devices:delete` | DEVICES | **YES** | NO | NO | NO | NO | NO |
| `firmware:view` | FIRMWARE | **YES** | **YES** | **YES** | NO | NO | **YES** |
| `firmware:upload`| FIRMWARE | **YES** | **YES** | NO | NO | NO | **YES** |
| `firmware:deploy`| FIRMWARE | **YES** | **YES** | **YES** | NO | NO | **YES** |
| `firmware:download`| FIRMWARE | **YES** | **YES** | **YES** | NO | NO | **YES** |
| `littlefs:view` | FILESYSTEM | **YES** | **YES** | **YES** | NO | NO | **YES** |
| `littlefs:manage`| FILESYSTEM | **YES** | **YES** | **YES** | NO | NO | **YES** |
| `littlefs:upload`| FILESYSTEM | **YES** | **YES** | **YES** | NO | NO | **YES** |
| `littlefs:download`| FILESYSTEM | **YES** | **YES** | **YES** | NO | NO | **YES** |
| `littlefs:delete`| FILESYSTEM | **YES** | **YES** | NO | NO | NO | NO |
| `littlefs:backup`| FILESYSTEM | **YES** | **YES** | **YES** | NO | NO | NO |
| `config:view` | CONFIG | **YES** | **YES** | **YES** | NO | NO | **YES** |
| `config:manage` | CONFIG | **YES** | **YES** | **YES** | NO | NO | **YES** |
| `config:sync` | CONFIG | **YES** | **YES** | **YES** | NO | NO | NO |
| `config:rollback`| CONFIG | **YES** | NO | NO | NO | NO | NO |
| `commands:execute`| DEVICES | **YES** | **YES** | **YES** | **YES** | NO | **YES** |
| `commands:view` | DEVICES | **YES** | **YES** | **YES** | **YES** | **YES** | **YES** |
| `telemetry:view`| TELEMETRY | **YES** | **YES** | **YES** | **YES** | **YES** | **YES** |
| `audit:view` | SYSTEM | **YES** | **YES** | **YES** | NO | NO | **YES** |

---

## 3. Session Token Lifecycle

1. **Authentication**: `POST /api/v1/auth/login` validates username and password hash.
2. **Token Generation**: Generates 32 random bytes as hex (`crypto.randomBytes(32).toString('hex')`).
3. **Session Record**: Stored in SQLite `user_sessions` with `expires_at = NOW + 7 days`.
4. **Validation**: Protected endpoints execute `authenticateUser(db)` middleware, extracting the token from `Authorization: Bearer <token>` or `Cookie: session=<token>`.
5. **Revocation**:
   - `POST /api/v1/auth/logout`: Revokes active session.
   - `POST /api/v1/admin/users/:id/revoke-sessions`: Superuser can instantly invalidate all active sessions for a target user.
