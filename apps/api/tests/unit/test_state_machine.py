"""Pipeline state machine skeleton (backend plan §9)."""

from __future__ import annotations

import uuid

import pytest
from psycopg.types.json import Jsonb

from app.core.db import system_claims, transaction
from app.domain.patches import ToggleNode, apply_patches
from app.domain.state_machine import StageOutcome, can_transition, can_transition_campaign, passes, transition
from tests.conftest import admin, create_auth_user, create_profile
from tests.unit.test_patches import wf


def test_pass_rules_use_each_nodes_threshold():
    w = wf()
    assert passes(w.node("n1"), 60) and not passes(w.node("n1"), 59.9)
    assert passes(w.node("n2"), 60) and not passes(w.node("n2"), 10)
    assert not passes(w.node("n4"), 100)  # final never auto-passes


def test_stage_and_campaign_transitions():
    assert can_transition("pending", "in_progress")
    assert not can_transition("passed", "failed")  # terminal
    assert can_transition("needs_review", "passed")  # manual score
    assert can_transition_campaign("draft", "open") and not can_transition_campaign("completed", "open")


@pytest.fixture
def application(migrated_db):
    mgr = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:6]}@sm.test"), "manager", "M", "SM Org")
    cand = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:6]}@sm.test"), "candidate", "C")
    with admin(migrated_db) as conn:
        job = conn.execute("insert into jobs (org_id, title) values (%s, 'J') returning id", (mgr["org_id"],)
                           ).fetchone()["id"]
        w = conn.execute("insert into workflows (job_id, version, definition) values (%s, 1, %s) returning id",
                         (job, Jsonb(wf().model_dump(mode="json")))).fetchone()["id"]
        camp = conn.execute("insert into campaigns (job_id, workflow_id, status) values (%s, %s, 'open') returning id",
                            (job, w)).fetchone()["id"]
        return conn.execute("insert into applications (campaign_id, candidate_id, workflow_id, current_node)"
                            " values (%s, %s, %s, 'n1') returning id", (camp, cand["id"], w)).fetchone()["id"]


def stages(db, app_id):
    with admin(db) as conn:
        rows = conn.execute("select node_id, status from stage_results where application_id = %s", (app_id,)).fetchall()
        node = conn.execute("select current_node from applications where id = %s", (app_id,)).fetchone()
    return {r["node_id"]: r["status"] for r in rows}, node["current_node"]


async def test_pass_moves_to_next_enabled_node_and_retries_are_no_ops(application, migrated_db):
    w = apply_patches(wf(), [ToggleNode(op="toggle_node", node="n2", enabled=False)]).workflow
    async with transaction(system_claims()) as tx:
        r = await transition(tx, application, "n1", StageOutcome(status="passed", score=80), w)
    assert r.changed and r.next_node == "n3"  # quiz disabled → interview
    assert stages(migrated_db, application) == ({"n1": "passed", "n3": "pending"}, "n3")

    async with transaction(system_claims()) as tx:  # the same job retried
        again = await transition(tx, application, "n1", StageOutcome(status="failed", score=10), w)
    assert not again.changed
    assert stages(migrated_db, application)[0]["n1"] == "passed"  # terminal rows never change


async def test_fail_keeps_current_node_and_needs_review_can_be_resolved(application, migrated_db):
    async with transaction(system_claims()) as tx:
        await transition(tx, application, "n1", StageOutcome(status="needs_review"), wf())
        r = await transition(tx, application, "n1", StageOutcome(status="failed", score=30, source="manual"), wf())
    assert r.changed and r.next_node is None
    assert stages(migrated_db, application) == ({"n1": "failed"}, "n1")
