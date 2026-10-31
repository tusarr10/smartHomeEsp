#!/bin/bash
cd "$(dirname "$0")"

echo "=============================================================================="
echo " SmartHome Central Platform (JavaScript / Node.js Edition)"
echo "=============================================================================="

if [ ! -d "node_modules" ]; then
    echo "[Node.js] Installing dependencies..."
    npm install
fi

node server.js
