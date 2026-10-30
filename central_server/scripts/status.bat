@echo off
setlocal

echo ==============================================================================
echo  SmartHome Central Management Platform - Service Status
echo ==============================================================================

echo Checking Port 8000 (FastAPI Web Dashboard)...
netstat -aon | findstr :8000
if %ERRORLEVEL% EQU 0 (
    echo [RUNNING] Web Dashboard is active on port 8000.
) else (
    echo [STOPPED] Web Dashboard is not listening on port 8000.
)

echo.
echo Checking Port 2000 (TCP Telemetry Listener)...
netstat -aon | findstr :2000
if %ERRORLEVEL% EQU 0 (
    echo [RUNNING] TCP Telemetry Listener is active on port 2000.
) else (
    echo [STOPPED] TCP Telemetry Listener is not listening on port 2000.
)

echo ==============================================================================
endlocal
