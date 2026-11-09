"""Supabase JWT verification and the current user (backend plan §6).

Supports both Supabase signing setups:
- asymmetric signing keys (ES256/RS256), verified against the project's JWKS, and
- the legacy shared secret (HS256), when SUPABASE_JWT_SECRET is set.

The role and org come from `profiles`, never from the token: user_metadata is editable
by the user, so it is only used by the frontends for redirects.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID

import jwt
from fastapi import Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.db import Tx, transaction
from app.core.errors import AppError

Role = Literal["manager", "candidate"]

_bearer = HTTPBearer(auto_error=False)
_jwks_client: jwt.PyJWKClient | None = None


class Principal(BaseModel):
    """A verified token holder. May not have a profile yet."""

    user_id: UUID
    email: str | None = None


class CurrentUser(BaseModel):
    user_id: UUID
    email: str | None
    role: Role | None  # None until the profile exists
    org_id: UUID | None
    display_name: str | None

    def claims(self) -> dict[str, str]:
        return {
            "sub": str(self.user_id),
            "role": self.role or "",
            "org_id": str(self.org_id) if self.org_id else "",
        }


def _jwks() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(get_settings().jwks_url, cache_keys=True, lifespan=600)
    return _jwks_client


def _invalid(message: str = "The access token is not valid.") -> AppError:
    return AppError(401, "invalid_token", message)


async def verify_token(token: str) -> Principal:
    settings = get_settings()
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise _invalid() from exc

    alg = header.get("alg")
    if alg == "HS256":
        if not settings.supabase_jwt_secret:
            raise _invalid()
        key: object = settings.supabase_jwt_secret
    elif alg in ("ES256", "RS256"):
        if not settings.supabase_url:
            raise _invalid()
        try:
            signing_key = await run_in_threadpool(_jwks().get_signing_key_from_jwt, token)
        except jwt.PyJWTError as exc:
            raise _invalid() from exc
        key = signing_key.key
    else:
        raise _invalid()

    try:
        claims = jwt.decode(
            token,
            key,  # type: ignore[arg-type]
            algorithms=[alg],
            audience=settings.supabase_jwt_aud,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "sub", "aud"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AppError(401, "token_expired", "The access token has expired.") from exc
    except jwt.PyJWTError as exc:
        raise _invalid() from exc

    try:
        user_id = UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise _invalid() from exc
    return Principal(user_id=user_id, email=claims.get("email"))


async def get_principal(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Principal:
    if creds is None or creds.scheme.lower() != "bearer":
        raise AppError(401, "unauthenticated", "Sign in to continue.")
    return await verify_token(creds.credentials)


PrincipalDep = Annotated[Principal, Depends(get_principal)]


@asynccontextmanager
async def user_tx(principal: Principal) -> AsyncIterator[tuple[Tx, CurrentUser]]:
    """Open the request transaction as this user: load the profile, then set full claims."""
    async with transaction({"sub": str(principal.user_id)}) as tx:
        row = await tx.fetchone(
            "select role, org_id, display_name from profiles where id = %s", (principal.user_id,)
        )
        user = CurrentUser(
            user_id=principal.user_id,
            email=principal.email,
            role=row["role"] if row else None,
            org_id=row["org_id"] if row else None,
            display_name=row["display_name"] if row else None,
        )
        if row:
            await tx.set_claims(user.claims())
        yield tx, user


def require_role(user: CurrentUser, role: Role) -> None:
    if user.role is None:
        raise AppError(403, "profile_missing", "Finish creating your account first.")
    if user.role != role:
        raise AppError(403, "wrong_app", f"This area is for {role}s.", {"role": user.role})
