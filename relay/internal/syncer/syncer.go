package syncer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"smarthome-edge/internal/config"
	"smarthome-edge/internal/state"
)

type CentralSyncer struct {
	mu              sync.RWMutex
	cfg             *config.Config
	sm              *state.StateManager
	httpClient      *http.Client
	isCentralAlive  bool
	lastPingEpoch   int64
	activePortalURL string
}

func NewCentralSyncer(cfg *config.Config, sm *state.StateManager) *CentralSyncer {
	portalURL := cfg.Breaker.PortalURL
	if portalURL == "" {
		portalURL = "http://192.168.1.10:8085"
	}
	return &CentralSyncer{
		cfg: cfg,
		sm:  sm,
		httpClient: &http.Client{
			Timeout: time.Duration(cfg.Central.TimeoutMS) * time.Millisecond,
		},
		activePortalURL: portalURL,
	}
}

func (s *CentralSyncer) getActivePortalURL() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.activePortalURL
}

func (s *CentralSyncer) setActivePortalURL(url string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activePortalURL = url
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
	currentPortal := s.getActivePortalURL()
	candidates := []string{
		currentPortal,
		s.cfg.Breaker.PortalURL,
		"http://192.168.1.10:8085",
		"http://127.0.0.1:8085",
		"http://192.168.1.2:8085",
	}

	var rawData []byte
	var successfulURL string

	for _, cand := range candidates {
		if cand == "" {
			continue
		}
		endpoint := fmt.Sprintf("%s/api/status", strings.TrimRight(cand, "/"))
		resp, err := s.httpClient.Get(endpoint)
		if err == nil && resp.StatusCode == http.StatusOK {
			body, readErr := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if readErr == nil && len(body) > 0 {
				rawData = body
				successfulURL = cand
				break
			}
		}
		if resp != nil {
			_ = resp.Body.Close()
		}
	}

	if rawData == nil {
		// Also try Central Server if online
		if s.cfg.Central.Enabled && s.IsCentralOnline() {
			endpoint := fmt.Sprintf("%s/api/v1/breaker/status", strings.TrimRight(s.cfg.Central.URL, "/"))
			resp, err := s.httpClient.Get(endpoint)
			if err == nil && resp.StatusCode == http.StatusOK {
				body, readErr := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				if readErr == nil && len(body) > 0 {
					rawData = body
				}
			}
			if resp != nil {
				_ = resp.Body.Close()
			}
		}
	}

	if rawData == nil {
		return
	}

	if successfulURL != "" && successfulURL != currentPortal {
		s.setActivePortalURL(successfulURL)
		log.Printf("[Central Syncer] Connected to Circuit Breaker Portal at %s", successfulURL)
	}

	var bd state.BreakerData
	if err := json.Unmarshal(rawData, &bd); err != nil {
		return
	}

	if bd.Config.DeviceID == "" {
		bd.Config.DeviceID = s.cfg.Breaker.NodeID
	}
	if bd.Config.DeviceName == "" {
		bd.Config.DeviceName = "Wi-Fi Smart Circuit Breaker"
	}
	if bd.Config.IPAddress == "" {
		bd.Config.IPAddress = s.cfg.Breaker.DirectIP
	}

	s.sm.UpdateBreaker(bd)
}

func (s *CentralSyncer) SetBreakerDP(dp string, val interface{}) error {
	portalURL := s.getActivePortalURL()
	endpoint := fmt.Sprintf("%s/api/control", strings.TrimRight(portalURL, "/"))

	payload := map[string]interface{}{
		"dp":    dp,
		"value": val,
	}

	b, _ := json.Marshal(payload)
	resp, err := s.httpClient.Post(endpoint, "application/json", bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("failed to reach breaker portal at %s: %w", portalURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		// Optimistic update of local state
		cur := s.sm.GetBreaker()
		if cur.Reading.DPS == nil {
			cur.Reading.DPS = make(map[string]interface{})
		}
		cur.Reading.DPS[dp] = val

		switch dp {
		case "108":
			if bVal, ok := val.(bool); ok {
				cur.Reading.Decoded.SwitchState = bVal
			}
		case "40":
			if bVal, ok := val.(bool); ok {
				cur.Reading.Decoded.ChildLock = bVal
			}
		case "38":
			if sVal, ok := val.(string); ok {
				cur.Reading.Decoded.PowerOnBehavior = sVal
			}
		case "115":
			if fVal, ok := toFloat(val); ok {
				cur.Reading.Decoded.HighTempThresholdC = fVal
			}
		case "121":
			if fVal, ok := toFloat(val); ok {
				cur.Reading.Decoded.OvervoltageThreshold = fVal
			}
		case "132":
			if fVal, ok := toFloat(val); ok {
				cur.Reading.Decoded.LeakageThresholdMA = fVal
			}
		case "127":
			if bVal, ok := val.(bool); ok {
				cur.Reading.Decoded.LeakageMasterEnabled = bVal
			}
		case "130":
			if fVal, ok := toFloat(val); ok {
				cur.Reading.Decoded.OvercurrentLimitA = fVal
			}
		case "119":
			if bVal, ok := val.(bool); ok {
				cur.Reading.Decoded.AutoRecloseEnabled = bVal
			}
		case "118":
			if fVal, ok := toFloat(val); ok {
				cur.Reading.Decoded.AutoRecloseDelayS = fVal
			}
		case "133":
			if fVal, ok := toFloat(val); ok {
				cur.Reading.Decoded.AutoRecloseAttempts = fVal
			}
		}

		s.sm.UpdateBreaker(cur)
		return nil
	}

	return fmt.Errorf("breaker portal returned status %d", resp.StatusCode)
}

func (s *CentralSyncer) SetBreakerToggle(targetState bool) error {
	portalURL := s.getActivePortalURL()
	endpoint := fmt.Sprintf("%s/api/toggle", strings.TrimRight(portalURL, "/"))
	payload := map[string]interface{}{
		"state": targetState,
	}

	b, _ := json.Marshal(payload)
	resp, err := s.httpClient.Post(endpoint, "application/json", bytes.NewReader(b))
	if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		_ = resp.Body.Close()
		cur := s.sm.GetBreaker()
		cur.Reading.Decoded.SwitchState = targetState
		if cur.Reading.DPS != nil {
			cur.Reading.DPS["108"] = targetState
		}
		s.sm.UpdateBreaker(cur)
		return nil
	}
	if resp != nil {
		_ = resp.Body.Close()
	}

	// Fallback to SetBreakerDP 108
	return s.SetBreakerDP("108", targetState)
}

func (s *CentralSyncer) SetBreakerSwitch(state bool) error {
	return s.SetBreakerToggle(state)
}

func (s *CentralSyncer) RefreshBreaker() error {
	portalURL := s.getActivePortalURL()
	endpoint := fmt.Sprintf("%s/api/refresh", strings.TrimRight(portalURL, "/"))
	resp, err := s.httpClient.Post(endpoint, "application/json", nil)
	if err == nil && resp != nil {
		_ = resp.Body.Close()
	}
	s.pollBreaker()
	return nil
}

func (s *CentralSyncer) TestBreakerSocket(payload map[string]interface{}) (map[string]interface{}, error) {
	portalURL := s.getActivePortalURL()
	endpoint := fmt.Sprintf("%s/api/test-connection", strings.TrimRight(portalURL, "/"))
	b, _ := json.Marshal(payload)
	resp, err := s.httpClient.Post(endpoint, "application/json", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *CentralSyncer) SaveBreakerConfig(payload map[string]interface{}) (map[string]interface{}, error) {
	portalURL := s.getActivePortalURL()
	endpoint := fmt.Sprintf("%s/api/config", strings.TrimRight(portalURL, "/"))
	b, _ := json.Marshal(payload)
	resp, err := s.httpClient.Post(endpoint, "application/json", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	s.pollBreaker()
	return result, nil
}

func toFloat(v interface{}) (float64, bool) {
	switch val := v.(type) {
	case float64:
		return val, true
	case int:
		return float64(val), true
	case int64:
		return float64(val), true
	}
	return 0, false
}
