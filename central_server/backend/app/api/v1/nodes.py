from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.node import Node, NodeHeartbeat
from app.models.relay import Relay
from app.models.sensor import Sensor
from app.services.device_service import device_service

router = APIRouter(prefix="/nodes", tags=["Node Management"])

@router.get("")
async def list_nodes(
    room: Optional[str] = None,
    status: Optional[str] = None,
    hardware: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Node).options(selectinload(Node.relays), selectinload(Node.sensors)).order_by(Node.is_online.desc(), Node.last_seen_at.desc())
    if room:
        stmt = stmt.where(Node.room == room)
    if status:
        stmt = stmt.where(Node.status == status)
    if hardware:
        stmt = stmt.where(Node.hardware_type == hardware)
    if search:
        stmt = stmt.where(Node.name.ilike(f"%{search}%") | Node.node_id.ilike(f"%{search}%"))

    res = await db.execute(stmt)
    nodes = res.scalars().all()
    
    out = []
    for n in nodes:
        out.append({
            "id": n.id,
            "node_id": n.node_id,
            "name": n.name,
            "hardware_type": n.hardware_type,
            "firmware_version": n.firmware_version,
            "ip_address": n.ip_address,
            "mac_address": n.mac_address,
            "gateway": n.gateway,
            "rssi": n.rssi,
            "uptime_sec": n.uptime_sec,
            "free_heap": n.free_heap,
            "is_online": n.is_online,
            "status": n.status,
            "room": n.room,
            "location": n.location,
            "category": n.category,
            "last_seen_at": n.last_seen_at.isoformat() if n.last_seen_at else None,
            "relays_count": len(n.relays),
            "sensors_count": len(n.sensors),
            "relays": [{
                "id": r.id,
                "channel_id": r.channel_id,
                "pin": r.pin,
                "name": r.name,
                "room": r.room,
                "function": r.function,
                "active_low": r.active_low,
                "current_state": r.current_state,
                "requested_state": r.requested_state,
                "is_syncing": r.is_syncing
            } for r in n.relays]
        })
    return out

@router.get("/{node_id}")
async def get_node_details(node_id: str, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(Node)
        .where(Node.node_id == node_id)
        .options(selectinload(Node.relays), selectinload(Node.sensors))
    )
    res = await db.execute(stmt)
    node = res.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Get recent heartbeats
    hb_stmt = select(NodeHeartbeat).where(NodeHeartbeat.node_id == node_id).order_by(NodeHeartbeat.id.desc()).limit(20)
    hb_res = await db.execute(hb_stmt)
    heartbeats = hb_res.scalars().all()

    return {
        "node": {
            "id": node.id,
            "node_id": node.node_id,
            "name": node.name,
            "hardware_type": node.hardware_type,
            "firmware_version": node.firmware_version,
            "ip_address": node.ip_address,
            "mac_address": node.mac_address,
            "gateway": node.gateway,
            "rssi": node.rssi,
            "uptime_sec": node.uptime_sec,
            "free_heap": node.free_heap,
            "is_online": node.is_online,
            "status": node.status,
            "room": node.room,
            "location": node.location,
            "category": node.category,
            "last_seen_at": node.last_seen_at.isoformat() if node.last_seen_at else None,
            "created_at": node.created_at.isoformat() if node.created_at else None,
            "relays": [
                {
                    "id": r.id,
                    "channel_id": r.channel_id,
                    "pin": r.pin,
                    "name": r.name,
                    "room": r.room,
                    "function": r.function,
                    "active_low": r.active_low,
                    "initial_mode": r.initial_mode,
                    "enabled": r.enabled,
                    "current_state": r.current_state,
                    "requested_state": r.requested_state,
                    "is_syncing": r.is_syncing,
                    "last_changed_at": r.last_changed_at.isoformat() if r.last_changed_at else None
                } for r in node.relays
            ],
            "sensors": [
                {
                    "id": s.id,
                    "sensor_id": s.sensor_id,
                    "name": s.name,
                    "sensor_type": s.sensor_type,
                    "unit": s.unit,
                    "gpio_pin": s.gpio_pin,
                    "current_value": s.current_value,
                    "min_threshold": s.min_threshold,
                    "max_threshold": s.max_threshold,
                    "alert_enabled": s.alert_enabled,
                    "last_updated_at": s.last_updated_at.isoformat() if s.last_updated_at else None
                } for s in node.sensors
            ]
        },
        "recent_heartbeats": [
            {
                "timestamp": h.timestamp.isoformat(),
                "rssi": h.rssi,
                "free_heap": h.free_heap,
                "uptime_sec": h.uptime_sec
            } for h in heartbeats
        ]
    }

@router.put("/{node_id}")
async def update_node(node_id: str, payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    stmt = select(Node).where(Node.node_id == node_id)
    res = await db.execute(stmt)
    node = res.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    if "name" in payload: node.name = payload["name"]
    if "room" in payload: node.room = payload["room"]
    if "location" in payload: node.location = payload["location"]
    if "category" in payload: node.category = payload["category"]
    if "hardware_type" in payload: node.hardware_type = payload["hardware_type"]

    await db.commit()
    return {"success": True, "message": "Node updated successfully"}

@router.delete("/{node_id}")
async def delete_node(node_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Node).where(Node.node_id == node_id)
    res = await db.execute(stmt)
    node = res.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    await db.delete(node)
    await db.commit()
    return {"success": True, "message": f"Node {node_id} deleted successfully"}

@router.post("/{node_id}/restart")
async def restart_node(node_id: str):
    res = await device_service.dispatch_command(node_id, channel_id=0, action="reboot")
    return res

@router.post("/telemetry")
async def ingest_http_telemetry(payload: Dict[str, Any]):
    pending = await device_service.handle_telemetry(payload, protocol="HTTP")
    resp = {"status": "ok"}
    if pending:
        resp["commands"] = pending
    return resp
