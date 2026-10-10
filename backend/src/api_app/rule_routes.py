"""HTTP routes for rule authoring: /api/v1/rules.

Reading the rule catalogue is open, like the config routes. Everything that
creates, changes or switches off a rule needs the admin token, and drafting
runs in the background: submit returns at once and the UI polls the draft.
"""

from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, Path, Request

from api_app.schemas import RULE_ID_PATTERN, DraftAnswerRequest, RuleDraftRequest
from api_app.security import acting_admin, require_admin
from rule_authoring.drafts import QUEUED, Draft
from rule_authoring.service import RuleAuthoringService

router = APIRouter(prefix="/api/v1/rules", tags=["rules"])
admin_only = [Depends(require_admin)]

RuleId = Annotated[str, Path(pattern=RULE_ID_PATTERN, max_length=32)]
DraftId = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]


def _service(request: Request) -> RuleAuthoringService:
    return request.app.state.rule_authoring


def _summary(draft: Draft) -> dict[str, Any]:
    return {
        "draft_id": draft.draft_id,
        "rule_id": draft.rule_id,
        "kind": draft.kind,
        "title": draft.rule.get("title"),
        "state": draft.state,
        "author": draft.author,
        "created_at": draft.created_at,
        "updated_at": draft.updated_at,
        "open_questions": len(draft.open_questions()),
    }


@router.get("")
def list_rules(request: Request):
    return {"rules": _service(request).list_rules()}


@router.get("/drafts", dependencies=admin_only)
def list_drafts(request: Request):
    return {"drafts": [_summary(draft) for draft in _service(request).list_drafts()]}


@router.post("/drafts", status_code=202, dependencies=admin_only)
def submit_draft(
    payload: RuleDraftRequest,
    request: Request,
    background: BackgroundTasks,
    actor: str = Depends(acting_admin),
):
    service = _service(request)
    draft = service.submit(payload.model_dump(exclude={"rule_id"}), actor, rule_id=payload.rule_id)
    background.add_task(service.run, draft.draft_id)
    return draft.to_json()


@router.get("/drafts/{draft_id}", dependencies=admin_only)
def get_draft(request: Request, draft_id: DraftId):
    return _service(request).get_draft(draft_id).to_json()


@router.post("/drafts/{draft_id}/answers", dependencies=admin_only)
def answer_question(
    payload: DraftAnswerRequest,
    draft_id: DraftId,
    request: Request,
    background: BackgroundTasks,
    actor: str = Depends(acting_admin),
):
    service = _service(request)
    draft = service.answer(draft_id, payload.question_id, payload.answer, actor)
    if draft.state == QUEUED:
        background.add_task(service.run, draft.draft_id)
    return draft.to_json()


@router.post("/drafts/{draft_id}/confirm", dependencies=admin_only)
def confirm_draft(request: Request, draft_id: DraftId, actor: str = Depends(acting_admin)):
    return _service(request).confirm(draft_id, actor).to_json()


@router.post("/drafts/{draft_id}/cancel", dependencies=admin_only)
def cancel_draft(request: Request, draft_id: DraftId, actor: str = Depends(acting_admin)):
    return _service(request).cancel(draft_id, actor).to_json()


@router.get("/{rule_id}")
def get_rule(request: Request, rule_id: RuleId):
    return _service(request).rule_detail(rule_id)


@router.post("/{rule_id}/deactivate", dependencies=admin_only)
def deactivate_rule(request: Request, rule_id: RuleId, actor: str = Depends(acting_admin)):
    return _service(request).deactivate(rule_id, actor)
