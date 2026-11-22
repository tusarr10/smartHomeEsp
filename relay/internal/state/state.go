package state

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Channel struct {
	ID        int    `json:"id"`
	ChannelID int    `json:"channelId,omitempty"`
	Pin       int    `json:"pin"`
	Name      string `json:"name"`
	Room      string `json:"room,omitempty"`
	Function  string `json:"function,omitempty"`
	State     bool   `json:"state"`
}

type Sensor struct {
	Type  string  `json:"type"`
	Name  string  `json:"name"`
	Value float64 `json:"value"`
	Unit  string  `json:"unit"`
}

type Node struct {
	NodeID          string    `json:"nodeId"`
	NodeName        string    `json:"nodeName"`
	IP              string    `json:"ip"`
	MAC             string    `json:"mac,omitempty"`
	RSSI            int       `json:"rssi,omitempty"`
	UptimeSec       int64     `json:"uptimeSec"`
	FreeHeap        int64     `json:"freeHeap,omitempty"`
	FirmwareVersion string    `json:"firmwareVersion,omitempty"`
	IsOnline        bool      `json:"isOnline"`
	Protocol        string    `json:"protocol,omitempty"`
	LastSeenEpoch   int64     `json:"lastSeenEpoch"`
	Channels        []Channel `json:"channels"`
	Sensors         []Sensor  `json:"sensors"`
}

type Command struct {
	CommandUUID string `json:"command_uuid"`
	Action      string `json:"action"` // "setState", "SET_STATE"
	ID          int    `json:"id"`
	ChannelID   int    `json:"channelId,omitempty"`
	Channel_ID  int    `json:"channel_id,omitempty"`
	Pin         int    `json:"pin,omitempty"`
	State       bool   `json:"state"`
	Value       int    `json:"value"`
	ExpiresAt   int64  `json:"expiresAt,omitempty"`
}

type BreakerConfigInfo struct {
	DeviceName      string  `json:"device_name"`
	DeviceID        string  `json:"device_id"`
	LocalKey        string  `json:"local_key,omitempty"`
	IPAddress       string  `json:"ip_address"`
	ProtocolVersion float64 `json:"protocol_version"`
	ProductName     string  `json:"product_name,omitempty"`
	MacAddress      string  `json:"mac_address"`
	ModelSN         string  `json:"model_sn"`
	PollIntervalSec int     `json:"poll_interval_sec,omitempty"`
	SimulationMode  bool    `json:"simulation_mode,omitempty"`
}

type BreakerDecoded struct {
	SwitchState          bool            `json:"switch_state"`
	VoltageV             float64         `json:"voltage_v"`
	CurrentA             float64         `json:"current_a"`
	PowerW               float64         `json:"power_w"`
	PowerKW              float64         `json:"power_kw"`
	PowerFactor          float64         `json:"power_factor"`
	FrequencyHz          float64         `json:"frequency_hz"`
	TemperatureC         float64         `json:"temperature_c"`
	TotalEnergyKWh       float64         `json:"total_energy_kwh"`
	LeakageCurrentMA     float64         `json:"leakage_current_ma"`
	LeakageThresholdMA   float64         `json:"leakage_threshold_ma"`
	LeakageMasterEnabled bool            `json:"leakage_master_enabled"`
	LeakageDelayS        float64         `json:"leakage_delay_s"`
	HighTempThresholdC   float64         `json:"high_temp_threshold_c"`
	OvercurrentLimitA    float64         `json:"overcurrent_limit_a"`
	OvercurrentDelayS    float64         `json:"overcurrent_delay_s"`
	ProtectionDelayS     float64         `json:"protection_delay_s"`
	AutoRecloseDelayS    float64         `json:"auto_reclose_delay_s"`
	AutoRecloseEnabled   bool            `json:"auto_reclose_enabled"`
	AutoRecloseAttempts  float64         `json:"auto_reclose_attempts"`
	OvervoltageThreshold float64         `json:"overvoltage_threshold"`
	OvervoltageDelayS    float64         `json:"overvoltage_delay_s"`
	BalanceThreshold     float64         `json:"balance_threshold"`
	ChildLock            bool            `json:"child_lock"`
	PowerOnBehavior      string          `json:"power_on_behavior"`
	ModelStr             string          `json:"model_str"`
	FaultRaw             int64           `json:"fault_raw"`
	Faults               map[string]bool `json:"faults"`
	HasAlarm             bool            `json:"has_alarm"`
	ApparentPowerVA      float64         `json:"apparent_power_va"`
	RawDP102Base64       string          `json:"raw_dp102_base64,omitempty"`
	RawDP102Hex          string          `json:"raw_dp102_hex,omitempty"`
}

type BreakerReading struct {
	Online    bool                   `json:"online"`
	Source    string                 `json:"source"`
	Timestamp string                 `json:"timestamp"`
	DPS       map[string]interface{} `json:"dps"`
	Decoded   BreakerDecoded         `json:"decoded"`
	Errors    []string               `json:"errors,omitempty"`
}

type BreakerData struct {
	Config  BreakerConfigInfo `json:"config"`
	Reading BreakerReading    `json:"reading"`
}

type EventListener func(eventType string, data interface{})

type StateManager struct {
	mu           sync.RWMutex
	nodes        map[string]*Node
	commandQueue map[string][]*Command
	breaker      BreakerData
	listeners    []EventListener
}

func NewStateManager() *StateManager {
	sm := &StateManager{
		nodes:        make(map[string]*Node),
		commandQueue: make(map[string][]*Command),
	}
	// Initial default breaker reading
	sm.breaker.Config = BreakerConfigInfo{
		DeviceName:      "Wi-Fi Smart Circuit Breaker (Main)",
		DeviceID:        "d705ffaccaf4d0f1b1addg",
		LocalKey:        "gp->j2_X[Bx=.ovC",
		IPAddress:       "192.168.1.25",
		ProtocolVersion: 3.5,
		MacAddress:      "30:48:7d:e8:5d:5c",
		ModelSN:         "B-B1-M",
	}
	sm.breaker.Reading.Online = false
	sm.breaker.Reading.Source = "edge_broker"
	sm.breaker.Reading.Timestamp = time.Now().Format("2006-01-02 15:04:05")
	sm.breaker.Reading.DPS = make(map[string]interface{})
	sm.breaker.Reading.Decoded.VoltageV = 230.0
	sm.breaker.Reading.Decoded.FrequencyHz = 50.0
	sm.breaker.Reading.Decoded.SwitchState = true
	sm.breaker.Reading.Decoded.Faults = make(map[string]bool)
	return sm
}

func (sm *StateManager) AddListener(listener EventListener) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.listeners = append(sm.listeners, listener)
}

func (sm *StateManager) emit(eventType string, data interface{}) {
	for _, l := range sm.listeners {
		go l(eventType, data)
	}
}

// IngestRawTelemetry parses incoming JSON from ESP8266 or HTTP and updates in-memory state
func (sm *StateManager) IngestRawTelemetry(raw []byte, clientIP string, protocol string) ([]*Command, error) {
	var payload struct {
		NodeID          string `json:"nodeId"`
		LegacyNodeID    string `json:"node_id"`
		NodeName        string `json:"nodeName"`
		Name            string `json:"name"`
		IP              string `json:"ip"`
		MAC             string `json:"mac"`
		RSSI            int    `json:"rssi"`
		UptimeSec       int64  `json:"uptimeSec"`
		LegacyUptimeSec int64  `json:"uptime_sec"`
		FreeHeap        int64  `json:"freeHeap"`
		FirmwareVersion string `json:"firmwareVersion"`
		// Both channel formats supported
		Channels []struct {
			ID        int    `json:"id"`
			ChannelID int    `json:"channelId"`
			Pin       int    `json:"pin"`
			Name      string `json:"name"`
			Room      string `json:"room"`
			Function  string `json:"function"`
			State     any    `json:"state"` // can be bool, 0/1
		} `json:"channels"`
		States []struct {
			Pin   int `json:"pin"`
			State int `json:"state"`
		} `json:"states"`
		Sensors []Sensor `json:"sensors"`
	}

	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("unmarshal telemetry: %w", err)
	}

	nodeID := payload.NodeID
	if nodeID == "" {
		nodeID = payload.LegacyNodeID
	}
	if nodeID == "" {
		return nil, fmt.Errorf("missing nodeId in telemetry")
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	node, exists := sm.nodes[nodeID]
	wasOnline := false
	if exists {
		wasOnline = node.IsOnline
	} else {
		node = &Node{
			NodeID:   nodeID,
			Channels: make([]Channel, 0),
			Sensors:  make([]Sensor, 0),
		}
		sm.nodes[nodeID] = node
	}

	// Update metadata
	if payload.NodeName != "" {
		node.NodeName = payload.NodeName
	} else if payload.Name != "" {
		node.NodeName = payload.Name
	} else if node.NodeName == "" {
		node.NodeName = nodeID
	}

	if clientIP != "" {
		node.IP = clientIP
	} else if payload.IP != "" && payload.IP != "0.0.0.0" {
		node.IP = payload.IP
	}

	if payload.MAC != "" {
		node.MAC = payload.MAC
	}
	node.RSSI = payload.RSSI

	uptime := payload.UptimeSec
	if uptime == 0 {
		uptime = payload.LegacyUptimeSec
	}
	node.UptimeSec = uptime
	node.FreeHeap = payload.FreeHeap
	if payload.FirmwareVersion != "" {
		node.FirmwareVersion = payload.FirmwareVersion
	}
	node.Protocol = protocol
	node.IsOnline = true
	node.LastSeenEpoch = time.Now().Unix()

	// Update channels (if channels array provided)
	if len(payload.Channels) > 0 {
		channels := make([]Channel, len(payload.Channels))
		for i, c := range payload.Channels {
			chID := c.ChannelID
			if chID == 0 {
				chID = c.ID
			}
			if chID == 0 {
				chID = i + 1
			}

			chState := false
			switch v := c.State.(type) {
			case bool:
				chState = v
			case float64:
				chState = v > 0
			case int:
				chState = v > 0
			}

			name := c.Name
			if name == "" {
				name = fmt.Sprintf("Channel %d", chID)
			}

			channels[i] = Channel{
				ID:        chID,
				ChannelID: chID,
				Pin:       c.Pin,
				Name:      name,
				Room:      c.Room,
				Function:  c.Function,
				State:     chState,
			}
		}
		node.Channels = channels
	} else if len(payload.States) > 0 {
		// Legacy states format: [{pin: 100, state: 1}]
		channels := make([]Channel, len(payload.States))
		for i, s := range payload.States {
			channels[i] = Channel{
				ID:        i + 1,
				ChannelID: i + 1,
				Pin:       s.Pin,
				Name:      fmt.Sprintf("Pin %d", s.Pin),
				State:     s.State > 0,
			}
		}
		node.Channels = channels
	}

	if len(payload.Sensors) > 0 {
		node.Sensors = payload.Sensors
	}

	if !wasOnline {
		sm.emit("node_status", map[string]interface{}{
			"nodeId":   nodeID,
			"isOnline": true,
			"name":     node.NodeName,
		})
	}

	// Pop queued commands for this node
	var pending []*Command
	if q, ok := sm.commandQueue[nodeID]; ok && len(q) > 0 {
		pending = q
		delete(sm.commandQueue, nodeID)
	}

	return pending, nil
}

func (sm *StateManager) GetNode(nodeID string) (*Node, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	n, ok := sm.nodes[nodeID]
	if !ok {
		return nil, false
	}
	// Return copy
	copyNode := *n
	return &copyNode, true
}

func (sm *StateManager) GetAllNodes() []*Node {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	list := make([]*Node, 0, len(sm.nodes))
	for _, n := range sm.nodes {
		cp := *n
		list = append(list, &cp)
	}
	return list
}

func (sm *StateManager) QueueCommand(nodeID string, cmd *Command) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.commandQueue[nodeID] = append(sm.commandQueue[nodeID], cmd)
}

func (sm *StateManager) SetChannelState(nodeID string, channelID int, state bool) (*Command, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	node, ok := sm.nodes[nodeID]
	if !ok {
		return nil, fmt.Errorf("node %s not found", nodeID)
	}

	var pin int
	found := false
	for i := range node.Channels {
		if node.Channels[i].ID == channelID || node.Channels[i].ChannelID == channelID {
			node.Channels[i].State = state
			pin = node.Channels[i].Pin
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("channel %d not found on node %s", channelID, nodeID)
	}

	val := 0
	if state {
		val = 1
	}

	cmd := &Command{
		CommandUUID: fmt.Sprintf("cmd-%d", time.Now().UnixNano()),
		Action:      "setState",
		ID:          channelID,
		ChannelID:   channelID,
		Channel_ID:  channelID,
		Pin:         pin,
		State:       state,
		Value:       val,
		ExpiresAt:   time.Now().Unix() + 30,
	}

	sm.commandQueue[nodeID] = append(sm.commandQueue[nodeID], cmd)

	// Direct HTTP push for instant sub-30ms switching if node IP is reachable on LAN
	if node.IP != "" && node.IP != "127.0.0.1" && node.IP != "0.0.0.0" {
		go func(ip string, chID int, targetState bool) {
			payload, err := json.Marshal(map[string]interface{}{
				"id":     chID,
				"state":  targetState,
				"action": "setState",
			})
			if err == nil {
				client := &http.Client{Timeout: 1200 * time.Millisecond}
				url := fmt.Sprintf("http://%s/api/gpio/state", ip)
				resp, postErr := client.Post(url, "application/json", bytes.NewReader(payload))
				if postErr == nil && resp != nil {
					_ = resp.Body.Close()
				}
			}
		}(node.IP, channelID, state)
	}

	sm.emit("pin_update", map[string]interface{}{
		"nodeId":    nodeID,
		"channelId": channelID,
		"pin":       pin,
		"state":     state,
	})

	return cmd, nil
}

func (sm *StateManager) UpdateBreaker(b BreakerData) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.breaker = b
	sm.emit("breaker_update", b)
}

func (sm *StateManager) GetBreaker() BreakerData {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.breaker
}

func (sm *StateManager) StartOfflineWatcher(timeoutSec int) {
	ticker := time.NewTicker(5 * time.Second)
	go func() {
		for range ticker.C {
			now := time.Now().Unix()
			sm.mu.Lock()
			for nodeID, node := range sm.nodes {
				if node.IsOnline && now-node.LastSeenEpoch > int64(timeoutSec) {
					node.IsOnline = false
					sm.emit("node_status", map[string]interface{}{
						"nodeId":   nodeID,
						"isOnline": false,
						"name":     node.NodeName,
					})
				}
			}
			sm.mu.Unlock()
		}
	}()
}
