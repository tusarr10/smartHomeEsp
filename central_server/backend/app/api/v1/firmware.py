from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.firmware import FirmwareFile, FirmwareDeployment
from app.services.firmware_service import firmware_service

router = APIRouter(prefix="/firmware", tags=["Firmware & OTA Management"])

@router.get("")
async def list_firmware(hardware_type: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    stmt = select(FirmwareFile).order_by(FirmwareFile.created_at.desc())
    if hardware_type:
        stmt = stmt.where(FirmwareFile.hardware_type == hardware_type)
    res = await db.execute(stmt)
    files = res.scalars().all()
    return [{
        "id": f.id,
        "filename": f.filename,
        "version": f.version,
        "hardware_type": f.hardware_type,
        "file_size_bytes": f.file_size_bytes,
        "checksum_md5": f.checksum_md5,
        "checksum_sha256": f.checksum_sha256,
        "description": f.description,
        "is_active": f.is_active,
        "created_at": f.created_at.isoformat()
    } for f in files]

@router.post("/upload")
async def upload_firmware(
    file: UploadFile = File(...),
    version: str = Form(...),
    hardware_type: str = Form(...), # ESP8266, ESP32, ESP-01
    description: str = Form("")
):
    content = await file.read()
    res = await firmware_service.save_firmware(
        filename=file.filename,
        content=content,
        version=version,
        hardware_type=hardware_type,
        description=description
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error"))
    return res

@router.post("/deploy")
async def deploy_firmware(payload: Dict[str, Any]):
    firmware_id = payload.get("firmware_id")
    node_id = payload.get("node_id")
    if not firmware_id or not node_id:
        raise HTTPException(status_code=400, detail="firmware_id and node_id required")

    res = await firmware_service.deploy_to_node(firmware_id, node_id)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error"))
    return res

@router.get("/deployments")
async def list_deployments(limit: int = 50, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(FirmwareDeployment)
        .options(selectinload(FirmwareDeployment.firmware))
        .order_by(FirmwareDeployment.id.desc())
        .limit(limit)
    )
    res = await db.execute(stmt)
    deps = res.scalars().all()
    return [{
        "id": d.id,
        "firmware_id": d.firmware_id,
        "firmware_version": d.firmware.version if d.firmware else "",
        "node_id": d.node_id,
        "status": d.status,
        "progress_percent": d.progress_percent,
        "error_message": d.error_message,
        "started_at": d.started_at.isoformat(),
        "completed_at": d.completed_at.isoformat() if d.completed_at else None
    } for d in deps]
