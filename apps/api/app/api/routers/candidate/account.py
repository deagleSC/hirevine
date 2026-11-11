"""The candidate's notifications and privacy requests (backend plan §7.3, §18)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.errors import ERROR_RESPONSES
from app.services import notifications as notes
from app.services import privacy

router = APIRouter(prefix="/v1/candidate", tags=["candidate"], responses=ERROR_RESPONSES)


@router.get("/notifications", response_model=notes.NotificationList)
async def list_notifications(principal: PrincipalDep) -> notes.NotificationList:
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await notes.list_mine(tx, user)


@router.post("/notifications/{notification_id}/read", response_model=notes.Notification)
async def read_notification(notification_id: UUID, principal: PrincipalDep) -> notes.Notification:
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await notes.mark_read(tx, user, notification_id)


@router.post("/notifications/read-all", response_model=notes.NotificationList)
async def read_all(principal: PrincipalDep) -> notes.NotificationList:
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await notes.mark_all_read(tx, user)


@router.post("/privacy/export", response_class=JSONResponse,
             responses={200: {"content": {"application/json": {"schema": {"type": "object"}}},
                              "description": "Everything stored about you, as one JSON document"}})
async def export(principal: PrincipalDep) -> JSONResponse:
    """Download your data now: profile, applications, consents, stage results you may see, quiz
    answers, interview transcripts, released feedback and notifications. Recorded as a data request."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        data: dict[str, Any] = await privacy.export(tx, user)
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="hirevine-export.json"'})


@router.post("/privacy/delete", response_model=privacy.DeleteQueued, status_code=202)
async def delete(body: privacy.DeleteIn, principal: PrincipalDep) -> privacy.DeleteQueued:
    """Delete your account and everything stored about you. Irreversible; you are signed out."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await privacy.request_delete(tx, user, body)
