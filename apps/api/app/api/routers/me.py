"""Shared by both apps: who am I, and create my profile after sign-up."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, PrincipalDep, user_tx
from app.core.db import Tx
from app.core.errors import ERROR_RESPONSES, AppError

router = APIRouter(prefix="/v1/me", tags=["me"], responses=ERROR_RESPONSES)


class Me(BaseModel):
    id: UUID
    email: str | None
    role: Literal["manager", "candidate"]
    display_name: str
    org_id: UUID | None = None
    org_name: str | None = None


class ProfileCreate(BaseModel):
    role: Literal["manager", "candidate"]
    display_name: str = Field(min_length=1, max_length=200)
    org_name: str | None = Field(default=None, max_length=200)
    adult_confirmed: bool = False


# Custom SQLSTATEs raised by app.create_profile.
_PROFILE_ERRORS = {
    "Z1001": (409, "role_conflict", "This account already has a different role."),
    "Z1002": (422, "adult_required", "You must confirm you are 18 or older."),
    "Z1003": (422, "org_name_required", "Enter your organization's name."),
}


async def _load_me(tx: Tx, user: CurrentUser) -> Me:
    org_name = None
    if user.org_id:
        row = await tx.fetchone("select name from organizations where id = %s", (user.org_id,))
        org_name = row["name"] if row else None
    assert user.role is not None and user.display_name is not None
    return Me(
        id=user.user_id,
        email=user.email,
        role=user.role,
        display_name=user.display_name,
        org_id=user.org_id,
        org_name=org_name,
    )


@router.get("", response_model=Me)
async def get_me(principal: PrincipalDep) -> Me:
    async with user_tx(principal) as (tx, user):
        if user.role is None:
            raise AppError(404, "profile_missing", "Finish creating your account first.")
        return await _load_me(tx, user)


@router.post("/profile", response_model=Me)
async def create_profile(body: ProfileCreate, principal: PrincipalDep) -> Me:
    """Create the caller's profile (and organization for managers). Idempotent; the role is fixed."""
    async with user_tx(principal) as (tx, user):
        try:
            async with tx.conn.transaction():  # savepoint, so a raised error leaves tx usable
                row = await tx.fetchone(
                    "select * from app.create_profile(%s, %s, %s, %s)",
                    (body.role, body.display_name, body.org_name, body.adult_confirmed),
                )
        except psycopg.Error as exc:
            mapped = _PROFILE_ERRORS.get(exc.sqlstate or "")
            if mapped:
                raise AppError(*mapped) from exc
            raise
        assert row is not None
        user = user.model_copy(
            update={"role": row["role"], "org_id": row["org_id"], "display_name": row["display_name"]}
        )
        await tx.set_claims(user.claims())
        return await _load_me(tx, user)
