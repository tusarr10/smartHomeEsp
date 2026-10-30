from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Relay(Base):
    __tablename__ = "relays"
    
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String(100), ForeignKey("nodes.node_id", ondelete="CASCADE"), nullable=False, index=True)
    channel_id = Column(Integer, nullable=False, index=True) # Channel index 1, 2, 3...
    pin = Column(Integer, nullable=False)                    # Hardware GPIO pin (e.g. 5 for D1, 4 for D2)
    name = Column(String(100), nullable=False)
    room = Column(String(100), default="General", nullable=False, index=True)
    function = Column(String(50), default="Relay", nullable=False)
    active_low = Column(Boolean, default=True, nullable=False)
    initial_mode = Column(Integer, default=0, nullable=False) # 0=Restore Last, 1=Force OFF, 2=Force ON
    enabled = Column(Boolean, default=True, nullable=False)
    
    # Crucial distinction between physical confirmed and requested state
    current_state = Column(Boolean, default=False, nullable=False, index=True) # Physical confirmed state
    requested_state = Column(Boolean, default=False, nullable=False)           # User/system desired state
    is_syncing = Column(Boolean, default=False, nullable=False)                # True while awaiting ack
    last_changed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    node = relationship("Node", back_populates="relays")
    events = relationship("RelayEvent", back_populates="relay", cascade="all, delete-orphan")

class RelayEvent(Base):
    __tablename__ = "relay_events"
    
    id = Column(Integer, primary_key=True, index=True)
    relay_id = Column(Integer, ForeignKey("relays.id", ondelete="CASCADE"), nullable=True)
    node_id = Column(String(100), nullable=False, index=True)
    channel_id = Column(Integer, nullable=False)
    old_state = Column(Boolean, nullable=True)
    new_state = Column(Boolean, nullable=False)
    trigger_source = Column(String(50), default="SYSTEM", nullable=False) # USER, AUTOMATION, HARDWARE, MQTT, TCP
    command_id = Column(String(100), nullable=True)
    confirmed = Column(Boolean, default=True, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    relay = relationship("Relay", back_populates="events")
