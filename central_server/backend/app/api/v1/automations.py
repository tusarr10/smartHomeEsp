from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.automation import AutomationRule, AutomationCondition, AutomationAction, AutomationExecution

router = APIRouter(prefix="/automations", tags=["Central Automation Engine"])

@router.get("")
async def list_automation_rules(db: AsyncSession = Depends(get_db)):
    stmt = (
        select(AutomationRule)
        .options(selectinload(AutomationRule.conditions), selectinload(AutomationRule.actions))
        .order_by(AutomationRule.id.asc())
    )
    res = await db.execute(stmt)
    rules = res.scalars().all()

    out = []
    for r in rules:
        out.append({
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "enabled": r.enabled,
            "trigger_type": r.trigger_type,
            "condition_logic": r.condition_logic,
            "schedule_time": r.schedule_time,
            "schedule_days": r.schedule_days,
            "cooldown_seconds": r.cooldown_seconds,
            "execution_count": r.execution_count,
            "last_executed_at": r.last_executed_at.isoformat() if r.last_executed_at else None,
            "conditions": [{
                "id": c.id,
                "condition_type": c.condition_type,
                "target_id": c.target_id,
                "operator": c.operator,
                "value_numeric": c.value_numeric,
                "value_numeric_max": c.value_numeric_max,
                "value_boolean": c.value_boolean,
                "value_string": c.value_string
            } for c in r.conditions],
            "actions": [{
                "id": a.id,
                "sequence_order": a.sequence_order,
                "action_type": a.action_type,
                "target_node_id": a.target_node_id,
                "target_channel_id": a.target_channel_id,
                "parameter_value": a.parameter_value,
                "message": a.message
            } for a in r.actions]
        })
    return out

@router.post("")
async def create_automation_rule(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    name = payload.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Rule name is required")

    rule = AutomationRule(
        name=name,
        description=payload.get("description", ""),
        enabled=bool(payload.get("enabled", True)),
        trigger_type=payload.get("trigger_type", "SENSOR"),
        condition_logic=payload.get("condition_logic", "AND"),
        schedule_time=payload.get("schedule_time"),
        schedule_days=payload.get("schedule_days", "ALL"),
        cooldown_seconds=int(payload.get("cooldown_seconds", 5))
    )
    db.add(rule)
    await db.flush()

    # Add conditions
    for c in payload.get("conditions", []):
        cond = AutomationCondition(
            rule_id=rule.id,
            condition_type=c.get("condition_type", "SENSOR_NUMERIC"),
            target_id=c.get("target_id", ""),
            operator=c.get("operator", "GT"),
            value_numeric=c.get("value_numeric"),
            value_numeric_max=c.get("value_numeric_max"),
            value_boolean=c.get("value_boolean"),
            value_string=c.get("value_string")
        )
        db.add(cond)

    # Add actions
    for idx, a in enumerate(payload.get("actions", []), start=1):
        act = AutomationAction(
            rule_id=rule.id,
            sequence_order=idx,
            action_type=a.get("action_type", "RELAY_ON"),
            target_node_id=a.get("target_node_id"),
            target_channel_id=a.get("target_channel_id"),
            parameter_value=float(a.get("parameter_value", 0.0)),
            message=a.get("message")
        )
        db.add(act)

    await db.commit()
    return {"success": True, "rule_id": rule.id, "message": "Automation rule created"}

@router.post("/{rule_id}/toggle")
async def toggle_automation_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(AutomationRule).where(AutomationRule.id == rule_id)
    res = await db.execute(stmt)
    rule = res.scalars().first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule.enabled = not rule.enabled
    await db.commit()
    return {"success": True, "rule_id": rule_id, "enabled": rule.enabled}

@router.delete("/{rule_id}")
async def delete_automation_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(AutomationRule).where(AutomationRule.id == rule_id)
    res = await db.execute(stmt)
    rule = res.scalars().first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    await db.delete(rule)
    await db.commit()
    return {"success": True, "message": f"Rule {rule_id} deleted"}

@router.get("/{rule_id}/history")
async def get_automation_history(rule_id: int, limit: int = 50, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(AutomationExecution)
        .where(AutomationExecution.rule_id == rule_id)
        .order_by(AutomationExecution.id.desc())
        .limit(limit)
    )
    res = await db.execute(stmt)
    executions = res.scalars().all()
    return [{
        "id": ex.id,
        "trigger_source": ex.trigger_source,
        "status": ex.status,
        "execution_time_ms": ex.execution_time_ms,
        "message": ex.message,
        "timestamp": ex.timestamp.isoformat()
    } for ex in executions]
