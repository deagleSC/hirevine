"""Job chat → confirm → publish, and the override agent, with a scripted model (backend plan §7.2, §12)."""

from __future__ import annotations

import uuid

import pytest

from app.agents import common
from app.llm.errors import BudgetExhausted, RateLimited
from tests.api.test_auth_and_profile import auth, client, make_candidate, make_manager  # noqa: F401
from tests.conftest import admin, create_auth_user
from tests.fake_llm import FakeLLM

PARTIAL = {"draft": {"title": "Backend Engineer", "must_have_skills": ["Python"]},
           "reply": "What seniority, and where is the role based?"}
FULL = {"draft": {"title": "Backend Engineer", "seniority": "senior", "location": "Remote",
                  "must_have_skills": ["Python", "PostgreSQL"], "include_quiz": True, "include_interview": True},
        "reply": "Great — a senior remote backend role. The pipeline is ready to review."}
RUBRIC = {
    "description": "Build and run our APIs.",
    "criteria": [{"name": "Python", "weight": 5, "must_have": True}, {"name": "PostgreSQL", "weight": 4, "must_have": True},
                 {"name": "Young and energetic", "weight": 1}],
    "interview_themes": ["API design", "Data modelling"],
    "interview_rubric": [{"name": "Depth", "weight": 3, "description": "Explains trade-offs"}],
    "protected_flags": [],
}


@pytest.fixture
def llm(monkeypatch) -> FakeLLM:
    fake = FakeLLM()
    monkeypatch.setattr(common, "call_structured", fake)
    return fake


@pytest.fixture
def new_user(migrated_db):
    return lambda: create_auth_user(migrated_db, f"{uuid.uuid4().hex[:8]}@jobs.test")


@pytest.fixture
async def mgr(client, new_user):  # noqa: F811
    uid = new_user()
    await make_manager(client, uid)
    return uid


async def chat_to_completion(client, uid, llm):  # noqa: F811
    llm.on("jd_turn", PARTIAL, FULL).on("jd_rubric", RUBRIC)
    r1 = (await client.post("/v1/manager/jobs/chat", json={"message": "Hiring a Python backend engineer"},
                            headers=auth(uid))).json()
    assert r1["complete"] is False and set(r1["missing"]) == {"seniority", "location"}
    assert r1["messages"][-1]["content"] == PARTIAL["reply"]
    r2 = (await client.post("/v1/manager/jobs/chat", json={"thread_id": r1["thread_id"], "message": "Senior, remote"},
                            headers=auth(uid))).json()
    return r1, r2


async def test_chat_collects_the_draft_then_proposes_a_workflow(client, mgr, llm):  # noqa: F811
    r1, r2 = await chat_to_completion(client, mgr, llm)
    assert r2["thread_id"] == r1["thread_id"] and r2["complete"] is True and r2["missing"] == []
    assert [m["role"] for m in r2["messages"]] == ["user", "assistant", "user", "assistant"]
    assert [n["type"] for n in r2["workflow"]["nodes"]] == ["screening", "quiz", "interview", "final"]
    crit = r2["workflow"]["nodes"][0]["config"]["criteria"]
    assert [c["name"] for c in crit] == ["Python", "PostgreSQL", "Young and energetic"]
    assert {(w["criterion"], w["characteristic"]) for w in r2["warnings"]} == {("Young and energetic", "age")}
    assert r2["summary"]["title"] == "Backend Engineer" and r2["summary"]["location"] == "Remote"
    # The second turn's model input carried the whole conversation and the first draft.
    second = llm.inputs("jd_turn")[1]
    assert [m.content for m in second.messages] == ["Hiring a Python backend engineer", PARTIAL["reply"], "Senior, remote"]
    assert second.draft.title == "Backend Engineer"


async def test_chat_state_reloads_and_confirm_creates_the_job(client, mgr, llm):  # noqa: F811
    _, r2 = await chat_to_completion(client, mgr, llm)
    tid = r2["thread_id"]
    again = (await client.get(f"/v1/manager/jobs/chat/{tid}", headers=auth(mgr))).json()
    assert again == r2

    created = (await client.post(f"/v1/manager/jobs/chat/{tid}/confirm", headers=auth(mgr))).json()
    job = (await client.get(f"/v1/manager/jobs/{created['job_id']}", headers=auth(mgr))).json()
    assert (job["title"], job["status"], job["workflow_version"], job["campaign"]) == ("Backend Engineer", "draft", 1, None)
    wf = (await client.get(f"/v1/manager/jobs/{job['id']}/workflow", headers=auth(mgr))).json()
    assert wf["definition"] == r2["workflow"]

    r = await client.post(f"/v1/manager/jobs/chat/{tid}/confirm", headers=auth(mgr))
    assert r.status_code == 409 and r.json()["error"]["code"] == "thread_closed"
    r = await client.post("/v1/manager/jobs/chat", json={"thread_id": tid, "message": "more"}, headers=auth(mgr))
    assert r.status_code == 409


async def test_confirm_before_complete_is_409(client, mgr, llm):  # noqa: F811
    llm.on("jd_turn", PARTIAL)
    r1 = (await client.post("/v1/manager/jobs/chat", json={"message": "hi"}, headers=auth(mgr))).json()
    r = await client.post(f"/v1/manager/jobs/chat/{r1['thread_id']}/confirm", headers=auth(mgr))
    assert r.status_code == 409 and r.json()["error"]["code"] == "chat_incomplete"


async def test_threads_are_private(client, mgr, llm, new_user):  # noqa: F811
    llm.on("jd_turn", PARTIAL)
    tid = (await client.post("/v1/manager/jobs/chat", json={"message": "hi"}, headers=auth(mgr))).json()["thread_id"]
    other = new_user()
    await make_manager(client, other, org="Snoop Org")
    assert (await client.get(f"/v1/manager/jobs/chat/{tid}", headers=auth(other))).status_code == 404
    r = await client.post("/v1/manager/jobs/chat", json={"thread_id": tid, "message": "x"}, headers=auth(other))
    assert r.status_code == 404
    assert (await client.post(f"/v1/manager/jobs/chat/{tid}/confirm", headers=auth(other))).status_code == 404


async def test_publish_list_and_edit(client, mgr, llm, migrated_db):  # noqa: F811
    _, r2 = await chat_to_completion(client, mgr, llm)
    job_id = (await client.post(f"/v1/manager/jobs/chat/{r2['thread_id']}/confirm", headers=auth(mgr))).json()["job_id"]

    upd = (await client.patch(f"/v1/manager/jobs/{job_id}", json={"location": "Pune"}, headers=auth(mgr))).json()
    assert upd["location"] == "Pune" and upd["title"] == "Backend Engineer"

    pub = (await client.post(f"/v1/manager/jobs/{job_id}/publish", headers=auth(mgr))).json()
    assert pub["workflow_version"] == 1 and pub["share_slug"].startswith("backend-engineer-")
    r = await client.post(f"/v1/manager/jobs/{job_id}/publish", headers=auth(mgr))
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_published"

    jobs = (await client.get("/v1/manager/jobs", headers=auth(mgr))).json()
    job = next(j for j in jobs if j["id"] == job_id)
    assert job["status"] == "published"
    assert job["campaign"] == {"id": pub["campaign_id"], "status": "open", "applicants": 0, "share_slug": pub["share_slug"]}
    with admin(migrated_db) as conn:
        c = conn.execute("select w.version from campaigns c join workflows w on w.id = c.workflow_id where c.id = %s",
                         (pub["campaign_id"],)).fetchone()
    assert c["version"] == 1


async def test_model_errors_become_clear_api_errors(client, mgr, llm):  # noqa: F811
    llm.on("jd_turn", RateLimited("busy", retry_after=12), BudgetExhausted("cap"))
    r = await client.post("/v1/manager/jobs/chat", json={"message": "hi"}, headers=auth(mgr))
    assert r.status_code == 429 and r.json()["error"] == {
        "code": "model_busy", "message": r.json()["error"]["message"], "details": {"retry_after": 12}}
    r = await client.post("/v1/manager/jobs/chat", json={"message": "hi"}, headers=auth(mgr))
    assert r.status_code == 429 and r.json()["error"]["code"] == "daily_ai_limit"


async def test_candidates_cannot_use_job_routes(client, new_user):  # noqa: F811
    cand = new_user()
    await make_candidate(client, cand)
    assert (await client.get("/v1/manager/jobs", headers=auth(cand))).json()["error"]["code"] == "wrong_app"


# ------------------------------------------------------------- override agent

async def make_job(client, mgr, llm):  # noqa: F811
    _, r2 = await chat_to_completion(client, mgr, llm)
    return (await client.post(f"/v1/manager/jobs/chat/{r2['thread_id']}/confirm", headers=auth(mgr))).json()["job_id"]


async def test_override_returns_validated_patches_and_retries_invalid_ones(client, mgr, llm):  # noqa: F811
    job_id = await make_job(client, mgr, llm)
    llm.on("override_patches",
           {"patches": [{"op": "set_cutoff", "node": "quiz", "value": 70}], "explanation": "wrong node"},
           {"patches": [{"op": "set_cutoff", "node": "screening", "value": 70}], "explanation": "Raised the cutoff."})
    url = f"/v1/manager/jobs/{job_id}/workflow/chat"
    r = (await client.post(url, json={"message": "raise the cutoff to 70"}, headers=auth(mgr))).json()
    assert r["patches"] == [{"op": "set_cutoff", "node": "screening", "value": 70}]
    assert r["descriptions"] == ["Set the screening cutoff to 70"] and r["error"] is None
    assert "screening" in llm.inputs("override_patches")[1].previous_error  # retried with the error

    # Nothing was applied; the follow-up has the earlier request as context.
    assert (await client.get(f"/v1/manager/jobs/{job_id}/workflow", headers=auth(mgr))).json()["version"] == 1
    llm.on("override_patches", {"patches": [{"op": "set_cutoff", "node": "screening", "value": 65}],
                                "explanation": "Lowered it."})
    await client.post(url, json={"thread_id": r["thread_id"], "message": "a bit lower"}, headers=auth(mgr))
    hist = llm.inputs("override_patches")[2].history
    assert [h.instruction for h in hist] == ["raise the cutoff to 70"]


async def test_override_gives_up_after_two_invalid_answers(client, mgr, llm):  # noqa: F811
    job_id = await make_job(client, mgr, llm)
    bad = {"patches": [{"op": "toggle_node", "node": "screening", "enabled": False}], "explanation": "x"}
    llm.on("override_patches", bad, bad)
    r = (await client.post(f"/v1/manager/jobs/{job_id}/workflow/chat", json={"message": "skip screening"},
                           headers=auth(mgr))).json()
    assert r["patches"] == [] and "operation 0" in r["error"]
