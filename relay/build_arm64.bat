@echo off
echo ======================================================================
echo  Compiling SmartHome Edge Broker for Linux ARM64 (Jio AX6000 OpenWrt)
echo  Target: MediaTek MT7986A Filogic 830 / Cortex-A53
echo ======================================================================

set GOOS=linux
set GOARCH=arm64
set CGO_ENABLED=0

go build -trimpath -ldflags="-s -w" -o bin/smarthome-edge ./cmd/edge

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Binary generated at: relay\bin\smarthome-edge
    echo Ready to SCP / upload to /usr/bin/smarthome-edge on your router!
) else (
    echo.
    echo [ERROR] Build failed.
)
pause
