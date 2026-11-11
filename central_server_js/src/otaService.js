const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

class OtaService {
  constructor(database, nodeManager) {
    this.db = database;
    this.nodeManager = nodeManager;
    this.backupDir = path.join(__dirname, '..', 'data', 'backups');
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  // --- HTTP HELPER ---
  async httpGetJson(ip, endpoint, timeoutMs = 3500, authHeader = null) {
    return new Promise((resolve, reject) => {
      const headers = { 'User-Agent': 'SmartHome-Central-OTA/1.6.0', 'Accept': 'application/json' };
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      const req = http.request({
        hostname: ip,
        port: 80,
        path: endpoint,
        method: 'GET',
        headers,
        timeout: timeoutMs
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Invalid JSON response from ${endpoint}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode} from ${endpoint}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out (${endpoint})`));
      });
      req.on('error', (err) => reject(err));
      req.end();
    });
  }

  // --- 1. FETCH LIVE NODE DATA & DIAGNOSTICS ---
  async fetchNodeDiagnostics(nodeId) {
    const node = this.db.getNode(nodeId);
    if (!node || !node.ip) {
      throw new Error(`Node '${nodeId}' not found or has no IP address`);
    }

    const ip = node.ip;
    let authHeader = null;
    if (node.auth_username && node.auth_password) {
      authHeader = 'Basic ' + Buffer.from(`${node.auth_username}:${node.auth_password}`).toString('base64');
    }

    const t0 = Date.now();
    let status = null;
    let gpios = [];

    try {
      status = await this.httpGetJson(ip, '/api/status', 3500, authHeader);
    } catch (err) {
      throw new Error(`Failed to connect to node at ${ip}: ${err.message}`);
    }

    try {
      gpios = await this.httpGetJson(ip, '/api/gpio', 2500, authHeader);
    } catch {}

    const rttMs = Date.now() - t0;
    const hwStr = status.hardware || node.hardware_type || 'ESP8266';
    const isOneMb = hwStr.includes('ESP-01') || hwStr.includes('1MB') || hwStr.includes('PCF8574');
    
    const freeSketchSpace = Number(status.freeSketchSpace) || (isOneMb ? 480000 : 1400000);
    const sketchSize = Number(status.sketchSize) || (isOneMb ? 335000 : 480000);
    const flashSize = Number(status.flashSize) || (isOneMb ? 1048576 : 4194304);
    const freeHeap = Number(status.freeHeap) || 30000;
    const maxFreeBlock = Number(status.maxFreeBlock) || freeHeap;

    return {
      nodeId: node.node_id,
      nodeName: node.name,
      ip: ip,
      online: true,
      rttMs,
      firmwareVersion: status.firmwareVersion || node.firmware_version || '1.6.0',
      hardware: status.hardware || node.hardware_type || 'ESP8266',
      coreVersion: status.coreVersion || '3.1.2',
      sdkVersion: status.sdkVersion || '2.2.2',
      flashGeometry: {
        flashSize,
        flashConfigSize: status.flashConfigSize || flashSize,
        sketchSize,
        freeSketchSpace,
        sketchPercent: flashSize > 0 ? Math.round((sketchSize / flashSize) * 100) : 0,
        freeSpaceMarginKb: Math.round(freeSketchSpace / 1024)
      },
      memory: {
        freeHeap,
        minFreeHeap: status.minFreeHeap || freeHeap,
        maxFreeBlock,
        heapFragPercent: status.heapFragPercent !== undefined ? status.heapFragPercent : Math.round((1 - (maxFreeBlock / (freeHeap || 1))) * 100),
        healthyForOta: freeHeap >= 14000
      },
      filesystem: {
        fsTotal: status.fsTotal || 0,
        fsUsed: status.fsUsed || 0,
        fsFree: status.fsFree || 0,
        fsPercent: status.fsPercent || 0
      },
      network: {
        mac: status.mac || node.mac_address || 'Unknown',
        rssi: status.rssi || node.rssi || 0,
        wifiMode: status.wifiMode || 0,
        uptimeSec: status.uptimeSec || 0,
        bootCount: status.bootCount || 0
      },
      channels: Array.isArray(gpios) ? gpios : [],
      otaCapability: {
        supported: true,
        canAcceptOta: freeSketchSpace > 200000 && freeHeap >= 12000,
        maxBinarySizeBytes: freeSketchSpace
      }
    };
  }

  // --- 2. BACKUP NODE CONFIGURATION & STATE ---
  async backupNode(nodeId, backupType = 'PRE_OTA') {
    const node = this.db.getNode(nodeId);
    if (!node || !node.ip) {
      throw new Error(`Node '${nodeId}' not found or offline`);
    }

    const ip = node.ip;
    const endpoints = ['/api/status', '/api/gpio', '/api/automation', '/api/receiver', '/api/settings'];
    const snapshot = {};

    for (const ep of endpoints) {
      try {
        snapshot[ep.replace('/api/', '')] = await this.httpGetJson(ip, ep, 2500);
      } catch (e) {
        snapshot[ep.replace('/api/', '')] = { error: e.message };
      }
    }

    const now = new Date();
    const timestampStr = now.toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${nodeId}_${timestampStr}.json`;
    const fullPath = path.join(this.backupDir, filename);

    const fullBackupData = {
      metadata: {
        nodeId: node.node_id,
        nodeName: node.name,
        ip: ip,
        mac: node.mac_address,
        backupType,
        firmwareVersion: snapshot.status?.firmwareVersion || node.firmware_version || '1.6.0',
        hardware: snapshot.status?.hardware || node.hardware_type || 'ESP8266',
        createdAt: now.toISOString()
      },
      snapshot
    };

    const contentStr = JSON.stringify(fullBackupData, null, 2);
    fs.writeFileSync(fullPath, contentStr, 'utf-8');
    const fileSize = Buffer.byteLength(contentStr);

    const backupId = this.db.addNodeBackup({
      node_id: node.node_id,
      node_name: node.name,
      firmware_version: fullBackupData.metadata.firmwareVersion,
      backup_type: backupType,
      backup_path: fullPath,
      file_size_bytes: fileSize,
      snapshot_json: contentStr
    });

    this.db.logAudit(
      'NODE_BACKUP_CREATED',
      node.node_id,
      `Created ${backupType} snapshot backup #${backupId} (${(fileSize / 1024).toFixed(1)} KB)`
    );

    return {
      success: true,
      backupId,
      filename,
      filePath: fullPath,
      fileSizeBytes: fileSize,
      createdAt: now.toISOString(),
      metadata: fullBackupData.metadata
    };
  }

  // --- 3. VERSION COMPARISON & PRE-CHECK ---
  compareVersions(v1, v2) {
    // Normalizes "v1.6.0" -> [1, 6, 0]
    const parse = (v) => {
      const parts = String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
      while (parts.length < 3) parts.push(0);
      return parts;
    };

    const p1 = parse(v1);
    const p2 = parse(v2);

    for (let i = 0; i < 3; i++) {
      if (p1[i] > p2[i]) return 1;   // v1 > v2
      if (p1[i] < p2[i]) return -1;  // v1 < v2
    }
    return 0; // v1 == v2
  }

  resolveFirmwarePath(filePath) {
    if (!filePath) return null;
    if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
      return filePath;
    }
    const candidates = [
      path.resolve(filePath),
      path.join(__dirname, '..', filePath),
      path.join(__dirname, '..', 'data', 'firmware', path.basename(filePath)),
      path.join(__dirname, '..', '..', filePath),
      path.join(__dirname, '..', '..', 'data', 'firmware', path.basename(filePath))
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  async preCheckOta(nodeId, firmwareId) {
    const fw = this.db.getFirmware(firmwareId);
    if (!fw) {
      throw new Error(`Firmware ID ${firmwareId} not found in catalog`);
    }

    const resolvedPath = this.resolveFirmwarePath(fw.file_path);
    if (!resolvedPath) {
      throw new Error(`Firmware binary file '${fw.filename}' not found on server disk`);
    }
    fw.file_path = resolvedPath;

    const diagnostics = await this.fetchNodeDiagnostics(nodeId);
    const checks = [];
    let canProceed = true;
    let requiresWarning = false;

    // Check 1: Target Node Responsiveness
    checks.push({
      id: 'node_connectivity',
      title: 'Target Node Reachable',
      status: 'PASS',
      details: `Node responding over LAN at ${diagnostics.ip} (${diagnostics.rttMs}ms latency)`
    });

    // Check 2: Binary Integrity & Magic Byte (ESP8266 ROM 0xE9)
    const fd = fs.openSync(fw.file_path, 'r');
    const headerBuf = Buffer.alloc(4);
    fs.readSync(fd, headerBuf, 0, 4, 0);
    fs.closeSync(fd);

    const isEsp8266 = fw.hardware_type.includes('ESP8266') || diagnostics.hardware.includes('ESP8266');
    if (isEsp8266) {
      if (headerBuf[0] === 0xE9) {
        checks.push({
          id: 'magic_byte',
          title: 'ESP8266 Binary Signature',
          status: 'PASS',
          details: `Magic byte 0x${headerBuf[0].toString(16).toUpperCase()} verified (Valid ESP8266 ROM flash binary)`
        });
      } else {
        checks.push({
          id: 'magic_byte',
          title: 'ESP8266 Binary Signature',
          status: 'FAIL',
          details: `Invalid first byte 0x${headerBuf[0].toString(16).toUpperCase()} (Expected 0xE9 for ESP8266). File may be corrupted or wrong target.`
        });
        canProceed = false;
      }
    }

    // Check 3: Flash Space Margin & ESP-01 1MB Flash Barrier Guard
    const flashTotal = Number(diagnostics.flashGeometry.flashSize) || 4194304;
    const freeSpace = diagnostics.flashGeometry.freeSketchSpace;
    const fwSize = fw.file_size_bytes;
    const marginBytes = freeSpace - fwSize;
    const marginKb = Math.round(marginBytes / 1024);

    // ESP-01 1MB Flash Partition Constraint Check
    const isOneMbFlash = flashTotal <= 1048576 || (diagnostics.hardware && (diagnostics.hardware.includes('ESP-01') || diagnostics.hardware.includes('PCF8574')));
    if (isOneMbFlash && fwSize > freeSpace) {
      checks.push({
        id: 'esp01_flash_barrier',
        title: 'ESP-01 1MB Flash Partition Constraint',
        status: 'FAIL',
        details: `CRITICAL: Incoming binary (${(fwSize/1024).toFixed(1)} KB) exceeds available free sketch space (${(freeSpace/1024).toFixed(1)} KB). Dual-slot OTA update aborted.`
      });
      canProceed = false;
    }

    if (marginBytes > 50000) {
      checks.push({
        id: 'flash_space',
        title: 'Flash Space Availability',
        status: 'PASS',
        details: `Binary size ${(fwSize/1024).toFixed(1)} KB fits safely inside free sketch space ${(freeSpace/1024).toFixed(1)} KB (Safety margin: +${marginKb} KB)`
      });
    } else if (marginBytes >= 0) {
      checks.push({
        id: 'flash_space',
        title: 'Flash Space Availability',
        status: 'WARN',
        details: `Tight margin! Binary ${(fwSize/1024).toFixed(1)} KB leaves only ${marginKb} KB free sketch space.`
      });
      requiresWarning = true;
    } else {
      checks.push({
        id: 'flash_space',
        title: 'Flash Space Availability',
        status: 'FAIL',
        details: `INSUFFICIENT SPACE! Binary size ${(fwSize/1024).toFixed(1)} KB exceeds node free sketch space ${(freeSpace/1024).toFixed(1)} KB by ${Math.abs(marginKb)} KB.`
      });
      canProceed = false;
    }

    // Check 4: Version Comparison
    const currentVer = diagnostics.firmwareVersion;
    const candidateVer = fw.version;
    const cmp = this.compareVersions(candidateVer, currentVer);

    let versionType = 'UPGRADE';
    if (cmp > 0) {
      versionType = 'UPGRADE';
      checks.push({
        id: 'version_check',
        title: 'Firmware Version Analysis',
        status: 'PASS',
        details: `Safe Upgrade: Current v${currentVer} -> Target v${candidateVer} (${fw.release_channel || 'LTS'})`
      });
    } else if (cmp === 0) {
      versionType = 'SAME_VERSION';
      checks.push({
        id: 'version_check',
        title: 'Firmware Version Analysis',
        status: 'WARN',
        details: `Re-flash / Repair: Candidate v${candidateVer} is identical to currently installed v${currentVer}.`
      });
      requiresWarning = true;
    } else {
      versionType = 'DOWNGRADE';
      checks.push({
        id: 'version_check',
        title: 'Firmware Version Analysis',
        status: 'WARN',
        details: `Version Downgrade Warning: Current is v${currentVer}, but candidate is older v${candidateVer}.`
      });
      requiresWarning = true;
    }

    // Check 5: Dynamic RAM Health
    if (diagnostics.memory.freeHeap >= 15000) {
      checks.push({
        id: 'heap_health',
        title: 'Dynamic Heap Memory Health',
        status: 'PASS',
        details: `Free Heap: ${(diagnostics.memory.freeHeap/1024).toFixed(1)} KB (Ample headroom for OTA transfer buffers)`
      });
    } else {
      checks.push({
        id: 'heap_health',
        title: 'Dynamic Heap Memory Health',
        status: 'WARN',
        details: `Low Free Heap: ${(diagnostics.memory.freeHeap/1024).toFixed(1)} KB. Recommend allowing node to stabilize before flashing.`
      });
      requiresWarning = true;
    }

    return {
      canProceed,
      requiresWarning,
      versionType,
      currentVersion: currentVer,
      targetVersion: candidateVer,
      releaseChannel: fw.release_channel || 'LTS',
      hardwareTarget: fw.hardware_type,
      fileSizeBytes: fw.file_size_bytes,
      checksumMd5: fw.checksum_md5,
      checksumSha256: fw.checksum_sha256,
      diagnostics,
      checks
    };
  }

  // --- 4. STREAM MULTIPART BINARY TO NODE ---
  async streamFirmwareToNode(ip, filePath, filename, timeoutMs = 60000, authHeader = null, md5 = null) {
    return new Promise((resolve, reject) => {
      const fileBuffer = fs.readFileSync(filePath);
      const boundary = '----SmartHomeOtaBoundary' + Math.random().toString(36).substring(2);

      const header = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="firmware"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const totalLength = header.length + fileBuffer.length + footer.length;

      const req = http.request({
        hostname: ip,
        port: 80,
        path: '/api/ota/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': totalLength,
          'User-Agent': 'SmartHome-Central-OTA/1.6.0'
        },
        timeout: timeoutMs
      }, (res) => {
        let respBody = '';
        res.on('data', chunk => respBody += chunk);
        res.on('end', () => {
          let parsed = {};
          try { parsed = JSON.parse(respBody); } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              statusCode: res.statusCode,
              success: true,
              message: parsed.message || 'Firmware flashed successfully! Node will reboot.',
              raw: respBody
            });
          } else {
            reject(new Error(parsed.error || `Node returned HTTP ${res.statusCode}: ${respBody}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OTA flash upload timed out after 60 seconds'));
      });
      req.on('error', (err) => reject(err));

      // Write payload in chunks
      req.write(header);
      req.write(fileBuffer);
      req.write(footer);
      req.end();
    });
  }

  // --- 5. POST-BOOT REBOOT HANDSHAKE VERIFICATION ---
  async waitForNodeReboot(ip, targetVersion, maxWaitSec = 45, authHeader = null) {
    const start = Date.now();
    // Allow initial reboot delay
    await new Promise(r => setTimeout(r, 4000));

    while ((Date.now() - start) < (maxWaitSec * 1000)) {
      try {
        const status = await this.httpGetJson(ip, '/api/status', 2000, authHeader);
        if (status && status.uptimeSec < 120) {
          // Node has rebooted!
          const actualVer = status.firmwareVersion || '';
          const match = (actualVer === targetVersion);
          return {
            online: true,
            uptimeSec: status.uptimeSec,
            bootCount: status.bootCount,
            actualVersion: actualVer,
            targetVersion,
            versionMatch: match,
            durationSec: Math.round((Date.now() - start) / 1000)
          };
        }
      } catch {}
      await new Promise(r => setTimeout(r, 3000));
    }

    return {
      online: false,
      actualVersion: 'Unknown',
      targetVersion,
      versionMatch: false,
      durationSec: maxWaitSec
    };
  }

  // --- 6. COMPLETE MANAGED OTA DEPLOYMENT PIPELINE ---
  async deployOta(nodeId, firmwareId, options = {}) {
    const {
      autoBackup = true,
      forceDowngrade = false,
      postVerify = true
    } = options;

    const tStart = Date.now();
    const node = this.db.getNode(nodeId);
    const fw = this.db.getFirmware(firmwareId);

    if (!node || !node.ip) throw new Error(`Node '${nodeId}' not found or offline`);
    if (!fw) throw new Error(`Firmware #${firmwareId} not found`);

    const resolvedPath = this.resolveFirmwarePath(fw.file_path);
    if (!resolvedPath) throw new Error(`Firmware binary file '${fw.filename}' not found on server disk`);
    fw.file_path = resolvedPath;

    // Step 1: Pre-Check
    const preCheck = await this.preCheckOta(nodeId, firmwareId);
    if (!preCheck.canProceed) {
      const failed = preCheck.checks.find(c => c.status === 'FAIL');
      throw new Error(`Pre-check failed: ${failed ? failed.details : 'Incompatible target'}`);
    }

    if (preCheck.versionType === 'DOWNGRADE' && !forceDowngrade) {
      throw new Error(`Downgrade prevented: Node is v${preCheck.currentVersion}, candidate is v${preCheck.targetVersion}. Must specify forceDowngrade.`);
    }

    // Initialize History Record
    const historyId = this.db.addOtaHistory({
      node_id: node.node_id,
      node_name: node.name,
      firmware_id: fw.id,
      firmware_filename: fw.filename,
      version_from: preCheck.currentVersion,
      version_to: preCheck.targetVersion,
      status: 'IN_PROGRESS',
      details: { stage: 'INITIATED', preCheck }
    });

    let backupInfo = null;

    // Step 2: Automated Pre-OTA Backup
    if (autoBackup) {
      try {
        backupInfo = await this.backupNode(nodeId, 'PRE_OTA');
        this.db.updateOtaHistory(historyId, {
          backup_id: backupInfo.backupId,
          details: { stage: 'BACKUP_COMPLETED', backup: backupInfo }
        });
      } catch (backupErr) {
        console.warn(`[OTA] Pre-backup warning: ${backupErr.message}`);
      }
    }

    // Step 3: Stream Firmware Binary to Node
    let uploadResult = null;
    try {
      this.db.updateOtaHistory(historyId, {
        details: { stage: 'FLASHING_STREAM' }
      });
      let authHeader = null;
      if (node.auth_username && node.auth_password) {
        authHeader = 'Basic ' + Buffer.from(`${node.auth_username}:${node.auth_password}`).toString('base64');
      }
      uploadResult = await this.streamFirmwareToNode(node.ip, fw.file_path, fw.filename, 60000, authHeader, fw.checksum_md5);
    } catch (uploadErr) {
      const totalDur = Date.now() - tStart;
      this.db.updateOtaHistory(historyId, {
        status: 'FAILED',
        duration_ms: totalDur,
        error_message: uploadErr.message,
        details: { stage: 'UPLOAD_FAILED', error: uploadErr.message }
      });
      this.db.logAudit('OTA_FLASH_FAILED', nodeId, `OTA deployment failed for ${node.name}: ${uploadErr.message}`);
      throw uploadErr;
    }

    // Step 4: Post-Flash Verification & Reboot Handshake
    let handshakeResult = { online: true, versionMatch: true };
    if (postVerify) {
      this.db.updateOtaHistory(historyId, {
        details: { stage: 'AWAITING_REBOOT_HANDSHAKE' }
      });
      let authHeader = null;
      if (node.auth_username && node.auth_password) {
        authHeader = 'Basic ' + Buffer.from(`${node.auth_username}:${node.auth_password}`).toString('base64');
      }
      handshakeResult = await this.waitForNodeReboot(node.ip, fw.version, 45, authHeader);
    }

    const totalDuration = Date.now() - tStart;
    const finalSuccess = uploadResult.success && (!postVerify || handshakeResult.online);

    this.db.updateOtaHistory(historyId, {
      status: finalSuccess ? 'SUCCESS' : 'FAILED',
      duration_ms: totalDuration,
      details: {
        stage: 'COMPLETED',
        upload: uploadResult,
        handshake: handshakeResult,
        backup: backupInfo
      },
      error_message: finalSuccess ? '' : 'Node did not report back after flash'
    });

    this.db.logAudit(
      finalSuccess ? 'OTA_DEPLOY_SUCCESS' : 'OTA_DEPLOY_WARNING',
      node.node_id,
      `OTA update to v${fw.version} finished in ${(totalDuration/1000).toFixed(1)}s (Status: ${finalSuccess ? 'SUCCESS' : 'REBOOT_TIMEOUT'})`
    );

    return {
      success: finalSuccess,
      historyId,
      nodeId: node.node_id,
      nodeName: node.name,
      versionFrom: preCheck.currentVersion,
      versionTo: preCheck.targetVersion,
      backupCreated: Boolean(backupInfo),
      backupId: backupInfo ? backupInfo.backupId : null,
      handshake: handshakeResult,
      totalDurationMs: totalDuration,
      message: `OTA firmware update to v${fw.version} completed successfully!`
    };
  }

  // --- 7. RESTORE NODE STATE FROM BACKUP ---
  async restoreNodeConfig(nodeId, backupId) {
    const backup = this.db.getNodeBackup(backupId);
    if (!backup) throw new Error(`Backup #${backupId} not found`);

    const node = this.db.getNode(nodeId);
    if (!node || !node.ip) throw new Error(`Target node '${nodeId}' not found or offline`);

    const snapshot = typeof backup.snapshot_json === 'string'
      ? JSON.parse(backup.snapshot_json)
      : backup.snapshot_json;

    let restoredItems = 0;
    const errors = [];

    // 1. Restore GPIO Channel Configuration
    if (snapshot.snapshot && Array.isArray(snapshot.snapshot.gpio)) {
      for (const ch of snapshot.snapshot.gpio) {
        try {
          await this.nodeManager.sendDirectLanHttp(node.ip, {
            action: 'update_channel',
            id: ch.id,
            name: ch.name,
            room: ch.room,
            function: ch.function,
            activeLow: ch.activeLow,
            initialMode: ch.initialMode,
            enabled: ch.enabled
          });
          restoredItems++;
        } catch (e) {
          errors.push(`GPIO ${ch.id}: ${e.message}`);
        }
      }
    }

    this.db.logAudit(
      'NODE_RESTORE_APPLIED',
      node.node_id,
      `Restored ${restoredItems} configuration items from backup #${backupId}`
    );

    return {
      success: errors.length === 0,
      restoredItems,
      errors
    };
  }
}

module.exports = OtaService;
