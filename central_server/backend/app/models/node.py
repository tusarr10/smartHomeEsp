from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base

class Node(Base):
    __tablename__ = "nodes"
    
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String(100), unique=True, nullable=False, index=True) # e.g. NODE-BCDDC223386C or NODE_LIVING_01
    name = Column(String(100), nullable=False)
    hardware_type = Column(String(50), default="ESP8266", nullable=False) # ESP8266, ESP32, ESP-01
    firmware_version = Column(String(50), default="1.6.0", nullable=False)
    ip_address = Column(String(50), nullable=True)
    mac_address = Column(String(50), nullable=True, index=True)
    gateway = Column(String(50), nullable=True)
    rssi = Column(Integer, default=0)
    uptime_sec = Column(Integer, default=0)
    free_heap = Column(Integer, default=0)
    is_online = Column(Boolean, default=False, nullable=False, index=True)
    status = Column(String(50), default="Offline", nullable=False) # Online, Offline, Connecting, Unresponsive, Updating, Error
    room = Column(String(100), default="General", nullable=False, index=True)
    location = Column(String(100), default="", nullable=False)
    category = Column(String(50), default="Relay Controller", nullable=False)
    auth_token = Column(String(255), nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    relays = relationship("Relay", back_populates="node", cascade="all, delete-orphan")
    sensors = relationship("Sensor", back_populates="node", cascade="all, delete-orphan")
    connections = relationship("NodeConnection", back_populates="node", cascade="all, delete-orphan")
    heartbeats = relationship("NodeHeartbeat", back_populates="node", cascade="all, delete-orphan")

class NodeConnection(Base):
    __tablename__ = "node_connections"
    
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String(100), ForeignKey("nodes.node_id", ondelete="CASCADE"), nullable=False, index=True)
    protocol = Column(String(20), nullable=False) # TCP, MQTT, HTTP
    remote_ip = Column(String(50), nullable=True)
    connected_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    disconnected_at = Column(DateTime, nullable=True)
    disconnect_reason = Column(String(255), nullable=True)

    node = relationship("Node", back_populates="connections")

class NodeHeartbeat(Base):
    __tablename__ = "node_heartbeats"
    
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String(100), ForeignKey("nodes.node_id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    epoch = Column(Float, nullable=False)
    rssi = Column(Integer, default=0)
    free_heap = Column(Integer, default=0)
    uptime_sec = Column(Integer, default=0)

    node = relationship("Node", back_populates="heartbeats")

class NodeConfiguration(Base):
    __tablename__ = "node_configuration"
    
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String(100), unique=True, nullable=False, index=True)
    config_json = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
