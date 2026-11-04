const path = require('path');
const fs = require('fs');
const FleetDatabase = require('./src/database');
const NodeManager = require('./src/nodeManager');
const ConfigSyncService = require('./src/configSyncService');
const { verifyDeviceScope } = require('./src/auth');

async function runTests() {
  console.log('=== STARTING INTEGRATION TESTS ===\n');

  const testDbPath = path.join(__dirname, 'data', 'test_fleet_integration.db');
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch {}
  }

  const db = new FleetDatabase(testDbPath);
  const nm = new NodeManager(db, {});
  const configSync = new ConfigSyncService(db, nm);

  // --- TEST 1: Admin User & Seeded RBAC ---
  console.log('1. Testing Admin User & Default RBAC Roles & Scopes...');
  const admin = db.getUserByUsername('admin');
  if (!admin || !admin.is_superuser) throw new Error('Admin user was not created or is not superuser');
  const adminRoles = db.getUserRoles(admin.id);
  const adminPerms = db.getUserPermissions(admin.id);
  const adminScopes = db.getUserScopes(admin.id);
  console.log('   Admin user verified:', admin.username);
  console.log('   Admin roles:', adminRoles);
  console.log('   Admin permissions count:', adminPerms.length);
  console.log('   Admin scopes:', adminScopes.map(s => s.scope_identifier));
  if (!adminRoles.includes('SUPER_ADMIN')) throw new Error('Missing SUPER_ADMIN role');
  if (adminPerms.length !== 27) throw new Error('Expected 27 permissions');
  console.log('   [PASS] Default seed verified.\n');

  // --- TEST 2: User Creation, Role & Scope Assignment ---
  console.log('2. Testing New User Creation & Restricted Role Assignment...');
  const viewerUser = db.createUser({
    username: 'john_viewer',
    password: 'password123',
    full_name: 'John Viewer',
    email: 'john@example.com',
    is_superuser: 0,
    role_names: ['VIEWER']
  });
  const viewerPerms = db.getUserPermissions(viewerUser.id);
  console.log('   Created viewer:', viewerUser.username);
  console.log('   Viewer permissions:', viewerPerms);
  if (viewerPerms.includes('devices:control') || viewerPerms.includes('users:manage')) {
    throw new Error('Viewer has forbidden write permissions!');
  }
  if (!viewerPerms.includes('devices:view')) {
    throw new Error('Viewer missing devices:view permission');
  }
  console.log('   [PASS] Role permissions properly isolated.\n');

  // --- TEST 3: Scope-based Access Control ---
  console.log('3. Testing Scope-Based Access Control...');
  const livingRoomScopeId = db.createScope({
    scope_type: 'ROOM',
    scope_identifier: 'living room',
    name: 'Living Room Scope',
    description: 'Access restricted to Living Room'
  });
  db.assignUserScopes(viewerUser.id, [livingRoomScopeId]);
  const userWithScope = db.getUserById(viewerUser.id);

  const livingRoomNode = { node_id: 'NODE-01', room: 'Living Room' };
  const bedroomNode = { node_id: 'NODE-02', room: 'Master Bedroom' };

  const canAccessLivingRoom = verifyDeviceScope(userWithScope, livingRoomNode);
  const canAccessBedroom = verifyDeviceScope(userWithScope, bedroomNode);
  const adminCanAccessBedroom = verifyDeviceScope(admin, bedroomNode);

  console.log('   Living Room Node access for scoped user:', canAccessLivingRoom);
  console.log('   Master Bedroom Node access for scoped user:', canAccessBedroom);
  console.log('   Master Bedroom Node access for superuser:', adminCanAccessBedroom);

  if (!canAccessLivingRoom || canAccessBedroom || !adminCanAccessBedroom) {
    throw new Error('Scope access resolution failed!');
  }
  console.log('   [PASS] Hierarchical scope resolution verified.\n');

  // --- TEST 4: Persistent Device Commands & Telemetry ACK Loop ---
  console.log('4. Testing Persistent Device Commands & Telemetry ACK Loop...');
  // Create simulated node
  db.upsertNode({
    nodeId: 'NODE-ESP8266-TEST',
    name: 'Test ESP8266 Node',
    ip: '192.168.1.50',
    hardware: 'ESP8266',
    firmwareVersion: '1.6.0',
    channels: [{ id: 1, pin: 5, name: 'Light Relay', state: false }]
  });

  const cmd = await nm.dispatchCommand('NODE-ESP8266-TEST', {
    action: 'setState',
    id: 1,
    state: true
  });
  console.log('   Dispatched command result:', cmd);
  if (!cmd.command_uuid) throw new Error('Command did not receive persistent UUID');

  // Verify command exists in database with status PENDING
  const storedCmd = db.getCommandByUuid(cmd.command_uuid);
  console.log('   Stored DB Command status:', storedCmd.status);
  if (storedCmd.status !== 'PENDING') throw new Error('Expected PENDING command in DB');

  // Simulate ESP Telemetry check-in containing application ACK
  console.log('   Simulating ESP node heartbeat with matching command ACK...');
  const telemetryWithAck = {
    nodeId: 'NODE-ESP8266-TEST',
    ip: '192.168.1.50',
    uptimeSec: 3600,
    freeHeap: 45000,
    acks: [
      {
        command_uuid: cmd.command_uuid,
        status: 'ACKNOWLEDGED',
        success: true,
        execution_time_ms: 12
      }
    ]
  };

  await nm.processTelemetry(telemetryWithAck, '192.168.1.50', 'TCP');

  const ackedCmd = db.getCommandByUuid(cmd.command_uuid);
  const cmdResults = db.getCommandResults(cmd.command_uuid);
  console.log('   Command status after telemetry ingestion:', ackedCmd.status);
  console.log('   Command results recorded:', cmdResults.length);

  if (ackedCmd.status !== 'ACKNOWLEDGED') throw new Error('Command was not marked ACKNOWLEDGED');
  if (cmdResults.length === 0) throw new Error('No command result record created');
  console.log('   [PASS] Persistent command queue and telemetry ACK loop verified.\n');

  // --- TEST 5: Authoritative Configuration Sync & Rollback ---
  console.log('5. Testing Authoritative Configuration Sync & Rollback...');
  const initialConfig = await configSync.getDeviceConfig('NODE-ESP8266-TEST');
  console.log('   Baseline config version:', initialConfig.config_version, 'Status:', initialConfig.sync_status);

  // Update configuration
  const updatedConf = JSON.parse(JSON.stringify(initialConfig.config));
  updatedConf.wifi.ssid = 'SmartHome_Production_5G';
  updatedConf.channels[0].name = 'Main Chandelier Light';

  const updateRes = await configSync.updateDeviceConfig(
    'NODE-ESP8266-TEST',
    updatedConf,
    admin.id,
    'Updated Wi-Fi SSID and Chandelier name'
  );
  console.log('   Updated config version:', updateRes.configuration.config_version, 'Status:', updateRes.configuration.sync_status);
  if (updateRes.configuration.config_version !== 2) throw new Error('Expected config version 2');

  const versions = configSync.getConfigurationVersions('NODE-ESP8266-TEST');
  console.log('   Configuration history versions count:', versions.length);

  // Rollback to version 1
  console.log('   Performing 1-click Rollback to version 1...');
  const rollbackRes = await configSync.rollbackDeviceConfig('NODE-ESP8266-TEST', 1, admin.id);
  console.log('   Rollback result version:', rollbackRes.currentVersion);
  if (rollbackRes.configuration.config.channels[0].name !== 'Light Relay') {
    throw new Error('Rollback did not restore original channel name');
  }
  console.log('   [PASS] Authoritative config versioning, sync states, and rollback verified.\n');

  console.log('=== ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
