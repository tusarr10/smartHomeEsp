@echo off
setlocal

echo ==============================================================================
echo  SmartHome Central Management Platform - Windows Installation
echo ==============================================================================

cd /d "%~dp0\.."

echo [1/4] Checking Python environment...
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH! Please install Python 3.10+
    pause
    exit /b 1
)

echo [2/4] Setting up Python virtual environment (venv)...
if not exist "venv" (
    python -m venv venv
)
call venv\Scripts\activate.bat

echo [3/4] Installing backend dependencies...
python -m pip install --upgrade pip
pip install -r backend\requirements.txt

echo [4/4] Creating local storage directories...
if not exist "data" mkdir "data"
if not exist "backups" mkdir "backups"
if not exist "firmware_storage\ESP8266" mkdir "firmware_storage\ESP8266"
if not exist "firmware_storage\ESP32" mkdir "firmware_storage\ESP32"
if not exist "firmware_storage\ESP-01" mkdir "firmware_storage\ESP-01"

echo ==============================================================================
echo [SUCCESS] Installation completed successfully!
echo To start the server, run: scripts\start_all.bat
echo ==============================================================================

pause
endlocal
