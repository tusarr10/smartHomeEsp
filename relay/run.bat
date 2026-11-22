@echo off
title SmartHome Go Edge Broker (Local Testing)
echo ======================================================================
echo  Starting SmartHome Go Edge Broker on Port 9200 (HTTP) & 2001 (TCP)...
echo ======================================================================

go run ./cmd/edge -config ./config/config.json
pause
