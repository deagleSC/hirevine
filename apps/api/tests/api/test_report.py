"""Final report and completion (backend plan §16): drafts for finalists and for candidates who failed,
the ranked list, feedback edits, manual scores, the complete transaction, release and notifications."""

from __future__ import annotations

import pytest
from psycopg.types.json import Jsonb

from app.domain import report as rules
from app.domain.workflow import FinalConfig, FinalNode, ScreeningConfig, ScreeningNode, chain
from app.jobs.dispatcher import InngestDispatcher
from app.services import applications as app_svc
from app.services import report as svc
from tests.api.test_applications import (  # noqa: F401
    CRITERIA,
    GOOD,
    apply_with,
    llm,
    new_uid,
    published_job,
    run_pipeline,
    storage,
)
from tests.api.test_auth_and_profile import auth, client, make_candidate  # noqa: F401
from tests.conftest import admin
from tests.jobs.test_dispatcher import FakeInngest, assert_ids_only
from tests.resumes import pdf_bytes

WEAK = {"scores": [{"criterion_id": c.id, "score": 0, "rationale": "Not shown.", "quote": ""} for c in CRITERIA]}
WF = chain([ScreeningNode(type="screening", id="screen", config=ScreeningConfig(cutoff=60, criteria=CRITERIA)),
            FinalNode(type="final", id="final", config=FinalConfig())])
DRAFT = {"cites": ["screening:py", "screening:nope", "screening:py"],
         "feedback": "Thank you for applying. Your Python service work stood out, and your PostgreSQL tuning "
                     "showed real depth. To grow further, add container orchestration experience.",
         "recommendation": "yes"}


async def campaign_with_two(client, db, storage, llm):  # noqa: F811
    """One candidate passes screening (finalist), one fails it."""
    job = await published_job(client, db, title="Platform Engineer")
    with admin(db) as conn:
        conn.execute("update workflows set definition = %s where job_id = %s",
                     (Jsonb(WF.model_dump(mode="json")), job["job_id"]))
    good, good_app = await apply_with(client, db, storage, job["job_id"], pdf_bytes())
    llm.on("screening_score", GOOD)
    assert await run_pipeline(good_app) == "passed"
    weak, weak_app = await apply_with(client, db, storage, job["job_id"], pdf_bytes())
    llm.on("screening_score", WEAK)
    assert await run_pipeline(weak_app) == "failed"
    return job, (good, good_app), (weak, weak_app)


@pytest.fixture(autouse=True)
def quiet_apply(monkeypatch):
    monkeypatch.setattr(app_svc, "dispatcher", InngestDispatcher(FakeInngest()))  # type: ignore[arg-type]


def draft_run(db, app_id) -> str:
    with admin(db) as conn:
        return str(conn.execute("select id from job_runs where application_id = %s and type = 'report_draft'",
                                (app_id,)).fetchone()["id"])


async def test_report_draft_edit_complete_and_release(client, migrated_db, storage, llm, report_events):  # noqa: F811
    job, (good, good_app), (weak, weak_app) = await campaign_with_two(client, migrated_db, storage, llm)
    base, m = f"/v1/manager/campaigns/{job['campaign_id']}", auth(job["manager"])

    # Reaching final and failing both queue a draft (ids only in the events).
    sent = [e for e in report_events.sent if e.name == "report/draft.requested"]
    assert sorted(e.data["application_id"] for e in sent) == sorted([good_app, weak_app])
    for e in sent:
        assert_ids_only(dict(e.data))

    # The finalist's draft: invalid and repeated citations are dropped; the manager's text is never touched.
    llm.on("report_draft", DRAFT)
    assert await svc.draft_and_save(draft_run(migrated_db, good_app), 10**12) == "done"
    inp = llm.inputs("report_draft")[0]
    assert [e.ref for e in inp.evidence][:2] == ["screening:py", "screening:pg"] and inp.reached_final
    assert "7 years building Python" in inp.evidence[0].quote  # quotes come from the redacted resume
    # The weak candidate's draft fails: release still gives them neutral feedback.

    rep = (await client.get(f"{base}/final", headers=m)).json()
    assert (rep["total"], rep["finalists"], rep["in_progress"]) == (2, 1, 0)
    first, second = rep["rows"]
    assert (first["application_id"], first["rank"], first["standing"]) == (good_app, 1, "final")
    assert first["suggested"] == "yes" and first["feedback_status"] == "draft" and first["overall"] == 72.5
    assert (second["application_id"], second["rank"], second["standing"]) == (weak_app, None, "failed")
    assert second["suggested"] == "no" and second["feedback_status"] == "drafting"

    # Exit check through the API: before release a candidate gets 404 for their own feedback.
    for cand, app_id in ((good, good_app), (weak, weak_app)):
        r = await client.get(f"/v1/candidate/applications/{app_id}/feedback", headers=auth(cand))
        assert r.status_code == 404 and r.json()["error"]["code"] == "feedback_not_available"

    # Manager edits (autosave sends partial updates).
    url = f"{base}/applications/{good_app}/feedback"
    r = (await client.patch(url, headers=m, json={"edited_text": "Great work on the Python services."})).json()
    assert r["edited_text"].startswith("Great work") and r["ai_draft"].startswith("Thank you")
    r = (await client.patch(url, headers=m, json={"recommendation": "strong_yes", "manager_note": "Call first."})).json()
    assert (r["recommendation"], r["manager_note"], r["edited_text"][:5]) == ("strong_yes", "Call first.", "Great")
    assert (await client.patch(url, headers=m, json={})).json()["error"]["code"] == "nothing_to_update"
    d = (await client.get(f"{base}/applications/{good_app}", headers=m)).json()
    assert d["feedback"]["recommendation"] == "strong_yes" and d["feedback"]["released"] is False
    assert (await client.get(f"{base}/final", headers=m)).json()["rows"][0]["feedback_status"] == "edited"
    # Another org's manager cannot touch it.
    other = await published_job(client, migrated_db)
    assert (await client.patch(url, headers=auth(other["manager"]), json={"excluded": True})).status_code == 404

    # Complete: the title must match; then everything is released in one go.
    r = await client.post(f"{base}/complete", headers=m, json={"confirm_title": "Wrong"})
    assert r.json()["error"]["code"] == "confirm_mismatch"
    r = (await client.post(f"{base}/complete", headers=m, json={"confirm_title": " platform engineer "})).json()
    assert r["released"] == 2 and r["notified"] is True
    [done] = [e for e in report_events.sent if e.name == "campaign/completed"]
    assert_ids_only(dict(done.data))
    assert (await client.post(f"{base}/complete", headers=m, json={"confirm_title": "Platform Engineer"})
            ).json()["error"]["code"] == "already_completed"
    assert (await client.patch(url, headers=m, json={"excluded": True})).json()["error"]["code"] == "campaign_completed"
    with admin(migrated_db) as conn:
        assert conn.execute("select status from jobs where id = %s", (job["job_id"],)).fetchone()["status"] == "closed"

    # Released: the edited text and the manager's recommendation decide what the finalist sees.
    fb = (await client.get(f"/v1/candidate/applications/{good_app}/feedback", headers=auth(good))).json()
    assert fb["outcome"] == "shortlisted" and fb["feedback"] == "Great work on the Python services."
    assert fb["stages"] == [{"node_type": "screening", "status": "passed", "score": 72.5}]
    assert "manager_note" not in fb and "Call first" not in str(fb)
    weak_fb = (await client.get(f"/v1/candidate/applications/{weak_app}/feedback", headers=auth(weak))).json()
    assert weak_fb["outcome"] == "not_selected"
    assert weak_fb["feedback"] == rules.neutral_feedback("Platform Engineer", "not_selected")
    assert (await client.get(f"/v1/candidate/applications/{good_app}/feedback", headers=auth(weak))).status_code == 404
    t = (await client.get(f"/v1/candidate/applications/{good_app}", headers=auth(good))).json()
    assert t["status"] == "outcome_released"

    # A draft finishing after release never changes the released text.
    llm.on("report_draft", DRAFT)
    assert await svc.draft_and_save(draft_run(migrated_db, weak_app), 10**12) == "skipped"

    # notify-release: one notification per candidate, and a retried batch adds nothing.
    targets = await svc.release_targets(str(job["campaign_id"]))
    assert sorted(targets) == sorted([good_app, weak_app])
    assert await svc.notify_batch(str(job["campaign_id"]), targets) == 2
    assert await svc.notify_batch(str(job["campaign_id"]), targets) == 0
    with admin(migrated_db) as conn:
        n = conn.execute("select payload from notifications where user_id = %s", (good,)).fetchone()["payload"]
    assert n == {"application_id": good_app, "campaign_id": str(job["campaign_id"]), "job_title": "Platform Engineer"}


async def test_manual_score_moves_a_reviewed_stage_on(client, migrated_db, storage, llm, report_events):  # noqa: F811
    job, (good, good_app), _ = await campaign_with_two(client, migrated_db, storage, llm)
    base, m = f"/v1/manager/campaigns/{job['campaign_id']}", auth(job["manager"])
    cand, app_id = await apply_with(client, migrated_db, storage, job["job_id"], pdf_bytes())
    with admin(migrated_db) as conn:
        conn.execute("insert into stage_results (application_id, node_id, status, flags) values"
                     " (%s, 'screen', 'needs_review', '{model_failed}')"
                     " on conflict (application_id, node_id) do update set status = 'needs_review',"
                     " flags = '{model_failed}'", (app_id,))
    url = f"{base}/applications/{app_id}/manual-score"
    r = await client.post(url, headers=m, json={"node_id": "final", "score": 80, "note": "x"})
    assert r.json()["error"]["code"] == "invalid_stage"
    r = await client.post(url, headers=m, json={"node_id": "screen", "score": 72, "note": "Strong Python on review."})
    assert r.json() == {"node_id": "screen", "node_type": "screening", "status": "passed", "score": 72.0}
    with admin(migrated_db) as conn:
        s = conn.execute("select status, score, flags, manual_note, scored_by from stage_results"
                         " where application_id = %s and node_id = 'screen'", (app_id,)).fetchone()
        a = conn.execute("select current_node from applications where id = %s", (app_id,)).fetchone()
    assert (s["status"], float(s["score"]), a["current_node"]) == ("passed", 72.0, "final")
    assert "manual_score" in s["flags"] and s["manual_note"] == "Strong Python on review."
    assert str(s["scored_by"]) == str(job["manager"])
    assert any(e.data["application_id"] == app_id for e in report_events.sent if e.name == "report/draft.requested")
    # Only a stage that needs review can be scored by hand.
    r = await client.post(url, headers=m, json={"node_id": "screen", "score": 10, "note": "Again"})
    assert r.json()["error"]["code"] == "not_reviewable"


def test_ranking_rules():
    s = lambda t, st, sc: rules.StageScore(node_id=t, node_type=t, status=st, score=sc)  # noqa: E731
    a = [s("screening", "passed", 80), s("quiz", "passed", 90), s("interview", "passed", 70)]
    assert rules.overall(a) == 80.0 and rules.rule_recommendation(a) == "yes"
    assert rules.rule_recommendation([*a[:2], s("interview", "failed", 40)]) == "no"
    assert rules.overall([s("screening", "passed", 70), s("quiz", "in_progress", None)]) == 70.0
    assert rules.candidate_outcome(reached_final=True, excluded=False, recommendation="yes") == "shortlisted"
    assert rules.candidate_outcome(reached_final=True, excluded=True, recommendation="strong_yes") == "not_selected"
    assert rules.candidate_outcome(reached_final=True, excluded=False, recommendation="maybe") == "not_selected"
    assert rules.valid_citations(["a", "x", "a", " b "], {"a", "b"}) == ["a", "b"]
    assert rules.strip_refs("Strong Python work [screening:c1]. Good tests (quiz:q2, interview:r1), well done.") \
        == "Strong Python work. Good tests, well done."
