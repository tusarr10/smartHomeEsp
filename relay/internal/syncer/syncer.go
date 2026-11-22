package syncer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"smarthome-edge/internal/config"
	"smarthome-edge/internal/state"
)

type CentralSyncer struct {
	mu             sync.RWMutex
	cfg            *config.Config
	sm             *state.StateManager
	httpClient     *http.Client
	isCentralAlive bool
	lastPingEpoch  int64
}

func NewCentralSyncer(cfg *config.Config, sm *state.StateManager) *CentralSyncer {
	return &CentralSyncer{
		cfg: cfg,
		sm:  sm,
		httpClient: &http.Client{
			Timeout: time.Duration(cfg.Central.TimeoutMS) * time.Millisecond,
		},
	}
}

func (s *CentralSyncer) Start() {
	if s.cfg.Central.Enabled {
		go s.healthCheckLoop()
	}
	if s.cfg.Breaker.Enabled {
		go s.breakerPollLoop()
	}
}

func (s *CentralSyncer) IsCentralOnline() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.isCentralAlive
}

func (s *CentralSyncer) healthCheckLoop() {
	interval := time.Duration(s.cfg.Central.SyncIntervalSeconds) * time.Second
	if interval < 2*time.Second {
		interval = 5 * time.Second
	}

	ticker := time.NewTicker(interval)
	s.checkHealth()

	for range ticker.C {
		s.checkHealth()
	}
}

func (s *CentralSyncer) checkHealth() {
	endpoint := fmt.Sprintf("%s/api/nodes", s.cfg.Central.URL)
	resp, err := s.httpClient.Get(endpoint)

	s.mu.Lock()
	defer s.mu.Unlock()

	s.lastPingEpoch = time.Now().Unix()
	wasAlive := s.isCentralAlive

	if err == nil && resp.StatusCode == http.StatusOK {
		_ = resp.Body.Close()
		s.isCentralAlive = true
		if !wasAlive {
			log.Printf("[Central Syncer] Central Server (%s) is ONLINE. Telemetry streaming active.", s.cfg.Central.URL)
		}
	} else {
		if resp != nil {
			_ = resp.Body.Close()
		}
		s.isCentralAlive = false
		if wasAlive {
			log.Printf("[Central Syncer] Central Server (%s) went OFFLINE. Operating in standalone edge mode.", s.cfg.Central.URL)
		}
	}
}

// ForwardTelemetry proxies raw node telemetry to the Central Server if online
func (s *CentralSyncer) ForwardTelemetry(raw []byte) {
	if !s.cfg.Central.Enabled || !s.IsCentralOnline() {
		return
	}

	endpoint := fmt.Sprintf("%s/api/telemetry", s.cfg.Central.URL)
	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(raw))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "SmartHome-Edge-Broker/1.0.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		var responseData struct {
			Status   string           `json:"status"`
			Commands []*state.Command `json:"commands"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&responseData); err == nil {
			// If Central Server queued commands, forward them to the local node queue
			if len(responseData.Commands) > 0 {
				var targetNodeID struct {
					NodeID string `json:"nodeId"`
				}
				_ = json.Unmarshal(raw, &targetNodeID)
				if targetNodeID.NodeID != "" {
					for _, cmd := range responseData.Commands {
						s.sm.QueueCommand(targetNodeID.NodeID, cmd)
					}
				}
			}
		}
	}
}

// Breaker Poller
func (s *CentralSyncer) breakerPollLoop() {
	interval := time.Duration(s.cfg.Breaker.PollIntervalSeconds) * time.Second
	if interval < 1*time.Second {
		interval = 3 * time.Second
	}

	ticker := time.NewTicker(interval)
	s.pollBreaker()

	for range ticker.C {
		s.pollBreaker()
	}
}

func (s *CentralSyncer) pollBreaker() {
	endpoint := fmt.Sprintf("%s/api/status", s.cfg.Breaker.PortalURL)
	resp, err := s.httpClient.Get(endpoint)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var portalData struct {
		Config struct {
			DeviceID   string `json:"device_id"`
			DeviceName string `json:"device_name"`
			IPAddress  string `json:"ip_address"`
		} `json:"config"`
		Reading struct {
			Online  bool `json:"online"`
			Decoded struct {
				SwitchState        bool    `json:"switch_state"`
				VoltageV           float64 `json:"voltage_v"`
				CurrentA           float64 `json:"current_a"`
				PowerW             float64 `json:"power_w"`
				FrequencyHz        float64 `json:"frequency_hz"`
				TemperatureC       float64 `json:"temperature_c"`
				LeakageCurrentMA   float64 `json:"leakage_current_ma"`
				TotalEnergyKWh     float64 `json:"total_energy_kwh"`
				ChildLock          bool    `json:"child_lock"`
				PowerFactor        float64 `json:"power_factor"`
				OvercurrentLimitA  float64 `json:"overcurrent_limit_a"`
				HighTempThresholdC float64 `json:"high_temp_threshold_c"`
				LeakageThresholdMA float64 `json:"leakage_threshold_ma"`
			} `json:"decoded"`
		} `json:"reading"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&portalData); err != nil {
		return
	}

	bt := state.BreakerTelemetry{
		Online:     portalData.Reading.Online,
		DeviceID:   portalData.Config.DeviceID,
		DeviceName: portalData.Config.DeviceName,
		IP:         portalData.Config.IPAddress,
		Timestamp:  time.Now(),
		Decoded:    portalData.Reading.Decoded,
	}

	if bt.DeviceID == "" {
		bt.DeviceID = s.cfg.Breaker.NodeID
	}
	if bt.DeviceName == "" {
		bt.DeviceName = "Wi-Fi Smart Circuit Breaker"
	}

	s.sm.UpdateBreaker(bt)
}

func (s *CentralSyncer) SetBreakerSwitch(state bool) error {
	endpoint := fmt.Sprintf("%s/api/control", s.cfg.Breaker.PortalURL)
	payload := map[string]interface{}{
		"switch": state,
		"dp":     108,
		"value":  state,
	}

	b, _ := json.Marshal(payload)
	resp, err := s.httpClient.Post(endpoint, "application/json", bytes.NewReader(b))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		// Update optimistic state
		cur := s.sm.GetBreaker()
		cur.Decoded.SwitchState = state
		s.sm.UpdateBreaker(cur)
		return nil
	}

	return fmt.Errorf("breaker control returned status %d", resp.StatusCode)
}
