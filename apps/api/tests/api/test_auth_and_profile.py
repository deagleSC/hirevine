"""API tests for auth, profiles, role guards and org isolation (Phase 1)."""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import AsyncIterator
from unittest.mock import patch

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from tests.conftest import JWT_SECRET, create_auth_user


def make_token(uid: uuid.UUID, *, secret: str = JWT_SECRET, aud: str = "authenticated",
               exp_in: int = 3600, email: str | None = None) -> str:
    now = int(time.time())
    payload = {"sub": str(uid), "aud": aud, "exp": now + exp_in, "iat": now, "role": "authenticated"}
    if email:
        payload["email"] = email
    return jwt.encode(payload, secret, algorithm="HS256")


def auth(uid: uuid.UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(uid)}"}


@pytest.fixture(scope="module")
async def client(migrated_db: str) -> AsyncIterator[httpx.AsyncClient]:
    from app.main import create_app

    app = create_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    from app.core.db import close_pool

    await close_pool()


@pytest.fixture
def new_user(migrated_db: str):
    def _make(email: str | None = None) -> uuid.UUID:
        return create_auth_user(migrated_db, email or f"{uuid.uuid4().hex[:8]}@example.test")
    return _make


async def make_manager(client, uid, org="Acme Hiring"):
    r = await client.post("/v1/me/profile", headers=auth(uid),
                          json={"role": "manager", "display_name": "Mia Manager", "org_name": org})
    assert r.status_code == 200, r.text
    return r.json()


async def make_candidate(client, uid):
    r = await client.post("/v1/me/profile", headers=auth(uid),
                          json={"role": "candidate", "display_name": "Cam Candidate", "adult_confirmed": True})
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------- health

async def test_healthz(client):
    r = await client.get("/healthz")
    assert r.json() == {"ok": True}
    r = await client.get("/healthz", params={"db": "true"})
    assert r.json() == {"ok": True, "db": True}


# --------------------------------------------------------------------- auth

async def test_missing_token_is_401_with_envelope(client):
    r = await client.get("/v1/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt",
        make_token(uuid.uuid4(), secret="wrong-secret-wrong-secret-wrong-secret!"),
        make_token(uuid.uuid4(), aud="someone-else"),
    ],
)
async def test_bad_tokens_are_rejected(client, token):
    r = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_token"


async def test_expired_token(client, new_user):
    token = make_token(new_user(), exp_in=-10)
    r = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "token_expired"


async def test_es256_token_verified_via_jwks(client, new_user, monkeypatch):
    """Supabase projects on asymmetric signing keys: verify through the JWKS client."""
    from app.core import auth as auth_mod
    from app.core.config import get_settings

    private_key = ec.generate_private_key(ec.SECP256R1())
    uid = new_user()
    settings = get_settings()
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    now = int(time.time())
    token = jwt.encode(
        {"sub": str(uid), "aud": "authenticated", "exp": now + 600,
         "iss": "https://example.supabase.co/auth/v1"},
        private_key, algorithm="ES256", headers={"kid": "k1"},
    )

    class FakeKey:
        key = private_key.public_key()

    class FakeJwks:
        def get_signing_key_from_jwt(self, _token):
            return FakeKey()

    with patch.object(auth_mod, "_jwks", lambda: FakeJwks()):
        r = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404  # verified; no profile yet
    assert r.json()["error"]["code"] == "profile_missing"


# ------------------------------------------------------------------ profiles

async def test_me_before_profile_is_404(client, new_user):
    r = await client.get("/v1/me", headers=auth(new_user()))
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "profile_missing"


async def test_create_manager_profile_creates_org(client, new_user):
    uid = new_user()
    me = await make_manager(client, uid, org="Northwind Talent")
    assert me["role"] == "manager"
    assert me["org_name"] == "Northwind Talent"
    r = await client.get("/v1/me", headers=auth(uid))
    assert r.json() == me


async def test_create_profile_is_idempotent(client, new_user):
    uid = new_user()
    first = await make_manager(client, uid)
    second = await make_manager(client, uid, org="Some Other Name")
    assert first["org_id"] == second["org_id"]


async def test_role_cannot_change(client, new_user):
    uid = new_user()
    await make_manager(client, uid)
    r = await client.post("/v1/me/profile", headers=auth(uid),
                          json={"role": "candidate", "display_name": "x", "adult_confirmed": True})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "role_conflict"


async def test_candidate_must_confirm_adult(client, new_user):
    r = await client.post("/v1/me/profile", headers=auth(new_user()),
                          json={"role": "candidate", "display_name": "Young"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "adult_required"


async def test_manager_needs_org_name(client, new_user):
    r = await client.post("/v1/me/profile", headers=auth(new_user()),
                          json={"role": "manager", "display_name": "No Org"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "org_name_required"


async def test_validation_error_envelope(client, new_user):
    r = await client.post("/v1/me/profile", headers=auth(new_user()), json={"role": "admin"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


# --------------------------------------------------------------- role guards

async def test_candidate_cannot_use_manager_routes(client, new_user):
    uid = new_user()
    await make_candidate(client, uid)
    r = await client.get("/v1/manager/org", headers=auth(uid))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "wrong_app"


async def test_manager_cannot_use_candidate_routes(client, new_user):
    uid = new_user()
    await make_manager(client, uid)
    r = await client.get("/v1/candidate/applications", headers=auth(uid))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "wrong_app"


async def test_no_profile_cannot_use_role_routes(client, new_user):
    r = await client.get("/v1/manager/org", headers=auth(new_user()))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "profile_missing"


async def test_candidate_applications_empty_list(client, new_user):
    uid = new_user()
    await make_candidate(client, uid)
    r = await client.get("/v1/candidate/applications", headers=auth(uid))
    assert r.status_code == 200
    assert r.json() == []


# ----------------------------------------------------------- org isolation

async def test_two_managers_see_only_their_own_org(client, new_user):
    a, b = new_user(), new_user()
    me_a = await make_manager(client, a, org="Org Alpha")
    me_b = await make_manager(client, b, org="Org Beta")
    r_a = await client.get("/v1/manager/org", headers=auth(a))
    r_b = await client.get("/v1/manager/org", headers=auth(b))
    assert r_a.json() == {"id": me_a["org_id"], "name": "Org Alpha"}
    assert r_b.json() == {"id": me_b["org_id"], "name": "Org Beta"}


async def test_claims_do_not_leak_between_concurrent_requests(client, new_user):
    """Many interleaved requests from different users each see only their own identity."""
    users = [new_user() for _ in range(6)]
    for i, uid in enumerate(users):
        await make_manager(client, uid, org=f"Concurrent Org {i}")

    async def whoami(uid):
        r = await client.get("/v1/manager/org", headers=auth(uid))
        return uid, r.json()["name"]

    results = await asyncio.gather(*(whoami(users[i % len(users)]) for i in range(60)))
    expected = {uid: f"Concurrent Org {i}" for i, uid in enumerate(users)}
    assert all(name == expected[uid] for uid, name in results)
