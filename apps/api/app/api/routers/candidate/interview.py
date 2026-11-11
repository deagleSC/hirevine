"""The candidate's AI interview (backend plan §7.3, §15): one attempt per application."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.errors import ERROR_RESPONSES
from app.services import interview as svc

router = APIRouter(prefix="/v1/candidate/applications/{application_id}/interview", tags=["candidate"],
                   responses=ERROR_RESPONSES)

SSE_DOC = (
    "Server-sent events. Each `data:` line is JSON: `{type: 'token', text}` chunks of the next question, "
    "at most one `{type: 'error', code, message, retry_after?}`, then `{type: 'done', state: InterviewState}`."
)


@router.get("", response_model=svc.InterviewState)
async def get_interview(application_id: UUID, principal: PrincipalDep) -> svc.InterviewState:
    """The interview's state. While in progress: the transcript so far, answers left and the deadline."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.state(tx, user, application_id)


@router.post("/start", response_model=svc.InterviewState)
async def start(application_id: UUID, principal: PrincipalDep) -> svc.InterviewState:
    """Start the clock. Calling it again returns the same session. Then request the first question
    with `POST …/turn` and no message."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.start(tx, user, application_id)


async def _sse(events: AsyncIterator[dict[str, object]]) -> AsyncIterator[bytes]:
    async for e in events:
        yield f"data: {json.dumps(e, separators=(',', ':'))}\n\n".encode()


@router.post(
    "/turn",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}, "description": SSE_DOC}},
)
async def turn(application_id: UUID, body: svc.TurnIn, principal: PrincipalDep) -> StreamingResponse:
    """Send an answer (or no message, to request the current question) and stream the next question.
    The answer is saved before streaming starts; the question is saved when it is complete."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        plan = await svc.begin_turn(tx, user, application_id, body)
    return StreamingResponse(_sse(svc.stream_turn(plan)), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/finish", response_model=svc.InterviewState)
async def finish(application_id: UUID, principal: PrincipalDep) -> svc.InterviewState:
    """End the interview now. Answers so far are scored; the result is shared when outcomes are released."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.finish(tx, user, application_id)
