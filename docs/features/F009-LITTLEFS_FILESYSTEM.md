# F009 – LITTLEFS FILESYSTEM & REMOTE EXPLORER

## 1. Feature Information
- **Feature ID**: F009
- **Feature Name**: LittleFS Embedded Filesystem Management & Remote Explorer
- **Version**: 1.6.0
- **Category**: Storage & Asset Management
- **Priority**: Medium
- **Implementation Status**: IMPLEMENTED
- **Last Audited Date**: 2026-11-07

## 2. Purpose
Provides a resilient, wear-leveled flash filesystem for storing web SPA assets, configuration JSON files, and system logs, with complete remote management capabilities from the Central Server.

## 3. Actual Functionality
- **Node-Side**: Mounts a 2MB LittleFS partition (Device 01) or 64KB partition (Device 03). Serves static files directly to HTTP clients (`/index.html`, `/app.js`, `/style.css`).
- **Server-Side**: Remote LittleFS manager browses remote directories, inspects file sizes, uploads new assets, downloads files, deletes obsolete logs, renames files, and creates complete compressed filesystem archives.

## 4. Architecture
Embedded LittleFS driver on the edge paired with an HTTP-driven remote filesystem proxy service (`littlefsService.js`) on the server.

## 5. Workflow
1. User opens "LittleFS Manager" in central dashboard.
2. Server executes `littlefsService.fetchFilesystemList(nodeId)`:
   - Dispatches `GET http://${node_ip}/api/fs/list`.
   - Microcontroller traverses directory tree with `LittleFS.openDir("/")` and returns JSON file manifest.
3. Server syncs file metadata into SQLite `filesystem_files` table.
4. User uploads a file: Server POSTs multipart payload to node `/api/fs/upload`.
5. Microcontroller writes file to flash.

## 6. Hardware Requirements
SPI Flash memory supported by LittleFS.

## 7. Device Implementation
- **ESP8266 (4MB)**: Full implementation in [`StorageManager`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/storage_manager.cpp) and `web_server.cpp` (lines 1187–1338).
- **ESP32**: Target specification.
- **ESP-01 (1MB)**: Partial (Storage engine active, but remote management `/api/fs/*` stripped to conserve code space).

## 8. Central Server Implementation
- **Backend**: Implemented in [`central_server_js/src/littlefsService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/littlefsService.js).
- **Frontend**: LittleFS Manager view in `app.js`.
- **Database**: SQLite `filesystem_files` and `filesystem_backups` tables.

## 9. API and Protocol
- Node Endpoints: `GET /api/fs/list`, `GET /api/fs/download`, `POST /api/fs/upload`, `POST /api/fs/delete`, `POST /api/fs/rename`.
- Server Endpoints: `GET /api/v1/nodes/:nodeId/fs`, `POST /api/v1/nodes/:nodeId/fs/backup`.

## 10. Data Storage
- Microcontroller: 2MB LittleFS partition (`eagle.flash.4m2m.ld`).
- Central Server: Cached in `filesystem_files` table; archives in `data/fs_backups/`.

## 11. Configuration
Partition boundary defined in PlatformIO `board_build.filesystem = littlefs`.

## 12. Error Handling
LittleFS automatically marks bad blocks and dynamically relocates write operations. Path traversal attacks (`..`) are rejected by `littlefsService.sanitizePath()`.

## 13. Security
All `/api/fs/*` endpoints require authenticated session and permission `littlefs:manage`.

## 14. Testing
Tested remote listing, file upload, and full archive creation from node `192.168.1.105`.

## 15. Source References
- Edge: [`esp8266_4mb/src/storage_manager.cpp`](file:///d:/ai/Homeautomation_server/esp8266_4mb/src/storage_manager.cpp)
- Server: [`central_server_js/src/littlefsService.js`](file:///d:/ai/Homeautomation_server/central_server_js/src/littlefsService.js)

## 16. Known Limitations
ESP-01 lacks `/api/fs/*` endpoints; attempts to open the LittleFS view for an ESP-01 node will display a 404 notice.

## 17. Implementation Matrix

| Component | Status | Evidence |
|---|---|---|
| ESP8266 | IMPLEMENTED | `/api/fs/*` routes in `web_server.cpp` |
| ESP32 | NOT IMPLEMENTED | Absent from codebase |
| ESP-01 | PARTIAL | Engine active, management routes stripped |
| Central Server | IMPLEMENTED | `littlefsService.js` |
| Dashboard | IMPLEMENTED | LittleFS Manager in `app.js` |

## 18. Future Improvements
Add gzip on-the-fly decompression in microcontroller LittleFS read routines.
