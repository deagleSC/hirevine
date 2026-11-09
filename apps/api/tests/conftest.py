"""Shared fixtures: a fresh migrated test database and helpers to act as a user."""

from __future__ import annotations

import json
import os
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import db_local  # noqa: E402

TEST_DB = "hirevine_test"
API_PASSWORD = "test"
API_DB_URL = f"postgresql://hirevine_api:{API_PASSWORD}@localhost:5432/{TEST_DB}"
JWT_SECRET = "test-jwt-secret-at-least-32-bytes-long!!"

# Settings the app reads (set before app modules are imported by test files).
os.environ.setdefault("APP_ENV", "test")
os.environ["DATABASE_URL"] = API_DB_URL
os.environ["SUPABASE_JWT_SECRET"] = JWT_SECRET
os.environ["SUPABASE_URL"] = ""


@pytest.fixture(scope="session")
def migrated_db() -> str:
    os.environ["API_DB_PASSWORD"] = API_PASSWORD
    db_local.API_PASSWORD = API_PASSWORD
    db_local.reset(TEST_DB)
    return db_local.admin_url_for(TEST_DB)


@contextmanager
def admin(db_url: str) -> Iterator[psycopg.Connection]:
    """Superuser connection (table owner, bypasses RLS) for seeding test data."""
    with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as conn:
        yield conn


@contextmanager
def as_claims(claims: dict | None) -> Iterator[psycopg.Connection]:
    """Connect as hirevine_api with the given claims, inside a transaction that rolls back."""
    with psycopg.connect(API_DB_URL, row_factory=dict_row) as conn:
        if claims is not None:
            conn.execute("select set_config('app.claims', %s, true)", (json.dumps(claims),))
        try:
            yield conn
        finally:
            conn.rollback()


def create_auth_user(db_url: str, email: str) -> uuid.UUID:
    uid = uuid.uuid4()
    with admin(db_url) as conn:
        conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, email))
    return uid


def create_profile(uid: uuid.UUID, role: str, name: str, org_name: str | None = None) -> dict:
    with psycopg.connect(API_DB_URL, row_factory=dict_row) as conn:
        conn.execute("select set_config('app.claims', %s, true)", (json.dumps({"sub": str(uid)}),))
        row = conn.execute(
            "select * from app.create_profile(%s, %s, %s, %s)",
            (role, name, org_name, role == "candidate"),
        ).fetchone()
        conn.commit()
    assert row is not None
    return row


def manager_claims(profile: dict) -> dict:
    return {"sub": str(profile["id"]), "role": "manager", "org_id": str(profile["org_id"])}


def candidate_claims(profile: dict) -> dict:
    return {"sub": str(profile["id"]), "role": "candidate"}
