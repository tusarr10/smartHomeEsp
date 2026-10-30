@echo off
setlocal

:: ==============================================================================
:: SmartHome Central Management Platform - One-Click Launcher
:: ==============================================================================

cd /d "%~dp0\.."

title SmartHome Central Management Platform

echo ==============================================================================
echo  🏠 Launching SmartHome Central Management Platform
echo ==============================================================================

if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

set PYTHONPATH=%CD%\backend

echo Starting Backend (FastAPI, TCP Port 2000, Automation, WebSockets)...
echo Web Dashboard will be available at: http://localhost:8000
echo.

python backend\app\main.py

pause
endlocal
