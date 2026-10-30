from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.sensor import Sensor, SensorReading
from app.services.sensor_service import sensor_service
from app.services.automation_engine import automation_engine

router = APIRouter(prefix="/sensors", tags=["Dynamic Sensor Management"])

@router.get("")
async def list_sensors(sensor_type: Optional[str] = None, node_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    stmt = select(Sensor)
    if sensor_type: stmt = stmt.where(Sensor.sensor_type == sensor_type)
    if node_id: stmt = stmt.where(Sensor.node_id == node_id)
    stmt = stmt.order_by(Sensor.name.asc())

    res = await db.execute(stmt)
    sensors = res.scalars().all()
    return [{
        "id": s.id,
        "sensor_id": s.sensor_id,
        "node_id": s.node_id,
        "name": s.name,
        "sensor_type": s.sensor_type,
        "unit": s.unit,
        "gpio_pin": s.gpio_pin,
        "interface": s.interface,
        "current_value": s.current_value,
        "previous_value": s.previous_value,
        "is_binary": s.is_binary,
        "binary_state": s.binary_state,
        "min_threshold": s.min_threshold,
        "max_threshold": s.max_threshold,
        "alert_enabled": s.alert_enabled,
        "last_updated_at": s.last_updated_at.isoformat() if s.last_updated_at else None
    } for s in sensors]

@router.post("/ingest")
async def ingest_sensor(payload: Dict[str, Any]):
    sensor_id = payload.get("sensor_id")
    node_id = payload.get("node_id")
    if not sensor_id or not node_id:
        raise HTTPException(status_code=400, detail="sensor_id and node_id required")

    res = await sensor_service.ingest_reading(
        node_id=node_id,
        sensor_id=sensor_id,
        name=payload.get("name", sensor_id),
        sensor_type=payload.get("sensor_type", "custom_numeric"),
        value=payload.get("value"),
        unit=payload.get("unit", ""),
        is_binary=bool(payload.get("is_binary", False)),
        binary_state=payload.get("binary_state"),
        gpio_pin=payload.get("gpio_pin")
    )

    if res.get("success") and payload.get("value") is not None:
        # Trigger automation engine evaluation
        await automation_engine.evaluate_sensor_event(sensor_id, float(payload["value"]))

    return res

@router.get("/{sensor_id}/history")
async def get_sensor_history(sensor_id: str, limit: int = 100, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(SensorReading)
        .join(Sensor, SensorReading.sensor_id == Sensor.id)
        .where(Sensor.sensor_id == sensor_id)
        .order_by(SensorReading.id.desc())
        .limit(limit)
    )
    res = await db.execute(stmt)
    readings = res.scalars().all()
    # Reverse so it's chronological for charts
    return [{
        "timestamp": r.timestamp.isoformat(),
        "epoch": r.epoch,
        "value": r.value,
        "unit": r.unit
    } for r in reversed(readings)]

@router.put("/{sensor_id}/thresholds")
async def update_sensor_thresholds(sensor_id: str, payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    stmt = select(Sensor).where(Sensor.sensor_id == sensor_id)
    res = await db.execute(stmt)
    sensor = res.scalars().first()
    if not sensor:
        raise HTTPException(status_code=404, detail="Sensor not found")

    if "min_threshold" in payload: sensor.min_threshold = payload["min_threshold"]
    if "max_threshold" in payload: sensor.max_threshold = payload["max_threshold"]
    if "alert_enabled" in payload: sensor.alert_enabled = bool(payload["alert_enabled"])

    await db.commit()
    return {"success": True, "message": "Sensor thresholds updated"}
