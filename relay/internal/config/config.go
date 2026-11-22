package config

import (
	"encoding/json"
	"fmt"
	"os"
)

type Config struct {
	Server   ServerConfig   `json:"server"`
	Protocol ProtocolConfig `json:"protocol"`
	Security SecurityConfig `json:"security"`
	Central  CentralConfig  `json:"central"`
	Storage  StorageConfig  `json:"storage"`
	Breaker  BreakerConfig  `json:"breaker"`
}

type ServerConfig struct {
	TCPListen     string `json:"tcp_listen"`
	HTTPListen    string `json:"http_listen"`
	MetricsListen string `json:"metrics_listen"`
}

type ProtocolConfig struct {
	Version               int `json:"version"`
	MaxPacketSize         int `json:"max_packet_size"`
	HeartbeatSeconds      int `json:"heartbeat_seconds"`
	OfflineTimeoutSeconds int `json:"offline_timeout_seconds"`
}

type SecurityConfig struct {
	RequireNodeAuth    bool   `json:"require_node_auth"`
	RequireMobileToken bool   `json:"require_mobile_token"`
	SharedSecret       string `json:"shared_secret"`
	PublicKeyPath      string `json:"public_key_path"`
}

type CentralConfig struct {
	Enabled             bool   `json:"enabled"`
	URL                 string `json:"url"`
	SyncIntervalSeconds int    `json:"sync_interval_seconds"`
	TimeoutMS           int    `json:"timeout_ms"`
}

type StorageConfig struct {
	DataDir         string `json:"data_dir"`
	EventQueueMaxMB int    `json:"event_queue_max_mb"`
}

type BreakerConfig struct {
	Enabled             bool   `json:"enabled"`
	PortalURL           string `json:"portal_url"`
	DirectIP            string `json:"direct_ip"`
	DeviceID            string `json:"device_id"`
	LocalKey            string `json:"local_key"`
	PollIntervalSeconds int    `json:"poll_interval_seconds"`
	NodeID              string `json:"node_id"`
}

func DefaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			TCPListen:     "0.0.0.0:2000",
			HTTPListen:    "0.0.0.0:9200",
			MetricsListen: "127.0.0.1:9201",
		},
		Protocol: ProtocolConfig{
			Version:               1,
			MaxPacketSize:         16384,
			HeartbeatSeconds:      15,
			OfflineTimeoutSeconds: 45,
		},
		Security: SecurityConfig{
			RequireNodeAuth:    false,
			RequireMobileToken: false,
			SharedSecret:       "smarthome-edge-secret-key",
			PublicKeyPath:      "",
		},
		Central: CentralConfig{
			Enabled:             true,
			URL:                 "http://127.0.0.1:9100",
			SyncIntervalSeconds: 5,
			TimeoutMS:           2500,
		},
		Storage: StorageConfig{
			DataDir:         "./data",
			EventQueueMaxMB: 16,
		},
		Breaker: BreakerConfig{
			Enabled:             true,
			PortalURL:           "http://192.168.1.10:8085",
			DirectIP:            "192.168.1.25",
			DeviceID:            "d705ffaccaf4d0f1b1addg",
			LocalKey:            "gp->j2_X[Bx=.ovC",
			PollIntervalSeconds: 3,
			NodeID:              "NODE-30487DE85D5C",
		},
	}
}

func LoadConfig(path string) (*Config, error) {
	cfg := DefaultConfig()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, fmt.Errorf("read config file: %w", err)
	}
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config json: %w", err)
	}
	return cfg, nil
}
