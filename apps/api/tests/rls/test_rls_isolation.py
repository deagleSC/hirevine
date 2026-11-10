"""Row Level Security tests as different users (backend plan §19, Phase 1 exit check).

Two managers in different organizations, and two candidates, act through the
restricted hirevine_api role. Each test runs in a transaction that rolls back.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from uuid import UUID

import psycopg
import pytest

from tests.conftest import (
    admin,
    as_claims,
    candidate_claims,
    create_auth_user,
    create_profile,
    manager_claims,
)

WORKFLOW = json.dumps({"schema_version": 1, "nodes": [], "edges": []})


@dataclass
class World:
    db: str
    mgr_a: dict
    mgr_b: dict
    cand_x: dict
    cand_y: dict
    job_a: UUID
    job_a_draft: UUID
    job_b: UUID
    camp_a: UUID
    camp_b: UUID
    app_x_a: UUID
    app_y_a: UUID
    app_y_b: UUID


def _job(conn, org_id, title, status) -> UUID:
    return conn.execute(
        "insert into jobs (org_id, title, status) values (%s, %s, %s) returning id",
        (org_id, title, status),
    ).fetchone()["id"]


def _campaign(conn, job_id, status="open") -> UUID:
    wf = conn.execute(
        "insert into workflows (job_id, version, definition) "
        "select %s, coalesce(max(version), 0) + 1, %s from workflows where job_id = %s returning id",
        (job_id, WORKFLOW, job_id),
    ).fetchone()["id"]
    return conn.execute(
        "insert into campaigns (job_id, workflow_id, status) values (%s, %s, %s) returning id",
        (job_id, wf, status),
    ).fetchone()["id"]


def _application(conn, campaign_id, candidate_id) -> UUID:
    wf = conn.execute("select workflow_id from campaigns where id = %s", (campaign_id,)).fetchone()
    app_id = conn.execute(
        "insert into applications (campaign_id, candidate_id, workflow_id, current_node) "
        "values (%s, %s, %s, 'n1') returning id",
        (campaign_id, candidate_id, wf["workflow_id"]),
    ).fetchone()["id"]
    conn.execute(
        "insert into stage_results (application_id, node_id, status, score) values (%s, 'n1', 'passed', 72)",
        (app_id,),
    )
    conn.execute(
        "insert into feedback (application_id, ai_draft, ai_recommendation) values (%s, 'draft', 'yes')",
        (app_id,),
    )
    return app_id


@pytest.fixture(scope="module")
def world(migrated_db: str) -> World:
    db = migrated_db
    mgr_a = create_profile(create_auth_user(db, "a@org-a.test"), "manager", "Manager A", "Org A")
    mgr_b = create_profile(create_auth_user(db, "b@org-b.test"), "manager", "Manager B", "Org B")
    cand_x = create_profile(create_auth_user(db, "x@cand.test"), "candidate", "Candidate X")
    cand_y = create_profile(create_auth_user(db, "y@cand.test"), "candidate", "Candidate Y")
    with admin(db) as conn:
        job_a = _job(conn, mgr_a["org_id"], "Frontend Engineer", "published")
        job_a_draft = _job(conn, mgr_a["org_id"], "Secret Draft Role", "draft")
        job_b = _job(conn, mgr_b["org_id"], "Data Analyst", "published")
        camp_a = _campaign(conn, job_a)
        camp_b = _campaign(conn, job_b)
        app_x_a = _application(conn, camp_a, cand_x["id"])
        app_y_a = _application(conn, camp_a, cand_y["id"])
        app_y_b = _application(conn, camp_b, cand_y["id"])
        for org in (mgr_a["org_id"], mgr_b["org_id"]):
            conn.execute(
                "insert into events (org_id, type, entity) values (%s, 'test.event', 'test')", (org,)
            )
    return World(db, mgr_a, mgr_b, cand_x, cand_y, job_a, job_a_draft, job_b, camp_a, camp_b,
                 app_x_a, app_y_a, app_y_b)


def ids(conn, query: str, params=()) -> set:
    return {r["id"] for r in conn.execute(query, params).fetchall()}


# ------------------------------------------------------------ org isolation (exit check)

ORG_SCOPED_TABLES = ["jobs", "workflows", "campaigns", "applications", "stage_results", "feedback", "events"]


@pytest.mark.parametrize("table", ORG_SCOPED_TABLES)
def test_managers_in_different_orgs_cannot_read_each_others_rows(world: World, table: str):
    with admin(world.db) as conn:
        all_rows = ids(conn, f"select id from {table}")
    with as_claims(manager_claims(world.mgr_a)) as conn:
        seen_by_a = ids(conn, f"select id from {table}")
    with as_claims(manager_claims(world.mgr_b)) as conn:
        seen_by_b = ids(conn, f"select id from {table}")
    assert seen_by_a, f"manager A should see their own {table}"
    assert seen_by_b, f"manager B should see their own {table}"
    assert seen_by_a.isdisjoint(seen_by_b)
    assert seen_by_a | seen_by_b <= all_rows


def test_manager_sees_exactly_own_org_jobs(world: World):
    with as_claims(manager_claims(world.mgr_a)) as conn:
        assert ids(conn, "select id from jobs") == {world.job_a, world.job_a_draft}
    with as_claims(manager_claims(world.mgr_b)) as conn:
        assert ids(conn, "select id from jobs") == {world.job_b}


def test_manager_cannot_create_job_in_another_org(world: World):
    with as_claims(manager_claims(world.mgr_a)) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "insert into jobs (org_id, title) values (%s, 'Injected')", (world.mgr_b["org_id"],)
            )


def test_manager_cannot_update_another_orgs_job(world: World):
    with as_claims(manager_claims(world.mgr_a)) as conn:
        cur = conn.execute("update jobs set title = 'hacked' where id = %s", (world.job_b,))
        assert cur.rowcount == 0


def test_manager_sees_only_candidates_who_applied_to_their_org(world: World):
    with as_claims(manager_claims(world.mgr_a)) as conn:
        seen = ids(conn, "select id from profiles where role = 'candidate'")
    assert seen == {world.cand_x["id"], world.cand_y["id"]}
    with as_claims(manager_claims(world.mgr_b)) as conn:
        seen = ids(conn, "select id from profiles where role = 'candidate'")
    assert seen == {world.cand_y["id"]}


# --------------------------------------------------------------------- candidates

def test_candidate_sees_only_published_jobs(world: World):
    with as_claims(candidate_claims(world.cand_x)) as conn:
        assert ids(conn, "select id from jobs") == {world.job_a, world.job_b}


def test_candidate_cannot_read_workflows(world: World):
    with as_claims(candidate_claims(world.cand_x)) as conn:
        assert ids(conn, "select id from workflows") == set()


def test_candidate_sees_only_own_applications(world: World):
    with as_claims(candidate_claims(world.cand_x)) as conn:
        assert ids(conn, "select id from applications") == {world.app_x_a}
    with as_claims(candidate_claims(world.cand_y)) as conn:
        assert ids(conn, "select id from applications") == {world.app_y_a, world.app_y_b}


def test_candidate_cannot_apply_as_someone_else(world: World):
    with as_claims(candidate_claims(world.cand_x)) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "insert into applications (campaign_id, candidate_id, workflow_id) "
                "select id, %s, workflow_id from campaigns where id = %s",
                (world.cand_y["id"], world.camp_b),
            )


def test_candidate_cannot_read_events(world: World):
    with as_claims(candidate_claims(world.cand_x)) as conn:
        assert ids(conn, "select id from events") == set()


# -------------------------------------------------------------------- release rule

def test_candidate_cannot_see_results_or_feedback_before_release(world: World):
    with as_claims(candidate_claims(world.cand_x)) as conn:
        assert ids(conn, "select id from stage_results") == set()
        assert ids(conn, "select id from feedback") == set()


def test_candidate_sees_own_results_and_feedback_only_after_release(world: World):
    with admin(world.db) as conn:
        camp = _campaign(conn, world.job_a)
        app_x = _application(conn, camp, world.cand_x["id"])
        app_y = _application(conn, camp, world.cand_y["id"])
        # Completing the campaign alone opens stage results; feedback also needs `released`.
        conn.execute("update campaigns set status = 'completed', completed_at = now() where id = %s", (camp,))
        conn.execute("update feedback set released = true, released_at = now() where application_id = %s", (app_x,))

    with as_claims(candidate_claims(world.cand_x)) as conn:
        assert {r["application_id"] for r in conn.execute("select application_id from stage_results")} == {app_x}
        assert {r["application_id"] for r in conn.execute("select application_id from feedback")} == {app_x}
    with as_claims(candidate_claims(world.cand_y)) as conn:
        # Y's campaign row is completed too, so Y sees Y's own result, but feedback is unreleased.
        assert {r["application_id"] for r in conn.execute("select application_id from stage_results")} == {app_y}
        assert ids(conn, "select id from feedback") == set()


def test_unreleased_feedback_stays_hidden_even_if_campaign_completed(world: World):
    with admin(world.db) as conn:
        camp = _campaign(conn, world.job_b)
        app_x = _application(conn, camp, world.cand_x["id"])
        conn.execute("update campaigns set status = 'completed', completed_at = now() where id = %s", (camp,))
    with as_claims(candidate_claims(world.cand_x)) as conn:
        assert app_x not in {r["application_id"] for r in conn.execute("select application_id from feedback")}


# ------------------------------------------------------------------ no claims / misc

@pytest.mark.parametrize("table", ORG_SCOPED_TABLES + ["organizations", "profiles", "job_runs", "rate_limits"])
def test_no_claims_sees_nothing(world: World, table: str):
    with as_claims(None) as conn:
        assert conn.execute(f"select count(*) as n from {table}").fetchone()["n"] == 0


def test_events_are_append_only_for_api_role(world: World):
    with as_claims({"role": "system"}) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("update events set type = 'tampered'")
    with as_claims({"role": "system"}) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("delete from events")


def test_system_context_sees_all_orgs(world: World):
    with as_claims({"role": "system"}) as conn:
        assert {world.job_a, world.job_b, world.job_a_draft} <= ids(conn, "select id from jobs")


# ------------------------------------------------------------------ create_profile

def test_create_profile_is_idempotent_and_role_is_fixed(world: World):
    again = create_profile(world.mgr_a["id"], "manager", "Manager A", "Ignored Org Name")
    assert again["org_id"] == world.mgr_a["org_id"]
    with pytest.raises(psycopg.Error) as exc:
        create_profile(world.mgr_a["id"], "candidate", "Manager A")
    assert exc.value.sqlstate == "Z1001"


def test_candidate_profile_requires_adult_confirmation(world: World):
    uid = create_auth_user(world.db, "minor@cand.test")
    with as_claims({"sub": str(uid)}) as conn:
        with pytest.raises(psycopg.Error) as exc:
            conn.execute("select app.create_profile('candidate', 'Kid', null, false)")
    assert exc.value.sqlstate == "Z1002"


def test_manager_profile_requires_org_name(world: World):
    uid = create_auth_user(world.db, "noorg@org.test")
    with as_claims({"sub": str(uid)}) as conn:
        with pytest.raises(psycopg.Error) as exc:
            conn.execute("select app.create_profile('manager', 'No Org', '  ', false)")
    assert exc.value.sqlstate == "Z1003"


# ------------------------------------------------------------ role escalation

def test_create_profile_rejects_unknown_roles(world: World):
    uid = create_auth_user(world.db, "admin-wannabe@x.test")
    for role in ("admin", "system", "public"):
        with as_claims({"sub": str(uid)}) as conn:
            with pytest.raises(psycopg.Error) as exc:
                conn.execute("select app.create_profile(%s, 'Eve', 'Evil Org', true)", (role,))
        assert exc.value.sqlstate == "22023"


def test_candidate_cannot_become_manager_or_join_an_org(world: World):
    with pytest.raises(psycopg.Error) as exc:
        create_profile(world.cand_x["id"], "manager", "Candidate X", "Takeover Org")
    assert exc.value.sqlstate == "Z1001"
    with admin(world.db) as conn:
        assert conn.execute("select 1 from organizations where name = 'Takeover Org'").fetchone() is None


@pytest.mark.parametrize("who", ["cand_x", "mgr_a"])
def test_users_cannot_edit_their_own_profile_row(world: World, who: str):
    profile = getattr(world, who)
    claims = candidate_claims(profile) if who == "cand_x" else manager_claims(profile)
    with as_claims(claims) as conn:
        updated = conn.execute(
            "update profiles set role = 'manager', org_id = %s where id = %s",
            (world.mgr_b["org_id"], profile["id"]),
        )
        assert updated.rowcount == 0
    with admin(world.db) as conn:
        row = conn.execute("select role, org_id from profiles where id = %s", (profile["id"],)).fetchone()
    assert row["role"] == profile["role"] and row["org_id"] == profile["org_id"]


def test_users_cannot_insert_profiles_directly(world: World):
    uid = create_auth_user(world.db, "direct-insert@x.test")
    with as_claims({"sub": str(uid)}) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "insert into profiles (id, role, org_id, display_name) values (%s, 'manager', %s, 'Eve')",
                (uid, world.mgr_a["org_id"]),
            )
