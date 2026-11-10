"""RLS on the Phase 2 tables: LLM bookkeeping is system-only; skill aliases are readable."""

from __future__ import annotations

import uuid

import psycopg
import pytest

from tests.conftest import admin, as_claims, candidate_claims, create_auth_user, create_profile, manager_claims

SYSTEM_ONLY = ["llm_cache", "llm_budget", "llm_rpm"]


@pytest.fixture(scope="module")
def users(migrated_db):
    m = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:6]}@ai-m.test"), "manager", "M", "AI Org")
    c = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:6]}@ai-c.test"), "candidate", "C")
    with admin(migrated_db) as conn:
        conn.execute("insert into llm_cache (key_hash, response, model_id, prompt_id, prompt_version)"
                     " values ('k-rls', '{}', 'a', 'p', 1) on conflict do nothing")
        conn.execute("insert into llm_budget (day, model_id, requests_used) values ('2031-01-01', '*', 3)"
                     " on conflict do nothing")
        conn.execute("insert into skill_aliases values ('reactjs', 'react') on conflict do nothing")
    return {"manager": manager_claims(m), "candidate": candidate_claims(c)}


@pytest.mark.parametrize("who", ["manager", "candidate", "none"])
@pytest.mark.parametrize("table", SYSTEM_ONLY)
def test_users_cannot_read_llm_tables(users, who, table):
    with as_claims(users.get(who)) as conn:
        assert conn.execute(f"select count(*) as n from {table}").fetchone()["n"] == 0


@pytest.mark.parametrize("who", ["manager", "candidate"])
def test_users_cannot_spend_or_reset_the_budget(users, who):
    with as_claims(users[who]) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("insert into llm_budget (day, model_id, requests_used) values ('2031-01-02', '*', 0)")
    with as_claims(users[who]) as conn:
        assert conn.execute("update llm_budget set requests_used = 0").rowcount == 0


def test_system_can_read_llm_tables(users):
    with as_claims({"role": "system"}) as conn:
        assert conn.execute("select count(*) as n from llm_cache where key_hash = 'k-rls'").fetchone()["n"] == 1


def test_skill_aliases_are_readable_but_not_writable(users):
    with as_claims(users["candidate"]) as conn:
        row = conn.execute("select canonical from skill_aliases where alias = 'reactjs'").fetchone()
        assert row["canonical"] == "react"
    with as_claims(users["manager"]) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("insert into skill_aliases values ('react.js', 'react')")
