import json
import logging
from typing import List, Dict, Any
from fastapi import WebSocket

logger = logging.getLogger("WebSocketManager")

class WebSocketManager:
    """Manages real-time WebSocket connections with web dashboard clients."""
    
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Total clients: {len(self.active_connections)}")

    async def broadcast(self, event_type: str, data: Any):
        """Broadcasts structured event to all connected dashboard browsers."""
        if not self.active_connections:
            return
            
        payload = json.dumps({
            "type": event_type,
            "data": data
        })
        
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                dead_connections.append(connection)

        for dead in dead_connections:
            if dead in self.active_connections:
                self.active_connections.remove(dead)

ws_manager = WebSocketManager()
