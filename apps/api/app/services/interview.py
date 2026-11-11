"""AI interview (backend plan §15, §7.3).

Candidates: read, start, answer and finish one interview. Each question is streamed: a turn
request first saves the candidate's answer (one transaction), then streams the next question from
the model outside any transaction, then appends it with a compare-and-set on the transcript length,
so a double send or a reconnect can never store two questions for one slot.

The clock is server time. If the daily AI budget runs out mid-interview the session pauses
(`paused_at`): the clock stops, and the next successful question moves the deadline forward by the
paused time. `interview-deadline` finishes a session left open past its deadline (+30 s grace), or
one paused for more than two days. Finishing queues `score-interview`, which scores the transcript
against the rubric with turn citations and transitions the stage.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.agents import interview as agent
from app.core.auth import CurrentUser
from app.core.db import Tx, system_claims, transaction
from app.core.errors import AppError
from app.domain import interview
from app.domain.state_machine import StageOutcome, passes, transition
from app.domain.workflow import InterviewNode, Workflow
from app.jobs.dispatcher import dispatcher
from app.jobs.runs import JobRefs
from app.llm.errors import BudgetExhausted, LLMNotConfigured, NeedsReview, RateLimited, TimeBudgetExceeded
from app.llm.wrapper import deadline_in

log = logging.getLogger("hirevine.interview")

GRACE = timedelta(seconds=30)
PAUSE_LIMIT = timedelta(days=2)
QUESTION_SECONDS = 50  # a question must arrive well inside the serverless request limit

InterviewStatus = Literal["not_started", "in_progress", "finished", "closed"]


# ------------------------------------------------------------------ models

class InterviewState(BaseModel):
    """What the candidate sees: the disclosure, the transcript and the clock. Never a score."""

    status: InterviewStatus
    disclosure: str
    turn_cap: int
    time_limit_min: int
    evaluates: list[str] = Field(description="What the answers are scored on (rubric item names)")
    questions_asked: int = 0
    answers_given: int = 0
    awaiting: Literal["question", "answer"] | None = None
    paused: bool = False
    transcript: list[interview.Entry] = Field(default_factory=list)
    started_at: datetime | None = None
    deadline_at: datetime | None = None
    finished_at: datetime | None = None
    server_now: datetime


class TurnIn(BaseModel):
    turn: int = Field(ge=0, description="Answers the client has seen saved (InterviewState.answers_given)")
    message: str | None = Field(default=None, max_length=interview.MAX_ANSWER_CHARS,
                                description="The answer to the current question; omit to (re)request a question")


class InterviewReview(BaseModel):
    started_at: datetime
    deadline_at: datetime
    finished_at: datetime | None
    paused: bool
    turn_cap: int
    answers_given: int
    transcript: list[interview.NumberedEntry]


# ------------------------------------------------------------------ context

_CONTEXT_SQL = """
select a.id, a.candidate_id, a.campaign_id, a.current_node, c.status as campaign_status, c.job_id,
       j.org_id, j.title, j.seniority, j.description, w.definition, s.status as stage_status,
       i.transcript, i.turn_count, i.turn_cap as session_turn_cap, i.started_at, i.deadline_at,
       i.finished_at, i.paused_at, now() as server_now
from applications a
join campaigns c on c.id = a.campaign_id
join jobs j on j.id = c.job_id
join workflows w on w.id = a.workflow_id
left join stage_results s on s.application_id = a.id and s.node_id = a.current_node
left join interview_sessions i on i.application_id = a.id
where a.id = %s
"""


async def _context(tx: Tx, application_id: UUID | str, candidate_id: UUID | None = None, *,
                   lock: bool = False) -> dict[str, Any]:
    """The application, its pinned workflow, the current stage and the session, read as system.
    With `candidate_id`, anything that is not the caller's own application is a 404."""
    async with tx.as_system():
        row = await tx.fetchone(_CONTEXT_SQL + (" for update of a" if lock else ""), (application_id,))
    if row is None or (candidate_id is not None and row["candidate_id"] != candidate_id):
        raise AppError(404, "application_not_found", "This application does not exist or is not yours.")
    ctx = dict(row)
    ctx["workflow"] = Workflow.model_validate(row["definition"])
    ctx["node"] = next((n for n in ctx["workflow"].nodes if isinstance(n, InterviewNode)), None)
    ctx["entries"] = interview.entries(row["transcript"])
    return ctx


async def _candidate_ctx(tx: Tx, user: CurrentUser, application_id: UUID, *, lock: bool = False) -> dict[str, Any]:
    ctx = await _context(tx, application_id, user.user_id, lock=lock)
    if ctx["node"] is None:
        raise AppError(404, "no_interview", "This application has no interview.")
    return ctx


def _state(ctx: dict[str, Any]) -> InterviewState:
    node: InterviewNode = ctx["node"]
    cfg = node.config
    base: dict[str, Any] = {
        "disclosure": interview.DISCLOSURE, "time_limit_min": interview.time_limit_min(cfg),
        "evaluates": [r.name for r in cfg.rubric], "server_now": ctx["server_now"],
    }
    if ctx["started_at"] is not None:
        t: list[interview.Entry] = ctx["entries"]
        finished = ctx["finished_at"] is not None
        return InterviewState(
            status="finished" if finished else "in_progress", turn_cap=ctx["session_turn_cap"],
            questions_asked=interview.questions_asked(t), answers_given=interview.answers_given(t),
            awaiting=None if finished else interview.awaiting(t), paused=ctx["paused_at"] is not None,
            transcript=[] if finished else t, started_at=ctx["started_at"], deadline_at=ctx["deadline_at"],
            finished_at=ctx["finished_at"], **base,
        )
    open_ = (ctx["current_node"] == node.id and ctx["campaign_status"] == "open"
             and ctx["stage_status"] in ("pending", "in_progress"))
    return InterviewState(status="not_started" if open_ else "closed", turn_cap=cfg.turn_cap, **base)


async def state(tx: Tx, user: CurrentUser, application_id: UUID) -> InterviewState:
    return _state(await _candidate_ctx(tx, user, application_id))


async def _system_state(application_id: str) -> InterviewState:
    async with transaction(system_claims()) as tx:
        return _state(await _context(tx, application_id))


def _refs(ctx: dict[str, Any]) -> JobRefs:
    return JobRefs(org_id=ctx["org_id"], application_id=ctx["id"], campaign_id=ctx["campaign_id"], job_id=ctx["job_id"])


# ------------------------------------------------------------------ start / finish

async def start(tx: Tx, user: CurrentUser, application_id: UUID) -> InterviewState:
    """Create the session (or return the open one). The deadline is set by the server and the
    `interview-deadline` job is queued. The first question comes from a `turn` request."""
    ctx = await _candidate_ctx(tx, user, application_id)
    if ctx["started_at"] is not None:
        return _state(ctx)
    if _state(ctx).status != "not_started":
        raise AppError(409, "interview_not_available", "This interview is not open.")
    node: InterviewNode = ctx["node"]
    if not node.config.rubric:
        raise AppError(409, "interview_not_ready", "This interview is not ready yet. Check back later.")
    try:
        async with tx.conn.transaction():  # savepoint: a double click loses the race cleanly
            await tx.conn.execute(
                "insert into interview_sessions (application_id, thread_id, turn_cap, deadline_at)"
                " values (%s, %s, %s, now() + make_interval(mins => %s))",
                (application_id, str(uuid4()), node.config.turn_cap, interview.time_limit_min(node.config)))
    except Exception as exc:  # unique violation: another request started it first
        if "interview_sessions_application_id_key" not in str(exc):
            raise
        return _state(await _candidate_ctx(tx, user, application_id))
    async with tx.as_system():
        await transition(tx, ctx["id"], node.id, StageOutcome(status="in_progress", source="system"), ctx["workflow"])
        await tx.conn.execute(
            "insert into events (actor_id, org_id, type, entity, entity_id) values (%s, %s, 'interview.started',"
            " 'application', %s)", (user.user_id, ctx["org_id"], application_id))
    await dispatcher.enqueue(tx, "interview_deadline", _refs(ctx))
    return _state(await _candidate_ctx(tx, user, application_id))


async def _finish(tx: Tx, ctx: dict[str, Any], trigger: Literal["candidate", "cap", "deadline"]) -> str:
    """Close the session and queue scoring, in system context. Idempotent."""
    async with tx.as_system():
        row = await tx.fetchone(
            "update interview_sessions set finished_at = now(), paused_at = null"
            " where application_id = %s and finished_at is null returning id", (ctx["id"],))
        if row is None:
            return "already_finished"
        await tx.conn.execute(
            "insert into events (org_id, type, entity, entity_id, payload) values (%s, 'interview.finished',"
            " 'application', %s, %s)", (ctx["org_id"], ctx["id"], Jsonb({"trigger": trigger})))
    await dispatcher.enqueue(tx, "interview_score", _refs(ctx), {"trigger": trigger})
    return "finished"


async def finish(tx: Tx, user: CurrentUser, application_id: UUID) -> InterviewState:
    ctx = await _candidate_ctx(tx, user, application_id, lock=True)
    if ctx["started_at"] is None:
        raise AppError(409, "interview_not_started", "Start the interview first.")
    await _finish(tx, ctx, "candidate")
    return _state(await _candidate_ctx(tx, user, application_id))


# ------------------------------------------------------------------ turns

@dataclass(frozen=True)
class TurnPlan:
    """What the streaming half of a turn must do, decided inside the request transaction."""

    application_id: str
    action: Literal["question", "closing", "none"]
    expected_len: int = 0
    title: str = ""
    seniority: str | None = None
    description: str = ""
    node: InterviewNode | None = None
    transcript: tuple[interview.Entry, ...] = ()


async def begin_turn(tx: Tx, user: CurrentUser, application_id: UUID, body: TurnIn) -> TurnPlan:
    """Validate and save the candidate's answer (if any), and decide whether a question is due."""
    ctx = await _candidate_ctx(tx, user, application_id, lock=True)
    if ctx["started_at"] is None:
        raise AppError(409, "interview_not_started", "Start the interview first.")
    if ctx["finished_at"] is not None:
        raise AppError(409, "interview_finished", "This interview has finished.")
    if ctx["paused_at"] is None and ctx["server_now"] > ctx["deadline_at"] + GRACE:
        raise AppError(409, "interview_closed", "Time is up. Your answers so far have been saved.")
    t: list[interview.Entry] = ctx["entries"]
    if body.turn != interview.answers_given(t):
        raise AppError(409, "stale_turn", "This interview moved on in another tab. Reload to continue.",
                       {"answers_given": interview.answers_given(t)})
    node: InterviewNode = ctx["node"]
    if body.message is not None:
        answer = body.message.strip()
        if not answer:
            raise AppError(422, "empty_answer", "Write an answer before sending.")
        if interview.awaiting(t) != "answer":
            raise AppError(409, "no_open_question", "There is no question to answer yet.")
        t = [*t, interview.Entry(role="candidate", content=answer, at=ctx["server_now"])]
        async with tx.as_system():
            await tx.conn.execute(
                "update interview_sessions set transcript = %s, turn_count = %s where application_id = %s",
                (Jsonb([e.model_dump(mode="json") for e in t]), interview.answers_given(t), ctx["id"]))
        if interview.answers_given(t) >= ctx["session_turn_cap"]:
            await _finish(tx, ctx, "cap")
            return TurnPlan(application_id=str(ctx["id"]), action="closing")
    if interview.awaiting(t) != "question":
        return TurnPlan(application_id=str(ctx["id"]), action="none")
    return TurnPlan(application_id=str(ctx["id"]), action="question", expected_len=len(t), title=ctx["title"],
                    seniority=ctx["seniority"], description=ctx["description"] or "", node=node,
                    transcript=tuple(t))


async def _append_question(plan: TurnPlan, text: str) -> bool:
    """Store the question if nothing else did first; un-pause and extend the clock by the pause."""
    entry = interview.Entry(role="interviewer", content=text, at=None)
    async with transaction(system_claims()) as tx:
        row = await tx.fetchone(
            """
            update interview_sessions
               set transcript = transcript || jsonb_build_array(jsonb_set(%s::jsonb, '{at}', to_jsonb(now()))),
                   deadline_at = deadline_at + coalesce(now() - paused_at, interval '0'),
                   paused_at = null
             where application_id = %s and finished_at is null and jsonb_array_length(transcript) = %s
            returning id
            """,
            (Jsonb(entry.model_dump(mode="json")), plan.application_id, plan.expected_len))
    return row is not None


async def _pause(application_id: str) -> None:
    async with transaction(system_claims()) as tx:
        await tx.conn.execute(
            "update interview_sessions set paused_at = coalesce(paused_at, now())"
            " where application_id = %s and finished_at is null", (application_id,))


async def stream_turn(plan: TurnPlan) -> AsyncIterator[dict[str, Any]]:
    """SSE payloads: `token` chunks, at most one `error`, then `done` with the saved state."""
    if plan.action == "closing":
        yield {"type": "token", "text": interview.CLOSING}
    elif plan.action == "question":
        assert plan.node is not None
        parts: list[str] = []
        try:
            async for chunk in agent.next_question(
                title=plan.title, seniority=plan.seniority, description=plan.description,
                config=plan.node.config, transcript=list(plan.transcript), deadline=deadline_in(QUESTION_SECONDS),
            ):
                parts.append(chunk)
                yield {"type": "token", "text": chunk}
            question = interview.clean_question("".join(parts))
            if question:
                await _append_question(plan, question)
        except BudgetExhausted:
            await _pause(plan.application_id)
            yield {"type": "error", "code": "daily_ai_limit",
                   "message": "Today's AI limit is used up, so the interview is paused and the clock is stopped. "
                              "Your answers are saved: come back after midnight UTC to continue."}
        except RateLimited as exc:
            yield {"type": "error", "code": "model_busy", "retry_after": round(exc.retry_after),
                   "message": "The interviewer is busy right now. Your answer is saved; try again in a moment."}
        except (NeedsReview, TimeBudgetExceeded, LLMNotConfigured, TimeoutError) as exc:
            log.warning("interview question failed for %s: %s", plan.application_id, exc)
            yield {"type": "error", "code": "agent_failed",
                   "message": "The interviewer could not write the next question. Your answer is saved; try again."}
        except Exception:
            log.exception("interview question failed for %s", plan.application_id)
            yield {"type": "error", "code": "agent_failed",
                   "message": "The interviewer could not write the next question. Your answer is saved; try again."}
    yield {"type": "done", "state": (await _system_state(plan.application_id)).model_dump(mode="json")}


# ------------------------------------------------------------------ interview-deadline job steps

async def deadline_of(application_id: str) -> str | None:
    """When to check next (ISO 8601): the deadline + grace, or the pause limit while paused;
    None when there is nothing left to wait for."""
    async with transaction(system_claims()) as tx:
        row = await tx.fetchone(
            "select deadline_at, finished_at, paused_at from interview_sessions where application_id = %s",
            (application_id,))
    if row is None or row["finished_at"] is not None:
        return None
    due = row["paused_at"] + PAUSE_LIMIT if row["paused_at"] is not None else row["deadline_at"] + GRACE
    return str(due.isoformat())


async def finish_if_open(application_id: str) -> str:
    async with transaction(system_claims()) as tx:
        ctx = await _context(tx, application_id, lock=True)
        if ctx["node"] is None or ctx["started_at"] is None:
            return "no_session"
        if ctx["finished_at"] is not None:
            return "already_finished"
        if ctx["campaign_status"] != "open":
            return "campaign_completed"  # outcomes are released: nothing may change now
        now = ctx["server_now"]
        if ctx["paused_at"] is not None:
            if now < ctx["paused_at"] + PAUSE_LIMIT:
                return "not_due"
        elif now < ctx["deadline_at"] + GRACE:
            return "not_due"
        return await _finish(tx, ctx, "deadline")


# ------------------------------------------------------------------ score-interview job step

async def _needs_review(tx: Tx, ctx: dict[str, Any], flag: str) -> None:
    node: InterviewNode = ctx["node"]
    await transition(tx, ctx["id"], node.id, StageOutcome(status="needs_review", source="system"), ctx["workflow"])
    await tx.conn.execute(
        "update stage_results set flags = array(select distinct unnest(flags || %s::text[]))"
        " where application_id = %s and node_id = %s", ([flag], ctx["id"], node.id))


async def score_and_transition(run_id: str, deadline: float) -> str:
    """Step of `score-interview`. Reads the transcript, calls the model outside any transaction,
    then stores scores, evidence and the outcome and marks the run done in one transaction."""
    async with transaction(system_claims()) as tx:
        run = await tx.fetchone("select * from job_runs where id = %s", (run_id,))
        if run is None or run["status"] in ("done", "failed"):
            return "skipped"
        ctx = await _context(tx, run["application_id"])
    node: InterviewNode | None = ctx["node"]
    if (node is None or ctx["finished_at"] is None or ctx["stage_status"] in ("passed", "failed")
            or ctx["campaign_status"] != "open"):
        await _mark_done(run_id)
        return "skipped"
    transcript: list[interview.Entry] = ctx["entries"]
    model_id: str | None = None
    prompt_version: str | None = None
    if not node.config.rubric:
        async with transaction(system_claims()) as tx:
            await _needs_review(tx, ctx, "not_scored")
            await _mark_done_tx(tx, run_id)
        return "needs_review"
    if interview.answers_given(transcript) == 0:
        result = interview.score(node.config.rubric, {}, transcript)
        result.flags.append("no_answers")
    else:
        result, model_id, version = await agent.score(title=ctx["title"], config=node.config, transcript=transcript,
                                                      deadline=deadline)
        prompt_version = f"interview_score@{version}"
    trigger = (run["params"] or {}).get("trigger")
    flags = result.flags + (["auto_finished"] if trigger == "deadline" else [])
    status: Literal["passed", "failed"] = "passed" if passes(node, result.score) else "failed"
    async with transaction(system_claims()) as tx:
        await tx.conn.execute("update interview_sessions set scores = %s where application_id = %s",
                              (Jsonb(result.model_dump(mode="json")), ctx["id"]))
        await tx.conn.execute(
            "update stage_results set evidence = %s, flags = %s, model_id = %s, prompt_version = %s"
            " where application_id = %s and node_id = %s and status in ('pending', 'in_progress', 'needs_review')",
            (Jsonb([i.model_dump() for i in result.items]), flags, model_id, prompt_version, ctx["id"], node.id))
        await transition(tx, ctx["id"], node.id, StageOutcome(status=status, score=result.score), ctx["workflow"])
        await _mark_done_tx(tx, run_id)
    return status


async def mark_model_failed(application_id: str) -> None:
    async with transaction(system_claims()) as tx:
        ctx = await _context(tx, application_id)
        if ctx["node"] is not None:
            await _needs_review(tx, ctx, "model_failed")


async def _mark_done_tx(tx: Tx, run_id: str) -> None:
    await tx.conn.execute("update job_runs set status = 'done', last_error = null, updated_at = now() where id = %s",
                          (run_id,))


async def _mark_done(run_id: str) -> None:
    async with transaction(system_claims()) as tx:
        await _mark_done_tx(tx, run_id)


# ------------------------------------------------------------------ manager: review

async def review(tx: Tx, application_id: UUID) -> InterviewReview | None:
    row = await tx.fetchone(
        "select started_at, deadline_at, finished_at, paused_at, turn_cap, transcript from interview_sessions"
        " where application_id = %s", (application_id,))
    if row is None:
        return None
    t = interview.entries(row["transcript"])
    return InterviewReview(started_at=row["started_at"], deadline_at=row["deadline_at"],
                           finished_at=row["finished_at"], paused=row["paused_at"] is not None,
                           turn_cap=row["turn_cap"], answers_given=interview.answers_given(t),
                           transcript=interview.numbered(t))

