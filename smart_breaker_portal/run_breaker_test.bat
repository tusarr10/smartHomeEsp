@echo off
title Smart Circuit Breaker Local Test Portal
cd /d "%~dp0"

echo =======================================================
echo   Smart Circuit Breaker - Local Test Portal
echo   Zero-Cloud LAN Operation (Port 8085)
echo =======================================================
echo.
echo Starting local test server...
start "" http://127.0.0.1:8085/
python server.py
pause
