"""
Local Smart Circuit Breaker Test Server
Zero-dependency HTTP server using standard library http.server + tinytuya.
Works 100% locally with zero cloud dependencies.
Non-blocking background polling with instant HTTP response.
"""

import base64
import csv
import json
import mimetypes
import os
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import tinytuya

BASE_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = BASE_DIR.parent
DATA_DIR = WORKSPACE_DIR / "example" / "data" / "smartlife"
CONFIG_FILE = BASE_DIR / "device_config.json"
HISTORY_CSV = DATA_DIR / "breaker_readings.csv"
SNAPSHOT_JSON = DATA_DIR / "snapshot.json"
DEVICES_JSON = DATA_DIR / "devices.json"

DEFAULT_CONFIG = {
    "device_name": "Wi-Fi Smart Circuit Breaker",
    "device_id": "d7298b9bb3bcdd3d26wfpj",
    "local_key": ">U>Si=K$<|1[J$')",
    "ip_address": "192.168.1.164",
    "protocol_version": 3.5,
    "product_name": "Wi-Fi Smart Circuit Breaker (KB-A1H-A)",
    "mac_address": "30:48:7d:e8:5d:5c",
    "model_sn": "YT1U-4400377",
    "poll_interval_sec": 4,
    "simulation_mode": False
}

def load_config() -> Dict[str, Any]:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    cfg = dict(DEFAULT_CONFIG)
    if DEVICES_JSON.exists():
        try:
            devs = json.loads(DEVICES_JSON.read_text(encoding="utf-8"))
            for d in devs:
                if d.get("id") == cfg["device_id"] or d.get("mac") == cfg["mac_address"]:
                    cfg["device_name"] = d.get("name", cfg["device_name"])
                    cfg["device_id"] = d.get("id", cfg["device_id"])
                    cfg["local_key"] = d.get("key", cfg["local_key"])
                    cfg["ip_address"] = d.get("ip") or cfg["ip_address"]
                    if d.get("version"):
                        cfg["protocol_version"] = float(d["version"])
                    break
        except Exception as e:
            print(f"Error loading devices.json: {e}")
    save_config(cfg)
    return cfg

def save_config(cfg: Dict[str, Any]):
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

CURRENT_CONFIG = load_config()
LAST_READING: Dict[str, Any] = {
    "online": False,
    "source": "reference_cache",
    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "dps": {},
    "decoded": {},
    "errors": []
}

def decode_dp102(payload: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, str):
        return None
    try:
        raw = base64.b64decode(payload, validate=True)
    except Exception:
        return None
    if len(raw) != 8:
        return None
    v_raw = int.from_bytes(raw[0:2], "big")
    i_raw = int.from_bytes(raw[2:5], "big")
    p_raw = int.from_bytes(raw[5:8], "big")
    return {
        "voltage": round(v_raw / 10.0, 1),
        "current": round(i_raw / 1000.0, 3),
        "power_w": p_raw,
        "power_kw": round(p_raw / 1000.0, 3)
    }

def decode_fault_bitmap(fault_val: Optional[int]) -> Dict[str, bool]:
    if fault_val is None:
        return {}
    val = int(fault_val)
    return {
        "leakage_alarm": bool(val & (1 << 0)),
        "overcurrent_alarm": bool(val & (1 << 1)),
        "overvoltage_alarm": bool(val & (1 << 2)),
        "undervoltage_alarm": bool(val & (1 << 3)),
        "credit_alarm": bool(val & (1 << 4)),
        "high_temp_alarm": bool(val & (1 << 5)),
        "unbalance_alarm": bool(val & (1 << 6)),
        "phase_loss_alarm": bool(val & (1 << 7)),
        "reverse_phase_alarm": bool(val & (1 << 8)),
        "overpower_alarm": bool(val & (1 << 9)),
        "overload_alarm": bool(val & (1 << 10)),
        "relay_failure_alarm": bool(val & (1 << 11))
    }

def get_reference_dps() -> Dict[str, Any]:
    if SNAPSHOT_JSON.exists():
        try:
            data = json.loads(SNAPSHOT_JSON.read_text(encoding="utf-8"))
            for dev in data.get("devices", []):
                if dev.get("dps", {}).get("dps"):
                    return dict(dev["dps"]["dps"])
        except Exception:
            pass
    return {
        "17": 9,
        "26": 0,
        "38": "memory",
        "40": False,
        "101": 5143,
        "103": True,
        "108": True,
        "111": "KB-A1H-A  ",
        "112": 500,
        "114": 36,
        "115": 98,
        "116": 5,
        "117": 1,
        "118": 30,
        "119": True,
        "121": 14144,
        "123": 1000,
        "126": 0,
        "127": True,
        "129": 1,
        "130": 30,
        "131": 0,
        "132": 10,
        "133": 3
    }

def poll_device_locally() -> Dict[str, Any]:
    global LAST_READING, CURRENT_CONFIG
    cfg = CURRENT_CONFIG
    errors = []
    dps = {}
    is_live = False

    if not cfg.get("simulation_mode"):
        try:
            dev = tinytuya.OutletDevice(
                dev_id=cfg["device_id"],
                address=cfg["ip_address"],
                local_key=cfg["local_key"],
                version=float(cfg.get("protocol_version", 3.5))
            )
            dev.set_socketTimeout(1.5)
            dev.set_socketPersistent(False)
            if hasattr(dev, "set_socketRetry"):
                dev.set_socketRetry(1)

            res = dev.status()
            if isinstance(res, dict) and "dps" in res:
                dps.update(res["dps"])
                is_live = True
            elif res and res.get("Error"):
                errors.append(f"Status read: {res.get('Error')}")

            if is_live:
                try:
                    ref = dev.updatedps([17, 26, 38, 40, 101, 102, 103, 112, 114, 115, 126, 132])
                    if isinstance(ref, dict):
                        if "dps" in ref and isinstance(ref["dps"], dict):
                            dps.update(ref["dps"])
                        if "data" in ref and isinstance(ref["data"], dict) and "dps" in ref["data"]:
                            dps.update(ref["data"]["dps"])
                except Exception as e:
                    errors.append(f"DP refresh: {str(e)}")

        except Exception as exc:
            errors.append(f"LAN socket error: {exc}")

    if not is_live:
        ref_dps = get_reference_dps()
        if LAST_READING.get("dps"):
            ref_dps.update(LAST_READING["dps"])
        dps = ref_dps

    dp102_data = decode_dp102(dps.get("102"))
    voltage = dp102_data["voltage"] if dp102_data else 231.4
    current = dp102_data["current"] if dp102_data else 1.845
    power_w = dp102_data["power_w"] if dp102_data else 426
    power_kw = dp102_data["power_kw"] if dp102_data else 0.426

    freq_raw = dps.get("112")
    frequency = round(freq_raw / 10.0, 1) if freq_raw is not None else 50.0
    temperature = dps.get("114", 36)

    energy_raw = dps.get("101")
    energy_kwh = round(energy_raw / 100.0, 2) if energy_raw is not None else 51.43

    apparent_va = voltage * current if voltage and current else 427.0
    pf = round(power_w / apparent_va, 3) if apparent_va and apparent_va > 0 else 0.98

    fault_int = dps.get("26", 0)
    fault_map = decode_fault_bitmap(fault_int)
    # Contactor switch state: In TDQ breakers, DP 108 is breaker contact switch; fallback to 1, 16, 103
    breaker_state = dps.get("108")
    if breaker_state is None:
        breaker_state = dps.get("1")
    if breaker_state is None:
        breaker_state = dps.get("16")
    if breaker_state is None:
        breaker_state = dps.get("103", True)
    breaker_state = bool(breaker_state)
    leakage_ma = int(dps.get("126", 0))

    decoded = {
        "switch_state": breaker_state,
        "voltage_v": voltage,
        "current_a": current,
        "power_w": power_w,
        "power_kw": power_kw,
        "power_factor": pf,
        "frequency_hz": frequency,
        "temperature_c": temperature,
        "total_energy_kwh": energy_kwh,
        "leakage_current_ma": leakage_ma,
        "leakage_threshold_ma": int(dps.get("132", 200)),
        "leakage_master_enabled": bool(dps.get("127", True)),
        "leakage_delay_s": int(dps.get("129", 1)),
        "high_temp_threshold_c": int(dps.get("115", 94)),
        "overcurrent_limit_a": int(dps.get("130", 30)),
        "overcurrent_delay_s": int(dps.get("116", 5)),
        "protection_delay_s": int(dps.get("117", 1)),
        "auto_reclose_delay_s": int(dps.get("118", 30)),
        "auto_reclose_enabled": bool(dps.get("119", True)),
        "auto_reclose_attempts": int(dps.get("133", 10)),
        "overvoltage_threshold": dps.get("121", 14144),
        "overvoltage_delay_s": int(dps.get("105", 0)),
        "balance_threshold": int(dps.get("123", 1000)),
        "child_lock": bool(dps.get("40", False)),
        "power_on_behavior": dps.get("38", "memory"),
        "model_str": str(dps.get("111", "KB-A1H-A")).strip(),
        "fault_raw": fault_int,
        "faults": fault_map,
        "has_alarm": any(fault_map.values()),
        "apparent_power_va": round(apparent_va, 1),
        "raw_dp102_base64": dps.get("102", ""),
        "raw_dp102_hex": base64.b64decode(dps.get("102", "")).hex() if dps.get("102") else ""
    }

    LAST_READING = {
        "online": is_live,
        "source": "live_device" if is_live else "local_reference_data",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "dps": dps,
        "decoded": decoded,
        "errors": errors
    }
    return LAST_READING

# Initial quick load from reference cache (non-blocking)
ref_dps = get_reference_dps()
LAST_READING = {
    "online": False,
    "source": "local_reference_data",
    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "dps": ref_dps,
    "decoded": {
        "switch_state": ref_dps.get("103", True),
        "voltage_v": 231.4,
        "current_a": 1.845,
        "power_w": 426,
        "power_kw": 0.426,
        "power_factor": 0.98,
        "frequency_hz": 50.0,
        "temperature_c": 36,
        "total_energy_kwh": 51.43,
        "leakage_current_ma": int(ref_dps.get("126", 0)),
        "leakage_threshold_ma": int(ref_dps.get("132", 30)),
        "child_lock": False,
        "power_on_behavior": "memory",
        "model_str": "KB-A1H-A",
        "fault_raw": 0,
        "faults": decode_fault_bitmap(0),
        "has_alarm": False,
        "apparent_power_va": 427.0
    },
    "errors": []
}

def background_poller():
    while True:
        try:
            interval = CURRENT_CONFIG.get("poll_interval_sec", 4)
            time.sleep(max(2, interval))
            poll_device_locally()
        except Exception as e:
            time.sleep(3)

# Start background poller daemon
poller_thread = threading.Thread(target=background_poller, daemon=True)
poller_thread.start()

class PortalHandler(BaseHTTPRequestHandler):
    def send_json(self, status_code: int, data: Any):
        payload = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path in ("/", "/index.html"):
            index_path = BASE_DIR / "static" / "index.html"
            if index_path.exists():
                content = index_path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return

        elif path.startswith("/static/"):
            rel_path = path[len("/static/"):]
            static_file = BASE_DIR / "static" / rel_path
            if static_file.exists() and static_file.is_file():
                mime, _ = mimetypes.guess_type(str(static_file))
                content = static_file.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", mime or "application/octet-stream")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return

        elif path == "/api/status":
            self.send_json(200, {
                "config": CURRENT_CONFIG,
                "reading": LAST_READING
            })
            return

        elif path == "/api/history":
            rows = []
            if HISTORY_CSV.exists():
                try:
                    with HISTORY_CSV.open("r", encoding="utf-8") as f:
                        reader = csv.DictReader(f)
                        rows = list(reader)[-40:]
                except Exception:
                    pass
            self.send_json(200, {"count": len(rows), "samples": rows})
            return

        elif path == "/api/scan":
            try:
                scanned = tinytuya.deviceScan(maxretry=1)
                dev_list = []
                for ip, d in scanned.items():
                    dev_list.append({
                        "ip": d.get("ip") or ip,
                        "device_id": d.get("gwId") or d.get("id"),
                        "product_key": d.get("productKey"),
                        "version": d.get("version", "3.5"),
                        "active": d.get("active")
                    })
                self.send_json(200, {"status": "ok", "devices": dev_list})
            except Exception as e:
                self.send_json(200, {"status": "error", "error": str(e), "devices": []})
            return

        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not Found")

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b"{}"

        try:
            req_data = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            req_data = {}

        if path == "/api/refresh":
            res = poll_device_locally()
            self.send_json(200, {"status": "ok", "reading": res})
            return

        elif path == "/api/toggle":
            global CURRENT_CONFIG, LAST_READING
            cfg = CURRENT_CONFIG
            current_state = LAST_READING.get("decoded", {}).get("switch_state", True)
            target = req_data.get("state")
            new_state = not current_state if target is None else bool(target)

            if LAST_READING.get("decoded", {}).get("child_lock") and new_state is True:
                self.send_json(400, {
                    "detail": "Action blocked: Maintenance Lock (DP 40) is currently ACTIVE!"
                })
                return

            action_success = False
            error_msg = None

            if not cfg.get("simulation_mode") and LAST_READING.get("online"):
                try:
                    dev = tinytuya.OutletDevice(
                        dev_id=cfg["device_id"],
                        address=cfg["ip_address"],
                        local_key=cfg["local_key"],
                        version=float(cfg.get("protocol_version", 3.5))
                    )
                    dev.set_socketTimeout(2.0)
                    res = dev.set_value("108", new_state)
                    if res and res.get("Error"):
                        res = dev.set_value("103", new_state)
                    if res and not res.get("Error"):
                        action_success = True
                    else:
                        error_msg = str(res)
                except Exception as e:
                    error_msg = str(e)
            else:
                action_success = True

            if "dps" in LAST_READING:
                LAST_READING["dps"]["108"] = new_state
                LAST_READING["dps"]["103"] = new_state
                LAST_READING["decoded"]["switch_state"] = new_state
                LAST_READING["timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            self.send_json(200, {
                "status": "success" if action_success else "partial",
                "new_state": new_state,
                "error": error_msg
            })
            return

        elif path == "/api/control":
            dp = str(req_data.get("dp", ""))
            val = req_data.get("value")
            error_msg = None

            if not CURRENT_CONFIG.get("simulation_mode") and LAST_READING.get("online"):
                try:
                    dev = tinytuya.OutletDevice(
                        dev_id=CURRENT_CONFIG["device_id"],
                        address=CURRENT_CONFIG["ip_address"],
                        local_key=CURRENT_CONFIG["local_key"],
                        version=float(CURRENT_CONFIG.get("protocol_version", 3.5))
                    )
                    dev.set_socketTimeout(2.0)
                    res = dev.set_value(dp, val)
                    if res and res.get("Error"):
                        error_msg = str(res.get("Error"))
                except Exception as e:
                    error_msg = str(e)

            if "dps" in LAST_READING:
                LAST_READING["dps"][dp] = val
                if dp == "40":
                    LAST_READING["decoded"]["child_lock"] = bool(val)
                elif dp == "38":
                    LAST_READING["decoded"]["power_on_behavior"] = str(val)
                elif dp == "103":
                    LAST_READING["decoded"]["switch_state"] = bool(val)

            self.send_json(200, {"status": "ok", "dp": dp, "value": val, "error": error_msg})
            return

        elif path == "/api/config":
            for k, v in req_data.items():
                if v is not None:
                    CURRENT_CONFIG[k] = v
            save_config(CURRENT_CONFIG)
            poll_device_locally()
            self.send_json(200, {"status": "ok", "config": CURRENT_CONFIG, "reading": LAST_READING})
            return

        elif path == "/api/test-connection":
            target_ip = req_data.get("ip_address") or CURRENT_CONFIG.get("ip_address")
            target_id = req_data.get("device_id") or CURRENT_CONFIG.get("device_id")
            target_key = req_data.get("local_key") or CURRENT_CONFIG.get("local_key")
            target_ver = float(req_data.get("protocol_version") or CURRENT_CONFIG.get("protocol_version", 3.5))

            try:
                test_dev = tinytuya.OutletDevice(
                    dev_id=target_id,
                    address=target_ip,
                    local_key=target_key,
                    version=target_ver
                )
                test_dev.set_socketTimeout(2.5)
                st = test_dev.status()
                if isinstance(st, dict) and "dps" in st:
                    self.send_json(200, {
                        "status": "ok",
                        "online": True,
                        "ip": target_ip,
                        "device_id": target_id,
                        "dps_count": len(st["dps"]),
                        "raw_dps": st["dps"]
                    })
                else:
                    err = st.get("Error") if isinstance(st, dict) else str(st)
                    self.send_json(200, {"status": "ok", "online": False, "ip": target_ip, "error": err or "No response from socket"})
            except Exception as e:
                self.send_json(200, {"status": "ok", "online": False, "ip": target_ip, "error": str(e)})
            return

        elif path == "/api/scan":
            try:
                scanned = tinytuya.deviceScan(maxretry=1)
                dev_list = []
                for ip, d in scanned.items():
                    dev_list.append({
                        "ip": d.get("ip") or ip,
                        "device_id": d.get("gwId") or d.get("id"),
                        "product_key": d.get("productKey"),
                        "version": d.get("version", "3.5"),
                        "active": d.get("active")
                    })
                self.send_json(200, {"status": "ok", "devices": dev_list})
            except Exception as e:
                self.send_json(200, {"status": "error", "error": str(e), "devices": []})
            return

        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not Found")

def run_server(port=8085):
    server = ThreadingHTTPServer(("0.0.0.0", port), PortalHandler)
    print(f"Smart Circuit Breaker Test Server running at http://127.0.0.1:{port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8085))
    run_server(port)
