"""JobDispatcher and housekeeping without Inngest (backend plan §10.4, §19.1 'Jobs')."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from app.core.db import transaction
from app.jobs import runs
from app.jobs.dispatcher import InngestDispatcher
from app.jobs.functions import housekeeping
from app.jobs.runs import JobRefs
from tests.conftest import admin, as_claims, create_auth_user, create_profile, manager_claims


class FakeInngest:
    def __init__(self, fail: bool = False):
        self.sent: list = []
        self.fail = fail

    async def send(self, event):
        if self.fail:
            raise ConnectionError("inngest down")
        self.sent.append(event)
        return [event.id]


@pytest.fixture
def manager(migrated_db):
    uid = create_auth_user(migrated_db, f"{uuid.uuid4().hex[:8]}@jobs.test")
    return create_profile(uid, "manager", "Jo Jobs", "Jobs Org")


def assert_ids_only(data: dict) -> None:
    """§10.1: events carry IDs only."""
    for key, value in data.items():
        assert key.endswith("_id"), key
        uuid.UUID(value)


async def test_event_is_sent_only_after_commit(manager):
    fake = FakeInngest()
    d = InngestDispatcher(fake)  # type: ignore[arg-type]
    async with transaction(manager_claims(manager)) as tx:
        run_id = await d.enqueue(tx, "selftest", JobRefs(org_id=manager["org_id"]))
        assert fake.sent == []  # not yet: still inside the transaction
    assert len(fake.sent) == 1
    event = fake.sent[0]
    assert event.name == "selftest/requested"
    assert event.id == str(run_id)  # Inngest dedupes on this
    assert event.data == {"org_id": str(manager["org_id"]), "job_run_id": str(run_id)}
    assert_ids_only(dict(event.data))
    assert (await runs.get(run_id))["status"] == "queued"


async def test_rollback_sends_nothing_and_leaves_no_run(manager, migrated_db):
    fake = FakeInngest()
    d = InngestDispatcher(fake)  # type: ignore[arg-type]
    run_id = None
    with pytest.raises(RuntimeError):
        async with transaction(manager_claims(manager)) as tx:
            run_id = await d.enqueue(tx, "selftest", JobRefs(org_id=manager["org_id"]))
            raise RuntimeError("request failed after queuing")
    assert fake.sent == []
    assert await runs.get(run_id) is None


async def test_enqueue_restores_the_callers_claims(manager):
    d = InngestDispatcher(FakeInngest())  # type: ignore[arg-type]
    async with transaction(manager_claims(manager)) as tx:
        await d.enqueue(tx, "selftest", JobRefs(org_id=manager["org_id"]))
        row = await tx.fetchone("select app.current_role() as role")
        assert row["role"] == "manager"


async def test_failed_send_keeps_the_run_queued_for_housekeeping(manager):
    d = InngestDispatcher(FakeInngest(fail=True))  # type: ignore[arg-type]
    async with transaction(manager_claims(manager)) as tx:
        run_id = await d.enqueue(tx, "selftest", JobRefs(org_id=manager["org_id"]))
    assert (await runs.get(run_id))["status"] == "queued"


async def test_unknown_job_type_is_rejected(manager):
    d = InngestDispatcher(FakeInngest())  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        async with transaction(manager_claims(manager)) as tx:
            await d.enqueue(tx, "no-such-job", JobRefs())


async def test_housekeeping_resends_stuck_runs_and_resumes_deferred(manager, migrated_db, monkeypatch):
    fake = FakeInngest()
    monkeypatch.setattr(housekeeping, "dispatcher", InngestDispatcher(fake))  # type: ignore[arg-type]
    with admin(migrated_db) as conn:
        conn.execute("update job_runs set status = 'done'")  # isolate from earlier tests
        stuck = conn.execute(
            "insert into job_runs (type, org_id, updated_at) values ('selftest', %s, now() - interval '10 minutes')"
            " returning id", (manager["org_id"],)).fetchone()["id"]
        fresh = conn.execute(
            "insert into job_runs (type, org_id) values ('selftest', %s) returning id", (manager["org_id"],)
        ).fetchone()["id"]
        yesterday = datetime.now(UTC) - timedelta(days=1)
        deferred = conn.execute(
            "insert into job_runs (type, org_id, status, updated_at, attempts)"
            " values ('selftest', %s, 'deferred_budget', %s, 1)"
            " returning id", (manager["org_id"], yesterday)).fetchone()["id"]
        deferred_today = conn.execute(
            "insert into job_runs (type, org_id, status) values ('selftest', %s, 'deferred_budget') returning id",
            (manager["org_id"],)).fetchone()["id"]

    assert await housekeeping.resend_stuck_runs() == 1
    assert await housekeeping.resume_budget_deferred() == 1
    # Every re-send gets a fresh id: Inngest drops a repeated id for 24 h even if no function took the
    # first event (an unsynced app), which would strand the run. mark_running guards double starts.
    sent = [e.id for e in fake.sent]
    assert sorted(i.split(":")[0] for i in sent) == sorted([str(stuck), str(deferred)])
    assert all(":" in i for i in sent)
    assert await housekeeping.resend_stuck_runs() == 1
    assert fake.sent[-1].id not in sent  # a second re-send of the same run is not deduped either
    assert not any(str(fresh) in i or str(deferred_today) in i for i in sent)
    assert (await runs.get(deferred))["status"] == "queued"
    assert (await runs.get(deferred_today))["status"] == "deferred_budget"
    for e in fake.sent:
        assert_ids_only(dict(e.data))


async def test_run_status_transitions(manager):
    async with transaction(manager_claims(manager)) as tx:
        run_id = await runs.create(tx, "selftest", JobRefs(org_id=manager["org_id"]))
    assert await runs.mark_running(str(run_id), "inngest-run-1") is True
    row = await runs.get(run_id)
    assert (row["status"], row["attempts"], row["inngest_run_id"]) == ("running", 1, "inngest-run-1")
    # A duplicate event cannot start the run again.
    assert await runs.mark_running(str(run_id), "inngest-run-2") is False
    row = await runs.get(run_id)
    assert (row["attempts"], row["inngest_run_id"]) == (1, "inngest-run-1")
    await runs.mark_deferred_budget(str(run_id))
    assert (await runs.get(run_id))["status"] == "deferred_budget"
    await runs.mark_failed(str(run_id), "boom")
    row = await runs.get(run_id)
    assert (row["status"], row["last_error"]) == ("failed", "boom")


def test_managers_cannot_write_job_runs_directly(manager):
    with as_claims(manager_claims(manager)) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("insert into job_runs (type, org_id) values ('selftest', %s)", (manager["org_id"],))
