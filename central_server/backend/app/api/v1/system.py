import time
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.node import Node
from app.models.relay import Relay
from app.models.sensor import Sensor
from app.models.system import SystemEvent, AuditLog, Notification
from app.protocols.tcp_server import tcp_server
from app.protocols.mqtt_client import mqtt_manager

router = APIRouter(prefix="/system", tags=["System Diagnostics & Diagnostics"])

SERVER_START_EPOCH = time.time()

@router.get("/overview")
async def get_overview(db: AsyncSession = Depends(get_db)):
    # Node stats
    n_res = await db.execute(select(func.count(Node.id)))
    total_nodes = n_res.scalar() or 0

    on_res = await db.execute(select(func.count(Node.id)).where(Node.is_online == True))
    online_nodes = on_res.scalar() or 0

    # Relay stats
    r_res = await db.execute(select(func.count(Relay.id)))
    total_relays = r_res.scalar() or 0

    ron_res = await db.execute(select(func.count(Relay.id)).where(Relay.current_state == True))
    active_relays = ron_res.scalar() or 0

    # Sensor stats
    s_res = await db.execute(select(func.count(Sensor.id)))
    total_sensors = s_res.scalar() or 0

    # Unread notifications
    notif_res = await db.execute(select(func.count(Notification.id)).where(Notification.read == False))
    unread_alerts = notif_res.scalar() or 0

    uptime_sec = int(time.time() - SERVER_START_EPOCH)

    return {
        "nodes": {
            "total": total_nodes,
            "online": online_nodes,
            "offline": total_nodes - online_nodes
        },
        "relays": {
            "total": total_relays,
            "on": active_relays,
            "off": total_relays - active_relays
        },
        "sensors": {
            "total": total_sensors
        },
        "alerts": {
            "unread": unread_alerts
        },
        "protocols": {
            "tcp_server": {
                "running": tcp_server.is_running,
                "port": settings.TCP_SERVER_PORT
            },
            "mqtt_broker": {
                "connected": mqtt_manager.is_connected,
                "broker": f"{settings.MQTT_BROKER_HOST}:{settings.MQTT_BROKER_PORT}"
            }
        },
        "server": {
            "version": settings.VERSION,
            "uptime_sec": uptime_sec,
            "platform": "Windows SmartHome Central Platform"
        }
    }

@router.get("/events")
async def get_events(limit: int = 100, db: AsyncSession = Depends(get_db)):
    stmt = select(SystemEvent).order_by(SystemEvent.id.desc()).limit(limit)
    res = await db.execute(stmt)
    events = res.scalars().all()
    return [{
        "id": ev.id,
        "timestamp": ev.timestamp.isoformat(),
        "node_id": ev.node_id,
        "category": ev.category,
        "severity": ev.severity,
        "description": ev.description,
        "execution_result": ev.execution_result
    } for ev in events]

@router.get("/notifications")
async def get_notifications(db: AsyncSession = Depends(get_db)):
    stmt = select(Notification).order_by(Notification.id.desc()).limit(50)
    res = await db.execute(stmt)
    notifs = res.scalars().all()
    return [{
        "id": n.id,
        "title": n.title,
        "message": n.message,
        "severity": n.severity,
        "read": n.read,
        "node_id": n.node_id,
        "timestamp": n.timestamp.isoformat()
    } for n in notifs]

@router.post("/notifications/mark-read")
async def mark_notifications_read(db: AsyncSession = Depends(get_db)):
    stmt = select(Notification).where(Notification.read == False)
    res = await db.execute(stmt)
    notifs = res.scalars().all()
    for n in notifs:
        n.read = True
    await db.commit()
    return {"success": True, "marked_count": len(notifs)}

@router.get("/logs")
async def get_audit_logs(limit: int = 100, db: AsyncSession = Depends(get_db)):
    stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    res = await db.execute(stmt)
    logs = res.scalars().all()
    return [{
        "id": l.id,
        "timestamp": l.timestamp.isoformat(),
        "username": l.username,
        "action": l.action,
        "target": l.target,
        "details": l.details,
        "ip_address": l.ip_address
    } for l in logs]
