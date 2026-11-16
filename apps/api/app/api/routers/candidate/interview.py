"""The candidate's AI interview (backend plan §7.3, §15): one attempt per application."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response, StreamingResponse

from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.config import get_settings
from app.core.errors import ERROR_RESPONSES, AppError
from app.domain.interview import MAX_ANSWER_CHARS
from app.services import interview as svc
from app.services import speech

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


async def _with_answer(text: str, events: AsyncIterator[dict[str, object]]) -> AsyncIterator[dict[str, object]]:
    yield {"type": "answer", "text": text}
    async for e in events:
        yield e


AUDIO_BODY = {"content": {t: {"schema": {"type": "string", "format": "binary"}} for t in speech.AUDIO_TYPES}}


@router.post(
    "/turn-voice",
    response_class=StreamingResponse,
    openapi_extra={"requestBody": {"required": True, **AUDIO_BODY}},
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}},
                     "description": "As `turn`, with a first `{type: 'answer', text}` event: the saved transcript."}},
)
async def turn_voice(application_id: UUID, request: Request, principal: PrincipalDep,
                     turn: int = Query(ge=0, description="InterviewState.answers_given")) -> StreamingResponse:
    """Send a spoken answer as the raw request body (an audio recording) and stream the next question.
    The recording is transcribed and discarded; only the transcript is saved, and it cannot be edited."""
    content_type = request.headers.get("content-type")
    speech.audio_extension(content_type)
    limit = get_settings().max_answer_audio_bytes
    if int(request.headers.get("content-length") or 0) > limit:
        raise AppError(413, "audio_too_large", "This answer is too long. Keep each answer under a few minutes.")
    async with user_tx(principal) as (tx, user):  # cheap checks before paying for a transcription
        require_role(user, "candidate")
        state = await svc.state(tx, user, application_id)
    if state.status != "in_progress" or state.awaiting != "answer" or state.answers_given != turn:
        code = "stale_turn" if state.answers_given != turn else "no_open_question"
        raise AppError(409, code, "This interview moved on. Reload to continue.")
    text = (await speech.transcribe(await request.body(), content_type)).strip()[:MAX_ANSWER_CHARS]
    async with user_tx(principal) as (tx, user):
        plan = await svc.begin_turn(tx, user, application_id, svc.TurnIn(turn=turn, message=text), spoken=True)
    return StreamingResponse(_sse(_with_answer(text, svc.stream_turn(plan))), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/speech", response_class=Response,
            responses={200: {"content": {"audio/mpeg": {"schema": {"type": "string", "format": "binary"}}}}})
async def question_speech(
    application_id: UUID, principal: PrincipalDep,
    question: int = Query(ge=1, description="The open question's number (InterviewState.questions_asked)"),
) -> Response:
    """The open question read aloud. Each question has its own URL, so the audio can be cached."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        text = await svc.current_question(tx, user, application_id, question)
    audio, media_type = await speech.synthesize(text)
    return Response(audio, media_type=media_type, headers={"Cache-Control": "private, max-age=3600"})


@router.post("/finish", response_model=svc.InterviewState)
async def finish(application_id: UUID, principal: PrincipalDep) -> svc.InterviewState:
    """End the interview now. Answers so far are scored; the result is shared when outcomes are released."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.finish(tx, user, application_id)
