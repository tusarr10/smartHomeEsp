from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Float, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from app.database import Base

class FirmwareFile(Base):
    __tablename__ = "firmware_files"
    
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    version = Column(String(50), nullable=False, index=True) # e.g. "1.6.0"
    hardware_type = Column(String(50), nullable=False, index=True) # ESP8266, ESP32, ESP-01
    file_size_bytes = Column(Integer, nullable=False)
    checksum_md5 = Column(String(64), nullable=False)
    checksum_sha256 = Column(String(128), nullable=False)
    storage_path = Column(String(500), nullable=False)
    description = Column(String(255), default="", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    deployments = relationship("FirmwareDeployment", back_populates="firmware", cascade="all, delete-orphan")

class FirmwareDeployment(Base):
    __tablename__ = "firmware_deployments"
    
    id = Column(Integer, primary_key=True, index=True)
    firmware_id = Column(Integer, ForeignKey("firmware_files.id", ondelete="CASCADE"), nullable=False, index=True)
    node_id = Column(String(100), ForeignKey("nodes.node_id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(50), default="PENDING", nullable=False) # PENDING, IN_PROGRESS, COMPLETED, FAILED, ROLLBACK
    progress_percent = Column(Float, default=0.0, nullable=False)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)

    firmware = relationship("FirmwareFile", back_populates="deployments")
