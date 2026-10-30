from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base

class AutomationRule(Base):
    __tablename__ = "automation_rules"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(255), default="", nullable=False)
    enabled = Column(Boolean, default=True, nullable=False, index=True)
    
    trigger_type = Column(String(50), default="SENSOR", nullable=False) # SENSOR, TIME, RELAY_CHANGE, SCHEDULE
    condition_logic = Column(String(10), default="AND", nullable=False)  # AND, OR
    cron_expression = Column(String(100), nullable=True)                 # For time-based triggers
    schedule_time = Column(String(10), nullable=True)                   # "HH:MM" format
    schedule_days = Column(String(50), default="ALL", nullable=False)   # "MON,TUE,WED..."
    
    # Loop & rapid-fire protection
    cooldown_seconds = Column(Integer, default=5, nullable=False)
    last_executed_at = Column(DateTime, nullable=True)
    execution_count = Column(Integer, default=0, nullable=False)
    last_error = Column(String(255), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    conditions = relationship("AutomationCondition", back_populates="rule", cascade="all, delete-orphan")
    actions = relationship("AutomationAction", back_populates="rule", cascade="all, delete-orphan", order_by="AutomationAction.sequence_order")
    executions = relationship("AutomationExecution", back_populates="rule", cascade="all, delete-orphan")

class AutomationCondition(Base):
    __tablename__ = "automation_conditions"
    
    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("automation_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # SENSOR_NUMERIC, SENSOR_BINARY, RELAY_STATE, TIME_RANGE
    condition_type = Column(String(50), nullable=False)
    target_id = Column(String(100), nullable=False) # sensor_id, or "node_id:channel_id"
    operator = Column(String(20), nullable=False)   # GT, LT, EQ, NEQ, GTE, LTE, BETWEEN
    
    value_numeric = Column(Float, nullable=True)
    value_numeric_max = Column(Float, nullable=True) # for BETWEEN
    value_boolean = Column(Boolean, nullable=True)
    value_string = Column(String(100), nullable=True)

    rule = relationship("AutomationRule", back_populates="conditions")

class AutomationAction(Base):
    __tablename__ = "automation_actions"
    
    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("automation_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence_order = Column(Integer, default=1, nullable=False)
    
    # RELAY_ON, RELAY_OFF, RELAY_TOGGLE, RELAY_PULSE, DELAY, NOTIFICATION
    action_type = Column(String(50), nullable=False)
    target_node_id = Column(String(100), nullable=True)
    target_channel_id = Column(Integer, nullable=True)
    parameter_value = Column(Float, default=0.0, nullable=False) # e.g. pulse ms or delay ms
    message = Column(String(255), nullable=True)

    rule = relationship("AutomationRule", back_populates="actions")

class AutomationExecution(Base):
    __tablename__ = "automation_executions"
    
    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("automation_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    trigger_source = Column(String(100), nullable=False)
    status = Column(String(50), default="SUCCESS", nullable=False) # SUCCESS, FAILED, SKIPPED, COOLDOWN
    execution_time_ms = Column(Float, default=0.0, nullable=False)
    message = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    rule = relationship("AutomationRule", back_populates="executions")
