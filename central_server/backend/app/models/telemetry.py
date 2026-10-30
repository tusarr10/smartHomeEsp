from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Float, Text
from app.database import Base

class TelemetryRecord(Base):
    __tablename__ = "telemetry"
    
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String(100), nullable=False, index=True)
    event_type = Column(String(50), default="heartbeat", nullable=False, index=True) # heartbeat, state_change, boot, alarm
    ip = Column(String(50), nullable=True)
    rssi = Column(Integer, default=0)
    free_heap = Column(Integer, default=0)
    uptime_sec = Column(Integer, default=0)
    payload_json = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    epoch = Column(Float, nullable=False, index=True)
