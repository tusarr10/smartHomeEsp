import asyncio
import logging
import time
from datetime import datetime
from typing import Dict, Any, List
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import async_session_factory
from app.models.automation import AutomationRule, AutomationCondition, AutomationAction, AutomationExecution
from app.models.sensor import Sensor
from app.models.relay import Relay
from app.models.system import Notification, SystemEvent
from app.services.device_service import device_service
from app.services.websocket_manager import ws_manager

logger = logging.getLogger("AutomationEngine")

class AutomationEngine:
    """
    Central Smart Home Automation & Scheduling Engine.
    Executes on Windows server; evaluates conditions, prevents loops, and dispatches actions.
    """

    def __init__(self):
        self._cron_task: Optional[asyncio.Task] = None
        self._last_rule_execution: Dict[int, float] = {} # rule_id -> epoch

    async def start(self):
        logger.info("Starting Central Automation Engine background scheduler...")
        self._cron_task = asyncio.create_task(self._scheduler_loop())

    async def stop(self):
        if self._cron_task:
            self._cron_task.cancel()
            logger.info("Automation Engine scheduler stopped.")

    async def evaluate_sensor_event(self, sensor_id: str, value: float):
        """Called whenever a sensor updates to evaluate matching condition-based rules."""
        async with async_session_factory() as session:
            try:
                # Load enabled sensor rules with conditions and actions
                stmt = (
                    select(AutomationRule)
                    .where(AutomationRule.enabled == True, AutomationRule.trigger_type.in_(["SENSOR", "CONDITION"]))
                    .options(selectinload(AutomationRule.conditions), selectinload(AutomationRule.actions))
                )
                res = await session.execute(stmt)
                rules = res.scalars().all()

                for rule in rules:
                    # Check if rule conditions reference this sensor
                    matches_sensor = any(c.target_id == sensor_id for c in rule.conditions)
                    if not matches_sensor:
                        continue

                    await self._evaluate_and_execute_rule(rule, trigger_source=f"Sensor Event: {sensor_id}={value}")

            except Exception as e:
                logger.error(f"Error evaluating sensor event for {sensor_id}: {e}")

    async def evaluate_relay_change_event(self, node_id: str, channel_id: int, new_state: bool):
        """Called whenever a relay state flips."""
        target_key = f"{node_id}:{channel_id}"
        async with async_session_factory() as session:
            try:
                stmt = (
                    select(AutomationRule)
                    .where(AutomationRule.enabled == True, AutomationRule.trigger_type == "RELAY_CHANGE")
                    .options(selectinload(AutomationRule.conditions), selectinload(AutomationRule.actions))
                )
                res = await session.execute(stmt)
                rules = res.scalars().all()

                for rule in rules:
                    matches = any(c.target_id == target_key or c.target_id == node_id for c in rule.conditions)
                    if matches:
                        await self._evaluate_and_execute_rule(rule, trigger_source=f"Relay Change: {target_key}={new_state}")
            except Exception as e:
                logger.error(f"Error evaluating relay change event: {e}")

    async def _evaluate_and_execute_rule(self, rule: AutomationRule, trigger_source: str):
        now_epoch = time.time()
        start_time = time.perf_counter()

        # Cooldown check (anti-loop protection)
        last_exec = self._last_rule_execution.get(rule.id, 0)
        if (now_epoch - last_exec) < rule.cooldown_seconds:
            logger.debug(f"Rule '{rule.name}' skipped due to active cooldown ({rule.cooldown_seconds}s)")
            return

        # Evaluate condition set
        condition_results = []
        for cond in rule.conditions:
            cond_met = await self._check_condition(cond)
            condition_results.append(cond_met)

        # Combine via condition logic (AND / OR)
        all_passed = False
        if not condition_results:
            all_passed = True
        elif rule.condition_logic == "OR":
            all_passed = any(condition_results)
        else:
            all_passed = all(condition_results)

        if not all_passed:
            return

        # Mark execution timestamp
        self._last_rule_execution[rule.id] = now_epoch

        # Execute actions in sequential order
        action_results = []
        for action in rule.actions:
            res = await self._execute_action(action)
            action_results.append(res)

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        # Record Execution History
        async with async_session_factory() as session:
            # Re-fetch rule to update counters
            r_stmt = select(AutomationRule).where(AutomationRule.id == rule.id)
            r_res = await session.execute(r_stmt)
            db_rule = r_res.scalars().first()
            if db_rule:
                db_rule.last_executed_at = datetime.utcnow()
                db_rule.execution_count += 1

            exec_record = AutomationExecution(
                rule_id=rule.id,
                trigger_source=trigger_source,
                status="SUCCESS",
                execution_time_ms=elapsed_ms,
                message=f"Executed {len(action_results)} actions: {', '.join(action_results)}"
            )
            session.add(exec_record)
            await session.commit()

        await ws_manager.broadcast("automation_executed", {
            "rule_id": rule.id,
            "rule_name": rule.name,
            "trigger_source": trigger_source,
            "execution_time_ms": elapsed_ms
        })
        logger.info(f"Automation Rule '{rule.name}' executed successfully ({elapsed_ms:.1f}ms).")

    async def _check_condition(self, cond: AutomationCondition) -> bool:
        """Evaluates a single condition against current state."""
        try:
            # 1. SENSOR condition
            if "SENSOR" in cond.condition_type:
                async with async_session_factory() as session:
                    stmt = select(Sensor).where(Sensor.sensor_id == cond.target_id)
                    res = await session.execute(stmt)
                    sensor = res.scalars().first()
                    if not sensor or sensor.current_value is None:
                        return False

                    val = sensor.current_value
                    op = cond.operator.upper()
                    target_val = cond.value_numeric or 0.0

                    if op == "GT": return val > target_val
                    elif op == "LT": return val < target_val
                    elif op in ("EQ", "=="): return val == target_val
                    elif op in ("NEQ", "!="): return val != target_val
                    elif op == "GTE": return val >= target_val
                    elif op == "LTE": return val <= target_val
                    elif op == "BETWEEN":
                        max_val = cond.value_numeric_max or target_val
                        return target_val <= val <= max_val
                    return False

            # 2. RELAY condition
            elif cond.condition_type == "RELAY_STATE":
                parts = cond.target_id.split(":")
                if len(parts) == 2:
                    nid, ch_id = parts[0], int(parts[1])
                    async with async_session_factory() as session:
                        stmt = select(Relay).where(Relay.node_id == nid, Relay.channel_id == ch_id)
                        res = await session.execute(stmt)
                        relay = res.scalars().first()
                        if relay:
                            expected = cond.value_boolean if cond.value_boolean is not None else True
                            return relay.current_state == expected
                return False

            return True
        except Exception as e:
            logger.error(f"Error checking condition {cond.id}: {e}")
            return False

    async def _execute_action(self, action: AutomationAction) -> str:
        """Executes a single action in an automation rule."""
        try:
            act = action.action_type.upper()

            # Handle Relay Commands
            if act in ("RELAY_ON", "RELAY_OFF", "RELAY_TOGGLE", "RELAY_PULSE"):
                node_id = action.target_node_id
                channel_id = action.target_channel_id or 1
                if not node_id:
                    return f"Skipped: Missing target_node_id"

                if act == "RELAY_ON":
                    await device_service.dispatch_command(node_id, channel_id, action="setState", state=True)
                    return f"Turned ON {node_id}:Ch{channel_id}"
                elif act == "RELAY_OFF":
                    await device_service.dispatch_command(node_id, channel_id, action="setState", state=False)
                    return f"Turned OFF {node_id}:Ch{channel_id}"
                elif act == "RELAY_TOGGLE":
                    await device_service.dispatch_command(node_id, channel_id, action="toggle")
                    return f"Toggled {node_id}:Ch{channel_id}"
                elif act == "RELAY_PULSE":
                    dur = int(action.parameter_value) if action.parameter_value > 0 else 500
                    await device_service.dispatch_command(node_id, channel_id, action="pulse", duration=dur)
                    return f"Pulsed {node_id}:Ch{channel_id} ({dur}ms)"

            # Handle Delay
            elif act == "DELAY":
                delay_sec = max(0.1, action.parameter_value / 1000.0) if action.parameter_value > 0 else 1.0
                await asyncio.sleep(delay_sec)
                return f"Delayed {delay_sec}s"

            # Handle Notification
            elif act == "NOTIFICATION":
                async with async_session_factory() as session:
                    notif = Notification(
                        title="Automation Notification",
                        message=action.message or "Triggered by Automation Engine",
                        severity="INFO",
                        node_id=action.target_node_id
                    )
                    session.add(notif)
                    await session.commit()
                return "Notification sent"

            return f"Action {act} completed"
        except Exception as e:
            return f"Action failed: {e}"

    async def _scheduler_loop(self):
        """Cron & time-based periodic scheduler loop checking every 30 seconds."""
        while True:
            try:
                await asyncio.sleep(30.0)
                now_str = datetime.now().strftime("%H:%M")
                day_str = datetime.now().strftime("%a").upper() # MON, TUE...

                async with async_session_factory() as session:
                    stmt = (
                        select(AutomationRule)
                        .where(AutomationRule.enabled == True, AutomationRule.trigger_type.in_(["TIME", "SCHEDULE"]))
                        .options(selectinload(AutomationRule.conditions), selectinload(AutomationRule.actions))
                    )
                    res = await session.execute(stmt)
                    rules = res.scalars().all()

                    for rule in rules:
                        if rule.schedule_time == now_str:
                            if rule.schedule_days == "ALL" or day_str in rule.schedule_days:
                                await self._evaluate_and_execute_rule(rule, trigger_source=f"Schedule Time: {now_str}")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in scheduler loop: {e}")

automation_engine = AutomationEngine()
