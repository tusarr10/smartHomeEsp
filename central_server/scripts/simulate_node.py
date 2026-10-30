#!/usr/bin/env python3
"""
Simulate Multi-Node Fleet for SmartHome Central Management Platform.
Simulates 5 nodes (ESP8266, ESP32, ESP-01) sending live telemetry over TCP port 2000.
"""

import socket
import time
import json
import random

SERVER_HOST = "127.0.0.1"
SERVER_PORT = 2000

NODES = [
    {
        "nodeId": "NODE_LIVING_01",
        "nodeName": "Living Room Hub",
        "hardware": "ESP8266 (ESP-12E)",
        "ip": "192.168.1.101",
        "mac": "BC:DD:C2:23:38:01",
        "channels": [
            {"id": 1, "pin": 5, "name": "Ceiling Chandelier", "room": "Living Room", "function": "Relay", "activeLow": True, "state": False},
            {"id": 2, "pin": 4, "name": "Balcony Spotlight", "room": "Living Room", "function": "Relay", "activeLow": True, "state": True}
        ]
    },
    {
        "nodeId": "NODE_BEDROOM_01",
        "nodeName": "Master Bedroom Controller",
        "hardware": "ESP8266 (ESP-12E)",
        "ip": "192.168.1.102",
        "mac": "BC:DD:C2:23:38:02",
        "channels": [
            {"id": 1, "pin": 5, "name": "Bedside Lamp", "room": "Master Bedroom", "function": "Relay", "activeLow": True, "state": False},
            {"id": 2, "pin": 4, "name": "Air Conditioner", "room": "Master Bedroom", "function": "Relay", "activeLow": True, "state": False}
        ]
    },
    {
        "nodeId": "NODE_KITCHEN_01",
        "nodeName": "Kitchen Appliance Node",
        "hardware": "ESP32",
        "ip": "192.168.1.103",
        "mac": "BC:DD:C2:23:38:03",
        "channels": [
            {"id": 1, "pin": 18, "name": "Exhaust Chimney", "room": "Kitchen", "function": "Relay", "activeLow": False, "state": False},
            {"id": 2, "pin": 19, "name": "Under-Cabinet LED", "room": "Kitchen", "function": "Relay", "activeLow": False, "state": True}
        ]
    },
    {
        "nodeId": "NODE_GATE_01",
        "nodeName": "Main Gate Controller",
        "hardware": "ESP-01",
        "ip": "192.168.1.104",
        "mac": "BC:DD:C2:23:38:04",
        "channels": [
            {"id": 1, "pin": 0, "name": "Electric Gate Lock", "room": "Outdoors", "function": "Pulse Relay", "activeLow": True, "state": False}
        ]
    },
    {
        "nodeId": "NODE_WATER_PUMP_01",
        "nodeName": "Overhead Tank Pump",
        "hardware": "ESP8266",
        "ip": "192.168.1.105",
        "mac": "BC:DD:C2:23:38:05",
        "channels": [
            {"id": 1, "pin": 5, "name": "Water Pump Relay", "room": "Rooftop", "function": "Heavy Relay", "activeLow": True, "state": False}
        ]
    }
]

def send_telemetry(node):
    payload = {
        "nodeId": node["nodeId"],
        "nodeName": node["nodeName"],
        "hardware": node["hardware"],
        "eventType": "heartbeat",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "epoch": int(time.time()),
        "ip": node["ip"],
        "mac": node["mac"],
        "rssi": random.randint(-68, -48),
        "uptimeSec": int(time.time() % 86400),
        "freeHeap": random.randint(24000, 31000),
        "firmwareVersion": "1.6.0",
        "channels": node["channels"]
    }

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect((SERVER_HOST, SERVER_PORT))
        raw_msg = json.dumps(payload) + "\n"
        s.sendall(raw_msg.encode("utf-8"))

        resp = s.recv(4096).decode("utf-8", errors="ignore")
        s.close()

        if resp:
            try:
                resp_json = json.loads(resp)
                if "commands" in resp_json:
                    for cmd in resp_json["commands"]:
                        action = cmd.get("action")
                        ch_id = cmd.get("id") or cmd.get("gpioId")
                        for ch in node["channels"]:
                            if ch["id"] == ch_id:
                                if action == "setState":
                                    ch["state"] = bool(cmd.get("state"))
                                elif action == "toggle":
                                    ch["state"] = not ch["state"]
                                print(f"[{node['nodeId']}] Executed server command: {action} on Ch {ch_id} -> New State: {ch['state']}")
            except Exception:
                pass
        return True
    except Exception as e:
        print(f"[{node['nodeId']}] Socket error: {e}")
        return False

def main():
    print(f"Starting Multi-Node Fleet Simulation ({len(NODES)} nodes)...")
    print(f"Targeting Central TCP Server {SERVER_HOST}:{SERVER_PORT}")
    print("Press Ctrl+C to stop.\n")

    while True:
        for node in NODES:
            ok = send_telemetry(node)
            status_str = "OK" if ok else "FAILED"
            print(f"[{time.strftime('%H:%M:%S')}] {node['nodeId']} ({node['nodeName']}) Telemetry -> {status_str}")
            time.sleep(1.0)
        print("--- Cycle complete. Sleeping 5s ---")
        time.sleep(5.0)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nSimulator stopped.")
