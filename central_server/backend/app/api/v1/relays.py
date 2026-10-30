from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.relay import Relay, RelayEvent
from app.models.node import Node
from app.services.device_service import device_service

router = APIRouter(prefix="/relays", tags=["GPIO & Relay Management"])

@router.get("")
async def list_relays(
    room: Optional[str] = None,
    node_id: Optional[str] = None,
    state: Optional[bool] = None,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Relay, Node.name.label("node_name"), Node.is_online).join(Node, Relay.node_id == Node.node_id)
    if room:
        stmt = stmt.where(Relay.room == room)
    if node_id:
        stmt = stmt.where(Relay.node_id == node_id)
    if state is not None:
        stmt = stmt.where(Relay.current_state == state)

    res = await db.execute(stmt)
    rows = res.all()

    out = []
    for r, node_name, is_online in rows:
        out.append({
            "id": r.id,
            "node_id": r.node_id,
            "node_name": node_name,
            "node_online": is_online,
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
        })
    return out

@router.post("/{node_id}/{channel_id}/command")
async def send_relay_command(node_id: str, channel_id: int, payload: Dict[str, Any]):
    action = payload.get("action", "setState") # setState, toggle, pulse
    state = bool(payload.get("state", False))
    duration = int(payload.get("duration", 500))

    res = await device_service.dispatch_command(
        node_id=node_id,
        channel_id=channel_id,
        action=action,
        state=state,
        duration=duration
    )
    return res

@router.post("/broadcast")
async def broadcast_relays(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    action = payload.get("action", "setState")
    target_state = bool(payload.get("state", False))
    target_room = payload.get("room")

    stmt = select(Relay)
    if target_room:
        stmt = stmt.where(Relay.room == target_room)
    res = await db.execute(stmt)
    relays = res.scalars().all()

    dispatched = 0
    for r in relays:
        await device_service.dispatch_command(
            node_id=r.node_id,
            channel_id=r.channel_id,
            action=action,
            state=target_state
        )
        dispatched += 1

    return {"success": True, "dispatched_count": dispatched, "target_state": target_state}

@router.get("/{node_id}/{channel_id}/history")
async def get_relay_history(node_id: str, channel_id: int, limit: int = 50, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(RelayEvent)
        .where(RelayEvent.node_id == node_id, RelayEvent.channel_id == channel_id)
        .order_by(RelayEvent.id.desc())
        .limit(limit)
    )
    res = await db.execute(stmt)
    events = res.scalars().all()
    return [{
        "id": e.id,
        "old_state": e.old_state,
        "new_state": e.new_state,
        "trigger_source": e.trigger_source,
        "confirmed": e.confirmed,
        "timestamp": e.timestamp.isoformat()
    } for e in events]
