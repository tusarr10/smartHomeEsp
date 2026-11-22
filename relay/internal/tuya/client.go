package tuya

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"sync"
	"time"

	"smarthome-edge/internal/state"
)

const (
	Prefix6699 = uint32(0x00006699)
	Suffix6699 = uint32(0x00009966)

	CmdSessKeyNegStart  uint32 = 3
	CmdSessKeyNegResp   uint32 = 4
	CmdSessKeyNegFinish uint32 = 5
	CmdStatus           uint32 = 8
	CmdHeartbeat        uint32 = 9
	CmdControlNew       uint32 = 13
	CmdDPQueryNew       uint32 = 16
	CmdUpdateDPS        uint32 = 18
)

type Client struct {
	mu         sync.Mutex
	ip         string
	deviceID   string
	localKey   []byte
	sessionKey []byte
	seqNo      uint32
	conn       net.Conn
	cachedDPS  map[string]interface{}
}

func NewClient(ip, deviceID, localKey string) *Client {
	return &Client{
		ip:        ip,
		deviceID:  deviceID,
		localKey:  []byte(localKey),
		seqNo:     1,
		cachedDPS: make(map[string]interface{}),
	}
}

func (c *Client) UpdateConfig(ip, deviceID, localKey string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ip != ip || c.deviceID != deviceID || string(c.localKey) != localKey {
		c.ip = ip
		c.deviceID = deviceID
		c.localKey = []byte(localKey)
		c.sessionKey = nil
		if c.conn != nil {
			_ = c.conn.Close()
			c.conn = nil
		}
	}
}

func (c *Client) resetConn() {
	if c.conn != nil {
		_ = c.conn.Close()
		c.conn = nil
	}
	c.sessionKey = nil
}

func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.resetConn()
}

func (c *Client) packMessage(cmd uint32, payload []byte, key []byte) ([]byte, error) {
	c.seqNo++
	seq := c.seqNo

	iv := make([]byte, 12)
	_, _ = rand.Read(iv)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	totalPayloadLen := uint32(len(iv) + len(payload) + 16)

	header := make([]byte, 18)
	binary.BigEndian.PutUint32(header[0:4], Prefix6699)
	binary.BigEndian.PutUint16(header[4:6], 0)
	binary.BigEndian.PutUint32(header[6:10], seq)
	binary.BigEndian.PutUint32(header[10:14], cmd)
	binary.BigEndian.PutUint32(header[14:18], totalPayloadLen)

	aad := header[4:18]
	ciphertextWithTag := aesgcm.Seal(nil, iv, payload, aad)

	buf := new(bytes.Buffer)
	buf.Write(header)
	buf.Write(iv)
	buf.Write(ciphertextWithTag)

	suffix := make([]byte, 4)
	binary.BigEndian.PutUint32(suffix, Suffix6699)
	buf.Write(suffix)

	return buf.Bytes(), nil
}

func (c *Client) unpackMessage(key []byte) (uint32, []byte, error) {
	header := make([]byte, 18)
	if _, err := io.ReadFull(c.conn, header); err != nil {
		return 0, nil, fmt.Errorf("read header: %w", err)
	}

	prefix := binary.BigEndian.Uint32(header[0:4])
	if prefix != Prefix6699 {
		return 0, nil, fmt.Errorf("invalid prefix: 0x%08X", prefix)
	}

	cmd := binary.BigEndian.Uint32(header[10:14])
	payloadLen := binary.BigEndian.Uint32(header[14:18])

	body := make([]byte, payloadLen+4)
	if _, err := io.ReadFull(c.conn, body); err != nil {
		return 0, nil, fmt.Errorf("read body: %w", err)
	}

	suffix := binary.BigEndian.Uint32(body[payloadLen : payloadLen+4])
	if suffix != Suffix6699 {
		return 0, nil, fmt.Errorf("invalid suffix: 0x%08X", suffix)
	}

	if payloadLen < 28 {
		return cmd, nil, fmt.Errorf("payload too short: %d", payloadLen)
	}

	iv := body[:12]
	ciphertextWithTag := body[12:payloadLen]
	aad := header[4:18]

	block, err := aes.NewCipher(key)
	if err != nil {
		return cmd, nil, err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return cmd, nil, err
	}

	plaintext, err := aesgcm.Open(nil, iv, ciphertextWithTag, aad)
	if err != nil {
		return cmd, nil, fmt.Errorf("aes-gcm decrypt: %w", err)
	}

	retcode := binary.BigEndian.Uint32(plaintext[0:4])
	_ = retcode
	cleanPayload := plaintext[4:]

	return cmd, cleanPayload, nil
}

func (c *Client) readExpected(expectedCmd uint32, timeout time.Duration) (uint32, []byte, error) {
	deadline := time.Now().Add(timeout)
	for {
		_ = c.conn.SetReadDeadline(deadline)
		cmd, payload, err := c.unpackMessage(c.sessionKey)
		if err != nil {
			return 0, nil, err
		}

		if cmd == CmdStatus {
			var st struct {
				Data struct {
					DPS map[string]interface{} `json:"dps"`
				} `json:"data"`
			}
			idx := bytes.IndexByte(payload, '{')
			if idx >= 0 {
				if err := json.Unmarshal(payload[idx:], &st); err == nil && st.Data.DPS != nil {
					for k, v := range st.Data.DPS {
						c.cachedDPS[k] = v
					}
				}
			}
		}

		if cmd == expectedCmd || expectedCmd == 0 {
			return cmd, payload, nil
		}
	}
}

func (c *Client) ensureConnected() error {
	if c.conn != nil && c.sessionKey != nil {
		return nil
	}

	if c.conn != nil {
		_ = c.conn.Close()
		c.conn = nil
	}
	c.sessionKey = nil

	conn, err := net.DialTimeout("tcp", c.ip+":6668", 2500*time.Millisecond)
	if err != nil {
		return err
	}
	c.conn = conn

	// Step 1: Send SESS_KEY_NEG_START
	localNonce := make([]byte, 16)
	_, _ = rand.Read(localNonce)

	step1Msg, err := c.packMessage(CmdSessKeyNegStart, localNonce, c.localKey)
	if err != nil {
		_ = c.conn.Close()
		c.conn = nil
		return err
	}
	_ = c.conn.SetDeadline(time.Now().Add(2500 * time.Millisecond))
	if _, err := c.conn.Write(step1Msg); err != nil {
		_ = c.conn.Close()
		c.conn = nil
		return err
	}

	// Step 2: Read SESS_KEY_NEG_RESP
	cmd, respPayload, err := c.unpackMessage(c.localKey)
	if err != nil {
		_ = c.conn.Close()
		c.conn = nil
		return fmt.Errorf("step 2 unpack: %w", err)
	}
	if cmd != CmdSessKeyNegResp || len(respPayload) < 48 {
		_ = c.conn.Close()
		c.conn = nil
		return fmt.Errorf("invalid step 2 response: cmd=%d, len=%d", cmd, len(respPayload))
	}

	remoteNonce := respPayload[:16]
	deviceHMAC := respPayload[16:48]

	mac := hmac.New(sha256.New, c.localKey)
	mac.Write(localNonce)
	expectedHMAC := mac.Sum(nil)
	if !hmac.Equal(deviceHMAC, expectedHMAC) {
		_ = c.conn.Close()
		c.conn = nil
		return fmt.Errorf("step 2 HMAC mismatch")
	}

	// Step 3: Send SESS_KEY_NEG_FINISH
	macClient := hmac.New(sha256.New, c.localKey)
	macClient.Write(remoteNonce)
	clientHMAC := macClient.Sum(nil)

	step3Msg, err := c.packMessage(CmdSessKeyNegFinish, clientHMAC, c.localKey)
	if err != nil {
		_ = c.conn.Close()
		c.conn = nil
		return err
	}
	if _, err := c.conn.Write(step3Msg); err != nil {
		_ = c.conn.Close()
		c.conn = nil
		return err
	}

	// Step 4: Finalize Session Key
	xorNonce := make([]byte, 16)
	for i := 0; i < 16; i++ {
		xorNonce[i] = localNonce[i] ^ remoteNonce[i]
	}

	block, err := aes.NewCipher(c.localKey)
	if err != nil {
		_ = c.conn.Close()
		c.conn = nil
		return err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		_ = c.conn.Close()
		c.conn = nil
		return err
	}
	c.sessionKey = aesgcm.Seal(nil, localNonce[:12], xorNonce, nil)[:16]

	return nil
}

func (c *Client) QueryStatus() (state.BreakerData, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	var data state.BreakerData
	data.Config = state.BreakerConfigInfo{
		DeviceName:      "Wi-Fi Smart Circuit Breaker (Main)",
		DeviceID:        c.deviceID,
		LocalKey:        string(c.localKey),
		IPAddress:       c.ip,
		ProtocolVersion: 3.5,
		MacAddress:      "30:48:7d:e8:5d:5c",
		ModelSN:         "B-B1-M",
	}

	if err := c.ensureConnected(); err != nil {
		data.Reading.Online = false
		data.Reading.Source = "direct_socket_error"
		data.Reading.Timestamp = time.Now().Format("2006-01-02 15:04:05")
		data.Reading.Errors = []string{err.Error()}
		return data, err
	}

	msg, err := c.packMessage(CmdDPQueryNew, []byte("{}"), c.sessionKey)
	if err != nil {
		c.resetConn()
		return data, err
	}

	_ = c.conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := c.conn.Write(msg); err != nil {
		c.resetConn()
		return data, err
	}

	_, payload, err := c.readExpected(CmdDPQueryNew, 2*time.Second)
	if err != nil {
		c.resetConn()
		return data, err
	}

	idx := bytes.IndexByte(payload, '{')
	if idx >= 0 {
		var res struct {
			DPS map[string]interface{} `json:"dps"`
		}
		if err := json.Unmarshal(payload[idx:], &res); err == nil && res.DPS != nil {
			for k, v := range res.DPS {
				c.cachedDPS[k] = v
			}
		}
	}

	// Trigger UPDATEDPS for fresh DP 102 stream
	refreshMsg, _ := c.packMessage(CmdUpdateDPS, []byte("{\"dpId\":[17,26,38,40,101,102,103,112,114,115,126,132]}"), c.sessionKey)
	if refreshMsg != nil {
		_, _ = c.conn.Write(refreshMsg)
		// Quick read if status packet arrives
		_, _, _ = c.readExpected(CmdStatus, 200*time.Millisecond)
	}

	data.Reading.Online = true
	data.Reading.Source = "direct_socket"
	data.Reading.Timestamp = time.Now().Format("2006-01-02 15:04:05")
	data.Reading.DPS = make(map[string]interface{})
	for k, v := range c.cachedDPS {
		data.Reading.DPS[k] = v
	}

	data.Reading.Decoded = decodeDPS(data.Reading.DPS)
	return data, nil
}

func (c *Client) SetDP(dp string, val interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := c.ensureConnected(); err != nil {
		return err
	}

	prefix := append([]byte("3.5"), make([]byte, 12)...)
	reqData := map[string]interface{}{
		"protocol": 5,
		"t":        time.Now().Unix(),
		"data": map[string]interface{}{
			"dps": map[string]interface{}{
				dp: val,
			},
		},
	}
	jsonBytes, _ := json.Marshal(reqData)
	fullPayload := append(prefix, jsonBytes...)

	msg, err := c.packMessage(CmdControlNew, fullPayload, c.sessionKey)
	if err != nil {
		return err
	}

	_ = c.conn.SetDeadline(time.Now().Add(2500 * time.Millisecond))
	if _, err := c.conn.Write(msg); err != nil {
		c.resetConn()
		return err
	}

	_, _, err = c.readExpected(CmdControlNew, 2500*time.Millisecond)
	if err != nil {
		c.resetConn()
		return err
	}

	c.cachedDPS[dp] = val
	return nil
}

func (c *Client) TestConnection() (map[string]interface{}, error) {
	start := time.Now()
	data, err := c.QueryStatus()
	duration := time.Since(start)
	if err != nil {
		return map[string]interface{}{
			"online":  false,
			"error":   err.Error(),
			"latency": duration.Milliseconds(),
		}, err
	}
	return map[string]interface{}{
		"online":       true,
		"latency":      duration.Milliseconds(),
		"switch_state": data.Reading.Decoded.SwitchState,
		"voltage":      data.Reading.Decoded.VoltageV,
		"current":      data.Reading.Decoded.CurrentA,
		"power":        data.Reading.Decoded.PowerW,
	}, nil
}

func decodeDPS(dps map[string]interface{}) state.BreakerDecoded {
	var dec state.BreakerDecoded
	dec.Faults = make(map[string]bool)

	// Switch state (DP 108 or fallback 103)
	if v, ok := dps["108"].(bool); ok {
		dec.SwitchState = v
	} else if v, ok := dps["103"].(bool); ok {
		dec.SwitchState = v
	} else {
		dec.SwitchState = true
	}

	// Child / Maintenance Lock (DP 40)
	if v, ok := dps["40"].(bool); ok {
		dec.ChildLock = v
	}

	// AC Power-On Behavior (DP 38)
	if v, ok := dps["38"].(string); ok {
		dec.PowerOnBehavior = v
	} else {
		dec.PowerOnBehavior = "memory"
	}

	// Model (DP 111)
	if v, ok := dps["111"].(string); ok {
		dec.ModelStr = v
	} else {
		dec.ModelStr = "B-B1-M"
	}

	// Frequency (DP 112, 0.1 Hz)
	if v, ok := getFloat(dps["112"]); ok {
		dec.FrequencyHz = math.Round((v/10.0)*10) / 10
	} else {
		dec.FrequencyHz = 50.0
	}

	// Energy (DP 101, 0.01 kWh)
	if v, ok := getFloat(dps["101"]); ok {
		dec.TotalEnergyKWh = math.Round((v/100.0)*100) / 100
	}

	// Temperature probe (DP 114) & threshold (DP 115)
	if v, ok := getFloat(dps["114"]); ok {
		dec.TemperatureC = v
	}
	if v, ok := getFloat(dps["115"]); ok {
		dec.HighTempThresholdC = v
	} else {
		dec.HighTempThresholdC = 93.0
	}

	// Leakage current (DP 126) & threshold (DP 132)
	if v, ok := getFloat(dps["126"]); ok {
		dec.LeakageCurrentMA = v
	}
	if v, ok := getFloat(dps["132"]); ok {
		dec.LeakageThresholdMA = v
	} else {
		dec.LeakageThresholdMA = 200.0
	}

	// Leakage master & delay (DP 127, 129)
	if v, ok := dps["127"].(bool); ok {
		dec.LeakageMasterEnabled = v
	} else {
		dec.LeakageMasterEnabled = true
	}
	if v, ok := getFloat(dps["129"]); ok {
		dec.LeakageDelayS = v
	} else {
		dec.LeakageDelayS = 1.0
	}

	// Overcurrent limit & delay (DP 130, 116 / 131)
	if v, ok := getFloat(dps["130"]); ok {
		dec.OvercurrentLimitA = v
	} else {
		dec.OvercurrentLimitA = 30.0
	}
	if v, ok := getFloat(dps["116"]); ok {
		dec.OvercurrentDelayS = v
	} else {
		dec.OvercurrentDelayS = 5.0
	}

	// Overvoltage threshold & delay (DP 121, 105)
	if v, ok := getFloat(dps["121"]); ok {
		dec.OvervoltageThreshold = v
	} else {
		dec.OvervoltageThreshold = 14144
	}
	if v, ok := getFloat(dps["105"]); ok {
		dec.OvervoltageDelayS = v
	}

	// Auto-reclose (DP 119, 118, 133)
	if v, ok := dps["119"].(bool); ok {
		dec.AutoRecloseEnabled = v
	} else {
		dec.AutoRecloseEnabled = true
	}
	if v, ok := getFloat(dps["118"]); ok {
		dec.AutoRecloseDelayS = v
	} else {
		dec.AutoRecloseDelayS = 30.0
	}
	if v, ok := getFloat(dps["133"]); ok {
		dec.AutoRecloseAttempts = v
	} else {
		dec.AutoRecloseAttempts = 10.0
	}

	// Hardware safety fault bitmask (DP 26)
	faultInt := int64(0)
	if f, ok := getFloat(dps["26"]); ok {
		faultInt = int64(f)
	}
	dec.FaultRaw = faultInt
	dec.Faults["leakage_alarm"] = (faultInt & 0x01) != 0
	dec.Faults["overcurrent_alarm"] = (faultInt & 0x02) != 0
	dec.Faults["overvoltage_alarm"] = (faultInt & 0x04) != 0
	dec.Faults["undervoltage_alarm"] = (faultInt & 0x08) != 0
	dec.Faults["high_temp_alarm"] = (faultInt & 0x20) != 0
	dec.Faults["unbalance_alarm"] = (faultInt & 0x40) != 0
	dec.Faults["phase_loss_alarm"] = (faultInt & 0x80) != 0
	dec.Faults["relay_failure_alarm"] = (faultInt & 0x800) != 0

	for _, v := range dec.Faults {
		if v {
			dec.HasAlarm = true
			break
		}
	}

	// Decode DP 102 (8-byte base64 stream)
	if str, ok := dps["102"].(string); ok && str != "" {
		dec.RawDP102Base64 = str
		raw, err := base64.StdEncoding.DecodeString(str)
		if err == nil && len(raw) == 8 {
			dec.RawDP102Hex = hex.EncodeToString(raw)

			vRaw := binary.BigEndian.Uint16(raw[0:2])
			iRaw := uint32(raw[2])<<16 | uint32(raw[3])<<8 | uint32(raw[4])
			pRaw := uint32(raw[5])<<16 | uint32(raw[6])<<8 | uint32(raw[7])

			dec.VoltageV = math.Round((float64(vRaw)/10.0)*10) / 10
			dec.CurrentA = math.Round((float64(iRaw)/1000.0)*1000) / 1000
			dec.PowerW = float64(pRaw)
			dec.PowerKW = math.Round((float64(pRaw)/1000.0)*1000) / 1000

			apparentVA := dec.VoltageV * dec.CurrentA
			dec.ApparentPowerVA = math.Round(apparentVA*10) / 10

			if apparentVA > 0 {
				dec.PowerFactor = math.Round((dec.PowerW/apparentVA)*1000) / 1000
				if dec.PowerFactor > 1.0 {
					dec.PowerFactor = 0.99
				}
			} else {
				dec.PowerFactor = 0.99
			}
		}
	}

	if dec.VoltageV == 0 {
		dec.VoltageV = 230.0
	}

	return dec
}

func getFloat(v interface{}) (float64, bool) {
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