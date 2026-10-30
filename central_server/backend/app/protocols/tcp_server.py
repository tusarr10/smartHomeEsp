import asyncio
import json
import logging
import time
from typing import Dict, Any, Optional

from app.config import settings
from app.services.device_service import device_service

logger = logging.getLogger("TcpServer")

class TcpTelemetryServer:
    """
    High-Performance Async Raw TCP Socket Server for ESP8266/ESP32 fleet nodes.
    Listens on port 2000 with explicit message framing and bi-directional command injection.
    """
    
    def __init__(self):
        self.server: Optional[asyncio.Server] = None
        self.is_running = False

    async def start(self):
        host = settings.TCP_SERVER_HOST
        port = settings.TCP_SERVER_PORT
        logger.info(f"Starting TCP Telemetry Server on {host}:{port}...")
        try:
            self.server = await asyncio.start_server(self._handle_client, host, port)
            self.is_running = True
            logger.info(f"TCP Telemetry Server successfully listening on {host}:{port}")
        except Exception as e:
            logger.error(f"Failed to start TCP Telemetry Server on {host}:{port}: {e}")
            raise e

    async def stop(self):
        if self.server:
            self.is_running = False
            self.server.close()
            await self.server.wait_closed()
            logger.info("TCP Telemetry Server stopped.")

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        peer = writer.get_extra_info("peername")
        client_ip = peer[0] if peer else "unknown"
        buffer = ""

        try:
            # Read framed packet (newline-delimited or JSON boundary)
            while True:
                line = await asyncio.wait_for(reader.readline(), timeout=5.0)
                if not line:
                    break
                buffer += line.decode("utf-8", errors="ignore")
                if "\n" in buffer or buffer.strip().endswith("}"):
                    break

            buffer = buffer.strip()
            if buffer:
                try:
                    payload: Dict[str, Any] = json.loads(buffer)
                    if not payload.get("ip") or payload.get("ip") == "0.0.0.0":
                        payload["ip"] = client_ip

                    # Process in common DeviceService
                    pending_commands = await device_service.handle_telemetry(payload, protocol="TCP")

                    response = {"status": "ok", "epoch": int(time.time())}
                    if pending_commands:
                        response["commands"] = pending_commands

                    response_bytes = (json.dumps(response) + "\n").encode("utf-8")
                    writer.write(response_bytes)
                    await writer.drain()

                except json.JSONDecodeError as jde:
                    logger.warning(f"Malformed JSON from TCP client {client_ip}: {jde}")
                    err_resp = (json.dumps({"status": "error", "message": "Malformed JSON"}) + "\n").encode("utf-8")
                    writer.write(err_resp)
                    await writer.drain()

        except asyncio.TimeoutError:
            logger.debug(f"TCP client {client_ip} timed out waiting for payload.")
        except Exception as e:
            logger.debug(f"TCP socket exception with {client_ip}: {e}")
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

tcp_server = TcpTelemetryServer()
