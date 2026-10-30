@echo off
setlocal
cd /d "%~dp0"

echo ==============================================================================
echo  SmartHome Central Platform Launcher
echo ==============================================================================
echo [1] Start Production FastAPI + WebSocket + TCP Server (Port 8000 & 2000)
echo [2] Start Lightweight Standalone Async Server (Port 8080 & 2000)
echo [3] Run Multi-Node Fleet Simulation (5 Nodes)
echo ==============================================================================
set /p OPT="Select option (1-3) [Default: 1]: "

if "%OPT%"=="2" (
    python server.py
) else if "%OPT%"=="3" (
    python scripts\simulate_node.py
) else (
    call scripts\start_all.bat
)

endlocal
