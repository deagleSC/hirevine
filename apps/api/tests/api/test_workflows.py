"""Workflow service and endpoints against Postgres (backend plan §8.4, Phase 3 exit check:
undo restores the earlier version)."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from hypothesis import HealthCheck, given, settings
from psycopg.types.json import Jsonb

from app.core.db import transaction
from app.domain.patches import PatchError, apply_patches
from app.services import workflows as svc
from tests.api.test_auth_and_profile import auth, client, make_candidate, make_manager  # noqa: F401
from tests.conftest import admin, manager_claims
from tests.strategies import patch_sequences
from tests.unit.test_patches import wf

BASE = wf()


def make_job(db: str, org_id: str, *, campaign: bool = False) -> uuid.UUID:
    with admin(db) as conn:
        job = conn.execute("insert into jobs (org_id, title) values (%s, 'Engineer') returning id", (org_id,)
                           ).fetchone()["id"]
        w = conn.execute("insert into workflows (job_id, version, definition) values (%s, 1, %s) returning id",
                         (job, Jsonb(BASE.model_dump(mode="json")))).fetchone()["id"]
        if campaign:
            conn.execute("insert into campaigns (job_id, workflow_id, status) values (%s, %s, 'open')", (job, w))
    return job


@pytest.fixture
async def mgr(client, new_user):  # noqa: F811
    uid = new_user()
    me = await make_manager(client, uid)
    return uid, me


@pytest.fixture
def new_user(migrated_db):
    from tests.conftest import create_auth_user

    return lambda: create_auth_user(migrated_db, f"{uuid.uuid4().hex[:8]}@wf.test")


URL = "/v1/manager/jobs/{}/workflow"


async def test_get_preview_apply_versions_undo(client, mgr, migrated_db):  # noqa: F811
    uid, me = mgr
    job = make_job(migrated_db, me["org_id"])
    url = URL.format(job)

    got = (await client.get(url, headers=auth(uid))).json()
    assert got["version"] == 1 and got["definition"]["nodes"][0]["config"]["cutoff"] == 60

    body = {"base_version": 1, "patches": [{"op": "set_cutoff", "node": "n1", "value": 80}]}
    prev = (await client.post(f"{url}/preview", json=body, headers=auth(uid))).json()
    assert prev["diff"] == [{"path": "n1.cutoff", "kind": "changed", "node_id": "n1", "before": 60, "after": 80}]
    assert prev["descriptions"] == ["Set the screening cutoff to 80"]
    assert prev["affects_running_campaign"] is False
    assert (await client.get(url, headers=auth(uid))).json()["version"] == 1  # preview wrote nothing

    applied = (await client.post(f"{url}/apply", json=body, headers=auth(uid))).json()
    assert applied["version"] == 2
    assert (await client.get(url, headers=auth(uid))).json()["definition"]["nodes"][0]["config"]["cutoff"] == 80

    undone = (await client.post(f"{url}/undo", headers=auth(uid))).json()
    assert undone["version"] == 3
    cur = (await client.get(url, headers=auth(uid))).json()
    assert cur["definition"] == BASE.model_dump(mode="json") and cur["parent_version"] == 2

    versions = (await client.get(f"{url}/versions", headers=auth(uid))).json()
    assert [v["version"] for v in versions] == [3, 2, 1]
    with admin(migrated_db) as conn:
        ev = conn.execute("select payload from events where type = 'workflow.patch_applied' and entity_id = %s",
                          (job,)).fetchall()
    assert ev[0]["payload"]["source"] == "panel" and ev[0]["payload"]["patch"]["value"] == 80


async def test_stale_base_is_409(client, mgr, migrated_db):  # noqa: F811
    uid, me = mgr
    url = URL.format(make_job(migrated_db, me["org_id"]))
    body = {"base_version": 1, "patches": [{"op": "set_notify", "value": False}]}
    assert (await client.post(f"{url}/apply", json=body, headers=auth(uid))).status_code == 200
    for path in ("apply", "preview"):
        r = await client.post(f"{url}/{path}", json=body, headers=auth(uid))
        assert r.status_code == 409
        assert r.json()["error"] == {"code": "stale_base_version", "message": r.json()["error"]["message"],
                                     "details": {"latest_version": 2}}


async def test_concurrent_applies_from_the_same_base_only_one_wins(client, mgr, migrated_db):  # noqa: F811
    uid, me = mgr
    url = URL.format(make_job(migrated_db, me["org_id"]))
    bodies = [{"base_version": 1, "patches": [{"op": "set_cutoff", "node": "n1", "value": v}]} for v in (10, 20, 30)]
    rs = await asyncio.gather(*(client.post(f"{url}/apply", json=b, headers=auth(uid)) for b in bodies))
    assert sorted(r.status_code for r in rs) == [200, 409, 409]
    assert [v["version"] for v in (await client.get(f"{url}/versions", headers=auth(uid))).json()] == [2, 1]


async def test_invalid_patch_is_422_with_index(client, mgr, migrated_db):  # noqa: F811
    uid, me = mgr
    url = URL.format(make_job(migrated_db, me["org_id"]))
    body = {"base_version": 1, "patches": [{"op": "set_notify", "value": False},
                                           {"op": "remove_criterion", "node": "n1", "criterion_id": "nope"}]}
    r = await client.post(f"{url}/apply", json=body, headers=auth(uid))
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_patch" and r.json()["error"]["details"] == {"patch_index": 1}
    assert len((await client.get(f"{url}/versions", headers=auth(uid))).json()) == 1


async def test_nothing_to_undo_on_first_version(client, mgr, migrated_db):  # noqa: F811
    uid, me = mgr
    r = await client.post(f"{URL.format(make_job(migrated_db, me['org_id']))}/undo", headers=auth(uid))
    assert r.status_code == 409 and r.json()["error"]["code"] == "nothing_to_undo"


async def test_other_orgs_and_candidates_cannot_touch_the_workflow(client, mgr, migrated_db, new_user):  # noqa: F811
    _, me = mgr
    url = URL.format(make_job(migrated_db, me["org_id"]))
    other = new_user()
    await make_manager(client, other, org="Other Org")
    assert (await client.get(url, headers=auth(other))).status_code == 404
    body = {"base_version": 1, "patches": [{"op": "set_notify", "value": False}]}
    assert (await client.post(f"{url}/apply", json=body, headers=auth(other))).status_code == 404
    cand = new_user()
    await make_candidate(client, cand)
    assert (await client.get(url, headers=auth(cand))).json()["error"]["code"] == "wrong_app"


async def test_open_campaign_repins_only_candidates_before_the_change(client, mgr, migrated_db, new_user):  # noqa: F811
    uid, me = mgr
    job = make_job(migrated_db, me["org_id"], campaign=True)
    url = URL.format(job)
    cands = []
    with admin(migrated_db) as conn:
        camp = conn.execute("select id, workflow_id from campaigns where job_id = %s", (job,)).fetchone()
        for node in ("n1", "n2", "n3"):
            c = new_user()
            conn.execute("insert into profiles (id, role, display_name, adult_confirmed)"
                         " values (%s, 'candidate', 'C', true)", (c,))
            a = conn.execute("insert into applications (campaign_id, candidate_id, workflow_id, current_node)"
                             " values (%s, %s, %s, %s) returning id", (camp["id"], c, camp["workflow_id"], node)
                             ).fetchone()["id"]
            cands.append(a)

    body = {"base_version": 1, "patches": [{"op": "set_pass_mark", "node": "n2", "value": 90},
                                           {"op": "set_notify", "value": False}]}
    prev = (await client.post(f"{url}/preview", json=body, headers=auth(uid))).json()
    assert prev["affects_running_campaign"] is True
    assert prev["affected_stage_note"].startswith("1 candidate who have not reached the quiz step")
    applied = (await client.post(f"{url}/apply", json=body, headers=auth(uid))).json()
    assert applied["repinned_applications"] == 1

    with admin(migrated_db) as conn:
        new_wf = conn.execute("select id from workflows where job_id = %s and version = 2", (job,)).fetchone()["id"]
        pins = {r["id"]: r["workflow_id"] for r in conn.execute(
            "select id, workflow_id from applications where id = any(%s)", (cands,)).fetchall()}
        c = conn.execute("select workflow_id, notify_on_complete from campaigns where id = %s",
                         (camp["id"],)).fetchone()
    assert pins[cands[0]] == new_wf  # at screening: before the quiz change
    assert pins[cands[1]] == camp["workflow_id"] and pins[cands[2]] == camp["workflow_id"]
    assert c["workflow_id"] == new_wf and c["notify_on_complete"] is False  # set_notify mirrored


@settings(max_examples=25, deadline=None, suppress_health_check=list(HealthCheck))
@given(case=patch_sequences(max_size=5))
async def test_undo_restores_the_previous_version(migrated_db, case):
    """Phase 3 exit check: after any applied change, undo restores exactly the earlier definition."""
    base, ops = case
    from tests.conftest import create_auth_user, create_profile

    me = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:8]}@prop.test"), "manager", "P", "Prop Org")
    actor, org = me["id"], me["org_id"]
    with admin(migrated_db) as conn:
        job = conn.execute("insert into jobs (org_id, title) values (%s, 'J') returning id", (org,)).fetchone()["id"]
        conn.execute("insert into workflows (job_id, version, definition) values (%s, 1, %s)",
                     (job, Jsonb(base.model_dump(mode="json"))))
    claims = manager_claims(me)
    history = [base]
    for p in ops:
        try:
            apply_patches(history[-1], [p])
        except PatchError:
            continue
        async with transaction(claims) as tx:
            await svc.apply(tx, job, len(history), [p], source="panel", actor=actor)
            history.append((await svc.latest(tx, job)).definition)
    if len(history) < 2:
        return
    async with transaction(claims) as tx:
        await svc.undo(tx, job, actor=actor)
        restored = await svc.latest(tx, job)
    assert restored.definition == history[-2]
    assert restored.version == len(history) + 1 and restored.parent_version == len(history)
