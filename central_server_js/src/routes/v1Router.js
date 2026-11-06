const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const multer = require('multer');

const {
  authenticateUser,
  requirePermission,
  requireHomeRole,
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

  const loginAttempts = new Map(); // ip -> { count, lockoutUntil }

  function checkLoginRateLimit(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (record) {
      if (record.lockoutUntil && record.lockoutUntil > now) {
        const remainingSec = Math.ceil((record.lockoutUntil - now) / 1000);
        return `Too many failed login attempts. Please try again in ${remainingSec} seconds.`;
      }
      if (record.lockoutUntil && record.lockoutUntil <= now) {
        loginAttempts.delete(ip);
      }
    }
    return null;
  }

  function recordFailedLogin(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip) || { count: 0, lockoutUntil: 0 };
    record.count++;
    if (record.count >= 5) {
      record.lockoutUntil = now + 5 * 60 * 1000; // 5-minute temporary lockout
    }
    loginAttempts.set(ip, record);
  }

  function resetFailedLogins(ip) {
    loginAttempts.delete(ip);
  }

  router.post('/auth/login', (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || '';
    const rateLimitError = checkLoginRateLimit(clientIp);
    if (rateLimitError) {
      return res.status(429).json({ success: false, error: rateLimitError });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    const user = db.getUserByUsername(username);
    if (!user) {
      recordFailedLogin(clientIp);
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, error: 'Account is deactivated. Contact an administrator.' });
    }

    if (!verifyPassword(password, user.password_hash)) {
      recordFailedLogin(clientIp);
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    resetFailedLogins(clientIp);

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

  router.post('/auth/logout', (req, res) => {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers.cookie) {
      const match = req.headers.cookie.match(/(?:^|;\s*)session=([a-f0-9]+)(?:;|$)/i);
      if (match) token = match[1].trim();
    }

    if (token) {
      db.revokeSession(token);
    }
    res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
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
    if (!userWithHash || !verifyPassword(oldPassword, userWithHash.password_hash)) {
      return res.status(400).json({ success: false, error: 'Current password does not match' });
    }

    db.setUserPassword(req.user.id, newPassword);
    res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
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
    const { room, status, hardware, search, home_id, room_id, homeId, roomId } = req.query;
    const targetHomeId = home_id ?? homeId;
    const targetRoomId = room_id ?? roomId;
    let nodes = db.getNodes({
      room,
      status,
      hardware,
      search,
      home_id: targetHomeId,
      room_id: targetRoomId
    });

    // Enforce hierarchical scope-based filtering for non-superusers
    if (req.user && !req.user.is_superuser) {
      nodes = nodes.filter(node => verifyDeviceScope(req.user, node, db));
    }
    res.json(nodes);
  });

  // ==========================================
  // === HOME-CENTRIC MANAGEMENT APIS ===
  // ==========================================

  // --- Homes ---
  router.get('/homes', authenticateUser(db), (req, res) => {
    try {
      const homes = db.getHomes(req.user.id, req.user.is_superuser);
      res.json({ success: true, homes });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/homes', requirePermission(db, 'homes:create'), (req, res) => {
    try {
      const { name, description, timezone, address } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: 'Home name is required' });
      }
      const home = db.createHome({
        name: name.trim(),
        description,
        timezone,
        address,
        created_by: req.user.id,
        owner_user_id: null // Ownerless bootstrap mode by default
      });
      res.json({ success: true, home });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/homes/:homeId', authenticateUser(db), (req, res) => {
    try {
      const homeId = Number(req.params.homeId);
      const home = db.getHomeById(homeId);
      if (!home) return res.status(404).json({ success: false, error: 'Home not found' });

      if (!req.user.is_superuser) {
        const member = db.getHomeMember(homeId, req.user.id);
        if (!member && home.owner_user_id !== req.user.id) {
          return res.status(403).json({ success: false, error: 'Forbidden: You do not have access to this home' });
        }
      }

      res.json({ success: true, home });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.put('/homes/:homeId', requireHomeRole(db, 'HOME_ADMIN'), (req, res) => {
    try {
      const homeId = Number(req.params.homeId);
      const updated = db.updateHome(homeId, req.body);
      res.json({ success: true, home: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/homes/:homeId', requirePermission(db, 'homes:delete'), (req, res) => {
    try {
      const homeId = Number(req.params.homeId);
      db.deleteHome(homeId);
      res.json({ success: true, message: `Home ${homeId} archived and nodes unassigned` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Appoint / Transfer Home Owner (Super Admin Only)
  router.post('/homes/:homeId/owner', requirePermission(db, 'system:manage'), (req, res) => {
    try {
      const homeId = Number(req.params.homeId);
      const targetUserId = Number(req.body.userId || req.body.user_id);
      if (!targetUserId) {
        return res.status(400).json({ success: false, error: 'userId is required to appoint a Home Owner' });
      }
      const home = db.appointHomeOwner(homeId, targetUserId, req.user.id);
      res.json({ success: true, home, message: 'Home Owner appointed successfully' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Home Members
  router.get('/homes/:homeId/members', requireHomeRole(db, 'FAMILY_MEMBER'), (req, res) => {
    try {
      const homeId = Number(req.params.homeId);
      const members = db.getHomeMembers(homeId);
      res.json({ success: true, members });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/homes/:homeId/members', requireHomeRole(db, 'HOME_ADMIN'), (req, res) => {
    try {
      const homeId = Number(req.params.homeId);
      const userId = Number(req.body.userId || req.body.user_id);
      const role = req.body.role || 'FAMILY_MEMBER';
      if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

      const member = db.addHomeMember(homeId, userId, role);
      res.json({ success: true, member });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.put('/homes/:homeId/members/:userId', requireHomeRole(db, 'HOME_ADMIN'), (req, res) => {
    try {
      const homeId = Number(req.params.homeId);
      const userId = Number(req.params.userId);
      const role = req.body.role;
      if (!role) return res.status(400).json({ success: false, error: 'role is required' });

      const member = db.updateHomeMemberRole(homeId, userId, role);
      res.json({ success: true, member });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/homes/:homeId/members/:userId', requireHomeRole(db, 'HOME_ADMIN'), (req, res) => {
    try {
      const homeId = Number(req.params.homeId);
      const userId = Number(req.params.userId);
      db.removeHomeMember(homeId, userId);
      res.json({ success: true, message: 'Member removed from home' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // --- Rooms ---
  router.get('/homes/:homeId/rooms', requireHomeRole(db, 'VIEWER'), (req, res) => {
    try {
      const homeId = Number(req.params.homeId);
      const rooms = db.getRooms(homeId, req.user.id, req.user.is_superuser);
      res.json({ success: true, rooms });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/homes/:homeId/rooms', requireHomeRole(db, 'HOME_ADMIN'), (req, res) => {
    try {
      const homeId = Number(req.params.homeId);
      const { name, floor, icon } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Room name is required' });

      const room = db.createRoom({ home_id: homeId, name: name.trim(), floor, icon });
      res.json({ success: true, room });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/rooms/:roomId', authenticateUser(db), (req, res) => {
    try {
      const roomId = Number(req.params.roomId);
      const room = db.getRoomById(roomId);
      if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

      if (!req.user.is_superuser) {
        const member = db.getHomeMember(room.home_id, req.user.id);
        if (!member) return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      res.json({ success: true, room });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.put('/rooms/:roomId', authenticateUser(db), (req, res) => {
    try {
      const roomId = Number(req.params.roomId);
      const room = db.getRoomById(roomId);
      if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

      if (!req.user.is_superuser) {
        const member = db.getHomeMember(room.home_id, req.user.id);
        if (!member || (member.role !== 'HOME_OWNER' && member.role !== 'HOME_ADMIN')) {
          return res.status(403).json({ success: false, error: 'Forbidden: Requires HOME_ADMIN role in this home' });
        }
      }

      const updated = db.updateRoom(roomId, req.body);
      res.json({ success: true, room: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/rooms/:roomId', authenticateUser(db), (req, res) => {
    try {
      const roomId = Number(req.params.roomId);
      const room = db.getRoomById(roomId);
      if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

      if (!req.user.is_superuser) {
        const member = db.getHomeMember(room.home_id, req.user.id);
        if (!member || (member.role !== 'HOME_OWNER' && member.role !== 'HOME_ADMIN')) {
          return res.status(403).json({ success: false, error: 'Forbidden: Requires HOME_ADMIN role in this home' });
        }
      }

      db.deleteRoom(roomId);
      res.json({ success: true, message: 'Room deleted successfully' });
    } catch (err) {
      // Handles assigned nodes rejection cleanly
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/rooms/:roomId/members', authenticateUser(db), (req, res) => {
    try {
      const roomId = Number(req.params.roomId);
      const members = db.getRoomMembers(roomId);
      res.json({ success: true, members });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/rooms/:roomId/members', authenticateUser(db), (req, res) => {
    try {
      const roomId = Number(req.params.roomId);
      const room = db.getRoomById(roomId);
      if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

      if (!req.user.is_superuser) {
        const member = db.getHomeMember(room.home_id, req.user.id);
        if (!member || (member.role !== 'HOME_OWNER' && member.role !== 'HOME_ADMIN')) {
          return res.status(403).json({ success: false, error: 'Forbidden: Requires HOME_ADMIN role in this home' });
        }
      }

      const userId = Number(req.body.userId || req.body.user_id);
      const role = req.body.role || 'FAMILY_MEMBER';
      db.assignRoomMember(roomId, userId, role);
      res.json({ success: true, message: 'User assigned to room' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete('/rooms/:roomId/members/:userId', authenticateUser(db), (req, res) => {
    try {
      const roomId = Number(req.params.roomId);
      const room = db.getRoomById(roomId);
      if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

      if (!req.user.is_superuser) {
        const member = db.getHomeMember(room.home_id, req.user.id);
        if (!member || (member.role !== 'HOME_OWNER' && member.role !== 'HOME_ADMIN')) {
          return res.status(403).json({ success: false, error: 'Forbidden: Requires HOME_ADMIN role in this home' });
        }
      }

      db.removeRoomMember(roomId, Number(req.params.userId));
      res.json({ success: true, message: 'User removed from room' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // --- Node Assignments & Unassigned Queue ---
  router.get('/nodes/unassigned', authenticateUser(db), (req, res) => {
    try {
      if (!req.user.is_superuser) {
        const hasPerm = req.user.permissions && (req.user.permissions.includes('devices:assign') || req.user.permissions.includes('devices:manage'));
        if (!hasPerm) {
          return res.status(403).json({ success: false, error: 'Forbidden: Requires devices:assign permission to inspect unassigned nodes' });
        }
      }
      const nodes = db.getUnassignedNodes();
      res.json({ success: true, nodes });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/nodes/:nodeId/assign', authenticateUser(db), (req, res) => {
    try {
      const { nodeId } = req.params;
      const homeId = Number(req.body.homeId || req.body.home_id);
      const roomId = Number(req.body.roomId || req.body.room_id);

      if (!homeId || !roomId) {
        return res.status(400).json({ success: false, error: 'homeId and roomId are required to assign a node' });
      }

      if (!req.user.is_superuser) {
        const member = db.getHomeMember(homeId, req.user.id);
        if (!member || (member.role !== 'HOME_OWNER' && member.role !== 'HOME_ADMIN')) {
          return res.status(403).json({ success: false, error: 'Forbidden: Requires HOME_ADMIN role in target home' });
        }
      }

      const node = db.assignNodeToRoom(nodeId, homeId, roomId);
      res.json({ success: true, node, message: `Node '${nodeId}' assigned successfully` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/nodes/:nodeId/move', authenticateUser(db), (req, res) => {
    try {
      const { nodeId } = req.params;
      const homeId = Number(req.body.homeId || req.body.home_id);
      const roomId = Number(req.body.roomId || req.body.room_id);

      if (!homeId || !roomId) {
        return res.status(400).json({ success: false, error: 'homeId and roomId are required to move a node' });
      }

      if (!req.user.is_superuser) {
        const member = db.getHomeMember(homeId, req.user.id);
        if (!member || (member.role !== 'HOME_OWNER' && member.role !== 'HOME_ADMIN')) {
          return res.status(403).json({ success: false, error: 'Forbidden: Requires HOME_ADMIN role in target home' });
        }
      }

      const node = db.moveNode(nodeId, homeId, roomId);
      res.json({ success: true, node, message: `Node '${nodeId}' moved successfully` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/nodes/:nodeId/unassign', authenticateUser(db), (req, res) => {
    try {
      const { nodeId } = req.params;
      const existing = db.getNode(nodeId);
      if (!existing) return res.status(404).json({ success: false, error: 'Node not found' });

      if (!req.user.is_superuser && existing.home_id) {
        const member = db.getHomeMember(existing.home_id, req.user.id);
        if (!member || (member.role !== 'HOME_OWNER' && member.role !== 'HOME_ADMIN')) {
          return res.status(403).json({ success: false, error: 'Forbidden: Requires HOME_ADMIN role in current home' });
        }
      }

      const node = db.unassignNode(nodeId);
      res.json({ success: true, node, message: `Node '${nodeId}' unassigned` });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
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
    if (!verifyDeviceScope(req.user, node, db)) {
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
    if (!verifyDeviceScope(req.user, node, db)) {
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
    if (!node) {
      return res.status(404).json({ success: false, error: 'Node not found' });
    }
    const nodeIp = node.ip || node.ip_address;
    if (!nodeIp) {
      return res.status(404).json({ success: false, error: 'Node has no IP address recorded' });
    }

    const user = (req.body.auth_username || req.body.username || node.auth_username || 'admin').trim();
    const pass = req.body.auth_password !== undefined ? req.body.auth_password : (req.body.password !== undefined ? req.body.password : (node.auth_password || 'admin'));

    const t0 = Date.now();

    try {
      // 1. Primary probe: Authenticate against /api/auth/login with JSON credentials
      const loginPayload = JSON.stringify({ username: user, password: pass });
      const loginResp = await fetch(`http://${nodeIp}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: loginPayload,
        signal: AbortSignal.timeout(3000)
      });
      const latencyMs = Date.now() - t0;

      if (loginResp.status === 401) {
        let errDetail = 'Invalid User ID or Password on node';
        try {
          const errJson = await loginResp.json();
          if (errJson.error) errDetail = errJson.error;
        } catch {}
        return res.json({
          success: false,
          httpStatus: 401,
          statusCode: 401,
          latencyMs,
          error: `Authentication failed: ${errDetail} (HTTP 401)`,
          message: `Authentication failed: ${errDetail}`
        });
      }

      if (loginResp.ok) {
        let token = null;
        try {
          const json = await loginResp.json();
          token = json.token;
        } catch {}

        // Fetch hardware info from status if possible
        let hardware = node.hardware_type || node.hardware || 'ESP8266';
        try {
          const stResp = await fetch(`http://${nodeIp}/api/status`, { signal: AbortSignal.timeout(1500) });
          if (stResp.ok) {
            const stData = await stResp.json();
            if (stData.hardware) hardware = stData.hardware;
          }
        } catch {}

        return res.json({
          success: true,
          httpStatus: 200,
          statusCode: 200,
          latencyMs,
          hardware,
          message: `Successfully authenticated with ${node.name} (${nodeIp})!`,
          token
        });
      }

      // 2. Fallback: If /api/auth/login is 404 (e.g. sketch using HTTP Basic Auth only)
      if (loginResp.status === 404) {
        const basicAuth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
        const probeResp = await fetch(`http://${nodeIp}/api/fs/list`, {
          headers: { 'Authorization': basicAuth },
          signal: AbortSignal.timeout(3000)
        });
        const latencyFallback = Date.now() - t0;

        if (probeResp.status === 401) {
          return res.json({
            success: false,
            httpStatus: 401,
            statusCode: 401,
            latencyMs: latencyFallback,
            error: 'Authentication failed: Invalid credentials (HTTP 401 Unauthorized)',
            message: 'Authentication failed: Invalid credentials'
          });
        }

        if (probeResp.ok) {
          return res.json({
            success: true,
            httpStatus: probeResp.status,
            statusCode: probeResp.status,
            latencyMs: latencyFallback,
            hardware: node.hardware_type || node.hardware || 'ESP8266',
            message: `Successfully authenticated with ${node.name} (${nodeIp})!`
          });
        }
      }

      return res.json({
        success: false,
        httpStatus: loginResp.status,
        statusCode: loginResp.status,
        latencyMs,
        error: `Node responded with HTTP ${loginResp.status}: ${loginResp.statusText}`,
        message: `Node responded with HTTP ${loginResp.status}`
      });
    } catch (err) {
      return res.json({
        success: false,
        httpStatus: 0,
        statusCode: 0,
        latencyMs: Date.now() - t0,
        error: `Cannot reach node at http://${nodeIp}: ${err.message}`,
        message: `Connection failed: ${err.message}`
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
  router.post('/nodes/:nodeId/relays', requirePermission(db, 'devices:manage'), async (req, res) => {
    const { nodeId } = req.params;
    const node = db.getNode(nodeId);
    if (!node) {
      return res.status(404).json({ success: false, error: `Node '${nodeId}' not found` });
    }

    try {
      const payload = { ...req.body };
      const rawCh = payload.channel_id ?? payload.id;
      if (rawCh !== undefined) {
        payload.channel_id = parseInt(String(rawCh).replace(/\D/g, '')) || 1;
      }
      const relay = db.addOrUpdateRelay(nodeId, payload);
      db.logAudit('RELAY_ADDED', nodeId, `Configured channel ${relay.channel_id} ('${relay.name}', Pin D${relay.pin}) on node '${node.name}'`);
      nodeManager.broadcast('relay_sync', { nodeId, channel_id: relay.channel_id, relay });

      try {
        await nodeManager.pushNodeConfig(nodeId);
      } catch {}

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

  router.delete('/nodes/:nodeId/relays/:channelId', requirePermission(db, 'devices:manage'), async (req, res) => {
    const { nodeId, channelId } = req.params;
    const node = db.getNode(nodeId);
    if (!node) {
      return res.status(404).json({ success: false, error: `Node '${nodeId}' not found` });
    }

    const numericChannelId = parseInt(String(channelId).replace(/\D/g, '')) || Number(channelId);
    db.deleteRelay(nodeId, numericChannelId);
    db.logAudit('RELAY_DELETED', nodeId, `Removed relay channel ${numericChannelId} from node '${node.name}'`);
    nodeManager.broadcast('relay_sync', { nodeId, channel_id: numericChannelId, deleted: true });

    try {
      await nodeManager.pushNodeConfig(nodeId);
    } catch {}

    res.json({
      success: true,
      message: `Relay channel ${numericChannelId} deleted from node '${node.name}'`
    });
  });


  router.post('/nodes/:nodeId/restart', requirePermission(db, 'devices:reboot'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden: Node outside assigned scope' });

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
        return verifyDeviceScope(req.user, n, db);
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

  router.get('/nodes/:nodeId/pins', authenticateUser(db), (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    const catalog = nodeManager.getHardwarePinCatalog(req.params.nodeId);
    res.json({ success: true, catalog });
  });

  router.post('/nodes/:nodeId/sync-pins', requirePermission(db, 'devices:control'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden: Node outside assigned scope' });

    try {
      const result = await nodeManager.syncNodePins(req.params.nodeId);
      const catalog = nodeManager.getHardwarePinCatalog(req.params.nodeId);
      res.json({
        success: true,
        message: `Synchronized ${result.count} pins from node ${req.params.nodeId}`,
        nodeId: req.params.nodeId,
        count: result.count,
        catalog,
        relays: catalog ? catalog.relays : []
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/relays/:nodeId/:channelId/command', requirePermission(db, 'devices:control'), async (req, res) => {
    const { nodeId, channelId } = req.params;
    const node = db.getNode(nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden: Node outside assigned scope' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

    res.json({ success: true, backups: db.getFilesystemBackups(req.params.nodeId) });
  });

  // LittleFS Live Sync: Synchronize filesystem and configuration tables
  router.post('/nodes/:nodeId/fs/sync', requirePermission(db, 'littlefs:manage'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

    try {
      const result = await littlefsService.syncLittlefsWithMaster(req.params.nodeId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // LittleFS View/Inspect File Content (JSON/Text)
  router.get('/nodes/:nodeId/fs/file-content', requirePermission(db, 'littlefs:view'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ success: false, error: 'path query parameter is required' });

    try {
      const fileData = await littlefsService.downloadFileFromNode(req.params.nodeId, filePath);
      const isText = fileData.contentType.includes('text') || fileData.contentType.includes('json') ||
                     /\.(json|txt|html|css|js|log|csv|conf|ini)$/i.test(filePath);
      res.json({
        success: true,
        filename: fileData.filename,
        path: fileData.path,
        size: fileData.size,
        contentType: fileData.contentType,
        isText,
        content: isText ? fileData.buffer.toString('utf-8') : null
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Direct In-Browser File Edit & Save (Protected to < 5KB for Node Heap Safety)
  router.post('/nodes/:nodeId/fs/save-content', requirePermission(db, 'littlefs:upload'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      return res.status(400).json({ success: false, error: 'path and content are required' });
    }

    try {
      const result = await littlefsService.saveFileContent(req.params.nodeId, filePath, content);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden: Device outside assigned scope' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

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
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const versions = configSyncService.getConfigurationVersions(req.params.nodeId);
    res.json({ success: true, versions });
  });

  router.post('/nodes/:nodeId/config/rollback/:version', requirePermission(db, 'config:rollback'), async (req, res) => {
    const node = db.getNode(req.params.nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    if (!verifyDeviceScope(req.user, node, db)) return res.status(403).json({ success: false, error: 'Forbidden' });

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

    const { version, hardware, hardware_type, release_channel, notes } = req.body;
    const hwTarget = hardware || hardware_type || 'ESP8266 (ESP-12E/F) NodeMCU';

    // 1. Strict Semantic Version Validation (e.g. 1.6.0, 1.7.0, v2.0.0)
    const semverRegex = /^v?([0-9]+).([0-9]+)(.([0-9]+))?(-[0-9A-Za-z.-]+)?$/;
    const rawVer = (version || '').trim();
    if (!rawVer || !semverRegex.test(rawVer)) {
      if (req.file && fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({
        success: false,
        error: `Invalid semantic version '${rawVer}'. Version must be formatted as X.Y.Z (e.g. 1.6.1, 1.7.0, or v2.0.0)`
      });
    }
    const normalizedVersion = rawVer.replace(/^v/i, '');

    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);

    // 2. ROM Flash Binary Magic Byte Verification (0xE9 for ESP8266 executable image)
    const isEsp8266 = hwTarget.toLowerCase().includes('esp8266') || hwTarget.toLowerCase().includes('esp-01') || hwTarget.toLowerCase().includes('nodemcu');
    if (isEsp8266) {
      const magicByte = buffer[0];
      if (magicByte !== 0xE9) {
        if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch {}
        return res.status(400).json({
          success: false,
          error: `Binary verification failed: Magic byte 0x${magicByte.toString(16).toUpperCase()} does not match ESP8266 ROM flash signature (expected 0xE9). Ensure you exported a compiled sketch binary (.bin) from Arduino IDE or PlatformIO.`
        });
      }
    }

    // 3. Hardware Flash Partition Constraint Check (ESP-01 1MB ~480KB limit)
    const isEsp01 = hwTarget.toLowerCase().includes('esp-01') || hwTarget.toLowerCase().includes('1mb');
    if (isEsp01 && req.file.size > 512000) {
      if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch {}
      return res.status(400).json({
        success: false,
        error: `Binary size (${(req.file.size / 1024).toFixed(1)} KB) exceeds the safe flash limit for ESP-01 1MB modules (~480 KB - 500 KB). Dual-slot OTA flashing would fail. Please compile with minimal libraries and 1MB (FS:64KB OTA:~470KB) partition scheme.`
      });
    }

    // 4. Compute Checksums & Preserve All Historical Versions
    const md5Hash = crypto.createHash('md5').update(buffer).digest('hex');
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Create unique archival filename on disk (never overwrite older versions)
    const hwSlug = hwTarget.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const safeFilename = `firmware_${hwSlug}_v${normalizedVersion}_${Date.now()}.bin`;
    const finalPath = path.join(firmwareDir, safeFilename);
    try {
      fs.renameSync(filePath, finalPath);
    } catch {
      // If rename across volumes fails, fallback to copy + delete
      fs.copyFileSync(filePath, finalPath);
      try { fs.unlinkSync(filePath); } catch {}
    }

    const id = db.addFirmwareRecord({
      filename: safeFilename,
      version: normalizedVersion,
      hardware_type: hwTarget,
      release_channel: release_channel || 'LTS',
      notes: notes || '',
      file_size_bytes: req.file.size,
      checksum_md5: md5Hash,
      checksum_sha256: sha256Hash,
      file_path: finalPath
    });

    const registered = db.getFirmware(id);

    db.logAudit(
      'FIRMWARE_UPLOAD',
      'System',
      `Uploaded firmware v${normalizedVersion} for ${hwTarget} (${(req.file.size/1024).toFixed(1)} KB, MD5: ${md5Hash}, Latest: ${registered.is_latest ? 'YES' : 'NO'})`
    );

    res.json({
      success: true,
      message: `Firmware v${normalizedVersion} verified and registered in catalog`,
      firmware: registered
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

  // OTA Diagnostics & Pre-check (With route aliases to prevent frontend fetch 404s)
  const handleNodeDiagnostics = async (req, res) => {
    try {
      const diag = await otaService.fetchNodeDiagnostics(req.params.nodeId);
      res.json(diag);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  };
  router.get('/ota/diagnostics/:nodeId', authenticateUser(db), handleNodeDiagnostics);
  router.get('/ota/node-diagnostics/:nodeId', authenticateUser(db), handleNodeDiagnostics);

  const handlePrecheck = async (req, res) => {
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
  };
  router.post('/ota/precheck', authenticateUser(db), handlePrecheck);
  router.post('/ota/pre-check', authenticateUser(db), handlePrecheck);

  // Standalone Node Backup Trigger
  router.post('/ota/backup/:nodeId', authenticateUser(db), async (req, res) => {
    try {
      const type = req.body.backupType || 'MANUAL';
      const result = await otaService.backupNode(req.params.nodeId, type);
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

  router.get('/ota/backups/:id/download', authenticateUser(db), (req, res) => {
    const b = db.getNodeBackup(req.params.id);
    if (!b) return res.status(404).json({ success: false, error: 'Backup not found' });
    if (b.backup_path && fs.existsSync(b.backup_path)) {
      return res.download(b.backup_path, path.basename(b.backup_path));
    }
    if (b.snapshot_json) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="backup_${b.node_id}_${b.id}.json"`);
      return res.send(typeof b.snapshot_json === 'string' ? b.snapshot_json : JSON.stringify(b.snapshot_json, null, 2));
    }
    res.status(404).json({ success: false, error: 'Backup snapshot data missing' });
  });

  router.post('/ota/backups/:backupId/restore/:nodeId', requirePermission(db, 'devices:manage'), async (req, res) => {
    try {
      const result = await otaService.restoreNodeConfig(req.params.nodeId, req.params.backupId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
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
