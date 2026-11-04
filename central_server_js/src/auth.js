const crypto = require('node:crypto');

const DEFAULT_ROLES_PERMISSIONS = {
  SUPER_ADMIN: [
    'system:manage', 'users:manage', 'roles:manage', 'scopes:manage',
    'devices:view', 'devices:manage', 'devices:control', 'devices:reboot', 'devices:delete',
    'firmware:view', 'firmware:upload', 'firmware:deploy', 'firmware:download',
    'littlefs:view', 'littlefs:manage', 'littlefs:upload', 'littlefs:download', 'littlefs:delete', 'littlefs:backup',
    'config:view', 'config:manage', 'config:sync', 'config:rollback',
    'commands:execute', 'commands:view',
    'telemetry:view', 'audit:view'
  ],
  ADMIN: [
    'users:manage', 'scopes:manage',
    'devices:view', 'devices:manage', 'devices:control', 'devices:reboot',
    'firmware:view', 'firmware:upload', 'firmware:deploy', 'firmware:download',
    'littlefs:view', 'littlefs:manage', 'littlefs:upload', 'littlefs:download', 'littlefs:delete', 'littlefs:backup',
    'config:view', 'config:manage', 'config:sync',
    'commands:execute', 'commands:view',
    'telemetry:view', 'audit:view'
  ],
  DEVICE_MANAGER: [
    'devices:view', 'devices:manage', 'devices:control', 'devices:reboot',
    'firmware:view', 'firmware:deploy', 'firmware:download',
    'littlefs:view', 'littlefs:manage', 'littlefs:upload', 'littlefs:download', 'littlefs:backup',
    'config:view', 'config:manage', 'config:sync',
    'commands:execute', 'commands:view',
    'telemetry:view', 'audit:view'
  ],
  OPERATOR: [
    'devices:view', 'devices:control', 'devices:reboot',
    'commands:execute', 'commands:view',
    'telemetry:view'
  ],
  VIEWER: [
    'devices:view',
    'commands:view',
    'telemetry:view'
  ],
  DEVELOPER: [
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
  { code: 'devices:view', name: 'View Devices', category: 'DEVICES', description: 'View device telemetry, status and properties' },
  { code: 'devices:manage', name: 'Manage Devices', category: 'DEVICES', description: 'Register, edit and configure IoT nodes' },
  { code: 'devices:control', name: 'Control Devices', category: 'DEVICES', description: 'Switch relays, trigger pulses and change outputs' },
  { code: 'devices:reboot', name: 'Reboot Microcontrollers', category: 'DEVICES', description: 'Soft-reboot devices remotely' },
  { code: 'devices:delete', name: 'Delete Devices', category: 'DEVICES', description: 'Unregister and remove devices from fleet' },
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
  const checkHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === checkHash;
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

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1].trim();
    } else if (req.headers.cookie) {
      const match = req.headers.cookie.match(/session=([a-f0-9]+)/);
      if (match) token = match[1];
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
 * Checks whether user scopes permit access to a node / resource.
 */
function verifyDeviceScope(user, node) {
  if (!user) return false;
  if (user.is_superuser) return true;

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
      if (stype === 'INDIVIDUAL_DEVICE' && node.node_id && sident === node.node_id.toLowerCase()) {
        return true;
      }
      if (stype === 'ROOM' && node.room && sident === node.room.toLowerCase()) {
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

module.exports = {
  DEFAULT_ROLES_PERMISSIONS,
  ALL_PERMISSIONS,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  authenticateUser,
  requirePermission,
  verifyDeviceScope
};
