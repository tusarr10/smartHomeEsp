package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"smarthome-edge/internal/auth"
	"smarthome-edge/internal/config"
	"smarthome-edge/internal/httpapi"
	"smarthome-edge/internal/queue"
	"smarthome-edge/internal/state"
	"smarthome-edge/internal/syncer"
	"smarthome-edge/internal/tcp"
	"smarthome-edge/internal/websocket"
)

const version = "1.0.0-edge"

func main() {
	configPath := flag.String("config", "./config/config.json", "Path to config.json")
	flag.Parse()

	log.Println(stringsRepeat("=", 70))
	log.Printf(" [SmartHome Edge] Go Edge Broker v%s", version)
	log.Println(" Optimized for MediaTek MT7986A Filogic 830 (Jio AX6000 OpenWrt)")
	log.Println(stringsRepeat("=", 70))

	// 1. Load Configuration
	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// 2. Initialize Subsystems
	stateMgr := state.NewStateManager()
	stateMgr.StartOfflineWatcher(cfg.Protocol.OfflineTimeoutSeconds)

	spool, err := queue.NewEventSpool(cfg.Storage.DataDir, cfg.Storage.EventQueueMaxMB)
	if err != nil {
		log.Fatalf("Failed to init event spool: %v", err)
	}

	authenticator := auth.NewAuthenticator(&cfg.Security)
	wsHub := websocket.NewHub()

	// Connect State updates to WebSocket broadcast
	stateMgr.AddListener(func(eventType string, data interface{}) {
		wsHub.BroadcastEvent(eventType, data)
	})

	centralSyncer := syncer.NewCentralSyncer(cfg, stateMgr)
	centralSyncer.Start()

	// 3. Start TCP Gateway (Port 2000 / 2001)
	tcpServer := tcp.NewServer(cfg, stateMgr, centralSyncer)
	if err := tcpServer.Start(); err != nil {
		log.Printf("[TCP Gateway] Warning: Could not bind TCP %s: %v", cfg.Server.TCPListen, err)
		log.Printf("              (If running on Windows alongside central server, adjust tcp_listen in config.json)")
	}

	// 4. Start HTTP & WebSocket Server (Port 9200)
	webDir := findWebDir(*configPath)
	log.Printf("[Web UI] Serving static files from: %s", webDir)
	httpRouter := httpapi.NewRouter(cfg, stateMgr, authenticator, wsHub, centralSyncer, spool, webDir)

	httpServer := &http.Server{
		Addr:    cfg.Server.HTTPListen,
		Handler: httpRouter,
	}

	go func() {
		log.Printf("[HTTP API] Listening on http://%s (REST + WebSocket)", cfg.Server.HTTPListen)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[HTTP API] Server error: %v", err)
		}
	}()

	// 5. Start Metrics Listener (Port 9201 - Localhost only)
	if cfg.Server.MetricsListen != "" {
		go func() {
			metricsMux := http.NewServeMux()
			metricsMux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, "smarthome_edge_status 1\n")
			})
			_ = http.ListenAndServe(cfg.Server.MetricsListen, metricsMux)
		}()
	}

	log.Println(stringsRepeat("=", 70))
	log.Printf(" >> Edge Broker Active: Ready for Node Telemetry & Local Mobile Control.")
	log.Println(stringsRepeat("=", 70))

	// Graceful Shutdown
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)
	<-stopChan

	log.Println("\n[Edge Broker] Shutting down gracefully...")
	tcpServer.Stop()
	_ = httpServer.Close()
	log.Println("[Edge Broker] Stopped cleanly. Goodbye.")
}

func stringsRepeat(s string, n int) string {
	res := ""
	for i := 0; i < n; i++ {
		res += s
	}
	return res
}

func findWebDir(configPath string) string {
	var candidates []string

	// Check if config file has a sibling or parent web dir
	if configPath != "" {
		confDir := filepath.Dir(configPath)
		candidates = append(candidates, filepath.Join(confDir, "web"))
		candidates = append(candidates, filepath.Join(confDir, "..", "web"))
	}

	// Check executable directory
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates, filepath.Join(exeDir, "web"))
		candidates = append(candidates, filepath.Join(exeDir, "..", "web"))
	}

	candidates = append(candidates,
		"./web",
		"./relay/web",
		"/usr/share/smarthome-edge/web",
		"/etc/smarthome-edge/web",
		"/www/smarthome-edge",
	)

	for _, p := range candidates {
		if fi, err := os.Stat(p); err == nil && fi.IsDir() {
			if _, errIndex := os.Stat(filepath.Join(p, "index.html")); errIndex == nil {
				abs, _ := filepath.Abs(p)
				return abs
			}
		}
	}

	abs, _ := filepath.Abs("./web")
	return abs
}
