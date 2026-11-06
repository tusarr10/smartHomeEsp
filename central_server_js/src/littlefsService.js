const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class LittlefsService {
  constructor(database, nodeManager) {
    this.db = database;
    this.nodeManager = nodeManager;
    this.backupDir = path.join(__dirname, '..', 'data', 'fs_backups');
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  sanitizePath(remotePath) {
    if (!remotePath || typeof remotePath !== 'string') {
      throw new Error('File path is required');
    }
    const clean = remotePath.replace(/\\/g, '/').trim();
    if (clean.includes('..')) {
      throw new Error('Path traversal is prohibited');
    }
    return clean.startsWith('/') ? clean : `/${clean}`;
  }

  async getNodeIp(nodeId) {
    const node = this.db.getNode(nodeId);
    if (!node) {
      throw new Error(`Node '${nodeId}' not found in registry`);
    }
    const ip = node.ip || node.ip_address;
    if (!ip || !ip.trim()) {
      throw new Error(`Node '${nodeId}' has no registered IP address`);
    }

    const user = node.auth_username || this.nodeManager?.config?.node_auth?.username || 'admin';
    const pass = node.auth_password || this.nodeManager?.config?.node_auth?.password || 'admin';
    const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

    return { node, ip: ip.trim(), authHeader };
  }

  // === 1. LIST FILESYSTEM ===
  async fetchFilesystemList(nodeId) {
    const { node, ip, authHeader } = await this.getNodeIp(nodeId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(`http://${ip}/api/fs/list`, {
        signal: controller.signal,
        headers: {
          'Authorization': authHeader,
          'User-Agent': 'SmartHome-Central-LittleFS/1.6.0'
        }
      });
      clearTimeout(timeout);

      // Handle architectures without LittleFS manager (e.g. ESP-01 1MB minimal partition)
      if (res.status === 404) {
        return {
          success: false,
          unsupported: true,
          nodeId,
          nodeName: node.name,
          ip,
          hardware: node.hardware_type || node.hardware || 'ESP8266',
          error: `LittleFS filesystem manager is not supported on '${node.name}' (${node.hardware_type || 'ESP8266 ESP-01 1MB'}). This microcontroller uses a minimal partition scheme without a LittleFS web file manager.`
        };
      }

      if (!res.ok) {
        throw new Error(`Node returned HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const totalBytes = Number(data.totalBytes) || 0;
      const usedBytes = Number(data.usedBytes) || 0;
      const freeBytes = Number(data.freeBytes) || (totalBytes - usedBytes);
      const rawFiles = Array.isArray(data.files) ? data.files : [];

      const normalizedFiles = rawFiles.map(f => ({
        path: this.sanitizePath(f.name || f.path || f.filename),
        name: path.basename(f.name || f.path || f.filename),
        size: Number(f.size) || 0
      }));

      // Synchronize database records
      this.db.syncFilesystemFiles(nodeId, normalizedFiles);

      // Update node capabilities & metrics
      this.db.upsertDeviceCapabilities(nodeId, {
        littlefs_total_bytes: totalBytes,
        littlefs_used_bytes: usedBytes,
        littlefs_free_bytes: freeBytes,
        littlefs_supported: 1
      });

      return {
        success: true,
        nodeId,
        nodeName: node.name,
        ip,
        totalBytes,
        usedBytes,
        freeBytes,
        usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
        files: normalizedFiles
      };
    } catch (err) {
      clearTimeout(timeout);
      throw new Error(`Failed to list filesystem on node '${nodeId}' (${ip}): ${err.message}`);
    }
  }

  // === 2. DOWNLOAD FILE ===
  async downloadFileFromNode(nodeId, remotePath) {
    const cleanPath = this.sanitizePath(remotePath);
    const { ip, authHeader } = await this.getNodeIp(nodeId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const url = `http://${ip}/api/fs/download?path=${encodeURIComponent(cleanPath)}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Authorization': authHeader,
          'User-Agent': 'SmartHome-Central-LittleFS/1.6.0'
        }
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Node returned HTTP ${res.status}: ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = res.headers.get('content-type') || 'application/octet-stream';

      return {
        filename: path.basename(cleanPath),
        path: cleanPath,
        contentType,
        buffer,
        size: buffer.length
      };
    } catch (err) {
      clearTimeout(timeout);
      throw new Error(`Failed to download '${cleanPath}' from node '${nodeId}': ${err.message}`);
    }
  }

  // === 3. UPLOAD FILE ===
  async uploadFileToNode(nodeId, fileBuffer, originalFilename, targetDirectory = '/') {
    const { node, ip, authHeader } = await this.getNodeIp(nodeId);
    const safeName = path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const targetPath = this.sanitizePath(path.join(targetDirectory, safeName));

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
    formData.append('file', blob, targetPath);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(`http://${ip}/api/fs/upload`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader
        },
        body: formData,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Node returned HTTP ${res.status}: ${text || res.statusText}`);
      }

      let respData = {};
      try {
        respData = await res.json();
      } catch {
        respData = { message: 'Upload completed' };
      }

      this.db.logAudit('LITTLEFS_UPLOAD', nodeId, `Uploaded file '${targetPath}' (${fileBuffer.length} bytes) to node '${node.name}'`);

      // Refresh file catalog
      await this.fetchFilesystemList(nodeId).catch(() => {});

      return {
        success: true,
        path: targetPath,
        size: fileBuffer.length,
        message: respData.message || 'File uploaded successfully'
      };
    } catch (err) {
      clearTimeout(timeout);
      throw new Error(`Failed to upload file to node '${nodeId}': ${err.message}`);
    }
  }

  // === 4. DELETE FILE ===
  async deleteFileOnNode(nodeId, remotePath) {
    const cleanPath = this.sanitizePath(remotePath);
    const { node, ip, authHeader } = await this.getNodeIp(nodeId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(`http://${ip}/api/fs/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify({ path: cleanPath }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Node returned HTTP ${res.status}: ${text || res.statusText}`);
      }

      this.db.deleteFilesystemFileRecord(nodeId, cleanPath);
      this.db.logAudit('LITTLEFS_DELETE', nodeId, `Deleted file '${cleanPath}' from node '${node.name}'`);

      // Refresh list to update free space
      await this.fetchFilesystemList(nodeId).catch(() => {});

      return {
        success: true,
        path: cleanPath,
        message: `File '${cleanPath}' deleted successfully`
      };
    } catch (err) {
      clearTimeout(timeout);
      throw new Error(`Failed to delete '${cleanPath}' on node '${nodeId}': ${err.message}`);
    }
  }

  // === 5. RENAME FILE ===
  async renameFileOnNode(nodeId, oldPath, newPath) {
    const cleanOld = this.sanitizePath(oldPath);
    const cleanNew = this.sanitizePath(newPath);
    const { node, ip, authHeader } = await this.getNodeIp(nodeId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(`http://${ip}/api/fs/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify({ oldPath: cleanOld, newPath: cleanNew }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Node returned HTTP ${res.status}: ${text || res.statusText}`);
      }

      this.db.deleteFilesystemFileRecord(nodeId, cleanOld);
      this.db.logAudit('LITTLEFS_RENAME', nodeId, `Renamed file from '${cleanOld}' to '${cleanNew}' on node '${node.name}'`);

      await this.fetchFilesystemList(nodeId).catch(() => {});

      return {
        success: true,
        oldPath: cleanOld,
        newPath: cleanNew,
        message: `Renamed '${cleanOld}' to '${cleanNew}'`
      };
    } catch (err) {
      clearTimeout(timeout);
      throw new Error(`Failed to rename file on node '${nodeId}': ${err.message}`);
    }
  }

  // === 6. DIRECT FILE CONTENT SAVE (HEAP SAFE < 5KB) ===
  async saveFileContent(nodeId, filePath, contentString) {
    const cleanPath = this.sanitizePath(filePath);
    const contentBuffer = Buffer.from(contentString, 'utf-8');
    const MAX_DIRECT_EDIT_BYTES = 5 * 1024; // Strict 5 KB safe heap buffer boundary

    if (contentBuffer.length >= MAX_DIRECT_EDIT_BYTES) {
      throw new Error(`File size (${(contentBuffer.length / 1024).toFixed(2)} KB) exceeds the 5 KB safe threshold for direct in-browser editing to protect ESP8266 heap memory. Use standard file upload.`);
    }

    if (cleanPath.endsWith('.json')) {
      try {
        JSON.parse(contentString);
      } catch (err) {
        throw new Error(`Invalid JSON syntax: ${err.message}`);
      }
    }

    const dir = path.dirname(cleanPath);
    const filename = path.basename(cleanPath);

    await this.uploadFileToNode(nodeId, contentBuffer, filename, dir);

    // Auto-reconcile database if this was a known config file
    if (cleanPath === '/config/gpio.json') {
      try {
        const channels = JSON.parse(contentString);
        if (Array.isArray(channels)) {
          this.db.updateNodeChannels(nodeId, channels);
        }
      } catch {}
    }

    // Trigger LittleFS sync
    this.syncLittlefsWithMaster(nodeId).catch(() => {});

    return {
      success: true,
      path: cleanPath,
      size: contentBuffer.length,
      message: `File '${cleanPath}' successfully saved to LittleFS`
    };
  }

  // === 6. CREATE FULL FILESYSTEM BACKUP ===
  async createFilesystemBackup(nodeId, backupType = 'MANUAL') {
    const listResult = await this.fetchFilesystemList(nodeId);
    if (!listResult.success) {
      throw new Error(listResult.error || 'Failed to list files on node');
    }

    const filesToBackup = listResult.files || [];
    const fileBackups = [];
    let totalBytes = 0;

    for (const f of filesToBackup) {
      try {
        const downloaded = await this.downloadFileFromNode(nodeId, f.path);
        const sha256 = crypto.createHash('sha256').update(downloaded.buffer).digest('hex');
        totalBytes += downloaded.size;

        fileBackups.push({
          path: f.path,
          size: downloaded.size,
          sha256,
          contentBase64: downloaded.buffer.toString('base64')
        });
      } catch (err) {
        console.warn(`[LittleFS Backup] Warning: Could not download ${f.path}:`, err.message);
      }
    }

    const manifest = {
      nodeId,
      nodeName: listResult.nodeName,
      backupType,
      createdAt: new Date().toISOString(),
      metrics: {
        totalBytes: listResult.totalBytes,
        usedBytes: listResult.usedBytes,
        freeBytes: listResult.freeBytes,
        backedUpFilesCount: fileBackups.length,
        backedUpTotalBytes: totalBytes
      },
      files: fileBackups
    };

    const manifestStr = JSON.stringify(manifest, null, 2);
    const overallChecksum = crypto.createHash('sha256').update(manifestStr).digest('hex');

    const filename = `fs_backup_${nodeId}_${Date.now()}.json`;
    const fullPath = path.join(this.backupDir, filename);
    fs.writeFileSync(fullPath, manifestStr, 'utf-8');

    const backupId = this.db.addFilesystemBackup({
      node_id: nodeId,
      backup_type: backupType,
      backup_path: fullPath,
      file_count: fileBackups.length,
      total_bytes: totalBytes,
      sha256_checksum: overallChecksum,
      snapshot_manifest: manifest
    });

    return {
      success: true,
      backupId,
      filename,
      filePath: fullPath,
      fileCount: fileBackups.length,
      totalBytes,
      sha256: overallChecksum,
      createdAt: manifest.createdAt
    };
  }

  // === 7. LIVE SYNC: BIDIRECTIONAL LITTLEFS RECONCILIATION ===
  async syncLittlefsWithMaster(nodeId) {
    const listResult = await this.fetchFilesystemList(nodeId);
    if (!listResult.success) {
      return listResult;
    }

    const files = listResult.files || [];
    const reconciledConfigs = [];

    // Reconcile /config/gpio.json if present
    const gpioFile = files.find(f => f.path === '/config/gpio.json');
    if (gpioFile) {
      try {
        const dl = await this.downloadFileFromNode(nodeId, '/config/gpio.json');
        const text = dl.buffer.toString('utf-8');
        const channels = JSON.parse(text);
        if (Array.isArray(channels)) {
          this.db.updateNodeChannels(nodeId, channels);
          reconciledConfigs.push('/config/gpio.json');
        }
      } catch (err) {
        console.warn(`[LittleFS Live Sync] Warning reconciling gpio.json:`, err.message);
      }
    }

    // Reconcile /config/receiver.json if present
    const receiverFile = files.find(f => f.path === '/config/receiver.json');
    if (receiverFile) {
      try {
        const dl = await this.downloadFileFromNode(nodeId, '/config/receiver.json');
        const text = dl.buffer.toString('utf-8');
        const rcfg = JSON.parse(text);
        if (rcfg && typeof rcfg === 'object') {
          reconciledConfigs.push('/config/receiver.json');
        }
      } catch (err) {
        console.warn(`[LittleFS Live Sync] Warning reconciling receiver.json:`, err.message);
      }
    }

    // Reconcile /config/system.json if present
    const sysFile = files.find(f => f.path === '/config/system.json');
    if (sysFile) {
      try {
        const dl = await this.downloadFileFromNode(nodeId, '/config/system.json');
        const text = dl.buffer.toString('utf-8');
        const sysCfg = JSON.parse(text);
        if (sysCfg && sysCfg.deviceName) {
          reconciledConfigs.push('/config/system.json');
        }
      } catch (err) {
        console.warn(`[LittleFS Live Sync] Warning reconciling system.json:`, err.message);
      }
    }

    // Notify connected clients via WebSocket
    if (this.nodeManager?.broadcast) {
      this.nodeManager.broadcast('littlefs_synced', {
        node_id: nodeId,
        node_name: listResult.nodeName,
        files_count: files.length,
        used_bytes: listResult.usedBytes,
        total_bytes: listResult.totalBytes,
        reconciled: reconciledConfigs,
        synced_at: new Date().toISOString()
      });
    }

    this.db.logAudit('LITTLEFS_LIVE_SYNC', nodeId, `Live synchronized LittleFS partition: ${files.length} files cataloged, ${reconciledConfigs.length} config maps reconciled.`);

    return {
      success: true,
      nodeId,
      nodeName: listResult.nodeName,
      ip: listResult.ip,
      totalBytes: listResult.totalBytes,
      usedBytes: listResult.usedBytes,
      freeBytes: listResult.freeBytes,
      usedPercent: listResult.usedPercent,
      filesCount: files.length,
      files,
      reconciledConfigs,
      syncedAt: new Date().toISOString()
    };
  }
}

module.exports = LittlefsService;
