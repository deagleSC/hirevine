"""Retention and abuse limits (backend plan §18): candidate data is deleted 180 days after a campaign
completes; applications are limited per client IP across accounts; old rate-limit counters go."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from psycopg.rows import dict_row

from app.core import ratelimit
from app.core.db import system_claims, transaction
from app.jobs.dispatcher import InngestDispatcher
from app.services import applications as app_svc
from app.services import retention
from tests.api.test_applications import apply_with, published_job, storage  # noqa: F401
from tests.api.test_auth_and_profile import auth, client, make_manager  # noqa: F401
from tests.conftest import admin, create_auth_user
from tests.jobs.test_dispatcher import FakeInngest
from tests.resumes import pdf_bytes


@pytest.fixture(autouse=True)
def quiet(monkeypatch, storage):  # noqa: F811
    monkeypatch.setattr(app_svc, "dispatcher", InngestDispatcher(FakeInngest()))  # type: ignore[arg-type]
    monkeypatch.setattr(retention, "get_storage", lambda: storage)


async def test_retention_deletes_candidate_data_after_six_months(client, migrated_db, storage):  # noqa: F811
    import seed_analytics  # scripts/ is on sys.path (tests/conftest.py)

    mgr = create_auth_user(migrated_db, "ret-mgr@ret.test")
    me = await make_manager(client, mgr, org="Retention Org")
    with psycopg.connect(migrated_db, row_factory=dict_row, autocommit=True) as conn:
        old = seed_analytics.seed(conn, me["org_id"])  # completed 2026-11-04
        recent = seed_analytics.seed(conn, me["org_id"])
        conn.execute("update campaigns set completed_at = %s where id = %s",  # 100 days after the old one
                     (datetime(2027, 2, 12, 12, tzinfo=UTC), recent["campaign_id"]))
        conn.execute("insert into notifications (user_id, type, payload) values (%s, 'outcome_released', %s)",
                     (old["candidates"][0], psycopg.types.json.Jsonb({"application_id": old["applications"][0]})))
    for path in [f"{c}/r.pdf" for c in old["candidates"]]:
        storage.put(path, b"%PDF")

    # 179 days after completion nothing is due; 181 days after, the old campaign is.
    done = datetime(2026, 11, 4, 12, tzinfo=UTC)
    assert old["campaign_id"] not in await retention.due_campaigns(done + timedelta(days=179))
    due = await retention.due_campaigns(done + timedelta(days=181))
    assert old["campaign_id"] in due and recent["campaign_id"] not in due

    assert await retention.purge_batch(old["campaign_id"]) == 10
    assert await retention.purge_batch(old["campaign_id"]) == 0  # a retried step is harmless
    assert (await retention.finish(old["campaign_id"], 10)) == {"done": True, "deleted": 10}
    with admin(migrated_db) as conn:
        left = {t: conn.execute(f"select count(*) n from {t} where application_id = any(%s)",
                                (old["applications"],)).fetchone()["n"]
                for t in ("stage_results", "feedback", "resume_texts", "consents")}
        apps = conn.execute("select count(*) n from applications where campaign_id = %s",
                            (old["campaign_id"],)).fetchone()["n"]
        notes = conn.execute("select count(*) n from notifications where user_id = %s",
                             (old["candidates"][0],)).fetchone()["n"]
        camp = conn.execute("select purged_at from campaigns where id = %s", (old["campaign_id"],)).fetchone()
        kept = conn.execute("select count(*) n from applications where campaign_id = %s",
                            (recent["campaign_id"],)).fetchone()["n"]
        profiles = conn.execute("select count(*) n from profiles where id = any(%s)", (old["candidates"],)).fetchone()["n"]
    assert set(left.values()) == {0} and apps == 0 and notes == 0
    assert camp["purged_at"] is not None and kept == 10
    assert profiles == 10  # accounts stay; candidates delete their own
    assert not any(p.startswith(old["candidates"][0]) for p in storage.objects)
    m = (await client.get(f"/v1/manager/campaigns/{old['campaign_id']}", headers=auth(mgr))).json()
    assert m["purged_at"] is not None and m["total"] == 0
    assert old["campaign_id"] not in await retention.due_campaigns(done + timedelta(days=400))


async def test_applications_are_limited_per_ip_across_accounts(client, migrated_db, storage, monkeypatch):  # noqa: F811
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "applications_per_ip_per_day", 2)
    jobs = [await published_job(client, migrated_db) for _ in range(3)]
    headers = {"x-forwarded-for": "203.0.113.7"}
    codes = []
    for job in jobs:  # three different accounts, one network
        try:
            await apply_with(client, migrated_db, storage, job["job_id"], pdf_bytes(), extra_headers=headers)
            codes.append(202)
        except AssertionError as exc:
            codes.append(429 if "rate_limited" in str(exc) else 500)
    assert codes == [202, 202, 429]
    with admin(migrated_db) as conn:
        keys = [r["key"] for r in conn.execute("select key from rate_limits where key like 'apply-ip:%'").fetchall()]
    assert keys and "203.0.113.7" not in str(keys)  # only a hash is stored


async def test_old_rate_limit_counters_are_purged(migrated_db):
    with admin(migrated_db) as conn:
        conn.execute("insert into rate_limits (key, window_start, count) values ('old', now() - interval '5 days', 3),"
                     " ('fresh', now(), 1) on conflict do nothing")
    async with transaction(system_claims()) as tx:
        assert await ratelimit.purge_old(tx) >= 1
    with admin(migrated_db) as conn:
        assert conn.execute("select count(*) n from rate_limits where key = 'old'").fetchone()["n"] == 0
        assert conn.execute("select count(*) n from rate_limits where key = 'fresh'").fetchone()["n"] == 1
