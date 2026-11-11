"""Candidate portal (backend plan §7.3, §18; Phase 9): notifications, released feedback with the
candidate's own evidence, data export and account deletion, plus the dev-only storage and inline jobs
that let the end-to-end test run the whole pipeline."""

from __future__ import annotations

import asyncio

import pytest
from psycopg.types.json import Jsonb

from app.core.db import transaction
from app.jobs.dispatcher import InlineDispatcher, InngestDispatcher
from app.jobs.runs import JobRefs
from app.services import applications as app_svc
from app.services import privacy
from tests.api.test_applications import GOOD, apply_with, llm, new_uid, published_job, run_pipeline, storage  # noqa: F401
from tests.api.test_auth_and_profile import auth, client, make_candidate  # noqa: F401
from tests.api.test_report import DRAFT, WF
from tests.conftest import admin
from tests.jobs.test_dispatcher import FakeInngest
from tests.resumes import pdf_bytes


@pytest.fixture(autouse=True)
def quiet(monkeypatch, storage):  # noqa: F811
    monkeypatch.setattr(app_svc, "dispatcher", InngestDispatcher(FakeInngest()))  # type: ignore[arg-type]
    monkeypatch.setattr(privacy, "get_storage", lambda: storage)


async def finalist(client, db, storage, llm):  # noqa: F811
    job = await published_job(client, db, title="Portal Engineer")
    with admin(db) as conn:
        conn.execute("update workflows set definition = %s where job_id = %s",
                     (Jsonb(WF.model_dump(mode="json")), job["job_id"]))
    cand, app_id = await apply_with(client, db, storage, job["job_id"], pdf_bytes())
    llm.on("screening_score", GOOD)
    assert await run_pipeline(app_id) == "passed"
    return job, cand, app_id


async def test_stage_invites_and_reading_notifications(client, migrated_db, storage, llm):  # noqa: F811
    from tests.api.test_quiz import at_quiz

    job, cand, app_id = await at_quiz(client, migrated_db, storage, llm)
    h = auth(cand)
    n = (await client.get("/v1/candidate/notifications", headers=h)).json()
    assert n["unread"] == 1
    [item] = n["items"]
    assert (item["type"], item["stage"], item["application_id"], item["read"]) == ("stage_invited", "quiz", app_id, False)
    assert item["job_title"] == "Backend Engineer"

    other = new_uid(migrated_db)
    await make_candidate(client, other)
    r = await client.post(f"/v1/candidate/notifications/{item['id']}/read", headers=auth(other))
    assert r.status_code == 404  # never someone else's
    assert (await client.get("/v1/candidate/notifications", headers=auth(other))).json() == {"items": [], "unread": 0}

    assert (await client.post(f"/v1/candidate/notifications/{item['id']}/read", headers=h)).json()["read"] is True
    assert (await client.post("/v1/candidate/notifications/read-all", headers=h)).json()["unread"] == 0


async def test_released_feedback_shows_the_candidates_own_evidence(client, migrated_db, storage, llm):  # noqa: F811
    job, cand, app_id = await finalist(client, migrated_db, storage, llm)
    m = auth(job["manager"])
    await client.post(f"/v1/manager/campaigns/{job['campaign_id']}/complete", headers=m,
                      json={"confirm_title": "Portal Engineer"})
    fb = (await client.get(f"/v1/candidate/applications/{app_id}/feedback", headers=auth(cand))).json()
    cites = fb["resume_citations"]
    assert [c["criterion"] for c in cites] == ["Python", "PostgreSQL"]
    for c in cites:  # each quote sits on the line it cites, in the candidate's redacted resume
        assert c["quote"].lower()[:20] in fb["resume_lines"][c["line_no"] - 1].lower()
    assert "score" not in str(cites) and "rationale" not in str(fb)
    assert fb["quiz_answers"] == [] and fb["interview_moments"] == []


async def test_export_respects_release_and_is_recorded(client, migrated_db, storage, llm):  # noqa: F811
    job, cand, app_id = await finalist(client, migrated_db, storage, llm)
    h = auth(cand)
    r = await client.post("/v1/candidate/privacy/export", headers=h)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    [a] = data["applications"]
    assert a["id"] == app_id and a["outcome_released"] is False
    assert "stage_results" not in a and "feedback" not in a  # not released yet
    assert a["resume_download_url"].endswith(a["resume_download_url"].split("/v1/dev/storage/")[1])
    assert a["resume_text_as_processed"] and a["consents"][0]["text_version"]
    assert data["account"]["display_name"] and "email" in data["account"]

    await client.post(f"/v1/manager/campaigns/{job['campaign_id']}/complete", headers=auth(job["manager"]),
                      json={"confirm_title": "Portal Engineer"})
    [a] = (await client.post("/v1/candidate/privacy/export", headers=h)).json()["applications"]
    assert {r["node_id"]: r["status"] for r in a["stage_results"]}["screen"] == "passed"
    assert a["feedback"]["text"] is None  # no draft was written; the reader gets the neutral message
    with admin(migrated_db) as conn:
        kinds = conn.execute("select kind, status from data_requests where user_id = %s", (cand,)).fetchall()
    assert [(k["kind"], k["status"]) for k in kinds] == [("export", "done"), ("export", "done")]


async def test_delete_account_removes_everything(client, migrated_db, storage, llm, monkeypatch):  # noqa: F811
    fake = FakeInngest()
    monkeypatch.setattr(privacy, "dispatcher", InngestDispatcher(fake))  # type: ignore[arg-type]
    job, cand, app_id = await finalist(client, migrated_db, storage, llm)
    h = auth(cand)
    with admin(migrated_db) as conn:
        path = conn.execute("select resume_path from applications where id = %s", (app_id,)).fetchone()["resume_path"]
        conn.execute("insert into events (actor_id, type, entity) values (%s, 'x', 'profile')", (cand,))
    assert path in storage.objects

    r = await client.post("/v1/candidate/privacy/delete", headers=h, json={"confirm": "delete me"})
    assert r.json()["error"]["code"] == "confirm_mismatch"
    r = await client.post("/v1/candidate/privacy/delete", headers=h, json={"confirm": "DELETE"})
    assert r.status_code == 202
    again = await client.post("/v1/candidate/privacy/delete", headers=h, json={"confirm": "DELETE"})
    assert again.json()["request_id"] == r.json()["request_id"]  # one request at a time
    [ev] = [e for e in fake.sent if e.name == "privacy/delete.requested"]
    assert set(ev.data) == {"job_run_id"}  # the user id travels in the run's params, not the event

    assert await privacy.delete_account(str(ev.data["job_run_id"])) == "deleted"
    assert await privacy.delete_account(str(ev.data["job_run_id"])) == "deleted"  # a retried step is harmless
    with admin(migrated_db) as conn:
        left = {t: conn.execute(f"select count(*) n from {t} where {c} = %s", (v,)).fetchone()["n"] for t, c, v in [
            ("profiles", "id", cand), ("applications", "id", app_id), ("resume_texts", "application_id", app_id),
            ("stage_results", "application_id", app_id), ("consents", "application_id", app_id),
            ("embeddings", "parent_id", app_id), ("events", "actor_id", cand), ("data_requests", "user_id", cand)]}
    assert set(left.values()) == {0}, left
    assert path not in storage.objects


async def test_inline_dispatcher_runs_a_job_after_commit(client, migrated_db, storage, llm, monkeypatch):  # noqa: F811
    job, cand, app_id = await finalist(client, migrated_db, storage, llm)
    with admin(migrated_db) as conn:
        conn.execute("delete from job_runs where application_id = %s and type = 'report_draft'", (app_id,))
    inline = InlineDispatcher()
    llm.on("report_draft", DRAFT)
    async with transaction({"role": "system"}) as tx:
        await inline.enqueue(tx, "report_draft", JobRefs(application_id=app_id, campaign_id=job["campaign_id"],
                                                          job_id=job["job_id"]))
        assert not inline._tasks  # nothing runs before commit
    await asyncio.gather(*inline._tasks)
    with admin(migrated_db) as conn:
        fb = conn.execute("select ai_draft from feedback where application_id = %s", (app_id,)).fetchone()
        run = conn.execute("select status from job_runs where application_id = %s and type = 'report_draft'",
                           (app_id,)).fetchone()
    assert fb["ai_draft"].startswith("Thank you") and run["status"] == "done"
    # Deadline jobs are recorded but never run inline.
    async with transaction({"role": "system"}) as tx:
        await inline.enqueue(tx, "quiz_deadline", JobRefs(application_id=app_id))
    assert not inline._tasks


async def test_dev_storage_round_trip(client, storage):  # noqa: F811
    up = await storage.signed_upload("u1/r.pdf")
    assert up.url.startswith("http://") and "/v1/dev/storage/u1/r.pdf" in up.url
    path = up.url.split("/v1/dev/storage/")[1].split("?")[0]
    r = await client.put(f"/v1/dev/storage/{path}?token=memory", content=b"%PDF-1.4 x",
                         headers={"content-type": "application/pdf"})
    assert r.status_code == 200
    assert (await client.get(f"/v1/dev/storage/{path}")).content == b"%PDF-1.4 x"



