from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.errors import ERROR_RESPONSES

router = APIRouter(prefix="/v1/candidate", tags=["candidate"], responses=ERROR_RESPONSES)


class ApplicationSummary(BaseModel):
    id: UUID
    campaign_id: UUID
    created_at: datetime


@router.get("/applications", response_model=list[ApplicationSummary])
async def list_applications(principal: PrincipalDep) -> list[ApplicationSummary]:
    """The tracker. Phase 1 returns the bare list; stage and next action arrive in Phase 9."""
    async with user_tx(principal) as (tx, user):
        require_role(user, "candidate")
        rows = await tx.fetchall(
            "select id, campaign_id, created_at from applications order by created_at desc"
        )
        return [ApplicationSummary(**r) for r in rows]
