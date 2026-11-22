package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"smarthome-edge/internal/auth"
	"smarthome-edge/internal/config"
	"smarthome-edge/internal/queue"
	"smarthome-edge/internal/state"
	"smarthome-edge/internal/syncer"
	"smarthome-edge/internal/websocket"
)

type Router struct {
	cfg       *config.Config
	sm        *state.StateManager
	auth      *auth.Authenticator
	hub       *websocket.Hub
	syncer    *syncer.CentralSyncer
	spool     *queue.EventSpool
	startTime time.Time
	webDir    string
}

func NewRouter(
	cfg *config.Config,
	sm *state.StateManager,
	auth *auth.Authenticator,
	hub *websocket.Hub,
	syncer *syncer.CentralSyncer,
	spool *queue.EventSpool,
	webDir string,
) *Router {
	return &Router{
		cfg:       cfg,
		sm:        sm,
		auth:      auth,
		hub:       hub,
		syncer:    syncer,
		spool:     spool,
		startTime: time.Now(),
		webDir:    webDir,
	}
}

func (rt *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// CORS Headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Node-ID")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	path := r.URL.Path

	// WebSocket upgrades
	if path == "/api/v1/ws" || path == "/ws" {
		rt.hub.ServeWS(w, r)
		return
	}

	// API Routing
	if strings.HasPrefix(path, "/api/") {
		rt.handleAPI(w, r)
		return
	}

	// Static Web Frontend files
	rt.handleStatic(w, r)
}

func (rt *Router) handleAPI(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// 1. Health
	if path == "/api/v1/health" && r.Method == http.MethodGet {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)

		sendJSON(w, http.StatusOK, map[string]interface{}{
			"status":    "healthy",
			"uptimeSec": int64(time.Since(rt.startTime).Seconds()),
			"memory": map[string]interface{}{
				"allocMb":      fmt.Sprintf("%.2f MB", float64(m.Alloc)/1024/1024),
				"sysMb":        fmt.Sprintf("%.2f MB", float64(m.Sys)/1024/1024),
				"goroutines":   runtime.NumGoroutine(),
			},
			"centralOnline": rt.syncer.IsCentralOnline(),
		})
		return
	}

	// 2. HTTP Telemetry Ingestion (for ESP8266 HTTP mode)
	if (path == "/api/telemetry" || path == "/api/v1/telemetry") && r.Method == http.MethodPost {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Read error", http.StatusBadRequest)
			return
		}
		clientIP := r.RemoteAddr
		commands, err := rt.sm.IngestRawTelemetry(body, clientIP, "HTTP")
		if err != nil {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		go rt.syncer.ForwardTelemetry(body)

		sendJSON(w, http.StatusOK, map[string]interface{}{
			"status":   "ok",
			"epoch":    time.Now().Unix(),
			"commands": commands,
		})
		return
	}

	// Authorization check for protected routes
	claims, err := rt.auth.ValidateToken(r.Header.Get("Authorization"))
	if err != nil {
		sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized: " + err.Error()})
		return
	}

	// 3. Nodes List (Scoped)
	if path == "/api/v1/nodes" && r.Method == http.MethodGet {
		allNodes := rt.sm.GetAllNodes()
		var allowed []*state.Node

		for _, n := range allNodes {
			if rt.auth.CanAccessNode(claims, n.NodeID) {
				allowed = append(allowed, n)
			}
		}

		sendJSON(w, http.StatusOK, map[string]interface{}{
			"nodes":         allowed,
			"centralOnline": rt.syncer.IsCentralOnline(),
		})
		return
	}

	// 4. Circuit Breaker Telemetry & Control
	if (path == "/api/v1/breaker" || path == "/api/v1/breaker/status" || path == "/api/breaker/status") && r.Method == http.MethodGet {
		b := rt.sm.GetBreaker()
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"success":       true,
			"config":        b.Config,
			"reading":       b.Reading,
			"centralOnline": rt.syncer.IsCentralOnline(),
		})
		return
	}

	if (path == "/api/v1/breaker/toggle" || path == "/api/breaker/toggle") && r.Method == http.MethodPost {
		var req struct {
			State bool `json:"state"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
			return
		}

		err := rt.syncer.SetBreakerToggle(req.State)
		if err != nil {
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		_, _ = rt.spool.Push("BREAKER_TOGGLE", rt.cfg.Breaker.NodeID, map[string]interface{}{
			"state": req.State,
		})

		sendJSON(w, http.StatusOK, map[string]interface{}{"success": true, "switch_state": req.State})
		return
	}

	if path == "/api/v1/breaker/switch" && r.Method == http.MethodPost {
		var req struct {
			State bool `json:"state"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
			return
		}

		err := rt.syncer.SetBreakerSwitch(req.State)
		if err != nil {
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		_, _ = rt.spool.Push("BREAKER_TRIP", rt.cfg.Breaker.NodeID, map[string]interface{}{
			"state": req.State,
		})

		sendJSON(w, http.StatusOK, map[string]interface{}{"success": true, "switch_state": req.State})
		return
	}

	if (path == "/api/v1/breaker/control" || path == "/api/breaker/control") && r.Method == http.MethodPost {
		var req struct {
			DP    interface{} `json:"dp"`
			Value interface{} `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
			return
		}

		dpStr := fmt.Sprintf("%v", req.DP)
		err := rt.syncer.SetBreakerDP(dpStr, req.Value)
		if err != nil {
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		_, _ = rt.spool.Push("BREAKER_DP_WRITE", rt.cfg.Breaker.NodeID, map[string]interface{}{
			"dp":    dpStr,
			"value": req.Value,
		})

		sendJSON(w, http.StatusOK, map[string]interface{}{"success": true, "dp": dpStr, "value": req.Value})
		return
	}

	if (path == "/api/v1/breaker/refresh" || path == "/api/breaker/refresh") && r.Method == http.MethodPost {
		_ = rt.syncer.RefreshBreaker()
		sendJSON(w, http.StatusOK, map[string]interface{}{"success": true})
		return
	}

	if (path == "/api/v1/breaker/devices" || path == "/api/breaker/devices") && r.Method == http.MethodGet {
		b := rt.sm.GetBreaker()
		cfg := b.Config
		ip := cfg.IPAddress
		if ip == "" {
			ip = "192.168.1.25"
		}
		devList := []map[string]interface{}{
			{
				"id":               cfg.DeviceID,
				"name":             cfg.DeviceName,
				"ip":               ip,
				"local_key":        cfg.LocalKey,
				"protocol_version": cfg.ProtocolVersion,
				"category":         "breaker",
				"is_active":        1,
			},
		}
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"devices": devList,
			"activeDevice": map[string]interface{}{
				"id":   cfg.DeviceID,
				"name": cfg.DeviceName,
				"ip":   ip,
			},
		})
		return
	}

	if (path == "/api/v1/breaker/devices/test" || path == "/api/breaker/devices/test") && r.Method == http.MethodPost {
		var req map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&req)
		res, err := rt.syncer.TestBreakerSocket(req)
		if err != nil {
			sendJSON(w, http.StatusOK, map[string]interface{}{"online": false, "error": err.Error()})
			return
		}
		sendJSON(w, http.StatusOK, res)
		return
	}

	if (path == "/api/v1/breaker/devices" || path == "/api/breaker/devices") && r.Method == http.MethodPost {
		var req map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&req)
		res, err := rt.syncer.SaveBreakerConfig(req)
		if err != nil {
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		sendJSON(w, http.StatusOK, res)
		return
	}

	if (path == "/api/v1/breaker/devices/select" || path == "/api/breaker/devices/select") && r.Method == http.MethodPost {
		b := rt.sm.GetBreaker()
		sendJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"activeDevice": map[string]interface{}{
				"id":   b.Config.DeviceID,
				"name": b.Config.DeviceName,
				"ip":   b.Config.IPAddress,
			},
		})
		return
	}

	// 5. Node Specific Commands & State (/api/v1/nodes/{id}/...)
	if strings.HasPrefix(path, "/api/v1/nodes/") {
		parts := strings.Split(strings.Trim(path, "/"), "/")
		if len(parts) >= 4 {
			nodeID := parts[3]

			// Scope check
			if !rt.auth.CanAccessNode(claims, nodeID) {
				sendJSON(w, http.StatusForbidden, map[string]string{"error": "Access to node forbidden"})
				return
			}

			// GET /api/v1/nodes/{id}
			if len(parts) == 4 && r.Method == http.MethodGet {
				node, ok := rt.sm.GetNode(nodeID)
				if !ok {
					sendJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
					return
				}
				sendJSON(w, http.StatusOK, node)
				return
			}

			// POST /api/v1/nodes/{id}/commands
			if len(parts) == 5 && parts[4] == "commands" && r.Method == http.MethodPost {
				var cmdReq struct {
					Action    string `json:"action"` // "setState", "SET_STATE"
					ChannelID int    `json:"channelId"`
					Pin       int    `json:"pin"`
					State     any    `json:"state"` // bool or 0/1
					Value     any    `json:"value"`
				}

				if err := json.NewDecoder(r.Body).Decode(&cmdReq); err != nil {
					sendJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
					return
				}

				targetState := false
				if cmdReq.State != nil {
					switch v := cmdReq.State.(type) {
					case bool:
						targetState = v
					case float64:
						targetState = v > 0
					}
				} else if cmdReq.Value != nil {
					switch v := cmdReq.Value.(type) {
					case bool:
						targetState = v
					case float64:
						targetState = v > 0
					}
				}

				chID := cmdReq.ChannelID
				if chID == 0 {
					chID = 1
				}

				cmd, err := rt.sm.SetChannelState(nodeID, chID, targetState)
				if err != nil {
					sendJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
					return
				}

				// Log to persistent event spool
				_ , _ = rt.spool.Push("RELAY_TRANSITION", nodeID, map[string]interface{}{
					"channelId": chID,
					"state":     targetState,
					"pin":       cmd.Pin,
				})

				sendJSON(w, http.StatusOK, map[string]interface{}{
					"status":  "accepted",
					"command": cmd,
				})
				return
			}
		}
	}

	// 6. Edge Status
	if path == "/api/v1/edge/status" && r.Method == http.MethodGet {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)

		sendJSON(w, http.StatusOK, map[string]interface{}{
			"server":        "SmartHome Edge Broker (Go Native ARM64/AMD64)",
			"uptimeSec":     int64(time.Since(rt.startTime).Seconds()),
			"centralServer": rt.cfg.Central.URL,
			"centralOnline": rt.syncer.IsCentralOnline(),
			"memoryMb":      fmt.Sprintf("%.1f MB", float64(m.Alloc)/1024/1024),
			"nodesCount":    len(rt.sm.GetAllNodes()),
		})
		return
	}

	// 7. Recent Spooled Events
	if path == "/api/v1/events" && r.Method == http.MethodGet {
		events, _ := rt.spool.ReadRecent(50)
		sendJSON(w, http.StatusOK, events)
		return
	}

	sendJSON(w, http.StatusNotFound, map[string]string{"error": "Route not found"})
}

func (rt *Router) handleStatic(w http.ResponseWriter, r *http.Request) {
	if rt.webDir == "" {
		http.NotFound(w, r)
		return
	}

	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}

	cleanPath := filepath.Clean(path)
	fullPath := filepath.Join(rt.webDir, cleanPath)

	if fi, err := os.Stat(fullPath); err == nil && !fi.IsDir() {
		ext := strings.ToLower(filepath.Ext(fullPath))
		switch ext {
		case ".html":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		case ".css":
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
		case ".js":
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		case ".json":
			w.Header().Set("Content-Type", "application/json")
		}
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		http.ServeFile(w, r, fullPath)
		return
	}

	// Fallback to index.html for SPA
	indexPath := filepath.Join(rt.webDir, "index.html")
	if _, err := os.Stat(indexPath); err == nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		http.ServeFile(w, r, indexPath)
		return
	}

	http.NotFound(w, r)
}

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
