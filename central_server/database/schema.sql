-- ==============================================================================
-- SmartHome Central Management Platform - Production PostgreSQL Schema
-- Supports: ESP8266, ESP32, ESP-01 Fleets, Multi-Protocol Telemetry, Automations
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS & ACCESS CONTROL
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    is_superuser BOOLEAN DEFAULT FALSE NOT NULL,
    role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    expires_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. NODES & FLEET TOPOLOGY
CREATE TABLE IF NOT EXISTS nodes (
    id SERIAL PRIMARY KEY,
    node_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    hardware_type VARCHAR(50) DEFAULT 'ESP8266' NOT NULL,
    firmware_version VARCHAR(50) DEFAULT '1.6.0' NOT NULL,
    ip_address VARCHAR(50),
    mac_address VARCHAR(50),
    gateway VARCHAR(50),
    rssi INTEGER DEFAULT 0,
    uptime_sec BIGINT DEFAULT 0,
    free_heap BIGINT DEFAULT 0,
    is_online BOOLEAN DEFAULT FALSE NOT NULL,
    status VARCHAR(50) DEFAULT 'Offline' NOT NULL,
    room VARCHAR(100) DEFAULT 'General' NOT NULL,
    location VARCHAR(100) DEFAULT '',
    category VARCHAR(50) DEFAULT 'Relay Controller' NOT NULL,
    auth_token VARCHAR(255),
    last_seen_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_online ON nodes(is_online);
CREATE INDEX IF NOT EXISTS idx_nodes_room ON nodes(room);
CREATE INDEX IF NOT EXISTS idx_nodes_hardware ON nodes(hardware_type);

CREATE TABLE IF NOT EXISTS node_connections (
    id SERIAL PRIMARY KEY,
    node_id VARCHAR(100) NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
    protocol VARCHAR(20) NOT NULL,
    remote_ip VARCHAR(50),
    connected_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    disconnected_at TIMESTAMP WITHOUT TIME ZONE,
    disconnect_reason VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS node_heartbeats (
    id BIGSERIAL PRIMARY KEY,
    node_id VARCHAR(100) NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    epoch DOUBLE PRECISION NOT NULL,
    rssi INTEGER DEFAULT 0,
    free_heap BIGINT DEFAULT 0,
    uptime_sec BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_node_time ON node_heartbeats(node_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS node_configuration (
    id SERIAL PRIMARY KEY,
    node_id VARCHAR(100) UNIQUE NOT NULL,
    config_json TEXT NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 3. GPIO & RELAY MANAGEMENT
CREATE TABLE IF NOT EXISTS relays (
    id SERIAL PRIMARY KEY,
    node_id VARCHAR(100) NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL,
    pin INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    room VARCHAR(100) DEFAULT 'General' NOT NULL,
    function VARCHAR(50) DEFAULT 'Relay' NOT NULL,
    active_low BOOLEAN DEFAULT TRUE NOT NULL,
    initial_mode INTEGER DEFAULT 0 NOT NULL,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    current_state BOOLEAN DEFAULT FALSE NOT NULL,
    requested_state BOOLEAN DEFAULT FALSE NOT NULL,
    is_syncing BOOLEAN DEFAULT FALSE NOT NULL,
    last_changed_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uq_node_channel UNIQUE (node_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_relays_state ON relays(current_state);

CREATE TABLE IF NOT EXISTS relay_events (
    id BIGSERIAL PRIMARY KEY,
    relay_id INTEGER REFERENCES relays(id) ON DELETE CASCADE,
    node_id VARCHAR(100) NOT NULL,
    channel_id INTEGER NOT NULL,
    old_state BOOLEAN,
    new_state BOOLEAN NOT NULL,
    trigger_source VARCHAR(50) DEFAULT 'SYSTEM' NOT NULL,
    command_id VARCHAR(100),
    confirmed BOOLEAN DEFAULT TRUE NOT NULL,
    timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relay_events_time ON relay_events(timestamp DESC);

-- 4. DYNAMIC SENSOR FRAMEWORK
CREATE TABLE IF NOT EXISTS sensors (
    id SERIAL PRIMARY KEY,
    sensor_id VARCHAR(100) UNIQUE NOT NULL,
    node_id VARCHAR(100) NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    sensor_type VARCHAR(50) NOT NULL,
    unit VARCHAR(20) DEFAULT '' NOT NULL,
    gpio_pin INTEGER,
    interface VARCHAR(50) DEFAULT 'GPIO' NOT NULL,
    current_value DOUBLE PRECISION,
    previous_value DOUBLE PRECISION,
    is_binary BOOLEAN DEFAULT FALSE NOT NULL,
    binary_state BOOLEAN,
    min_threshold DOUBLE PRECISION,
    max_threshold DOUBLE PRECISION,
    alert_enabled BOOLEAN DEFAULT FALSE NOT NULL,
    last_updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sensors_type ON sensors(sensor_type);

CREATE TABLE IF NOT EXISTS sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    sensor_id INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    node_id VARCHAR(100) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    unit VARCHAR(20) DEFAULT '' NOT NULL,
    timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    epoch DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_time ON sensor_readings(sensor_id, timestamp DESC);

-- 5. CENTRAL AUTOMATION ENGINE
CREATE TABLE IF NOT EXISTS automation_rules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) DEFAULT '',
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    trigger_type VARCHAR(50) DEFAULT 'SENSOR' NOT NULL,
    condition_logic VARCHAR(10) DEFAULT 'AND' NOT NULL,
    cron_expression VARCHAR(100),
    schedule_time VARCHAR(10),
    schedule_days VARCHAR(50) DEFAULT 'ALL' NOT NULL,
    cooldown_seconds INTEGER DEFAULT 5 NOT NULL,
    last_executed_at TIMESTAMP WITHOUT TIME ZONE,
    execution_count INTEGER DEFAULT 0 NOT NULL,
    last_error VARCHAR(255),
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_conditions (
    id SERIAL PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    condition_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(100) NOT NULL,
    operator VARCHAR(20) NOT NULL,
    value_numeric DOUBLE PRECISION,
    value_numeric_max DOUBLE PRECISION,
    value_boolean BOOLEAN,
    value_string VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS automation_actions (
    id SERIAL PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    sequence_order INTEGER DEFAULT 1 NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    target_node_id VARCHAR(100),
    target_channel_id INTEGER,
    parameter_value DOUBLE PRECISION DEFAULT 0.0 NOT NULL,
    message VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS automation_executions (
    id BIGSERIAL PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    trigger_source VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'SUCCESS' NOT NULL,
    execution_time_ms DOUBLE PRECISION DEFAULT 0.0 NOT NULL,
    message TEXT,
    timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auto_exec_time ON automation_executions(timestamp DESC);

-- 6. PARTITION-READY TELEMETRY STORAGE
CREATE TABLE IF NOT EXISTS telemetry (
    id BIGSERIAL,
    node_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(50) DEFAULT 'heartbeat' NOT NULL,
    ip VARCHAR(50),
    rssi INTEGER DEFAULT 0,
    free_heap BIGINT DEFAULT 0,
    uptime_sec BIGINT DEFAULT 0,
    payload_json TEXT NOT NULL,
    timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    epoch DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Default sub-partition for modern telemetry
CREATE TABLE IF NOT EXISTS telemetry_current PARTITION OF telemetry
    FOR VALUES FROM ('2026-01-01') TO ('2030-01-01');

CREATE INDEX IF NOT EXISTS idx_telemetry_node_time ON telemetry(node_id, timestamp DESC);

-- 7. FIRMWARE & OTA MANAGEMENT
CREATE TABLE IF NOT EXISTS firmware_files (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    hardware_type VARCHAR(50) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    checksum_md5 VARCHAR(64) NOT NULL,
    checksum_sha256 VARCHAR(128) NOT NULL,
    storage_path VARCHAR(500) NOT NULL,
    description VARCHAR(255) DEFAULT '',
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS firmware_deployments (
    id SERIAL PRIMARY KEY,
    firmware_id INTEGER NOT NULL REFERENCES firmware_files(id) ON DELETE CASCADE,
    node_id VARCHAR(100) NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'PENDING' NOT NULL,
    progress_percent DOUBLE PRECISION DEFAULT 0.0 NOT NULL,
    error_message TEXT,
    started_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at TIMESTAMP WITHOUT TIME ZONE
);

-- 8. SYSTEM EVENTS, AUDIT LOGS, NOTIFICATIONS & SETTINGS
CREATE TABLE IF NOT EXISTS system_events (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    node_id VARCHAR(100),
    category VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'INFO' NOT NULL,
    description TEXT NOT NULL,
    execution_result VARCHAR(50) DEFAULT 'SUCCESS' NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sys_events_time ON system_events(timestamp DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    username VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    target VARCHAR(100),
    details TEXT,
    ip_address VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'INFO' NOT NULL,
    read BOOLEAN DEFAULT FALSE NOT NULL,
    node_id VARCHAR(100),
    timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value_json TEXT NOT NULL,
    description VARCHAR(255) DEFAULT '',
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Seed Default Roles
INSERT INTO roles (id, name, description) VALUES
    (1, 'Administrator', 'Full system access and hardware control'),
    (2, 'Operator', 'Can control relays and run automations'),
    (3, 'Viewer', 'Read-only access to dashboard and telemetry')
ON CONFLICT (id) DO NOTHING;
