from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from app.database import Base

class SystemEvent(Base):
    __tablename__ = "system_events"
    
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    node_id = Column(String(100), nullable=True, index=True)
    category = Column(String(50), nullable=False, index=True) # MQTT, TCP, HTTP, RELAY, SENSOR, AUTOMATION, OTA, SYSTEM
    severity = Column(String(20), default="INFO", nullable=False, index=True) # INFO, SUCCESS, WARNING, ERROR, CRITICAL
    description = Column(Text, nullable=False)
    execution_result = Column(String(50), default="SUCCESS", nullable=False)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    username = Column(String(50), nullable=True)
    action = Column(String(100), nullable=False)
    target = Column(String(100), nullable=True)
    details = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)

class Notification(Base):
    __tablename__ = "notifications"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(150), nullable=False)
    message = Column(Text, nullable=False)
    severity = Column(String(20), default="INFO", nullable=False) # INFO, WARNING, ALERT, CRITICAL
    read = Column(Boolean, default=False, nullable=False, index=True)
    node_id = Column(String(100), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

class SystemSetting(Base):
    __tablename__ = "system_settings"
    
    key = Column(String(100), primary_key=True, index=True)
    value_json = Column(Text, nullable=False)
    description = Column(String(255), default="", nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
