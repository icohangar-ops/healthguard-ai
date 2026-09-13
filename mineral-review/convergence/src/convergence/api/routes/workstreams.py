"""Convergence API routes — workstreams."""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from convergence.api.security import verify_api_key
from convergence.chp.orchestrator import CHPOrchestrator
from convergence.chp.registry import DecisionRegistry
from convergence.chp.models import DecisionCase, Dossier, FoundationAttack, FoundationDisclosure, SessionStatus, WorkstreamType
from convergence.convergence_tower import BlockedDecision, ConvergenceTower, Milestone, RiskItem, WorkstreamStatus
from convergence.mesh.orchestrator import EnterpriseOrchestrator
from convergence.workstreams import WORKSTREAM_MAP, WorkstreamBrief

router = APIRouter(prefix="/api/v1", tags=["workstreams"])

# Security configuration
MAX_VALIDATION_LOG_SIZE = 100
MAX_VALIDATION_FIELD_LENGTH = 10000

# In-memory state (production would use DB)
_registry = DecisionRegistry()
_tower = ConvergenceTower()
_orchestrator = CHPOrchestrator(registry=_registry)


@router.get("/workstreams")
def list_workstreams() -> Dict[str, Any]:
    return {"workstreams": list(WORKSTREAM_MAP.keys()),
            "tower": _tower.to_dict()}


@router.get("/workstreams/{workstream_type}")
def get_workstream(workstream_type: str) -> Dict[str, Any]:
    if workstream_type not in WORKSTREAM_MAP:
        raise HTTPException(404, f"Unknown workstream: {workstream_type}")
    cls = WORKSTREAM_MAP[workstream_type]
    brief = WorkstreamBrief(title=f"Integration {workstream_type}", acquirer=_tower.acquirer,
                            target=_tower.target, day_post_close=_tower.day_post_close)
    ws = cls(brief)
    agents = ws.get_agents()
    return {"workstream_type": workstream_type, "agents": [a.name for a in agents],
            "status": ws.get_status().to_dict(), "analysis": ws.run_analysis()}


@router.post("/workstreams/{workstream_type}/analyze")
def analyze_workstream(workstream_type: str) -> Dict[str, Any]:
    if workstream_type not in WORKSTREAM_MAP:
        raise HTTPException(404, f"Unknown workstream: {workstream_type}")
    cls = WORKSTREAM_MAP[workstream_type]
    brief = WorkstreamBrief(title=f"Integration {workstream_type}", acquirer=_tower.acquirer,
                            target=_tower.target, day_post_close=_tower.day_post_close)
    ws = cls(brief)
    agents = ws.get_agents()
    mesh = EnterpriseOrchestrator(agents=agents, context=ws.context)
    report = mesh.orchestrate(f"Analyze integration workstream: {workstream_type}",
                              workflow_title=f"Analysis: {workstream_type}")
    return {"workstream_type": workstream_type, "report": report.render(),
            "duration_ms": report.duration_ms, "agents": [t.agent for t in report.turns],
            "workflow_steps": len(report.workflow.steps)}


@router.get("/convergence")
def get_convergence() -> Dict[str, Any]:
    return _tower.to_dict()


@router.post("/convergence/init")
def init_convergence(acquirer: str = "", target: str = "", day_post_close: int = 0) -> Dict[str, Any]:
    global _tower
    _tower = ConvergenceTower(acquirer=acquirer, target=target, day_post_close=day_post_close)
    # Initialize default workstream statuses
    for ws_type in WORKSTREAM_MAP:
        cls = WORKSTREAM_MAP[ws_type]
        brief = WorkstreamBrief(title=f"Integration {ws_type}", acquirer=acquirer,
                                target=target, day_post_close=day_post_close)
        ws = cls(brief)
        _tower.add_workstream(ws.get_status())
    return _tower.to_dict()


@router.post("/convergence/risks")
def add_risk(risk: Dict[str, Any]) -> Dict[str, Any]:
    item = RiskItem(id=risk.get("id", ""), title=risk.get("title", ""),
                    category=risk.get("category", ""), severity=risk.get("severity", "medium"),
                    owner=risk.get("owner", ""), impact=risk.get("impact", ""),
                    mitigation=risk.get("mitigation", ""))
    _tower.add_risk(item)
    return {"added": True, "risk": item.to_dict()}


@router.post("/convergence/milestones")
def add_milestone(milestone: Dict[str, Any]) -> Dict[str, Any]:
    item = Milestone(id=milestone.get("id", ""), title=milestone.get("title", ""),
                     target_date=milestone.get("target_date", ""),
                     workstream=milestone.get("workstream", ""),
                     owner=milestone.get("owner", ""))
    _tower.add_milestone(item)
    return {"added": True, "milestone": item.to_dict()}


@router.post("/convergence/blocked-decisions")
def add_blocked_decision(decision: Dict[str, Any]) -> Dict[str, Any]:
    item = BlockedDecision(id=decision.get("id", ""), title=decision.get("title", ""),
                          blocking_reason=decision.get("blocking_reason", ""),
                          decision_needed_from=decision.get("decision_needed_from", ""),
                          deadline=decision.get("deadline", ""))
    _tower.add_blocked_decision(item)
    return {"added": True, "decision": item.to_dict()}


@router.get("/decisions")
def list_decisions(
    domain: str = "",
    status: str = "",
    api_key: str = Depends(verify_api_key)
) -> Dict[str, Any]:
    cases = _registry.all()
    if domain:
        cases = [c for c in cases if c.domain == domain]
    if status:
        cases = [c for c in cases if c.status.value == status]
    return {"decisions": [c.to_dict() for c in cases], "count": len(cases)}


@router.get("/decisions/{decision_id}")
def get_decision(
    decision_id: str,
    api_key: str = Depends(verify_api_key)
) -> Dict[str, Any]:
    case = _registry.get(decision_id)
    if not case:
        raise HTTPException(404, f"Decision not found: {decision_id}")
    return case.to_dict()


@router.post("/decisions/{decision_id}/validate")
def validate_decision(
    decision_id: str,
    validation: Dict[str, Any],
    api_key: str = Depends(verify_api_key)
) -> Dict[str, Any]:
    from convergence.chp.models import ThirdPartyValidation, ValidationResult
    
    # Validate input field lengths to prevent memory exhaustion
    validator = validation.get("validator", "")
    item = validation.get("item", "")
    challenge = validation.get("challenge", "")
    rationale = validation.get("rationale", "")
    
    if len(validator) > MAX_VALIDATION_FIELD_LENGTH:
        raise HTTPException(400, f"validator field exceeds maximum length of {MAX_VALIDATION_FIELD_LENGTH}")
    if len(item) > MAX_VALIDATION_FIELD_LENGTH:
        raise HTTPException(400, f"item field exceeds maximum length of {MAX_VALIDATION_FIELD_LENGTH}")
    if len(challenge) > MAX_VALIDATION_FIELD_LENGTH:
        raise HTTPException(400, f"challenge field exceeds maximum length of {MAX_VALIDATION_FIELD_LENGTH}")
    if len(rationale) > MAX_VALIDATION_FIELD_LENGTH:
        raise HTTPException(400, f"rationale field exceeds maximum length of {MAX_VALIDATION_FIELD_LENGTH}")
    
    try:
        # Check if case exists and validate log size before appending
        case = _registry.get(decision_id)
        if not case:
            raise KeyError(f"Unknown decision_id: {decision_id}")
        
        # Enforce maximum validation log size to prevent unbounded growth
        if len(case.third_party_log) >= MAX_VALIDATION_LOG_SIZE:
            raise HTTPException(
                429, 
                f"Validation log limit reached ({MAX_VALIDATION_LOG_SIZE}). Cannot accept more validations for this decision."
            )
        
        tv = ThirdPartyValidation(
            validator=validator,
            item=item,
            challenge=challenge,
            result=ValidationResult(validation.get("result", "CONFIRM")),
            rationale=rationale,
        )
        case = _orchestrator.apply_validation(decision_id, tv)
        return {"decision_id": decision_id, "status": case.status.value,
                "locked_decisions": case.locked_decisions}
    except KeyError as e:
        raise HTTPException(404, str(e))



@router.post("/decisions/{decision_id}/advance")
def advance_decision(
    decision_id: str,
    api_key: str = Depends(verify_api_key)
) -> Dict[str, Any]:
    try:
        case = _orchestrator.advance_to_provisional_lock(decision_id)
        return {"decision_id": decision_id, "status": case.status.value}
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))


@router.get("/health")
def health_check() -> Dict[str, Any]:
    return {"status": "healthy", "version": "0.1.0",
            "decisions_count": _registry.count(),
            "workstreams_count": len(_tower.workstreams)}
