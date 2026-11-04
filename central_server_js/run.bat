@echo off
setlocal
cd /d "%~dp0"

set PATH=%LOCALAPPDATA%\node-lts\node-v22.11.0-win-x64;%PATH%

echo ==============================================================================
echo  SmartHome Central Platform (JavaScript / Node.js Edition)
echo ==============================================================================
echo  Starting TCP Telemetry Server (Port 2000)
echo  Starting HTTP Dashboard and REST API (Port 9100)
echo  Starting WebSocket Server (/api/v1/ws)
echo ==============================================================================

if not exist node_modules (
    echo [Node.js] Installing dependencies...
    call npm install
)

node --experimental-sqlite server.js

endlocal
