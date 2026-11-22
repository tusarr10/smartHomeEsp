@echo off
echo ======================================================================
echo  Compiling SmartHome Edge Broker for Windows (Local Testing)
echo ======================================================================

set GOOS=windows
set GOARCH=amd64
set CGO_ENABLED=0

go build -trimpath -ldflags="-s -w" -o bin/smarthome-edge.exe ./cmd/edge

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Windows executable generated at: relay\bin\smarthome-edge.exe
) else (
    echo.
    echo [ERROR] Build failed.
)
pause
