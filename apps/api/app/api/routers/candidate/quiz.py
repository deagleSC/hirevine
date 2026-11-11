"""The candidate's quiz (backend plan §7.3, §14): one timed attempt per application."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter

from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.errors import ERROR_RESPONSES
from app.services import quiz as svc

router = APIRouter(prefix="/v1/candidate/applications/{application_id}/quiz", tags=["candidate"],
                   responses=ERROR_RESPONSES)


@router.get("", response_model=svc.QuizState)
async def get_quiz(application_id: UUID, principal: PrincipalDep) -> svc.QuizState:
    """The quiz's state. While in progress: the questions (no answers) and the saved answers."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.state(tx, user, application_id)


@router.post("/start", response_model=svc.QuizState)
async def start(application_id: UUID, principal: PrincipalDep) -> svc.QuizState:
    """Start the timer. Calling it again returns the same attempt."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.start(tx, user, application_id)


@router.put("/answers", response_model=svc.AnswersSaved)
async def save_answers(application_id: UUID, body: svc.AnswersIn, principal: PrincipalDep) -> svc.AnswersSaved:
    """Autosave: merges the given answers into the saved ones, until the deadline (+30 s)."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.save_answers(tx, user, application_id, body)


@router.post("/submit", response_model=svc.QuizState)
async def submit(application_id: UUID, principal: PrincipalDep) -> svc.QuizState:
    """Submit the saved answers. The result is not shown until the hiring team releases outcomes."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.submit(tx, user, application_id)
