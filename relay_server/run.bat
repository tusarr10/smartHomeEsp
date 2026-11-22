@echo off
title SmartHome Relay Gateway (MTK Lightweight Edition)
echo ======================================================================
echo  Starting SmartHome Edge Relay Gateway...
echo  Configured Port: 9200 (HTTP Dashboard) and 2000 (TCP Telemetry)
echo  RAM Optimization: 64MB memory limit for embedded devices
echo ======================================================================

node --max-old-space-size=64 server.js
pause
