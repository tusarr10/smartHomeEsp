#!/bin/sh
# SmartHome Edge Relay Gateway Runner for OpenWrt / Embedded Linux (MTK 830)

cd "$(dirname "$0")"

echo "======================================================================"
echo " Starting SmartHome Edge Relay Gateway on Embedded Linux / OpenWrt..."
echo " Memory limit pinned to 64MB (Safe for 512MB RAM MTK boards)"
echo "======================================================================"

# Check if node is installed
if ! command -v node > /dev/null 2>&1; then
    echo "Error: Node.js runtime not found. Install with: opkg install node (OpenWrt) or apt install nodejs"
    exit 1
fi

exec node --max-old-space-size=64 server.js
