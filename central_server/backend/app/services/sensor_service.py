import logging
import time
from datetime import datetime
from typing import Dict, Any, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_factory
from app.models.sensor import Sensor, SensorReading
from app.models.system import Notification, SystemEvent
from app.services.websocket_manager import ws_manager

logger = logging.getLogger("SensorService")

class SensorService:
    """
    Dynamic Sensor Framework Manager.
    Allows arbitrary sensor drivers and interfaces without hardcoding sensor types.
    """

    async def ingest_reading(
        self,
        node_id: str,
        sensor_id: str,
        name: str,
        sensor_type: str,
        value: Optional[float] = None,
        unit: str = "",
        is_binary: bool = False,
        binary_state: Optional[bool] = None,
        gpio_pin: Optional[int] = None
    ) -> Dict[str, Any]:
        
        async with async_session_factory() as session:
            try:
                stmt = select(Sensor).where(Sensor.sensor_id == sensor_id)
                res = await session.execute(stmt)
                sensor = res.scalars().first()

                now = datetime.utcnow()
                epoch = time.time()

                if not sensor:
                    sensor = Sensor(
                        sensor_id=sensor_id,
                        node_id=node_id,
                        name=name,
                        sensor_type=sensor_type,
                        unit=unit,
                        gpio_pin=gpio_pin,
                        current_value=value,
                        previous_value=value,
                        is_binary=is_binary,
                        binary_state=binary_state,
                        last_updated_at=now
                    )
                    session.add(sensor)
                    await session.flush()
                else:
                    sensor.previous_value = sensor.current_value
                    sensor.current_value = value
                    sensor.is_binary = is_binary
                    sensor.binary_state = binary_state
                    sensor.last_updated_at = now

                # Record historical time-series reading
                if value is not None:
                    reading = SensorReading(
                        sensor_id=sensor.id,
                        node_id=node_id,
                        value=value,
                        unit=unit,
                        timestamp=now,
                        epoch=epoch
                    )
                    session.add(reading)

                # Threshold & Alert Evaluation
                alerts_triggered = []
                if sensor.alert_enabled and value is not None:
                    if sensor.max_threshold is not None and value > sensor.max_threshold:
                        msg = f"Alert: {sensor.name} on {node_id} exceeded maximum threshold ({value} {unit} > {sensor.max_threshold} {unit})"
                        alerts_triggered.append(msg)
                    elif sensor.min_threshold is not None and value < sensor.min_threshold:
                        msg = f"Alert: {sensor.name} on {node_id} fell below minimum threshold ({value} {unit} < {sensor.min_threshold} {unit})"
                        alerts_triggered.append(msg)

                for alert_msg in alerts_triggered:
                    notif = Notification(
                        title=f"Sensor Alert: {sensor.name}",
                        message=alert_msg,
                        severity="ALERT",
                        node_id=node_id,
                        timestamp=now
                    )
                    session.add(notif)
                    sys_ev = SystemEvent(
                        node_id=node_id,
                        category="SENSOR",
                        severity="WARNING",
                        description=alert_msg,
                        execution_result="ALERT_FIRED"
                    )
                    session.add(sys_ev)

                await session.commit()

                # Broadcast realtime update
                await ws_manager.broadcast("sensor_reading", {
                    "sensor_id": sensor_id,
                    "node_id": node_id,
                    "name": sensor.name,
                    "sensor_type": sensor_type,
                    "value": value,
                    "unit": unit,
                    "is_binary": is_binary,
                    "binary_state": binary_state,
                    "timestamp": now.isoformat()
                })

                return {"success": True, "sensor_id": sensor_id, "value": value}

            except Exception as e:
                logger.error(f"Error ingesting sensor {sensor_id}: {e}")
                await session.rollback()
                return {"success": False, "error": str(e)}

sensor_service = SensorService()
