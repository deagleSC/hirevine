"""Workflow editing for managers (backend plan §7.2). Preview writes nothing; apply and undo
create a new version. RLS limits every query to the manager's own org's jobs."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.errors import ERROR_RESPONSES
from app.domain.patches import Patch
from app.services import workflows as svc

router = APIRouter(prefix="/v1/manager/jobs/{job_id}/workflow", tags=["manager", "workflow"], responses=ERROR_RESPONSES)


class PatchRequest(BaseModel):
    base_version: int = Field(ge=1)
    patches: list[Patch] = Field(min_length=1, max_length=50)


class ApplyRequest(PatchRequest):
    source: Literal["panel", "chat"] = "panel"


@router.get("", response_model=svc.WorkflowVersion)
async def get_workflow(job_id: UUID, principal: PrincipalDep) -> svc.WorkflowVersion:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.latest(tx, job_id)


@router.get("/versions", response_model=list[svc.VersionSummary])
async def list_versions(job_id: UUID, principal: PrincipalDep) -> list[svc.VersionSummary]:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.versions(tx, job_id)


@router.get("/versions/{version}", response_model=svc.WorkflowVersion)
async def get_version(job_id: UUID, version: int, principal: PrincipalDep) -> svc.WorkflowVersion:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.get_version(tx, job_id, version)


@router.post("/preview", response_model=svc.Preview)
async def preview(job_id: UUID, body: PatchRequest, principal: PrincipalDep) -> svc.Preview:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.preview(tx, job_id, body.base_version, body.patches)


@router.post("/apply", response_model=svc.Applied)
async def apply(job_id: UUID, body: ApplyRequest, principal: PrincipalDep) -> svc.Applied:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.apply(tx, job_id, body.base_version, body.patches, source=body.source, actor=user.user_id)


@router.post("/undo", response_model=svc.Applied)
async def undo(job_id: UUID, principal: PrincipalDep) -> svc.Applied:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.undo(tx, job_id, actor=user.user_id)
