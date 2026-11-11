"""Dashboards (backend plan §7.2–7.3, §17). Numbers are computed as the caller, under RLS."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter

from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.errors import ERROR_RESPONSES
from app.services import analytics as svc

router = APIRouter(tags=["analytics"], responses=ERROR_RESPONSES)


@router.get("/v1/manager/analytics/overview", response_model=svc.Overview)
async def overview(principal: PrincipalDep) -> svc.Overview:
    """Your organisation: open jobs, applications per week, campaigns completed per month, time to
    shortlist, and how often AI drafts and suggestions were kept."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.overview(tx, user)


@router.get("/v1/manager/analytics/campaigns/{campaign_id}", response_model=svc.CampaignAnalytics)
async def campaign(campaign_id: UUID, principal: PrincipalDep) -> svc.CampaignAnalytics:
    """One campaign: funnel, score distributions, cutoff impact, time per stage and AI agreement."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        return await svc.campaign(tx, campaign_id)


@router.get("/v1/candidate/analytics", response_model=svc.CandidateAnalytics)
async def candidate(principal: PrincipalDep) -> svc.CandidateAnalytics:
    """Your applications over time and progress; scores only for released outcomes."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        return await svc.candidate(tx, user)
