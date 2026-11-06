const crypto = require('node:crypto');

const DEFAULT_ROLES_PERMISSIONS = {
  SUPER_ADMIN: [
    'system:manage', 'users:manage', 'roles:manage', 'scopes:manage',
    'homes:view', 'homes:manage', 'homes:create', 'homes:delete',
    'rooms:view', 'rooms:manage',
    'devices:view', 'devices:manage', 'devices:control', 'devices:reboot', 'devices:delete', 'devices:assign', 'devices:move',
    'firmware:view', 'firmware:upload', 'firmware:deploy', 'firmware:download',
    'littlefs:view', 'littlefs:manage', 'littlefs:upload', 'littlefs:download', 'littlefs:delete', 'littlefs:backup',
    'config:view', 'config:manage', 'config:sync', 'config:rollback',
    'commands:execute', 'commands:view',
    'telemetry:view', 'audit:view'
  ],
  HOME_OWNER: [
    'homes:view', 'homes:manage', 'homes:delete',
    'rooms:view', 'rooms:manage',
    'devices:view', 'devices:manage', 'devices:control', 'devices:reboot', 'devices:assign', 'devices:move',
    'firmware:view', 'firmware:deploy', 'firmware:download',
    'littlefs:view', 'littlefs:manage', 'littlefs:upload', 'littlefs:download', 'littlefs:backup',
    'config:view', 'config:manage', 'config:sync', 'config:rollback',
    'commands:execute', 'commands:view',
    'telemetry:view', 'audit:view'
  ],
  HOME_ADMIN: [
    'homes:view', 'homes:manage',
    'rooms:view', 'rooms:manage',
    'devices:view', 'devices:manage', 'devices:control', 'devices:reboot', 'devices:assign', 'devices:move',
    'firmware:view', 'firmware:deploy', 'firmware:download',
    'littlefs:view', 'littlefs:manage', 'littlefs:upload', 'littlefs:download',
    'config:view', 'config:manage', 'config:sync',
    'commands:execute', 'commands:view',
    'telemetry:view', 'audit:view'
  ],
  FAMILY_MEMBER: [
    'homes:view', 'rooms:view',
    'devices:view', 'devices:control',
    'commands:execute', 'commands:view',
    'telemetry:view'
  ],
  GUEST: [
    'homes:view', 'rooms:view',
    'devices:view', 'devices:control',
    'commands:execute', 'commands:view'
  ],
  ADMIN: [
    'users:manage', 'scopes:manage',
    'homes:view', 'homes:manage', 'homes:create',
    'rooms:view', 'rooms:manage',
    'devices:view', 'devices:manage', 'devices:control', 'devices:reboot', 'devices:assign', 'devices:move',
    'firmware:view', 'firmware:upload', 'firmware:deploy', 'firmware:download',
    'littlefs:view', 'littlefs:manage', 'littlefs:upload', 'littlefs:download', 'littlefs:delete', 'littlefs:backup',
    'config:view', 'config:manage', 'config:sync',
    'commands:execute', 'commands:view',
    'telemetry:view', 'audit:view'
  ],
  DEVICE_MANAGER: [
    'homes:view', 'rooms:view',
    'devices:view', 'devices:manage', 'devices:control', 'devices:reboot', 'devices:assign', 'devices:move',
    'firmware:view', 'firmware:deploy', 'firmware:download',
    'littlefs:view', 'littlefs:manage', 'littlefs:upload', 'littlefs:download', 'littlefs:backup',
    'config:view', 'config:manage', 'config:sync',
    'commands:execute', 'commands:view',
    'telemetry:view', 'audit:view'
  ],
  OPERATOR: [
    'homes:view', 'rooms:view',
    'devices:view', 'devices:control', 'devices:reboot',
    'commands:execute', 'commands:view',
    'telemetry:view'
  ],
  VIEWER: [
    'homes:view', 'rooms:view',
    'devices:view',
    'commands:view',
    'telemetry:view'
  ],
  DEVELOPER: [
    'homes:view', 'rooms:view',
    'devices:view', 'devices:control', 'devices:reboot',
    'firmware:view', 'firmware:upload', 'firmware:deploy', 'firmware:download',
    'littlefs:view', 'littlefs:manage', 'littlefs:upload', 'littlefs:download',
    'config:view', 'config:manage',
    'commands:execute', 'commands:view',
    'telemetry:view', 'audit:view'
  ]
};

const ALL_PERMISSIONS = [
  { code: 'system:manage', name: 'System Administration', category: 'SYSTEM', description: 'Manage system settings, backups and global recovery' },
  { code: 'users:manage', name: 'User Administration', category: 'USERS', description: 'Create, edit, deactivate users and reset passwords' },
  { code: 'roles:manage', name: 'Role & Permission Administration', category: 'USERS', description: 'Configure roles, assign scopes and permissions' },
  { code: 'scopes:manage', name: 'Scope Administration', category: 'USERS', description: 'Create, edit and manage resource scopes' },
  { code: 'homes:view', name: 'View Homes', category: 'HOMES', description: 'View accessible homes, summary and activity' },
  { code: 'homes:manage', name: 'Manage Homes', category: 'HOMES', description: 'Configure homes, manage members and home settings' },
  { code: 'homes:create', name: 'Create Homes', category: 'HOMES', description: 'Create new residential homes and properties' },
  { code: 'homes:delete', name: 'Delete Homes', category: 'HOMES', description: 'Archive or permanently delete homes' },
  { code: 'rooms:view', name: 'View Rooms', category: 'ROOMS', description: 'Inspect room layouts, relays and sensors' },
  { code: 'rooms:manage', name: 'Manage Rooms', category: 'ROOMS', description: 'Create, rename and delete rooms' },
  { code: 'devices:view', name: 'View Devices', category: 'DEVICES', description: 'View device telemetry, status and properties' },
  { code: 'devices:manage', name: 'Manage Devices', category: 'DEVICES', description: 'Register, edit and configure IoT nodes' },
  { code: 'devices:control', name: 'Control Devices', category: 'DEVICES', description: 'Switch relays, trigger pulses and change outputs' },
  { code: 'devices:reboot', name: 'Reboot Microcontrollers', category: 'DEVICES', description: 'Soft-reboot devices remotely' },
  { code: 'devices:delete', name: 'Delete Devices', category: 'DEVICES', description: 'Unregister and remove devices from fleet' },
  { code: 'devices:assign', name: 'Assign Devices', category: 'DEVICES', description: 'Assign unassigned IoT nodes to rooms' },
  { code: 'devices:move', name: 'Move Devices', category: 'DEVICES', description: 'Reassign devices between rooms and homes' },
  { code: 'firmware:view', name: 'View Firmware', category: 'FIRMWARE', description: 'Inspect firmware release catalog' },
  { code: 'firmware:upload', name: 'Upload Firmware', category: 'FIRMWARE', description: 'Upload new firmware binaries to server' },
  { code: 'firmware:deploy', name: 'Deploy OTA Updates', category: 'FIRMWARE', description: 'Flash firmware onto microcontrollers over Wi-Fi' },
  { code: 'firmware:download', name: 'Download Firmware', category: 'FIRMWARE', description: 'Download stored firmware binaries' },
  { code: 'littlefs:view', name: 'View LittleFS Files', category: 'FILESYSTEM', description: 'Browse files and storage metrics on device filesystem' },
  { code: 'littlefs:manage', name: 'Manage LittleFS Filesystem', category: 'FILESYSTEM', description: 'Full LittleFS file operations' },
  { code: 'littlefs:upload', name: 'Upload LittleFS File', category: 'FILESYSTEM', description: 'Upload files to device filesystem' },
  { code: 'littlefs:download', name: 'Download LittleFS File', category: 'FILESYSTEM', description: 'Download files from device filesystem' },
  { code: 'littlefs:delete', name: 'Delete LittleFS File', category: 'FILESYSTEM', description: 'Remove files from device filesystem' },
  { code: 'littlefs:backup', name: 'Backup LittleFS Filesystem', category: 'FILESYSTEM', description: 'Create filesystem archives and snapshots' },
  { code: 'config:view', name: 'View Device Configuration', category: 'CONFIG', description: 'Inspect device configuration tree' },
  { code: 'config:manage', name: 'Manage Device Configuration', category: 'CONFIG', description: 'Edit configuration parameters' },
  { code: 'config:sync', name: 'Synchronize Configuration', category: 'CONFIG', description: 'Trigger bidirectional configuration sync' },
  { code: 'config:rollback', name: 'Rollback Configuration', category: 'CONFIG', description: 'Revert to prior configuration version' },
  { code: 'commands:execute', name: 'Execute Commands', category: 'DEVICES', description: 'Issue authorized commands to devices' },
  { code: 'commands:view', name: 'View Commands', category: 'DEVICES', description: 'Inspect command queue and acknowledgement history' },
  { code: 'telemetry:view', name: 'View Telemetry', category: 'TELEMETRY', description: 'Access live telemetry, history and charts' },
  { code: 'audit:view', name: 'View Audit Logs', category: 'SYSTEM', description: 'Inspect security audit logs and system event history' }
];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) {
    // Legacy plaintext fallback for first-time migration
    return password === storedHash;
  }
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const checkHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  try {
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(checkHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return hash === checkHash;
  }
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware: Authenticates user session via Bearer Token or Cookie.
 * Attaches req.user (with roles, permissions, scopes).
 */
function authenticateUser(db) {
  return (req, res, next) => {
    let token = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers.cookie) {
      const match = req.headers.cookie.match(/(?:^|;\s*)session=([a-f0-9]+)(?:;|$)/i);
      if (match) token = match[1].trim();
    }

    // Node machine-to-machine telemetry fallback
    if (!token && req.headers['x-node-id']) {
      req.isNodeRequest = true;
      return next();
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
    }

    const session = db.getSession(token);
    if (!session || session.is_revoked || new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked. Please sign in again.' });
    }

    const user = db.getUserById(session.user_id);
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, error: 'User account is deactivated or deleted' });
    }

    // Attach active user session & permissions
    user.roles = db.getUserRoles(user.id);
    user.permissions = db.getUserPermissions(user.id);
    user.scopes = db.getUserScopes(user.id);

    req.user = user;
    req.sessionToken = token;

    // Update last activity
    db.touchSession(token);
    next();
  };
}

/**
 * Middleware generator: Deny-by-default permission authorization.
 */
function requirePermission(db, requiredPermission) {
  const auth = authenticateUser(db);
  return (req, res, next) => {
    auth(req, res, () => {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      if (req.user.is_superuser) {
        return next();
      }

      if (!req.user.permissions || !req.user.permissions.includes(requiredPermission)) {
        return res.status(403).json({
          success: false,
          error: `Forbidden: Missing required permission '${requiredPermission}'`
        });
      }

      next();
    });
  };
}

/**
 * Role hierarchy levels for multi-tenant home RBAC.
 */
const ROLE_HIERARCHY_LEVELS = {
  SUPER_ADMIN: 99,
  HOME_OWNER: 40,
  HOME_ADMIN: 30,
  FAMILY_MEMBER: 20,
  GUEST: 10,
  VIEWER: 5
};

function isRoleSufficient(userRole, requiredRole) {
  const userLevel = ROLE_HIERARCHY_LEVELS[userRole] || 0;
  const reqLevel = ROLE_HIERARCHY_LEVELS[requiredRole] || 0;
  return userLevel >= reqLevel;
}

/**
 * Checks whether user scopes or home/room memberships permit access to a node.
 */
function verifyDeviceScope(user, node, db = null) {
  if (!user) return false;
  if (user.is_superuser) return true;

  // 1. Direct device permission table check
  if (db && node && db.getDevicePermission) {
    const devPerm = db.getDevicePermission(node.node_id, user.id);
    if (devPerm) return true;
  }

  // 2. Home & Room hierarchical membership check
  if (db && node && node.home_id && db.getHomeMember) {
    const member = db.getHomeMember(node.home_id, user.id);
    if (member) {
      // Home Owners and Admins inherit full access to all rooms and devices in the home
      if (member.role === 'HOME_OWNER' || member.role === 'HOME_ADMIN') {
        return true;
      }

      // Family members and guests: check if restricted to specific rooms
      if (member.role === 'FAMILY_MEMBER' || member.role === 'GUEST' || member.role === 'VIEWER') {
        if (!node.room_id) {
          // Unassigned node in home: visible only to Home Admins & Owners
          return false;
        }
        if (db.getUserRoomsInHome) {
          const userRooms = db.getUserRoomsInHome(node.home_id, user.id);
          // If no specific room restrictions assigned, grant access to all rooms in the home
          if (!userRooms || userRooms.length === 0) {
            return true;
          }
          if (userRooms.some(r => r.id === node.room_id || r.room_id === node.room_id)) {
            return true;
          }
        } else {
          return true;
        }
      }
    }
  }

  // 3. Fallback to user resource scopes
  if (!user.scopes || user.scopes.length === 0) {
    return false;
  }

  for (const sc of user.scopes) {
    const stype = (sc.scope_type || '').toUpperCase();
    const sident = (sc.scope_identifier || '').toLowerCase();

    if (stype === 'GLOBAL' || sident === 'global') {
      return true;
    }

    if (node) {
      if (stype === 'HOME' && node.home_id && String(node.home_id) === sident) {
        return true;
      }
      if (stype === 'ROOM') {
        if (node.room_id && String(node.room_id) === sident) return true;
        if (node.room && sident === node.room.toLowerCase()) return true;
      }
      if (stype === 'INDIVIDUAL_DEVICE' && node.node_id && sident === node.node_id.toLowerCase()) {
        return true;
      }
      if (stype === 'DEVICE_GROUP' && node.device_group && sident === node.device_group.toLowerCase()) {
        return true;
      }
      if ((stype === 'LOCATION' || stype === 'BUILDING' || stype === 'FLOOR') && node.location && node.location.toLowerCase().includes(sident)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Middleware: Requires a minimum home role (HOME_OWNER, HOME_ADMIN, FAMILY_MEMBER, etc.)
 */
function requireHomeRole(db, minRequiredRole = 'VIEWER') {
  const auth = authenticateUser(db);
  return (req, res, next) => {
    auth(req, res, () => {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      if (req.user.is_superuser) {
        return next();
      }

      const homeId = Number(req.params.homeId || req.body.homeId || req.query.homeId);
      if (!homeId) {
        return res.status(400).json({ success: false, error: 'homeId is required for this operation' });
      }

      const member = db.getHomeMember(homeId, req.user.id);
      if (!member) {
        return res.status(403).json({ success: false, error: 'Forbidden: You are not a member of this home' });
      }

      if (!isRoleSufficient(member.role, minRequiredRole)) {
        return res.status(403).json({
          success: false,
          error: `Forbidden: Requires minimum role '${minRequiredRole}' in this home (current: '${member.role}')`
        });
      }

      req.homeMember = member;
      next();
    });
  };
}

module.exports = {
  DEFAULT_ROLES_PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_HIERARCHY_LEVELS,
  isRoleSufficient,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  authenticateUser,
  requirePermission,
  requireHomeRole,
  verifyDeviceScope
};
