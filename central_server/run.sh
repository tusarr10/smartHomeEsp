#!/bin/bash
cd "$(dirname "$0")"

echo "=============================================================================="
echo " SmartHome Central Platform Launcher"
echo "=============================================================================="
echo "[1] Start Production FastAPI + WebSocket + TCP Server (Port 8000 & 2000)"
echo "[2] Start Lightweight Standalone Async Server (Port 8080 & 2000)"
echo "[3] Run Multi-Node Fleet Simulation (5 Nodes)"
echo "=============================================================================="
read -p "Select option (1-3) [Default: 1]: " OPT

if [ "$OPT" == "2" ]; then
    python3 server.py
elif [ "$OPT" == "3" ]; then
    python3 scripts/simulate_node.py
else
    export PYTHONPATH="$(pwd)/backend"
    python3 backend/app/main.py
fi
