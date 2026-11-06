# AUTHENTICATION & SESSION REST API SPECIFICATION

**Base Path**: `/api/v1/auth`  
**Authentication Type**: Bearer Session Tokens (`Authorization: Bearer <token>`) & Cookies (`session=<token>`)  
**Source Implementation**: [`central_server_js/src/routes/v1Router.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/routes/v1Router.js#L50-L130)  

---

## 1. Endpoints

### 1.1 User Login (`POST /api/v1/auth/login`)
- **Method**: `POST`
- **Purpose**: Authenticates credentials, generates a 32-byte session token, and establishes user context.
- **Authentication**: Unauthenticated / Open.
- **Request Body**:
  ```json
  {
    "username": "admin",
    "password": "admin123"
  }
  ```
- **Response (HTTP 200)**:
  ```json
  {
    "success": true,
    "token": "4f8a129d8b7c6e5a4d3f2e1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c",
    "user": {
      "id": 1,
      "username": "admin",
      "full_name": "System Administrator",
      "email": "admin@smarthome.local",
      "is_superuser": 1,
      "roles": ["SUPER_ADMIN"],
      "permissions": ["system:manage", "users:manage", "devices:control", "..."]
    }
  }
  ```
- **Error Response (HTTP 401)**:
  ```json
  {
    "success": false,
    "error": "Invalid username or password"
  }
  ```

---

### 1.2 Get Current User Profile (`GET /api/v1/auth/me`)
- **Method**: `GET`
- **Purpose**: Returns active session user profile, roles, and assigned scopes.
- **Authentication**: Required (`authenticateUser`).
- **Headers**: `Authorization: Bearer <token>`
- **Response (HTTP 200)**:
  ```json
  {
    "success": true,
    "user": {
      "id": 1,
      "username": "admin",
      "full_name": "System Administrator",
      "roles": ["SUPER_ADMIN"],
      "permissions": ["*"]
    }
  }
  ```

---

### 1.3 User Logout (`POST /api/v1/auth/logout`)
- **Method**: `POST`
- **Purpose**: Invalidates the active session token in SQLite `user_sessions`.
- **Authentication**: Required (`authenticateUser`).
- **Response (HTTP 200)**:
  ```json
  {
    "success": true,
    "message": "Logged out successfully"
  }
  ```

---

### 1.4 Change Password (`POST /api/v1/auth/change-password`)
- **Method**: `POST`
- **Purpose**: Changes password for the currently signed-in user and regenerates PBKDF2 hash.
- **Authentication**: Required (`authenticateUser`).
- **Request Body**:
  ```json
  {
    "currentPassword": "oldPassword123",
    "newPassword": "newSecretPassword456"
  }
  ```
- **Validation**: Minimum 4 characters; current password must match stored PBKDF2 hash.
- **Response (HTTP 200)**:
  ```json
  {
    "success": true,
    "message": "Password changed successfully"
  }
  ```
