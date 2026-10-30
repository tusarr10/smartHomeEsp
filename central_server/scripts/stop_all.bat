@echo off
setlocal

:: ==============================================================================
:: SmartHome Central Management Platform - Stop Services
:: ==============================================================================

echo Stopping SmartHome Central Server processes...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000') do (
    echo Terminating PID %%a on port 8000...
    taskkill /F /PID %%a >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :2000') do (
    echo Terminating PID %%a on port 2000...
    taskkill /F /PID %%a >nul 2>&1
)

echo [SUCCESS] Central Server stopped.
endlocal
