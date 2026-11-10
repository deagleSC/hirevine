"""Campaign monitor and candidate detail (backend plan §7.2)."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.errors import ERROR_RESPONSES
from app.services import applications as svc

router = APIRouter(prefix="/v1/manager/campaigns", tags=["manager", "campaigns"], responses=ERROR_RESPONSES)

StageStatus = Literal["pending", "in_progress", "passed", "failed", "needs_review"]


@router.get("/{campaign_id}", response_model=svc.CampaignMonitor)
async def monitor(campaign_id: UUID, principal: PrincipalDep) -> svc.CampaignMonitor:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.monitor(tx, campaign_id)


@router.get("/{campaign_id}/applications", response_model=svc.ApplicationPage)
async def list_applications(
    campaign_id: UUID, principal: PrincipalDep, node: str | None = None, status: StageStatus | None = None,
    flag: str | None = None, cursor: str | None = None, limit: int = Query(50, ge=1, le=200),
) -> svc.ApplicationPage:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.list_applications(tx, campaign_id, node=node, status=status, flag=flag, cursor=cursor,
                                           limit=limit)


@router.get("/{campaign_id}/applications/{application_id}", response_model=svc.ApplicationDetail)
async def application_detail(campaign_id: UUID, application_id: UUID, principal: PrincipalDep) -> svc.ApplicationDetail:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.detail(tx, campaign_id, application_id)


@router.post("/{campaign_id}/applications/{application_id}/retry", response_model=svc.Queued, status_code=202)
async def retry(campaign_id: UUID, application_id: UUID, principal: PrincipalDep) -> svc.Queued:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.retry(tx, user, campaign_id, application_id)
