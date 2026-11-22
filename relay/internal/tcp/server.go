package tcp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"strings"
	"time"

	"smarthome-edge/internal/config"
	"smarthome-edge/internal/state"
)

type TelemetryForwarder interface {
	ForwardTelemetry(raw []byte)
}

type Server struct {
	cfg       *config.Config
	sm        *state.StateManager
	forwarder TelemetryForwarder
	listener  net.Listener
	running   bool
}

func NewServer(cfg *config.Config, sm *state.StateManager, fwd TelemetryForwarder) *Server {
	return &Server{
		cfg:       cfg,
		sm:        sm,
		forwarder: fwd,
	}
}

func (s *Server) Start() error {
	addr := s.cfg.Server.TCPListen
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", addr, err)
	}
	s.listener = ln
	s.running = true

	log.Printf("[TCP Gateway] Listening on %s (ESP8266 NDJSON Protocol)", addr)

	go s.acceptLoop()
	return nil
}

func (s *Server) Stop() {
	s.running = false
	if s.listener != nil {
		_ = s.listener.Close()
	}
}

func (s *Server) acceptLoop() {
	for s.running {
		conn, err := s.listener.Accept()
		if err != nil {
			if !s.running {
				return
			}
			log.Printf("[TCP Gateway] Accept error: %v", err)
			continue
		}
		go s.handleConnection(conn)
	}
}

func (s *Server) handleConnection(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(6 * time.Second))

	clientIP := conn.RemoteAddr().String()
	if host, _, err := net.SplitHostPort(clientIP); err == nil {
		clientIP = host
	}

	reader := bufio.NewReader(conn)

	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			raw := strings.TrimSpace(string(line))
			if raw != "" {
				s.processLine(conn, []byte(raw), clientIP)
			}
		}
		if err != nil {
			break
		}
	}
}

func (s *Server) processLine(conn net.Conn, raw []byte, clientIP string) {
	// 1. Process in local state manager
	commands, err := s.sm.IngestRawTelemetry(raw, clientIP, "TCP")
	if err != nil {
		log.Printf("[TCP Gateway] Telemetry parse error from %s: %v", clientIP, err)
		resp := map[string]string{"status": "error", "message": "Malformed JSON"}
		b, _ := json.Marshal(resp)
		_, _ = conn.Write(append(b, '\n'))
		return
	}

	// 2. Asynchronously forward telemetry to Central Server if online
	if s.forwarder != nil {
		go s.forwarder.ForwardTelemetry(raw)
	}

	// 3. Prepare response with pending commands
	type ResponsePayload struct {
		Status   string           `json:"status"`
		Epoch    int64            `json:"epoch"`
		Commands []*state.Command `json:"commands,omitempty"`
	}

	resp := ResponsePayload{
		Status:   "ok",
		Epoch:    time.Now().Unix(),
		Commands: commands,
	}

	respBytes, err := json.Marshal(resp)
	if err == nil {
		_, _ = conn.Write(append(respBytes, '\n'))
	}
}
