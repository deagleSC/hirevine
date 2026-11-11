"""Candidate applications (backend plan §7.3): upload URL, apply + consent, tracker."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Request

from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.errors import ERROR_RESPONSES, AppError
from app.services import applications as svc
from app.services import report as report_svc

router = APIRouter(prefix="/v1/candidate", tags=["candidate"], responses=ERROR_RESPONSES)


@router.post("/applications/upload-url", response_model=svc.UploadUrl)
async def upload_url(body: svc.UploadRequest, principal: PrincipalDep) -> svc.UploadUrl:
    """A signed URL to PUT the resume to Supabase Storage directly (pdf/docx, ≤ 5 MB)."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.upload_url(tx, user, body)


@router.post("/applications", response_model=svc.ApplicationCreated, status_code=202)
async def apply(body: svc.ApplicationCreate, request: Request, principal: PrincipalDep) -> svc.ApplicationCreated:
    """Create the application with consent, then start screening in the background."""
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
        request.client.host if request.client else None)
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.apply(tx, user, body, ip)


@router.get("/applications", response_model=list[svc.TrackerItem])
async def list_applications(principal: PrincipalDep) -> list[svc.TrackerItem]:
    """The tracker: one row per application with the candidate-facing status (§7.4)."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.tracker(tx, user)


@router.get("/applications/{application_id}", response_model=svc.TrackerItem)
async def get_application(application_id: UUID, principal: PrincipalDep) -> svc.TrackerItem:
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        items = await svc.tracker(tx, user, application_id)
        if not items:
            raise AppError(404, "application_not_found", "This application does not exist or is not yours.")
        return items[0]


@router.get("/applications/{application_id}/feedback", response_model=report_svc.CandidateFeedback)
async def get_feedback(application_id: UUID, principal: PrincipalDep) -> report_svc.CandidateFeedback:
    """Released feedback: the outcome, the feedback text and stage results. 404 until the hiring team
    completes the campaign (enforced by RLS)."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await report_svc.candidate_feedback(tx, user, application_id)
