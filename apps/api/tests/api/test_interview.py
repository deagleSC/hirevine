"""AI interview end to end (backend plan §15): start, streamed turns with saved answers, resume, the
turn cap, the deadline, the budget pause, and scoring with verified turn citations."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

import pytest
from psycopg.types.json import Jsonb

from app.agents import common
from app.domain.workflow import (
    FinalConfig,
    FinalNode,
    InterviewConfig,
    InterviewNode,
    RubricItem,
    ScreeningConfig,
    ScreeningNode,
    chain,
)
from app.jobs.dispatcher import InngestDispatcher
from app.llm.errors import BudgetExhausted, NeedsReview, RateLimited
from app.services import applications as app_svc
from app.services import interview as svc
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

RUBRIC = [RubricItem(id="r1", name="System design", weight=3), RubricItem(id="r2", name="Testing", weight=1)]


def workflow(turn_cap=3, rubric=RUBRIC):
    return chain([
        ScreeningNode(type="screening", id="screen", config=ScreeningConfig(cutoff=60, criteria=CRITERIA)),
        InterviewNode(type="interview", id="iv", config=InterviewConfig(
            themes=["APIs", "Testing"], turn_cap=turn_cap, rubric=list(rubric), pass_threshold=60,
            prompt_additions="Focus on backend work.")),
        FinalNode(type="final", id="final", config=FinalConfig()),
    ])


class FakeStream:
    """Stands in for `stream_text`: each call yields the next queued question in chunks, or raises."""

    def __init__(self) -> None:
        self.queue: dict[str, list[Any]] = defaultdict(list)
        self.calls: list[Any] = []

    def on(self, *outputs: str | Exception) -> FakeStream:
        self.queue["interview_next"].extend(outputs)
        return self

    def __call__(self, role: str, prompt_id: str, input: Any, **_: Any):
        self.calls.append(input)
        out = self.queue[prompt_id].pop(0) if self.queue[prompt_id] else AssertionError("Unexpected question")

        async def gen():
            if isinstance(out, Exception):
                raise out
            for i in range(0, len(out), 7):
                yield out[i:i + 7]
        return gen()


@pytest.fixture
def stream(monkeypatch) -> FakeStream:
    fake = FakeStream()
    monkeypatch.setattr(common, "stream_text", fake)
    return fake


@pytest.fixture
def inngest(monkeypatch) -> FakeInngest:
    fake = FakeInngest()
    d = InngestDispatcher(fake)  # type: ignore[arg-type]
    monkeypatch.setattr(app_svc, "dispatcher", d)
    monkeypatch.setattr(svc, "dispatcher", d)
    return fake


async def at_interview(client, db, storage, llm, wf=None):  # noqa: F811
    job = await published_job(client, db)
    with admin(db) as conn:
        conn.execute("update workflows set definition = %s where job_id = %s",
                     (Jsonb((wf or workflow()).model_dump(mode="json")), job["job_id"]))
    cand, app_id = await apply_with(client, db, storage, job["job_id"], pdf_bytes())
    llm.on("screening_score", GOOD)
    assert await run_pipeline(app_id) == "passed"
    return job, cand, app_id


def base(app_id: str) -> str:
    return f"/v1/candidate/applications/{app_id}/interview"


async def turn(client, app_id, h, n, message=None) -> tuple[str, list[dict[str, Any]]]:  # noqa: F811
    """POST a turn; returns (streamed text, all SSE payloads). Non-200 responses come back as one 'http' item."""
    r = await client.post(f"{base(app_id)}/turn", headers=h, json={"turn": n, "message": message})
    if r.status_code != 200:
        return "", [{"type": "http", "status": r.status_code, **r.json()}]
    assert r.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    assert events[-1]["type"] == "done"
    return "".join(e["text"] for e in events if e["type"] == "token"), events


async def test_interview_streams_saves_resumes_and_finishes_at_the_cap(
        client, migrated_db, storage, inngest, llm, stream):  # noqa: F811
    job, cand, app_id = await at_interview(client, migrated_db, storage, llm)
    h = auth(cand)

    s = (await client.get(base(app_id), headers=h)).json()
    assert s["status"] == "not_started" and s["turn_cap"] == 3 and s["time_limit_min"] == 15
    assert "conducted by an AI" in s["disclosure"] and s["evaluates"] == ["System design", "Testing"]
    t = (await client.get(f"/v1/candidate/applications/{app_id}", headers=h)).json()
    assert t["next_action"] == "interview" and t["action_deadline_at"] is None

    started = (await client.post(f"{base(app_id)}/start", headers=h)).json()
    assert started["status"] == "in_progress" and started["awaiting"] == "question" and started["transcript"] == []
    [ev] = [e for e in inngest.sent if e.name == "interview/started"]
    assert_ids_only(dict(ev.data))
    assert (await client.post(f"{base(app_id)}/start", headers=h)).json()["deadline_at"] == started["deadline_at"]

    stream.on("Tell me about an API you designed.", "How did you test it?", "What would you change?")
    text, events = await turn(client, app_id, h, 0)
    assert text == "Tell me about an API you designed."
    state = events[-1]["state"]
    assert state["awaiting"] == "answer" and state["questions_asked"] == 1
    # The wrapper got the role, themes and the manager's additions; the first call has no transcript.
    first = stream.calls[0]
    assert first.question_number == 1 and first.themes == ["APIs", "Testing"]
    assert first.prompt_additions == "Focus on backend work." and first.transcript == []

    # Asking again while a question is open streams nothing new (a reconnect is safe).
    text, events = await turn(client, app_id, h, 0)
    assert text == "" and events[-1]["state"]["questions_asked"] == 1

    text, events = await turn(client, app_id, h, 0, "I designed a REST API in FastAPI.")
    assert text == "How did you test it?"
    # A stale or duplicate send is refused; the answer was saved once.
    _, [err] = await turn(client, app_id, h, 0, "I designed a REST API in FastAPI.")
    assert err["status"] == 409 and err["error"]["code"] == "stale_turn"

    # Resume: a reload gets the transcript, the answers given and the same deadline.
    r = (await client.get(base(app_id), headers=h)).json()
    assert [e["role"] for e in r["transcript"]] == ["interviewer", "candidate", "interviewer"]
    assert r["answers_given"] == 1 and r["awaiting"] == "answer" and r["deadline_at"] == started["deadline_at"]
    t = (await client.get(f"/v1/candidate/applications/{app_id}", headers=h)).json()
    assert t["action_deadline_at"] is not None

    await turn(client, app_id, h, 1, "Pytest against a real Postgres.")
    assert stream.calls[-1].transcript[-1].content == "Pytest against a real Postgres."
    # The third answer reaches the cap: a fixed closing line, no model call, and scoring is queued.
    calls = len(stream.calls)
    text, events = await turn(client, app_id, h, 2, "I would add rate limiting.")
    assert "last question" in text and len(stream.calls) == calls
    assert events[-1]["state"]["status"] == "finished" and events[-1]["state"]["transcript"] == []
    [fin] = [e for e in inngest.sent if e.name == "interview/finished"]
    assert_ids_only(dict(fin.data))
    t = (await client.get(f"/v1/candidate/applications/{app_id}", headers=h)).json()
    assert t["status"] == "in_review" and t["next_action"] is None

    _, [err] = await turn(client, app_id, h, 3, "One more thing")
    assert err["error"]["code"] == "interview_finished"

    # Scoring: citations to interviewer turns are dropped; the score is the weighted rubric.
    with admin(migrated_db) as conn:
        run = conn.execute("select id from job_runs where application_id = %s and type = 'interview_score'",
                           (app_id,)).fetchone()["id"]
    llm.on("interview_score", {"items": [
        {"item_id": "r1", "score": 3, "rationale": "Clear REST design.", "answers": [1, 9]},
        {"item_id": "r2", "score": 4, "rationale": "Tests against Postgres.", "answers": [4]},  # no 4th answer
    ]})
    assert await svc.score_and_transition(str(run), 10**12) == "failed"  # (3*3 + 0) / 16 = 56.2 < 60
    d = (await client.get(f"/v1/manager/campaigns/{job['campaign_id']}/applications/{app_id}",
                          headers=auth(job["manager"]))).json()
    stage = next(s for s in d["stages"] if s["node_id"] == "iv")
    assert stage["status"] == "failed" and stage["score"] == 56.2 and stage["flags"] == ["no_evidence"]
    assert [(e["item_id"], e["score"], e["turns"]) for e in stage["evidence"]] == [("r1", 3, [2]), ("r2", 0, [])]
    assert stage["prompt_version"] == "interview_score@3"
    assert [(e["n"], e["role"]) for e in d["interview"]["transcript"]][:2] == [(1, "interviewer"), (2, "candidate")]
    assert d["interview"]["answers_given"] == 3 and d["interview"]["finished_at"] is not None
    # Scoring twice is a no-op.
    assert await svc.score_and_transition(str(run), 10**12) == "skipped"


async def test_candidate_can_finish_early_and_passing_moves_on(
        client, migrated_db, storage, inngest, llm, stream):  # noqa: F811
    job, cand, app_id = await at_interview(client, migrated_db, storage, llm)
    h = auth(cand)
    await client.post(f"{base(app_id)}/start", headers=h)
    stream.on("Q1?")
    await turn(client, app_id, h, 0)
    stream.on("Q2?")
    await turn(client, app_id, h, 0, "A thorough answer.")
    done = (await client.post(f"{base(app_id)}/finish", headers=h)).json()
    assert done["status"] == "finished"
    assert (await client.post(f"{base(app_id)}/finish", headers=h)).json()["status"] == "finished"
    assert len([e for e in inngest.sent if e.name == "interview/finished"]) == 1
    with admin(migrated_db) as conn:
        run = conn.execute("select id from job_runs where application_id = %s and type = 'interview_score'",
                           (app_id,)).fetchone()["id"]
    llm.on("interview_score", {"items": [{"item_id": "r1", "score": 4, "rationale": "Great.", "answers": ["A1"]},
                                         {"item_id": "r2", "score": 2, "rationale": "Ok.", "answers": [1]}]})
    assert await svc.score_and_transition(str(run), 10**12) == "passed"
    with admin(migrated_db) as conn:
        a = conn.execute("select current_node from applications where id = %s", (app_id,)).fetchone()
    assert a["current_node"] == "final"


async def test_model_failures_keep_the_answer_and_budget_pauses_the_clock(
        client, migrated_db, storage, inngest, llm, stream):  # noqa: F811
    job, cand, app_id = await at_interview(client, migrated_db, storage, llm)
    h = auth(cand)
    await client.post(f"{base(app_id)}/start", headers=h)
    stream.on("Q1?")
    await turn(client, app_id, h, 0)

    stream.on(RateLimited("busy", retry_after=12))
    text, events = await turn(client, app_id, h, 0, "My answer.")
    [err] = [e for e in events if e["type"] == "error"]
    assert err["code"] == "model_busy" and err["retry_after"] == 12
    assert events[-1]["state"]["answers_given"] == 1 and events[-1]["state"]["awaiting"] == "question"

    stream.on(BudgetExhausted("cap"))
    _, events = await turn(client, app_id, h, 1)
    assert [e["code"] for e in events if e["type"] == "error"] == ["daily_ai_limit"]
    assert events[-1]["state"]["paused"] is True
    t = (await client.get(f"/v1/candidate/applications/{app_id}", headers=h)).json()
    assert t["next_action"] == "interview" and t["action_deadline_at"] is None  # no ticking clock while paused

    # While paused, the deadline check waits for the pause limit, even past the original deadline.
    with admin(migrated_db) as conn:
        conn.execute("update interview_sessions set deadline_at = now() - interval '5 minutes',"
                     " paused_at = now() - interval '10 minutes' where application_id = %s", (app_id,))
    assert await svc.finish_if_open(app_id) == "not_due"
    # The next question un-pauses and gives back the paused time (10 min → 5 min left).
    stream.on("Q2?")
    text, events = await turn(client, app_id, h, 1)
    assert text == "Q2?" and events[-1]["state"]["paused"] is False
    with admin(migrated_db) as conn:
        left = conn.execute("select extract(epoch from deadline_at - now()) as s from interview_sessions"
                            " where application_id = %s", (app_id,)).fetchone()["s"]
    assert 280 < float(left) <= 300


async def test_deadline_finishes_an_open_interview(client, migrated_db, storage, inngest, llm, stream):  # noqa: F811
    job, cand, app_id = await at_interview(client, migrated_db, storage, llm)
    h = auth(cand)
    await client.post(f"{base(app_id)}/start", headers=h)
    assert await svc.finish_if_open(app_id) == "not_due" and await svc.deadline_of(app_id) is not None
    with admin(migrated_db) as conn:
        conn.execute("update interview_sessions set deadline_at = now() - interval '1 minute'"
                     " where application_id = %s", (app_id,))
    _, [err] = await turn(client, app_id, h, 0)
    assert err["error"]["code"] == "interview_closed"
    assert await svc.finish_if_open(app_id) == "finished"
    assert await svc.finish_if_open(app_id) == "already_finished" and await svc.deadline_of(app_id) is None
    # Nothing was answered: scored 0 without a model call, flagged, and marked as finished by the clock.
    with admin(migrated_db) as conn:
        run = conn.execute("select id from job_runs where application_id = %s and type = 'interview_score'",
                           (app_id,)).fetchone()["id"]
    assert await svc.score_and_transition(str(run), 10**12) == "failed"
    with admin(migrated_db) as conn:
        s = conn.execute("select score, flags from stage_results where application_id = %s and node_id = 'iv'",
                         (app_id,)).fetchone()
    assert float(s["score"]) == 0.0 and s["flags"] == ["no_answers", "auto_finished"]


async def test_scoring_failure_goes_to_review(client, migrated_db, storage, inngest, llm, stream):  # noqa: F811
    job, cand, app_id = await at_interview(client, migrated_db, storage, llm)
    h = auth(cand)
    await client.post(f"{base(app_id)}/start", headers=h)
    stream.on("Q1?")
    await turn(client, app_id, h, 0)
    stream.on("Q2?")
    await turn(client, app_id, h, 0, "Answer.")
    await client.post(f"{base(app_id)}/finish", headers=h)
    with admin(migrated_db) as conn:
        run = conn.execute("select id from job_runs where application_id = %s and type = 'interview_score'",
                           (app_id,)).fetchone()["id"]
    llm.on("interview_score", NeedsReview("interview_score", "bad"))
    with pytest.raises(NeedsReview):
        await svc.score_and_transition(str(run), 10**12)
    await svc.mark_model_failed(app_id)
    with admin(migrated_db) as conn:
        s = conn.execute("select status, flags from stage_results where application_id = %s and node_id = 'iv'",
                         (app_id,)).fetchone()
    assert s["status"] == "needs_review" and s["flags"] == ["model_failed"]


async def test_interview_is_only_for_the_owner_at_that_stage(
        client, migrated_db, storage, inngest, llm, stream):  # noqa: F811
    job, cand, app_id = await at_interview(client, migrated_db, storage, llm)
    other = new_uid(migrated_db)
    await make_candidate(client, other)
    for method, path in (("GET", base(app_id)), ("POST", f"{base(app_id)}/start")):
        assert (await client.request(method, path, headers=auth(other))).status_code == 404
    assert (await client.post(f"{base(app_id)}/start", headers=auth(job["manager"]))).json()["error"]["code"] \
        == "wrong_app"
    _, [err] = await turn(client, app_id, auth(cand), 0)
    assert err["error"]["code"] == "interview_not_started"

    # A workflow whose interview has no rubric cannot be started (and cannot be published).
    job2, cand2, app2 = await at_interview(client, migrated_db, storage, llm, workflow(rubric=[]))
    r = await client.post(f"{base(app2)}/start", headers=auth(cand2))
    assert r.json()["error"]["code"] == "interview_not_ready"
