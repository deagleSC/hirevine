"""RLS on agent tables: threads are private to their manager; checkpoints are system-only."""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import admin, as_claims, create_auth_user, create_profile, manager_claims


@pytest.fixture(scope="module")
def two_managers(migrated_db):
    a = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:6]}@ag.test"), "manager", "A", "Agent A")
    b = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:6]}@ag.test"), "manager", "B", "Agent B")
    with admin(migrated_db) as conn:
        tid = conn.execute("insert into agent_threads (kind, org_id, user_id) values ('jd', %s, %s) returning thread_id",
                           (a["org_id"], a["id"])).fetchone()["thread_id"]
        conn.execute("insert into checkpoints (thread_id, checkpoint_id, checkpoint) values (%s, 'c1', '{}')"
                     " on conflict do nothing", (str(tid),))
    return a, b, tid


def test_threads_are_visible_only_to_their_owner(two_managers):
    a, b, tid = two_managers
    with as_claims(manager_claims(a)) as conn:
        assert conn.execute("select count(*) n from agent_threads where thread_id = %s", (tid,)).fetchone()["n"] == 1
    with as_claims(manager_claims(b)) as conn:
        assert conn.execute("select count(*) n from agent_threads where thread_id = %s", (tid,)).fetchone()["n"] == 0


@pytest.mark.parametrize("table", ["checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"])
def test_checkpoints_are_system_only(two_managers, table):
    a, _, _ = two_managers
    with as_claims(manager_claims(a)) as conn:
        assert conn.execute(f"select count(*) n from {table}").fetchone()["n"] == 0


def test_a_manager_cannot_create_a_thread_for_someone_else(two_managers):
    a, b, _ = two_managers
    import psycopg

    with as_claims(manager_claims(a)) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("insert into agent_threads (kind, org_id, user_id) values ('jd', %s, %s)",
                         (b["org_id"], b["id"]))
