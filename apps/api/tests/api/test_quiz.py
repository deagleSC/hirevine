"""Quiz end to end (backend plan §14): generation as patches, then one timed attempt per application
with autosave, resume, grading exactly against the key, and the deadline auto-submit."""

from __future__ import annotations

import pytest
from psycopg.types.json import Jsonb

from app.domain.workflow import (
    FinalConfig,
    FinalNode,
    QuizConfig,
    QuizNode,
    QuizQuestion,
    ScreeningConfig,
    ScreeningNode,
    chain,
)
from app.jobs.dispatcher import InngestDispatcher
from app.llm.errors import NeedsReview
from app.services import applications as app_svc
from app.services import quiz as svc
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

QUESTIONS = [QuizQuestion(id=f"q{i}", prompt=f"Question {i}?", options=["a", "b", "c", "d"], answer_index=i % 4,
                          explanation=f"Because {i}.") for i in range(5)]


def workflow(questions=QUESTIONS, pass_mark=60):
    return chain([
        ScreeningNode(type="screening", id="screen", config=ScreeningConfig(cutoff=60, criteria=CRITERIA)),
        QuizNode(type="quiz", id="quiz", config=QuizConfig(pass_mark=pass_mark, time_limit_min=15,
                                                          questions=list(questions))),
        FinalNode(type="final", id="final", config=FinalConfig()),
    ])


@pytest.fixture
def inngest(monkeypatch) -> FakeInngest:
    fake = FakeInngest()
    d = InngestDispatcher(fake)  # type: ignore[arg-type]
    monkeypatch.setattr(app_svc, "dispatcher", d)
    monkeypatch.setattr(svc, "dispatcher", d)
    return fake


def set_workflow(db, job, wf):
    with admin(db) as conn:
        conn.execute("update workflows set definition = %s where job_id = %s",
                     (Jsonb(wf.model_dump(mode="json")), job["job_id"]))


async def at_quiz(client, db, storage, llm, wf=None):  # noqa: F811
    """A candidate who has passed screening and is invited to the quiz."""
    job = await published_job(client, db)
    set_workflow(db, job, wf or workflow())
    cand, app_id = await apply_with(client, db, storage, job["job_id"], pdf_bytes())
    llm.on("screening_score", GOOD)
    assert await run_pipeline(app_id) == "passed"
    return job, cand, app_id


def base(app_id: str) -> str:
    return f"/v1/candidate/applications/{app_id}/quiz"


# ------------------------------------------------------------------ attempts


async def test_start_resume_autosave_and_submit_grade_exactly(
        client, migrated_db, storage, inngest, llm):  # noqa: F811
    job, cand, app_id = await at_quiz(client, migrated_db, storage, llm)
    h = auth(cand)

    s = (await client.get(base(app_id), headers=h)).json()
    assert s["status"] == "not_started" and s["question_count"] == 5 and s["questions"] == []

    started = (await client.post(f"{base(app_id)}/start", headers=h)).json()
    assert started["status"] == "in_progress" and len(started["questions"]) == 5
    assert all(set(q) == {"id", "prompt", "options"} for q in started["questions"])  # no answer key
    assert "answer_index" not in str(started) and "Because" not in str(started)
    [event] = [e for e in inngest.sent if e.name == "quiz/started"]
    assert event.data["application_id"] == app_id
    assert_ids_only(dict(event.data))

    # Autosave merges; invalid answers are rejected whole.
    r = await client.put(f"{base(app_id)}/answers", headers=h, json={"answers": {"q0": 0, "q1": 1}})
    assert r.status_code == 200 and r.json()["answers"] == {"q0": 0, "q1": 1}
    for bad in ({"q2": 7}, {"nope": 0}):
        r = await client.put(f"{base(app_id)}/answers", headers=h, json={"answers": bad})
        assert r.json()["error"]["code"] == "invalid_answer"
    await client.put(f"{base(app_id)}/answers", headers=h, json={"answers": {"q1": 3, "q2": 2}})

    # A resumed session (or a second start) gets the same snapshot, deadline and saved answers.
    again = (await client.post(f"{base(app_id)}/start", headers=h)).json()
    assert again["questions"] == started["questions"] and again["deadline_at"] == started["deadline_at"]
    assert again["answers"] == {"q0": 0, "q1": 3, "q2": 2}
    assert len([e for e in inngest.sent if e.name == "quiz/started"]) == 1

    # The tracker shows the action and its deadline, never a score.
    t = (await client.get(f"/v1/candidate/applications/{app_id}", headers=h)).json()
    assert t["next_action"] == "quiz" and t["action_deadline_at"] is not None

    done = (await client.post(f"{base(app_id)}/submit", headers=h)).json()
    assert done["status"] == "submitted" and done["questions"] == [] and "score" not in done
    # q0 and q2 are right; q1 is wrong; q3, q4 unanswered → 2/5 = 40 < 60.
    with admin(migrated_db) as conn:
        attempt = conn.execute("select score, submitted_at from quiz_attempts where application_id = %s",
                               (app_id,)).fetchone()
    assert float(attempt["score"]) == 40.0 and attempt["submitted_at"] is not None

    d = (await client.get(f"/v1/manager/campaigns/{job['campaign_id']}/applications/{app_id}",
                          headers=auth(job["manager"]))).json()
    stage = next(s for s in d["stages"] if s["node_id"] == "quiz")
    assert stage["status"] == "failed" and stage["score"] == 40.0 and stage["flags"] == []
    assert [e["correct"] for e in stage["evidence"]] == [True, False, True, False, False]
    assert stage["evidence"][1] == {**stage["evidence"][1], "chosen": 3, "answer_index": 1,
                                    "explanation": "Because 1."}
    assert d["quiz"]["answered"] == 3 and d["quiz"]["total"] == 5

    # Closed: no more saves or submits, and the tracker no longer asks for action.
    r = await client.put(f"{base(app_id)}/answers", headers=h, json={"answers": {"q3": 3}})
    assert r.json()["error"]["code"] == "quiz_submitted"
    assert (await client.post(f"{base(app_id)}/submit", headers=h)).json()["error"]["code"] == "quiz_submitted"
    t = (await client.get(f"/v1/candidate/applications/{app_id}", headers=h)).json()
    assert t["status"] == "in_review" and "score" not in str(t)


async def test_passing_moves_to_the_next_stage(client, migrated_db, storage, inngest, llm):  # noqa: F811
    job, cand, app_id = await at_quiz(client, migrated_db, storage, llm)
    h = auth(cand)
    await client.post(f"{base(app_id)}/start", headers=h)
    await client.put(f"{base(app_id)}/answers", headers=h,
                     json={"answers": {q.id: q.answer_index for q in QUESTIONS[:3]}})
    await client.post(f"{base(app_id)}/submit", headers=h)
    with admin(migrated_db) as conn:
        a = conn.execute("select current_node from applications where id = %s", (app_id,)).fetchone()
        s = conn.execute("select status, score from stage_results where application_id = %s and node_id = 'quiz'",
                         (app_id,)).fetchone()
    assert a["current_node"] == "final" and s["status"] == "passed" and float(s["score"]) == 60.0


async def test_deadline_auto_submits_saved_answers_once(client, migrated_db, storage, inngest, llm):  # noqa: F811
    job, cand, app_id = await at_quiz(client, migrated_db, storage, llm)
    h = auth(cand)
    await client.post(f"{base(app_id)}/start", headers=h)
    await client.put(f"{base(app_id)}/answers", headers=h,
                     json={"answers": {q.id: q.answer_index for q in QUESTIONS}})
    assert await svc.auto_submit_if_open(app_id) == "not_due"
    assert await svc.deadline_of(app_id) is not None

    with admin(migrated_db) as conn:  # the deadline passes, but within the 30 s grace
        conn.execute("update quiz_attempts set deadline_at = now() - interval '10 seconds'"
                     " where application_id = %s", (app_id,))
    r = await client.put(f"{base(app_id)}/answers", headers=h, json={"answers": {"q0": 1}})
    assert r.status_code == 200  # grace: a save in flight at the deadline still lands
    assert await svc.auto_submit_if_open(app_id) == "not_due"

    with admin(migrated_db) as conn:
        conn.execute("update quiz_attempts set deadline_at = now() - interval '1 minute'"
                     " where application_id = %s", (app_id,))
    r = await client.put(f"{base(app_id)}/answers", headers=h, json={"answers": {"q0": 0}})
    assert r.json()["error"]["code"] == "quiz_closed"
    assert await svc.auto_submit_if_open(app_id) == "passed"  # 4/5 = 80
    assert await svc.auto_submit_if_open(app_id) == "already_submitted"
    assert await svc.deadline_of(app_id) is None
    with admin(migrated_db) as conn:
        s = conn.execute("select score, flags from stage_results where application_id = %s and node_id = 'quiz'",
                         (app_id,)).fetchone()
    assert float(s["score"]) == 80.0 and s["flags"] == ["auto_submitted"]
    assert (await client.get(base(app_id), headers=h)).json()["status"] == "submitted"


async def test_quiz_is_only_for_the_owner_at_the_quiz_stage(client, migrated_db, storage, inngest, llm):  # noqa: F811
    job, cand, app_id = await at_quiz(client, migrated_db, storage, llm)
    other = new_uid(migrated_db)
    await make_candidate(client, other)
    for method, path in (("GET", base(app_id)), ("POST", f"{base(app_id)}/start")):
        r = await client.request(method, path, headers=auth(other))
        assert r.status_code == 404, path
    r = await client.post(f"{base(app_id)}/start", headers=auth(job["manager"]))
    assert r.json()["error"]["code"] == "wrong_app"

    # Still at screening: the quiz is not open yet.
    job2 = await published_job(client, migrated_db)
    set_workflow(migrated_db, job2, workflow())
    cand2, app2 = await apply_with(client, migrated_db, storage, job2["job_id"], pdf_bytes())
    assert (await client.get(base(app2), headers=auth(cand2))).json()["status"] == "closed"
    r = await client.post(f"{base(app2)}/start", headers=auth(cand2))
    assert r.json()["error"]["code"] == "quiz_not_available"


async def test_a_quiz_without_questions_cannot_start(client, migrated_db, storage, inngest, llm):  # noqa: F811
    _, cand, app_id = await at_quiz(client, migrated_db, storage, llm, workflow(questions=[]))
    r = await client.post(f"{base(app_id)}/start", headers=auth(cand))
    assert r.json()["error"]["code"] == "quiz_not_ready"


# ------------------------------------------------------------------ generation


def generated(*prompts: str, answer: int = 1) -> dict:
    return {"questions": [{"prompt": p, "options": ["w", "x", "y", "z"], "answer_index": answer,
                           "explanation": "Why.", "difficulty": "medium"} for p in prompts]}


async def test_generation_adds_valid_questions_as_one_version(client, migrated_db, inngest, llm):  # noqa: F811
    job = await published_job(client, migrated_db)
    set_workflow(migrated_db, job, workflow(questions=QUESTIONS[:1]))
    h = auth(job["manager"])
    r = await client.post(f"/v1/manager/jobs/{job['job_id']}/quiz/generate", headers=h,
                          json={"count": 3, "difficulty": "hard"})
    assert r.status_code == 202, r.text
    run_id = r.json()["job_run_id"]
    [event] = inngest.sent
    assert event.name == "quiz/generate.requested"
    assert_ids_only(dict(event.data))
    busy = await client.post(f"/v1/manager/jobs/{job['job_id']}/quiz/generate", headers=h, json={})
    assert busy.json()["error"]["code"] == "already_processing"

    # First call: one duplicate of the existing question, one bad answer index, one good.
    bad = generated("Question 0", "Good one?")
    bad["questions"].append({"prompt": "Bad index", "options": ["a", "b", "c"], "answer_index": 3})
    llm.on("quiz_generate", bad, generated("Retry one?", "Retry two?", "Retry three?"))
    assert await svc.generate_and_patch(run_id, deadline=10**12) == "done"
    first, retry = llm.inputs("quiz_generate")
    assert first.count == 3 and first.difficulty == "hard" and first.skills[:2] == ["Python", "PostgreSQL"]
    assert retry.count == 2 and "Good one?" in retry.avoid and "Question 0?" in retry.avoid

    status = (await client.get(f"/v1/manager/jobs/{job['job_id']}/quiz/generate/{run_id}", headers=h)).json()
    assert status["status"] == "done" and status["added"] == 3 and status["version"] == 2
    wf = (await client.get(f"/v1/manager/jobs/{job['job_id']}/workflow", headers=h)).json()
    quiz_node = next(n for n in wf["definition"]["nodes"] if n["type"] == "quiz")
    assert [q["prompt"] for q in quiz_node["config"]["questions"]] == [
        "Question 0?", "Good one?", "Retry one?", "Retry two?"]
    with admin(migrated_db) as conn:
        sources = conn.execute("select payload->>'source' as s from events where type = 'workflow.patch_applied'"
                               " and entity_id = %s", (job["job_id"],)).fetchall()
    assert [r["s"] for r in sources] == ["agent"] * 3

    # A retried step after success changes nothing.
    assert await svc.generate_and_patch(run_id, deadline=10**12) == "skipped"


async def test_generation_can_replace_and_reports_failures(client, migrated_db, inngest, llm):  # noqa: F811
    job = await published_job(client, migrated_db)
    set_workflow(migrated_db, job, workflow())
    h = auth(job["manager"])
    full = await client.post(f"/v1/manager/jobs/{job['job_id']}/quiz/generate", headers=h, json={"count": 26})
    assert full.json()["error"]["code"] == "quiz_full"

    run = (await client.post(f"/v1/manager/jobs/{job['job_id']}/quiz/generate", headers=h,
                             json={"count": 2, "replace": True})).json()["job_run_id"]
    llm.on("quiz_generate", generated("New A?", "Question 1?"))  # replacing: old prompts may come back
    assert await svc.generate_and_patch(run, deadline=10**12) == "done"
    wf = (await client.get(f"/v1/manager/jobs/{job['job_id']}/workflow", headers=h)).json()
    quiz_node = next(n for n in wf["definition"]["nodes"] if n["type"] == "quiz")
    assert [q["prompt"] for q in quiz_node["config"]["questions"]] == ["New A?", "Question 1?"]

    run = (await client.post(f"/v1/manager/jobs/{job['job_id']}/quiz/generate", headers=h,
                             json={"count": 2})).json()["job_run_id"]
    llm.on("quiz_generate", generated("New A?"), generated("Question 1?"))  # only duplicates
    assert await svc.generate_and_patch(run, deadline=10**12) == "empty"
    status = (await client.get(f"/v1/manager/jobs/{job['job_id']}/quiz/generate/{run}", headers=h)).json()
    assert status["status"] == "failed" and "valid questions" in status["error"]

    run = (await client.post(f"/v1/manager/jobs/{job['job_id']}/quiz/generate", headers=h,
                             json={"count": 2})).json()["job_run_id"]
    llm.on("quiz_generate", NeedsReview("quiz_generate", "bad output twice"))
    with pytest.raises(NeedsReview):  # the function maps this to a failed run
        await svc.generate_and_patch(run, deadline=10**12)

    stranger = (await published_job(client, migrated_db))["manager"]
    r = await client.post(f"/v1/manager/jobs/{job['job_id']}/quiz/generate", headers=auth(stranger), json={})
    assert r.status_code == 404
