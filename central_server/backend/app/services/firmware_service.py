import os
import hashlib
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session_factory
from app.models.firmware import FirmwareFile, FirmwareDeployment
from app.models.node import Node
from app.models.system import SystemEvent
from app.services.websocket_manager import ws_manager

logger = logging.getLogger("FirmwareService")

class FirmwareService:
    """
    Central Firmware & OTA Management Service.
    Validates hardware flash limits, verifies checksums, and manages deployments.
    """

    # Flash size limit guidelines:
    # ESP-01: 1MB (max ~512KB firmware partition)
    # ESP8266 (ESP-12E/F): 4MB (max ~1044KB OTA partition)
    # ESP32: 4MB-16MB (max ~1.5MB - 3MB OTA partition)
    HARDWARE_LIMITS = {
        "ESP-01": 524288,        # 512 KB
        "ESP8266": 1048576,      # 1024 KB
        "ESP32": 2097152         # 2048 KB
    }

    async def save_firmware(
        self,
        filename: str,
        content: bytes,
        version: str,
        hardware_type: str,
        description: str = ""
    ) -> Dict[str, Any]:
        
        file_size = len(content)
        max_allowed = self.HARDWARE_LIMITS.get(hardware_type, 1048576)

        if file_size > max_allowed:
            limit_kb = max_allowed // 1024
            size_kb = file_size // 1024
            return {
                "success": False,
                "error": f"Firmware file size ({size_kb} KB) exceeds maximum OTA capacity for {hardware_type} ({limit_kb} KB)"
            }

        # Calculate Checksums
        md5_hash = hashlib.md5(content).hexdigest()
        sha256_hash = hashlib.sha256(content).hexdigest()

        # Save to storage directory
        target_dir = os.path.join(settings.FIRMWARE_STORAGE_PATH, hardware_type)
        os.makedirs(target_dir, exist_ok=True)
        storage_path = os.path.join(target_dir, f"{version}_{filename}")

        with open(storage_path, "wb") as f:
            f.write(content)

        async with async_session_factory() as session:
            firmware = FirmwareFile(
                filename=filename,
                version=version,
                hardware_type=hardware_type,
                file_size_bytes=file_size,
                checksum_md5=md5_hash,
                checksum_sha256=sha256_hash,
                storage_path=storage_path,
                description=description,
                is_active=True
            )
            session.add(firmware)
            await session.commit()
            await session.refresh(firmware)

        logger.info(f"Firmware {filename} (v{version} for {hardware_type}) saved successfully. MD5: {md5_hash}")
        return {
            "success": True,
            "firmware_id": firmware.id,
            "version": version,
            "size_bytes": file_size,
            "md5": md5_hash
        }

    async def deploy_to_node(self, firmware_id: int, node_id: str) -> Dict[str, Any]:
        """Initiates OTA deployment to an individual target node."""
        async with async_session_factory() as session:
            f_stmt = select(FirmwareFile).where(FirmwareFile.id == firmware_id)
            f_res = await session.execute(f_stmt)
            fw = f_res.scalars().first()

            n_stmt = select(Node).where(Node.node_id == node_id)
            n_res = await session.execute(n_stmt)
            node = n_res.scalars().first()

            if not fw: return {"success": False, "error": "Firmware not found"}
            if not node: return {"success": False, "error": "Node not found"}

            if fw.hardware_type != node.hardware_type:
                return {
                    "success": False,
                    "error": f"Incompatible hardware: Firmware is for {fw.hardware_type}, but node is {node.hardware_type}"
                }

            deployment = FirmwareDeployment(
                firmware_id=fw.id,
                node_id=node.node_id,
                status="IN_PROGRESS",
                progress_percent=10.0,
                started_at=datetime.utcnow()
            )
            session.add(deployment)
            node.status = "Updating"
            await session.commit()
            await session.refresh(deployment)

        # Broadcast OTA started
        await ws_manager.broadcast("ota_progress", {
            "deployment_id": deployment.id,
            "node_id": node_id,
            "status": "IN_PROGRESS",
            "progress": 10.0
        })

        # Launch async deployment worker
        asyncio.create_task(self._execute_ota(deployment.id, fw.storage_path, node.ip_address, fw.version))
        return {"success": True, "deployment_id": deployment.id, "message": "OTA deployment started"}

    async def _execute_ota(self, deployment_id: int, storage_path: str, node_ip: str, target_version: str):
        try:
            if not os.path.exists(storage_path):
                raise FileNotFoundError("Firmware binary file missing on disk")

            with open(storage_path, "rb") as f:
                fw_data = f.read()

            # Upload to ESP8266 OTA endpoint: POST http://<node_ip>/api/ota
            url = f"http://{node_ip}/api/ota"
            async with httpx.AsyncClient(timeout=60.0) as client:
                files = {"file": ("firmware.bin", fw_data, "application/octet-stream")}
                resp = await client.post(url, files=files)

            async with async_session_factory() as session:
                d_stmt = select(FirmwareDeployment).where(FirmwareDeployment.id == deployment_id)
                d_res = await session.execute(d_stmt)
                dep = d_res.scalars().first()

                if resp.status_code == 200:
                    dep.status = "COMPLETED"
                    dep.progress_percent = 100.0
                    dep.completed_at = datetime.utcnow()
                    logger.info(f"OTA deployment {deployment_id} succeeded on {node_ip}")
                else:
                    dep.status = "FAILED"
                    dep.error_message = f"Node returned HTTP {resp.status_code}: {resp.text}"
                    logger.error(f"OTA deployment {deployment_id} failed: {dep.error_message}")

                await session.commit()

            await ws_manager.broadcast("ota_progress", {
                "deployment_id": deployment_id,
                "status": "COMPLETED" if resp.status_code == 200 else "FAILED",
                "progress": 100.0 if resp.status_code == 200 else 0.0
            })

        except Exception as e:
            logger.error(f"OTA execution exception: {e}")
            async with async_session_factory() as session:
                d_stmt = select(FirmwareDeployment).where(FirmwareDeployment.id == deployment_id)
                d_res = await session.execute(d_stmt)
                dep = d_res.scalars().first()
                if dep:
                    dep.status = "FAILED"
                    dep.error_message = str(e)
                    await session.commit()

firmware_service = FirmwareService()
