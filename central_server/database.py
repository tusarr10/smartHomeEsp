import sqlite3
import json
import time
import os
from typing import Dict, List, Optional, Any

class FleetDatabase:
    """SQLite Database manager for smartHomeEsp Central Fleet Server."""
    
    def __init__(self, db_path: str = "data/fleet.db"):
        self.db_path = db_path
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self.init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            # Nodes Table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS nodes (
                node_id TEXT PRIMARY KEY,
                node_name TEXT,
                ip TEXT,
                mac TEXT,
                firmware_version TEXT,
                rssi INTEGER,
                uptime_sec INTEGER,
                free_heap INTEGER,
                last_seen_epoch REAL,
                last_seen_str TEXT,
                channels_json TEXT,
                is_online INTEGER DEFAULT 1,
                created_at REAL
            )
            """)
            
            # Telemetry Log
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS telemetry_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id TEXT,
                event_type TEXT,
                timestamp_str TEXT,
                epoch REAL,
                ip TEXT,
                rssi INTEGER,
                free_heap INTEGER,
                payload_json TEXT
            )
            """)
            
            # Audit Activity Logs
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp_str TEXT,
                epoch REAL,
                category TEXT,
                node_id TEXT,
                message TEXT
            )
            """)
            
            conn.commit()

    def upsert_node(self, node_data: Dict[str, Any]) -> bool:
        node_id = node_data.get("nodeId")
        if not node_id:
            return False

        now_epoch = time.time()
        time_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now_epoch))

        channels_json = json.dumps(node_data.get("channels", []))

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO nodes (
                node_id, node_name, ip, mac, firmware_version, rssi, uptime_sec, 
                free_heap, last_seen_epoch, last_seen_str, channels_json, is_online, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(node_id) DO UPDATE SET
                node_name = COALESCE(excluded.node_name, nodes.node_name),
                ip = excluded.ip,
                mac = excluded.mac,
                firmware_version = excluded.firmware_version,
                rssi = excluded.rssi,
                uptime_sec = excluded.uptime_sec,
                free_heap = excluded.free_heap,
                last_seen_epoch = excluded.last_seen_epoch,
                last_seen_str = excluded.last_seen_str,
                channels_json = excluded.channels_json,
                is_online = 1
            """, (
                node_id,
                node_data.get("nodeName", "ESP-Node"),
                node_data.get("ip", ""),
                node_data.get("mac", ""),
                node_data.get("firmwareVersion", "1.6.0"),
                node_data.get("rssi", 0),
                node_data.get("uptimeSec", 0),
                node_data.get("freeHeap", 0),
                now_epoch,
                node_data.get("timestamp", time_str),
                channels_json,
                now_epoch
            ))
            conn.commit()
        return True

    def get_nodes(self) -> List[Dict[str, Any]]:
        nodes = []
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM nodes ORDER BY is_online DESC, last_seen_epoch DESC")
            for row in cursor.fetchall():
                node = dict(row)
                try:
                    node["channels"] = json.loads(node.get("channels_json") or "[]")
                except Exception:
                    node["channels"] = []
                node.pop("channels_json", None)
                node["name"] = node.get("node_name", node.get("node_id"))
                node["ip_address"] = node.get("ip", "")
                node["status"] = "Online" if node.get("is_online") else "Offline"
                node["hardware_type"] = "ESP8266"
                nodes.append(node)
        return nodes

    def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,))
            row = cursor.fetchone()
            if not row:
                return None
            node = dict(row)
            try:
                node["channels"] = json.loads(node.get("channels_json") or "[]")
            except Exception:
                node["channels"] = []
            node.pop("channels_json", None)
            node["name"] = node.get("node_name", node.get("node_id"))
            node["ip_address"] = node.get("ip", "")
            node["status"] = "Online" if node.get("is_online") else "Offline"
            node["hardware_type"] = "ESP8266"
            return node

    def set_node_online(self, node_id: str, is_online: bool):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE nodes SET is_online = ? WHERE node_id = ?", (1 if is_online else 0, node_id))
            conn.commit()

    def rename_node(self, node_id: str, new_name: str) -> bool:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE nodes SET node_name = ? WHERE node_id = ?", (new_name, node_id))
            conn.commit()
            return cursor.rowcount > 0

    def delete_node(self, node_id: str) -> bool:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM nodes WHERE node_id = ?", (node_id,))
            cursor.execute("DELETE FROM telemetry_logs WHERE node_id = ?", (node_id,))
            conn.commit()
            return cursor.rowcount > 0

    def update_channel_state(self, node_id: str, channel_id: int, new_state: bool) -> bool:
        node = self.get_node(node_id)
        if not node:
            return False
        channels = node.get("channels", [])
        updated = False
        for ch in channels:
            if ch.get("id") == channel_id:
                ch["state"] = new_state
                updated = True
                break
        if updated:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE nodes SET channels_json = ? WHERE node_id = ?", (json.dumps(channels), node_id))
                conn.commit()
        return updated

    def log_telemetry(self, node_id: str, event_type: str, data: Dict[str, Any]):
        now_epoch = time.time()
        time_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now_epoch))
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO telemetry_logs (node_id, event_type, timestamp_str, epoch, ip, rssi, free_heap, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                node_id,
                event_type,
                data.get("timestamp", time_str),
                data.get("epoch", now_epoch),
                data.get("ip", ""),
                data.get("rssi", 0),
                data.get("freeHeap", 0),
                json.dumps(data)
            ))
            # Clean up old logs beyond 10,000 entries
            cursor.execute("""
            DELETE FROM telemetry_logs WHERE id IN (
                SELECT id FROM telemetry_logs ORDER BY id DESC LIMIT -1 OFFSET 10000
            )
            """)
            conn.commit()

    def log_audit(self, category: str, node_id: str, message: str):
        now_epoch = time.time()
        time_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now_epoch))
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO audit_logs (timestamp_str, epoch, category, node_id, message)
            VALUES (?, ?, ?, ?, ?)
            """, (time_str, now_epoch, category, node_id, message))
            # Clean up old logs beyond 2,000 entries
            cursor.execute("""
            DELETE FROM audit_logs WHERE id IN (
                SELECT id FROM audit_logs ORDER BY id DESC LIMIT -1 OFFSET 2000
            )
            """)
            conn.commit()

    def get_audit_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?", (limit,))
            return [dict(r) for r in cursor.fetchall()]

    def get_telemetry_history(self, node_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM telemetry_logs WHERE node_id = ? ORDER BY id DESC LIMIT ?", (node_id, limit))
            return [dict(r) for r in cursor.fetchall()]
