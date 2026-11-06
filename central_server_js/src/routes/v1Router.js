const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const multer = require('multer');

const {
  authenticateUser,
  requirePermission,
  verifyDeviceScope,
  verifyPassword
} = require('../auth');
const OtaService = require('../otaService');
const LittlefsService = require('../littlefsService');
const ConfigSyncService = require('../configSyncService');
const DiscoveryService = require('../discoveryService');

function createV1Router(nodeManager, db) {
  const router = express.Router();
  const otaService = new OtaService(db, nodeManager);
  const littlefsService = new LittlefsService(db, nodeManager);
  const configSyncService = new ConfigSyncService(db, nodeManager);
  const discoveryService = new DiscoveryService(db, nodeManager);

  // Configure Multer for Firmware Uploads (Disk Storage)
  const firmwareDir = path.join(__dirname, '..', '..', 'data', 'firmware');
  if (!fs.existsSync(firmwareDir)) {
    fs.mkdirSync(firmwareDir, { recursive: true });
  }

  const fwStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, firmwareDir),
    filename: (req, file, cb) => {
      const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${sanitized}`);
    }
  });
  const fwUpload = multer({ storage: fwStorage });

  // Configure Multer for LittleFS Uploads (In-Memory Buffer for streaming to node)
  const fsUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  });

  // ==========================================
  // === AUTHENTICATION & SESSION ROUTES ===
  // ==========================================

  router.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    const user = db.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, error: 'Account is deactivated. Contact an administrator.' });
    }

    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    const clientIp = req.ip || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const session = db.createSession(user.id, clientIp, userAgent);

    const roles = db.getUserRoles(user.id);
    const permissions = db.getUserPermissions(user.id);
    const scopes = db.getUserScopes(user.id);

    db.logAudit('USER_LOGIN', 'System', `User '${user.username}' signed in successfully`);
    res.setHeader('Set-Cookie', `session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);

    res.json({
      success: true,
      token: session.token,
      expires_at: session.expires_at,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        is_superuser: Boolean(user.is_superuser),
        roles,
        permissions,
        scopes
      }
    });
  });

  router.get('/auth/me', authenticateUser(db), (req, res) => {
    res.json({
      success: true,
      user: req.user
    });
  });

  router.post('/auth/logout', authenticateUser(db), (req, res) => {
    if (req.sessionToken) {
      db.revokeSession(req.sessionToken);
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });

  router.post('/auth/change-password', authenticateUser(db), (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
    }

    const userWithHash = db.getUserByUsername(req.user.username);
    if (!verifyPassword(oldPassword, userWithHash.password_hash)) {
      return res.status(400).json({ success: false, error: 'Current password does not match' });
    }

    db.setUserPassword(req.user.id, newPassword);
    res.json({ success: true, message: 'Password changed successfully. Please log in again.' });
  });

  // ==========================================
  // === USER & RBAC ADMINISTRATION ROUTES ===
  // ==========================================

  router.get('/admin/users', requirePermission(db, 'users:manage'), (req, res) => {
    const users = db.getUsers();
    res.json({ success: true, users });
  });

  router.post('/admin/users', requirePermission(db, 'users:manage'), (req, res) => {
    const { username, password, full_name, email, is_superuser, role_names, scope_ids } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    try {
      const newUser = db.createUser({
        username,
        password,
        full_name,
        email,
        is_superuser: Boolean(is_superuser),
        role_names: Array.isArray(role_names) ? role_names : ['OPERATOR'],
        scope_ids: Array.isArray(scope_ids) ? scope_ids : []
      });
      res.json({ success: true, user: newUser });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.put('/admin/users/:id', requirePermission(db, 'users:manage'), (req, res) => {
    try {
      const updated = db.updateUser(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      res.json({ success: true, user: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/admin/users/:id/password', requirePermission(db, 'users:manage'), (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    try {
      db.setUserPassword(req.params.id, newPassword);
      res.json({ success: true, message: 'User password reset successfully' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/admin/users/:id', requirePermission(db, 'users:manage'), (req, res) => {
    try {
      const ok = db.deleteUser(req.params.id);
      if (ok) {
        res.json({ success: true, message: 'User deleted successfully' });
      } else {
        res.status(404).json({ success: false, error: 'User not found' });
      }
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/admin/users/:id/sessions', requirePermission(db, 'users:manage'), (req, res) => {
    const sessions = db.getUserSessions(req.params.id);
    res.json({ success: true, sessions });
  });

  router.post('/admin/users/:id/revoke-sessions', requirePermission(db, 'users:manage'), (req, res) => {
    db.revokeUserSessions(req.params.id);
    res.json({ success: true, message: 'All active sessions for this user have been revoked' });
  });

  router.get('/admin/roles', requirePermission(db, 'roles:manage'), (req, res) => {
    res.json({ success: true, roles: db.getRoles() });
  });

  router.get('/admin/permissions', requirePermission(db, 'roles:manage'), (req, res) => {
    res.json({ success: true, permissions: db.getPermissions() });
  });

  router.get('/admin/scopes', requirePermission(db, 'scopes:manage'), (req, res) => {
    res.json({ success: true, scopes: db.getScopes() });
  });

  router.post('/admin/scopes', requirePermission(db, 'scopes:manage'), (req, res) => {
    const { scope_type, scope_identifier, name, description } = req.body;
    if (!scope_type || !scope_identifier || !name) {
      return res.status(400).json({ success: false, error: 'scope_type, scope_identifier and name are required' });
    }
    try {
      const id = db.createScope({ scope_type, scope_identifier, name, description });
      res.json({ success: true, id, message: 'Scope created successfully' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/admin/scopes/:id', requirePermission(db, 'scopes:manage'), (req, res) => {
    try {
      const ok = db.deleteScope(req.params.id);
      if (ok) {
        res.json({ success: true, message: 'Scope deleted successfully' });
      } else {
        res.status(404).json({ success: false, error: 'Scope not found' });
      }
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // === SYSTEM OVERVIEW & FLEET NODES ===
  // ==========================================

  router.get('/system/overview', (req, res) => {
    res.json(nodeManager.getOverview());
  });

  router.get('/nodes', authenticateUser(db), (req, res) => {
    const { room, status, hardware, search } = req.query;
    let nodes = db.getNodes({ room, status, hardware, search });

    // Enforce hierarchical scope-based filtering for non-superusers
    if (req.user && !req.user.is_superuser) {
      nodes = nodes.filter(node => verifyDeviceScope(req.user, node));
    }
    res.json(nodes);
  });

  // Add / Register Node
  const addNodeHandler = async (req, res) => {
    const ip = (req.body.ip || req.body.ip_address || '').trim();
    const name = (req.body.name || req.body.node_name || '').trim();
    const room = req.body.room || 'General';

    if (!ip) {
      return res.status(400).json({ success: false, error: 'IP address is required to probe and add a node' });
    }

    const probeNode = () => new Promise((resolve) => {
      const clientReq = http.get(`http://${ip}/api/status`, { timeout: 3000 }, (targetRes) => {
        let raw = '';
        targetRes.on('data', chunk => raw += chunk);
        targetRes.on('end', () => {
          try {
            resolve({ ok: true, data: JSON.parse(raw) });
          } catch {
            resolve({ ok: false, error: 'Invalid JSON response from node' });
          }
        });
      });
      clientReq.on('error', (err) => resolve({ ok: false, error: err.message }));
      clientReq.on('timeout', () => { clientReq.destroy(); resolve({ ok: false, error: 'Connection timed out' }); });
    });

    const probeGpios = () => new Promise((resolve) => {
      const clientReq = http.get(`http://${ip}/api/gpio`, { timeout: 3000 }, (targetRes) => {
        let raw = '';
        targetRes.on('data', chunk => raw += chunk);
        targetRes.on('end', () => {
          try {
            resolve({ ok: true, data: JSON.parse(raw) });
          } catch {
            resolve({ ok: false, data: [] });
          }
        });
      });
      clientReq.on('error', () => resolve({ ok: false, data: [] }));
      clientReq.on('timeout', () => { clientReq.destroy(); resolve({ ok: false, data: [] }); });
    });

    const probe = await probeNode();
    const gpios = await probeGpios();

    let nodeId = `NODE-${ip.replace(/\./g, '')}`;
    let nodeName = name || `SmartHome-${ip}`;
    let hw = 'ESP8266';
    let fw = '1.6.0';
    let mac = '';
    let rssi = 0;
    let uptime = 0;
    let heap = 0;
    let channels = Array.isArray(gpios.data) ? gpios.data : [];

    if (probe.ok && probe.data) {
      const d = probe.data;
      if (d.mac) {
        mac = d.mac;
        nodeId = `NODE-${d.mac.replace(/:/g, '')}`;
      }
      if (d.deviceName && !name) nodeName = d.deviceName;
      if (d.hardware) hw = d.hardware;
      if (d.firmwareVersion) fw = d.firmwareVersion;
      if (d.rssi) rssi = d.rssi;
      if (d.uptimeSec) uptime = d.uptimeSec;
      if (d.freeHeap) heap = d.freeHeap;
    }

    const nodePayload = {
      nodeId,
      nodeName,
      hardware: hw,
      firmwareVersion: fw,
      ip,
      mac,
      rssi,
      uptimeSec: uptime,
      freeHeap: heap,
      room,
      channels
    };

    await nodeManager.processTelemetry(nodePayload, ip, 'MANUAL_ADD');

    // Save per-node credentials if provided
    const authUsername = (req.body.auth_username || req.body.username || 'admin').trim();
    const authPassword = req.body.auth_password || req.body.password || 'admin';
    db.updateNodeSettings(nodeId, {
      auth_username: authUsername,
      auth_password: authPassword
    });

    db.logAudit('NODE_ADDED', nodeId, `Manually registered node '${nodeName}' (${ip}) into fleet [Auth User: ${authUsername}]`);
    nodeManager.broadcast('node_added', { nodeId, name: nodeName, ip });

    res.json({
      success: true,
      message: `Node '${nodeName}' successfully registered and probed!`,
      node: db.getNode(nodeId)
    });
  };

  router.post('/nodes', requirePermission(db, 'devices:manage'), addNodeHandler);
  router.post('/nodes/add', requirePermission(db, 'devices:manage'), addNodeHandler);

  router.get('/nodes/:nodeId', authenticateUser(db), (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    if (!verifyDeviceScope(req.user, node)) {
      return res.status(403).json({ error: 'Forbidden: Node is outside your assigned scope' });
    }
    const history = db.getTelemetryHistory(req.params.nodeId, 20);
    const capabilities = db.getDeviceCapabilities(req.params.nodeId);
    res.json({ node, capabilities, history });
  });

  router.delete('/nodes/:nodeId', requirePermission(db, 'devices:delete'), (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) {
      return res.status(404).json({ success: false, error: 'Node not found' });
    }
    if (!verifyDeviceScope(req.user, node)) {
      return res.status(403).json({ success: false, error: 'Forbidden: Device outside assigned scope' });
    }
    const ok = db.deleteNode(req.params.nodeId);
    if (ok) {
      nodeManager.broadcast('node_deleted', { nodeId: req.params.nodeId });
      res.json({ success: true, nodeId: req.params.nodeId });
    } else {
      res.status(404).json({ success: false, error: 'Node not found' });
    }
  });

  // === LOCAL NETWORK DISCOVERY ROUTES ===
  router.get('/nodes/discovery/subnets', authenticateUser(db), (req, res) => {
    res.json({
      success: true,
      subnets: discoveryService.getLocalSubnets(),
      primarySubnet: discoveryService.getPrimarySubnet()
    });
  });

  router.post('/nodes/discovery/scan', requirePermission(db, 'devices:manage'), async (req, res) => {
    try {
      const results = await discoveryService.scanNetwork(req.body);
      res.json(results);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // === PER-NODE SETTINGS & AUTHENTICATION ===
  const updateSettingsHandler = (req, res) => {
    const { nodeId } = req.params;
    const existing = db.getNode(nodeId);
    if (!existing) {
      return res.status(404).json({ success: false, error: `Node '${nodeId}' not found` });
    }

    const updated = db.updateNodeSettings(nodeId, req.body);
    db.logAudit('NODE_CONFIG_UPDATE', nodeId, `Updated configuration settings for node '${updated.name}'`);
    nodeManager.broadcast('node_status', {
      node_id: nodeId,
      nodeId: nodeId,
      name: updated.name,
      is_online: updated.is_online,
      status: updated.status
    });

    res.json({
      success: true,
      message: `Node '${updated.name}' settings saved successfully`,
      node: updated
    });
  };

  router.put('/nodes/:nodeId/settings', requirePermission(db, 'devices:manage'), updateSettingsHandler);
  router.put('/nodes/:nodeId', requirePermission(db, 'devices:manage'), updateSettingsHandler);
  router.post('/nodes/:nodeId/settings', requirePermission(db, 'devices:manage'), updateSettingsHandler);

  // Test per-node credentials against live hardware
  router.post('/nodes/:nodeId/test-auth', requirePermission(db, 'devices:manage'), async (req, res) => {
    const { nodeId } = req.params;
    const node = db.getNode(nodeId);
    if (!node || !node.ip) {
      return res.status(404).json({ success: false, error: 'Node not found or has no IP address' });
    }

    const user = (req.body.auth_username || node.auth_username || 'admin').trim();
    const pass = req.body.auth_password !== undefined ? req.body.auth_password : (node.auth_password || 'admin');

    const t0 = Date.now();
    const headers = {
      'Accept': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
    };

    try {
      const response = await fetch(`http://${node.ip}/api/status`, {
        headers,
        signal: AbortSignal.timeout(3000)
      });
      const latencyMs = Date.now() - t0;

      if (response.status === 401) {
        return res.json({
          success: false,
          statusCode: 401,
          latencyMs,
          message: 'Authentication failed: Invalid User ID or Password on node'
        });
      }

      if (response.ok) {
        let nodeData = {};
        try { nodeData = await response.json(); } catch {}
        return res.json({
          success: true,
          statusCode: response.status,
          latencyMs,
          message: `Successfully authenticated with ${node.name} (${node.ip})!`,
          nodeData
        });
      }

      return res.json({
        success: false,
        statusCode: response.status,
        latencyMs,
        message: `Node responded with HTTP status ${response.status}: ${response.statusText}`
      });
    } catch (err) {
      return res.json({
        success: false,
        error: err.message,
        message: `Failed to connect to node at http://${node.ip}: ${err.message}`
      });
    }
  });

  // Push full configuration to node
  router.post('/nodes/:nodeId/push-config', requirePermission(db, 'devices:manage'), async (req, res) => {
    try {
      const result = await nodeManager.pushNodeConfig(req.params.nodeId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // === PER-NODE RELAY CONFIGURATION ===
  router.post('/nodes/:nodeId/relays', requirePermission(db, 'devices:manage'), (req, res) => {
    const { nodeId } = req.params;
    const node = db.getNode(nodeId);
    if (!node) {
      return res.status(404).json({ success: false, error: `Node '${nodeId}' not found` });
    }

    try {
      const relay = db.addOrUpdateRelay(nodeId, req.body);
      db.logAudit('RELAY_ADDED', nodeId, `Configured channel ${relay.channel_id} ('${relay.name}', Pin D${relay.pin}) on node '${node.name}'`);
      nodeManager.broadcast('relay_sync', { nodeId, channel_id: relay.channel_id, relay });
      res.json({
        success: true,
        message: `Relay channel ${relay.channel_id} ('${relay.name}') configured successfully`,
        relay
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.put('/nodes/:nodeId/relays/:channelId', requirePermission(db, 'devices:manage'), (req, res) => {
    const { nodeId, channelId } = req.params;
    const node = db.getNode(nodeId);
    if (!node) {
      return res.status(404).json({ success: false, error: `Node '${nodeId}' not found` });
    }

    try {
      const relay = db.addOrUpdateRelay(nodeId, { ...req.body, channel_id: Number(channelId) });
      db.logAudit('RELAY_UPDATED', nodeId, `Updated channel ${channelId} ('${relay.name}', Pin D${relay.pin}) on node '${node.name}'`);
      nodeManager.broadcast('relay_sync', { nodeId, channel_id: relay.channel_id, relay });
      res.json({
        success: true,
        message: `Relay channel ${channelId} updated`,
        relay
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/nodes/:nodeId/relays/:channelId', requirePermission(db, 'devices:manage'), (req, res) => {
    const { nodeId, channelId } = req.params;
    const node = db.getNode(nodeId);
    if (!node) {
      return res.status(404).json({ success: false, error: `Node '${nodeId}' not found` });
    }

    db.deleteRelay(nodeId, Number(channelId));
    db.logAudit('RELAY_DELETED', nodeId, `Removed relay channel ${channelId} from node '${node.name}'`);
    nodeManager.broadcast('relay_sync', { nodeId, channel_id: Number(channelId), deleted: true });
    res.json({
      success: true,
      message: `Relay channel ${channelId} deleted from node '${node.name}'`
    });
  });


  router.post('/nodes/:nodeId/restart', requirePermission(db, 'devices:reboot'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden: Node outside assigned scope' });

    const result = await nodeManager.dispatchCommand(req.params.nodeId, { action: 'reboot' }, req.user);
    res.json(result);
  });

  // ==========================================
  // === RELAY & HARDWARE CONTROL ROUTES ===
  // ==========================================

  router.get('/relays', authenticateUser(db), (req, res) => {
    const { room, node_id, state } = req.query;
    const filters = {};
    if (room) filters.room = room;
    if (node_id) filters.node_id = node_id;
    if (state !== undefined) filters.state = state === 'true' || state === '1';

    let relays = db.getRelays(filters);
    if (req.user && !req.user.is_superuser) {
      relays = relays.filter(r => {
        const n = db.getNode(r.node_id);
        return verifyDeviceScope(req.user, n);
      });
    }
    res.json(relays);
  });

  router.post('/relays/sync', requirePermission(db, 'devices:control'), async (req, res) => {
    try {
      const results = await nodeManager.syncAllOnlineNodesPins();
      const updatedRelays = db.getRelays();
      res.json({
        success: true,
        message: 'Synchronized hardware GPIO pins with nodes',
        totalRelays: updatedRelays.length,
        results,
        relays: updatedRelays
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/nodes/:nodeId/sync-pins', requirePermission(db, 'devices:control'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden: Node outside assigned scope' });

    try {
      const result = await nodeManager.syncNodePins(req.params.nodeId);
      const updatedRelays = db.getRelays({ node_id: req.params.nodeId });
      res.json({
        success: true,
        message: `Synchronized ${result.count} pins from node ${req.params.nodeId}`,
        nodeId: req.params.nodeId,
        count: result.count,
        relays: updatedRelays
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/relays/:nodeId/:channelId/command', requirePermission(db, 'devices:control'), async (req, res) => {
    const { nodeId, channelId } = req.params;
    const node = db.getNode(nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden: Node outside assigned scope' });

    const action = req.body.action || 'setState';
    const state = Boolean(req.body.state);
    const duration = Number(req.body.duration) || 500;

    const cmd = {
      id: Number(channelId),
      gpioId: Number(channelId),
      action,
      state,
      duration
    };

    const result = await nodeManager.dispatchCommand(nodeId, cmd, req.user);
    res.json(result);
  });

  router.post('/relays/broadcast', requirePermission(db, 'devices:control'), async (req, res) => {
    const action = req.body.action || 'setState';
    const targetState = Boolean(req.body.state);
    const targetRoom = req.body.room;

    const result = await nodeManager.broadcastCommand({ action, state: targetState }, targetRoom);
    res.json(result);
  });

  router.get('/relays/:nodeId/:channelId/history', authenticateUser(db), (req, res) => {
    const { nodeId, channelId } = req.params;
    const limit = Number(req.query.limit) || 50;
    const history = db.getRelayHistory(nodeId, channelId, limit);
    res.json(history);
  });

  // ==========================================
  // === LITTLEFS FILESYSTEM MANAGER ROUTES ===
  // ==========================================

  router.get('/nodes/:nodeId/fs', requirePermission(db, 'littlefs:view'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    try {
      const fsData = await littlefsService.fetchFilesystemList(req.params.nodeId);
      res.json(fsData);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/nodes/:nodeId/fs/download', requirePermission(db, 'littlefs:download'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ success: false, error: 'path query parameter is required' });

    try {
      const fileData = await littlefsService.downloadFileFromNode(req.params.nodeId, filePath);
      res.setHeader('Content-Type', fileData.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileData.filename}"`);
      res.setHeader('Content-Length', fileData.size);
      res.send(fileData.buffer);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/nodes/:nodeId/fs/upload', requirePermission(db, 'littlefs:upload'), fsUpload.single('file'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    try {
      const result = await littlefsService.uploadFileToNode(
        req.params.nodeId,
        req.file.buffer,
        req.file.originalname,
        req.body.dir || '/'
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/nodes/:nodeId/fs/delete', requirePermission(db, 'littlefs:delete'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ success: false, error: 'path is required' });

    try {
      const result = await littlefsService.deleteFileOnNode(req.params.nodeId, filePath);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/nodes/:nodeId/fs/rename', requirePermission(db, 'littlefs:manage'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ success: false, error: 'oldPath and newPath are required' });

    try {
      const result = await littlefsService.renameFileOnNode(req.params.nodeId, oldPath, newPath);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/nodes/:nodeId/fs/backup', requirePermission(db, 'littlefs:backup'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    try {
      const result = await littlefsService.createFilesystemBackup(req.params.nodeId, req.body.backupType || 'MANUAL');
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/nodes/:nodeId/fs/backups', requirePermission(db, 'littlefs:view'), (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    res.json({ success: true, backups: db.getFilesystemBackups(req.params.nodeId) });
  });

  // ==========================================
  // === DEVICE COMMAND MANAGEMENT ROUTES ===
  // ==========================================

  router.get('/commands', requirePermission(db, 'commands:view'), (req, res) => {
    const filters = {
      node_id: req.query.node_id,
      status: req.query.status,
      limit: Number(req.query.limit) || 100
    };
    res.json({ success: true, commands: db.getCommands(filters) });
  });

  router.post('/commands/dispatch', requirePermission(db, 'commands:execute'), async (req, res) => {
    const { node_id, ...commandPayload } = req.body;
    if (!node_id) return res.status(400).json({ success: false, error: 'node_id is required' });

    const node = db.getNode(node_id);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden: Device outside assigned scope' });

    try {
      const result = await nodeManager.dispatchCommand(node_id, commandPayload, req.user);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/commands/:uuid', requirePermission(db, 'commands:view'), (req, res) => {
    const cmd = db.getCommandByUuid(req.params.uuid);
    if (!cmd) return res.status(404).json({ success: false, error: 'Command not found' });
    const results = db.getCommandResults(req.params.uuid);
    res.json({ success: true, command: cmd, results });
  });

  // ==========================================
  // === CONFIGURATION SYNCHRONIZATION ROUTES ===
  // ==========================================

  router.get('/nodes/:nodeId/config', requirePermission(db, 'config:view'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    try {
      const config = await configSyncService.getDeviceConfig(req.params.nodeId);
      res.json({ success: true, configuration: config });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.put('/nodes/:nodeId/config', requirePermission(db, 'config:manage'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const { config, summary } = req.body;
    if (!config) return res.status(400).json({ success: false, error: 'config object is required' });

    try {
      const result = await configSyncService.updateDeviceConfig(req.params.nodeId, config, req.user ? req.user.id : null, summary);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/nodes/:nodeId/config/sync', requirePermission(db, 'config:sync'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    try {
      const result = await configSyncService.syncDeviceConfig(req.params.nodeId, req.user ? req.user.id : null);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/nodes/:nodeId/config/versions', requirePermission(db, 'config:view'), (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const versions = configSyncService.getConfigurationVersions(req.params.nodeId);
    res.json({ success: true, versions });
  });

  router.post('/nodes/:nodeId/config/rollback/:version', requirePermission(db, 'config:rollback'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node)) return res.status(403).json({ success: false, error: 'Forbidden' });

    try {
      const result = await configSyncService.rollbackDeviceConfig(req.params.nodeId, req.params.version, req.user ? req.user.id : null);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // === FIRMWARE & OTA PIPELINE ROUTES ===
  // ==========================================

  router.get('/firmware', (req, res) => {
    res.json(db.getFirmwareList());
  });

  router.post('/firmware/upload', requirePermission(db, 'firmware:upload'), fwUpload.single('firmware'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No firmware binary file uploaded' });
    }

    const { version, hardware, release_channel, notes } = req.body;
    if (!version) {
      return res.status(400).json({ success: false, error: 'Firmware version string is required (e.g. 1.6.0)' });
    }

    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);
    const md5Hash = crypto.createHash('md5').update(buffer).digest('hex');
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

    const id = db.addFirmwareRecord({
      filename: req.file.filename,
      version: version.trim(),
      hardware_type: hardware || 'ESP8266',
      release_channel: release_channel || 'LTS',
      notes: notes || '',
      file_size_bytes: req.file.size,
      checksum_md5: md5Hash,
      checksum_sha256: sha256Hash,
      file_path: filePath
    });

    db.logAudit('FIRMWARE_UPLOAD', 'System', `Uploaded firmware v${version} (${req.file.size} bytes, MD5: ${md5Hash})`);

    res.json({
      success: true,
      message: 'Firmware uploaded and registered in catalog',
      firmware: db.getFirmware(id)
    });
  });

  router.get('/firmware/:id/download', requirePermission(db, 'firmware:download'), (req, res) => {
    const fw = db.getFirmware(req.params.id);
    if (!fw) return res.status(404).json({ success: false, error: 'Firmware not found' });

    const resolved = otaService.resolveFirmwarePath(fw.file_path);
    if (!resolved || !fs.existsSync(resolved)) {
      return res.status(404).json({ success: false, error: 'Firmware binary file missing from server disk' });
    }

    res.download(resolved, fw.filename);
  });

  router.delete('/firmware/:id', requirePermission(db, 'firmware:upload'), (req, res) => {
    const fw = db.getFirmware(req.params.id);
    if (!fw) return res.status(404).json({ success: false, error: 'Firmware not found' });

    if (fw.file_path && fs.existsSync(fw.file_path)) {
      try { fs.unlinkSync(fw.file_path); } catch {}
    }
    db.deleteFirmware(req.params.id);
    db.logAudit('FIRMWARE_DELETED', 'System', `Deleted firmware ID ${req.params.id} (${fw.filename})`);
    res.json({ success: true, message: 'Firmware removed from catalog' });
  });

  // OTA Diagnostics & Pre-check
  router.get('/ota/diagnostics/:nodeId', authenticateUser(db), async (req, res) => {
    try {
      const diag = await otaService.fetchNodeDiagnostics(req.params.nodeId);
      res.json(diag);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/ota/precheck', authenticateUser(db), async (req, res) => {
    const { nodeId, firmwareId } = req.body;
    if (!nodeId || !firmwareId) {
      return res.status(400).json({ success: false, error: 'nodeId and firmwareId are required' });
    }
    try {
      const result = await otaService.preCheckOta(nodeId, firmwareId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // OTA Deployment
  router.post('/ota/deploy', requirePermission(db, 'firmware:deploy'), async (req, res) => {
    const { nodeId, firmwareId, options } = req.body;
    if (!nodeId || !firmwareId) {
      return res.status(400).json({ success: false, error: 'nodeId and firmwareId are required' });
    }
    try {
      const result = await otaService.deployOta(nodeId, firmwareId, options || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/ota/history', requirePermission(db, 'firmware:view'), (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json(db.getOtaHistory(limit));
  });

  router.get('/ota/backups', authenticateUser(db), (req, res) => {
    res.json(db.getNodeBackups(req.query.node_id));
  });

  router.delete('/ota/backups/:id', requirePermission(db, 'system:manage'), (req, res) => {
    const b = db.getNodeBackup(req.params.id);
    if (!b) return res.status(404).json({ success: false, error: 'Backup not found' });
    if (b.backup_path && fs.existsSync(b.backup_path)) {
      try { fs.unlinkSync(b.backup_path); } catch {}
    }
    db.deleteNodeBackup(b.id);
    res.json({ success: true, message: 'Backup deleted' });
  });

  // ==========================================
  // === SENSORS, AUTOMATIONS & LOGS ===
  // ==========================================

  router.get('/sensors', authenticateUser(db), (req, res) => {
    res.json(db.getSensors());
  });

  router.get('/automations', authenticateUser(db), (req, res) => {
    res.json(db.getAutomations());
  });

  router.post('/automations', requirePermission(db, 'devices:manage'), (req, res) => {
    try {
      const id = db.addAutomation(req.body);
      db.logAudit('AUTO_RULE_ADD', 'System', `Created automation rule: ${req.body.name}`);
      res.json({ success: true, id });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/automations/:id/toggle', requirePermission(db, 'devices:manage'), (req, res) => {
    const ok = db.toggleAutomation(req.params.id);
    res.json({ success: true, enabled: ok });
  });

  router.delete('/automations/:id', requirePermission(db, 'devices:manage'), (req, res) => {
    const ok = db.deleteAutomation(req.params.id);
    res.json({ success: ok });
  });

  router.get('/telemetry', requirePermission(db, 'telemetry:view'), (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json(db.getRecentTelemetry(limit));
  });

  router.get('/system/events', requirePermission(db, 'audit:view'), (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json(db.getSystemEvents(limit));
  });

  router.get('/system/notifications', authenticateUser(db), (req, res) => {
    const limit = Number(req.query.limit) || 60;
    res.json(db.getNotifications(limit));
  });

  router.get('/system/notifications/unread-count', authenticateUser(db), (req, res) => {
    res.json({ unreadCount: db.getUnreadNotificationCount() });
  });

  router.post('/system/notifications/mark-read', authenticateUser(db), (req, res) => {
    db.markNotificationsRead();
    res.json({ success: true, message: 'All notifications marked as read' });
  });

  router.delete('/system/notifications/:id', authenticateUser(db), (req, res) => {
    db.deleteNotification(req.params.id);
    res.json({ success: true, message: 'Notification removed' });
  });

  router.delete('/system/notifications', authenticateUser(db), (req, res) => {
    db.clearAllNotifications();
    res.json({ success: true, message: 'All notifications cleared' });
  });

  router.get('/system/logs', requirePermission(db, 'audit:view'), (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const category = req.query.category || null;
    res.json(db.getAuditLogs(limit, category));
  });

  router.get('/system/poll-settings', (req, res) => {
    res.json(nodeManager.getPollSettings());
  });

  router.post('/system/poll-settings', requirePermission(db, 'system:manage'), async (req, res) => {
    const { intervalSec, enabled } = req.body;
    const settings = await nodeManager.setPollInterval(intervalSec, enabled);
    res.json({ success: true, settings });
  });

  router.post('/system/poll-now', requirePermission(db, 'devices:control'), async (req, res) => {
    await nodeManager.pollAllNodesStatusAndPins();
    res.json({
      success: true,
      message: 'Active pin and status polling cycle executed across fleet',
      settings: nodeManager.getPollSettings()
    });
  });

  return router;
}

module.exports = createV1Router;
