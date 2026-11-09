from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.auth import PrincipalDep, require_role, user_tx
from app.core.errors import ERROR_RESPONSES, AppError

router = APIRouter(prefix="/v1/manager", tags=["manager"], responses=ERROR_RESPONSES)


class Organization(BaseModel):
    id: UUID
    name: str


@router.get("/org", response_model=Organization)
async def get_org(principal: PrincipalDep) -> Organization:
    async with user_tx(principal) as (tx, user):
        require_role(user, "manager")
        row = await tx.fetchone("select id, name from organizations")  # RLS: own org only
        if row is None:
            raise AppError(404, "not_found", "Organization not found.")
        return Organization(**row)
