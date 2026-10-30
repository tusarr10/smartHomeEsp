from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base

class Sensor(Base):
    __tablename__ = "sensors"
    
    id = Column(Integer, primary_key=True, index=True)
    sensor_id = Column(String(100), unique=True, nullable=False, index=True) # e.g. SENS_LIVING_TEMP
    node_id = Column(String(100), ForeignKey("nodes.node_id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    # Generic Sensor Types: temperature, humidity, voltage, current, power, energy, motion, door_window, water_level, light, gas_smoke, custom_numeric, custom_binary
    sensor_type = Column(String(50), nullable=False, index=True)
    unit = Column(String(20), default="", nullable=False) # °C, %, V, A, W, kWh, lux, etc.
    gpio_pin = Column(Integer, nullable=True)
    interface = Column(String(50), default="GPIO", nullable=False) # GPIO, ADC, I2C, SPI, ONE_WIRE
    
    current_value = Column(Float, nullable=True)
    previous_value = Column(Float, nullable=True)
    is_binary = Column(Boolean, default=False, nullable=False)
    binary_state = Column(Boolean, nullable=True)
    
    # Thresholds & Alerts
    min_threshold = Column(Float, nullable=True)
    max_threshold = Column(Float, nullable=True)
    alert_enabled = Column(Boolean, default=False, nullable=False)
    
    last_updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    node = relationship("Node", back_populates="sensors")
    readings = relationship("SensorReading", back_populates="sensor", cascade="all, delete-orphan")

class SensorReading(Base):
    __tablename__ = "sensor_readings"
    
    id = Column(Integer, primary_key=True, index=True)
    sensor_id = Column(Integer, ForeignKey("sensors.id", ondelete="CASCADE"), nullable=False, index=True)
    node_id = Column(String(100), nullable=False, index=True)
    value = Column(Float, nullable=False)
    unit = Column(String(20), default="", nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    epoch = Column(Float, nullable=False)

    sensor = relationship("Sensor", back_populates="readings")
