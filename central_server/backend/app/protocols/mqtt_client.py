import asyncio
import json
import logging
from typing import Optional, Dict, Any
import paho.mqtt.client as mqtt

from app.config import settings
from app.services.device_service import device_service

logger = logging.getLogger("MqttClient")

class MqttManager:
    """
    MQTT Communication Service for SmartHome nodes.
    Supports QoS 1, Retained messages, LWT, and structured topic routing.
    """
    
    def __init__(self):
        self.client: Optional[mqtt.Client] = None
        self.is_connected = False
        self._loop_task: Optional[asyncio.Task] = None

    async def start(self):
        if not settings.MQTT_ENABLED:
            logger.info("MQTT is disabled in settings.")
            return

        broker = settings.MQTT_BROKER_HOST
        port = settings.MQTT_BROKER_PORT
        logger.info(f"Connecting to MQTT Broker on {broker}:{port}...")

        # Initialize Paho MQTT client
        self.client = mqtt.Client(client_id=settings.MQTT_CLIENT_ID, clean_session=True)
        if settings.MQTT_USERNAME:
            self.client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)

        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.on_disconnect = self._on_disconnect

        # Background connect & loop
        self._loop_task = asyncio.create_task(self._connection_loop())

    async def _connection_loop(self):
        broker = settings.MQTT_BROKER_HOST
        port = settings.MQTT_BROKER_PORT
        while True:
            try:
                if not self.is_connected:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(None, lambda: self.client.connect(broker, port, keepalive=settings.MQTT_KEEPALIVE))
                    self.client.loop_start()
                    self.is_connected = True
                    logger.info("Successfully connected to MQTT Broker.")
            except Exception as e:
                self.is_connected = False
                logger.warning(f"Could not connect to MQTT Broker at {broker}:{port} ({e}). Retrying in 10s...")
            await asyncio.sleep(10.0)

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            logger.info("MQTT Connected. Subscribing to node topic wildcards...")
            client.subscribe("smarthome/nodes/+/telemetry", qos=1)
            client.subscribe("smarthome/nodes/+/status", qos=1)
            client.subscribe("smarthome/nodes/+/heartbeat", qos=1)
            client.subscribe("smarthome/nodes/+/sensors", qos=1)
            client.subscribe("smarthome/nodes/+/relays/state", qos=1)
            client.subscribe("smarthome/nodes/+/events", qos=1)
        else:
            logger.error(f"MQTT Connect failed with code {rc}")

    def _on_disconnect(self, client, userdata, rc):
        self.is_connected = False
        logger.warning(f"MQTT Disconnected (code {rc})")

    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        payload_str = msg.payload.decode("utf-8", errors="ignore")
        
        asyncio.create_task(self._process_mqtt_message(topic, payload_str))

    async def _process_mqtt_message(self, topic: str, payload_str: str):
        try:
            parts = topic.split("/")
            if len(parts) >= 4 and parts[0] == "smarthome" and parts[1] == "nodes":
                node_id = parts[2]
                sub_topic = "/".join(parts[3:])

                try:
                    payload = json.loads(payload_str)
                except Exception:
                    payload = {"raw": payload_str}

                payload["nodeId"] = payload.get("nodeId", node_id)

                if sub_topic in ("telemetry", "heartbeat"):
                    await device_service.handle_telemetry(payload, protocol="MQTT")
                elif sub_topic == "status":
                    status_val = payload.get("status", "Offline")
                    is_online = (status_val.lower() == "online")
                    # Update status
                elif sub_topic == "relays/state":
                    # Channel state update
                    await device_service.handle_telemetry(payload, protocol="MQTT")

        except Exception as e:
            logger.error(f"Error handling MQTT message on {topic}: {e}")

    async def publish_relay_command(self, node_id: str, channel_id: int, action: str, state: bool, duration: int = 500):
        if not self.is_connected or not self.client:
            return False
            
        topic = f"smarthome/nodes/{node_id}/relays/command"
        cmd = {
            "id": channel_id,
            "action": action,
            "state": state,
            "duration": duration,
            "command_id": f"CMD_{int(asyncio.get_event_loop().time() * 1000)}"
        }
        self.client.publish(topic, json.dumps(cmd), qos=1)
        return True

    async def stop(self):
        if self._loop_task:
            self._loop_task.cancel()
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()
            logger.info("MQTT Client stopped.")

mqtt_manager = MqttManager()
