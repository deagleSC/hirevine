"""Quiz (backend plan §14, §7.2–7.3).

Managers: request generation (a `generate-quiz` job adds questions as `add_quiz_question` patches)
and watch its status. Candidates: read, start, autosave and submit one timed attempt. The
`quiz-deadline` job auto-submits an attempt left open past its deadline plus a 30 s grace.

Grading is code: score = 100 × correct / total against the answer key in the workflow version the
application is pinned to. Per-question results go into the quiz stage's `evidence`, which
candidates cannot read before release; the candidate API never returns a score or correctness.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.agents import quiz as agent
from app.core.auth import CurrentUser
from app.core.db import Tx, system_claims, transaction
from app.core.errors import AppError
from app.domain import quiz
from app.domain.patches import AddQuizQuestion, Patch, RemoveQuizQuestion
from app.domain.state_machine import StageOutcome, passes, transition
from app.domain.workflow import QuizNode, QuizQuestion, Workflow, normalize_prompt
from app.jobs.dispatcher import dispatcher
from app.jobs.runs import JobRefs
from app.services import workflows as wf_svc

log = logging.getLogger("hirevine.quiz")

GRACE = timedelta(seconds=30)
Difficulty = Literal["easy", "medium", "hard", "mixed"]


# ------------------------------------------------------------------ models

class GenerateRequest(BaseModel):
    count: int = Field(default=10, ge=1, le=30)
    difficulty: Difficulty = "mixed"
    replace: bool = Field(default=False, description="Remove the current questions first")


class GenerationQueued(BaseModel):
    status: Literal["processing"] = "processing"
    job_run_id: UUID


class GenerationStatus(BaseModel):
    job_run_id: UUID
    status: Literal["queued", "running", "deferred_budget", "paused", "done", "failed"]
    added: int | None = None
    version: int | None = None
    error: str | None = None


QuizStatus = Literal["not_started", "in_progress", "submitted", "closed"]


class QuizState(BaseModel):
    """What the candidate sees. Never a score or which answers were right."""

    status: QuizStatus
    time_limit_min: int
    question_count: int
    started_at: datetime | None = None
    deadline_at: datetime | None = None
    submitted_at: datetime | None = None
    server_now: datetime
    questions: list[quiz.PublicQuestion] = Field(default_factory=list)
    answers: dict[str, int] = Field(default_factory=dict)


class AnswersIn(BaseModel):
    answers: dict[str, int] = Field(max_length=30, description="question id → chosen option index")


class AnswersSaved(BaseModel):
    answers: dict[str, int]
    saved_at: datetime
    deadline_at: datetime


# ------------------------------------------------------------------ manager: generation

async def _job_with_quiz(tx: Tx, job_id: UUID) -> tuple[dict[str, Any], wf_svc.WorkflowVersion, QuizNode]:
    job = await tx.fetchone("select id, org_id, title, description, seniority from jobs where id = %s", (job_id,))
    if job is None:
        raise AppError(404, "job_not_found", "This job does not exist or is not yours.")
    version = await wf_svc.latest(tx, job_id)
    node = next((n for n in version.definition.nodes if isinstance(n, QuizNode)), None)
    if node is None:
        raise AppError(409, "no_quiz", "This workflow has no quiz step.")
    return dict(job), version, node


async def request_generation(tx: Tx, user: CurrentUser, job_id: UUID, body: GenerateRequest) -> GenerationQueued:
    job, _, node = await _job_with_quiz(tx, job_id)
    if not body.replace and body.count > quiz.room(len(node.config.questions)):
        raise AppError(422, "quiz_full", f"A quiz holds at most 30 questions; there is room for "
                       f"{quiz.room(len(node.config.questions))} more.")
    busy = await tx.fetchone(
        "select 1 from job_runs where job_id = %s and type = 'quiz_generate'"
        " and status in ('queued', 'running', 'deferred_budget')", (job_id,))
    if busy:
        raise AppError(409, "already_processing", "Questions are already being generated for this job.")
    run_id = await dispatcher.enqueue(
        tx, "quiz_generate", JobRefs(org_id=job["org_id"], job_id=job_id),
        {**body.model_dump(), "requested_by": str(user.user_id)},
    )
    return GenerationQueued(job_run_id=run_id)


async def generation_status(tx: Tx, job_id: UUID, run_id: UUID) -> GenerationStatus:
    row = await tx.fetchone(
        "select id, status, params, last_error from job_runs where id = %s and job_id = %s and type = 'quiz_generate'",
        (run_id, job_id))
    if row is None:
        raise AppError(404, "job_run_not_found", "This generation request does not exist.")
    p = row["params"] or {}
    return GenerationStatus(job_run_id=row["id"], status=row["status"], added=p.get("added"),
                            version=p.get("version"), error=row["last_error"])


async def generate_and_patch(run_id: str, deadline: float) -> str:
    """Step of `generate-quiz`. Reads inputs, calls the model outside any transaction, then adds the
    questions and marks the run done in one transaction, so a retried step never adds twice."""
    async with transaction(system_claims()) as tx:
        run = await tx.fetchone("select * from job_runs where id = %s", (run_id,))
        if run is None or run["status"] in ("done", "failed"):
            return "skipped"
        try:
            job, _, node = await _job_with_quiz(tx, run["job_id"])
        except AppError as exc:
            await tx.conn.execute("update job_runs set status = 'failed', last_error = %s, updated_at = now()"
                                  " where id = %s", (exc.message, run_id))
            return "no_quiz"
        screening = (await wf_svc.latest(tx, run["job_id"])).definition.first_node()
    params = run["params"] or {}
    replace = bool(params.get("replace"))
    existing = [] if replace else [q.prompt for q in node.config.questions]
    count = min(int(params.get("count") or 10), quiz.room(0 if replace else len(node.config.questions)))
    criteria = sorted(getattr(screening.config, "criteria", []), key=lambda c: (not c.must_have, -c.weight))
    questions = await agent.generate(
        title=job["title"], seniority=job["seniority"], description=job["description"],
        skills=[c.name for c in criteria], count=count, difficulty=params.get("difficulty") or "mixed",
        existing=existing, deadline=deadline,
    ) if count > 0 else []

    async with transaction(system_claims()) as tx:
        run = await tx.fetchone("select status, params from job_runs where id = %s for update", (run_id,))
        if run is None or run["status"] in ("done", "failed"):
            return "skipped"
        if not questions:
            await tx.conn.execute(
                "update job_runs set status = 'failed', last_error = %s, updated_at = now() where id = %s",
                ("The model did not produce any valid questions. Try again.", run_id))
            return "empty"
        base = await wf_svc.latest(tx, job["id"], lock=True)
        current = next((n for n in base.definition.nodes if isinstance(n, QuizNode)), None)
        if current is None:
            await tx.conn.execute("update job_runs set status = 'failed', last_error = %s, updated_at = now()"
                                  " where id = %s", ("This workflow no longer has a quiz step.", run_id))
            return "no_quiz"
        patches: list[Patch] = []
        if replace:
            patches += [RemoveQuizQuestion(op="remove_quiz_question", node=current.id, question_id=q.id)
                        for q in current.config.questions]
            taken: set[str] = set()
            room = quiz.room(0)
        else:
            taken = {normalize_prompt(q.prompt) for q in current.config.questions}
            room = quiz.room(len(current.config.questions))
        for q in questions:  # the quiz may have changed while the model ran
            key = normalize_prompt(q.prompt)
            if key in taken or room <= 0:
                continue
            taken.add(key)
            room -= 1
            patches.append(AddQuizQuestion(op="add_quiz_question", node=current.id, question=q))
        added = sum(isinstance(p, AddQuizQuestion) for p in patches)
        actor = UUID(params["requested_by"]) if params.get("requested_by") else None
        applied = await wf_svc.apply(tx, job["id"], base.version, patches, source="agent", actor=actor)
        await tx.conn.execute(
            "update job_runs set status = 'done', last_error = null, params = params || %s, updated_at = now()"
            " where id = %s", (Jsonb({"added": added, "version": applied.version}), run_id))
    return "done"


# ------------------------------------------------------------------ candidate: attempts

async def _context(tx: Tx, application_id: UUID | str, candidate_id: UUID | None = None) -> dict[str, Any]:
    """The application, its pinned workflow, the current stage and the attempt, read as system.
    With `candidate_id`, anything that is not the caller's own application is a 404."""
    async with tx.as_system():
        row = await tx.fetchone(
            """
            select a.id, a.candidate_id, a.campaign_id, a.current_node, c.status as campaign_status, c.job_id,
                   j.org_id, w.definition, s.status as stage_status,
                   q.questions_snapshot, q.answers, q.started_at, q.deadline_at, q.submitted_at,
                   now() as server_now
            from applications a
            join campaigns c on c.id = a.campaign_id
            join jobs j on j.id = c.job_id
            join workflows w on w.id = a.workflow_id
            left join stage_results s on s.application_id = a.id and s.node_id = a.current_node
            left join quiz_attempts q on q.application_id = a.id
            where a.id = %s
            """,
            (application_id,),
        )
    if row is None or (candidate_id is not None and row["candidate_id"] != candidate_id):
        raise AppError(404, "application_not_found", "This application does not exist or is not yours.")
    ctx = dict(row)
    ctx["workflow"] = Workflow.model_validate(row["definition"])
    ctx["node"] = next((n for n in ctx["workflow"].nodes if isinstance(n, QuizNode)), None)
    return ctx


def _snapshot(ctx: dict[str, Any]) -> list[quiz.PublicQuestion]:
    return [quiz.PublicQuestion.model_validate(q) for q in ctx["questions_snapshot"] or []]


def _state(ctx: dict[str, Any]) -> QuizState:
    node: QuizNode = ctx["node"]
    base = {"time_limit_min": node.config.time_limit_min, "server_now": ctx["server_now"]}
    if ctx["submitted_at"] is not None:
        return QuizState(status="submitted", question_count=len(ctx["questions_snapshot"] or []),
                         started_at=ctx["started_at"], deadline_at=ctx["deadline_at"],
                         submitted_at=ctx["submitted_at"], **base)
    if ctx["started_at"] is not None:
        snap = _snapshot(ctx)
        return QuizState(status="in_progress", question_count=len(snap), started_at=ctx["started_at"],
                         deadline_at=ctx["deadline_at"], questions=snap,
                         answers=quiz.clean_answers(snap, ctx["answers"] or {}), **base)
    open_ = (ctx["current_node"] == node.id and ctx["campaign_status"] == "open"
             and ctx["stage_status"] in ("pending", "in_progress"))
    return QuizState(status="not_started" if open_ else "closed", question_count=len(node.config.questions), **base)


async def _candidate_ctx(tx: Tx, user: CurrentUser, application_id: UUID) -> dict[str, Any]:
    ctx = await _context(tx, application_id, user.user_id)
    if ctx["node"] is None:
        raise AppError(404, "no_quiz", "This application has no quiz.")
    return ctx


async def state(tx: Tx, user: CurrentUser, application_id: UUID) -> QuizState:
    return _state(await _candidate_ctx(tx, user, application_id))


async def start(tx: Tx, user: CurrentUser, application_id: UUID) -> QuizState:
    """Create the attempt (or return the open one: a resumed session gets the same snapshot and
    answers). The deadline is set by the server and the `quiz-deadline` job is queued."""
    ctx = await _candidate_ctx(tx, user, application_id)
    if ctx["started_at"] is not None:
        return _state(ctx)
    current = _state(ctx)
    if current.status != "not_started":
        raise AppError(409, "quiz_not_available", "This quiz is not open.")
    node: QuizNode = ctx["node"]
    if not node.config.questions:
        raise AppError(409, "quiz_not_ready", "This quiz is not ready yet. Check back later.")
    snap = [q.model_dump() for q in quiz.snapshot(node.config.questions)]
    try:
        async with tx.conn.transaction():  # savepoint: a double click loses the race cleanly
            await tx.conn.execute(
                "insert into quiz_attempts (application_id, questions_snapshot, deadline_at)"
                " values (%s, %s, now() + make_interval(mins => %s))",
                (application_id, Jsonb(snap), node.config.time_limit_min))
    except Exception as exc:  # unique violation: another request started it first
        if "quiz_attempts_application_id_key" not in str(exc):
            raise
        return _state(await _candidate_ctx(tx, user, application_id))
    async with tx.as_system():
        await transition(tx, ctx["id"], node.id, StageOutcome(status="in_progress", source="system"),
                         ctx["workflow"])
        await tx.conn.execute(
            "insert into events (actor_id, org_id, type, entity, entity_id) values (%s, %s, 'quiz.started',"
            " 'application', %s)", (user.user_id, ctx["org_id"], application_id))
    await dispatcher.enqueue(tx, "quiz_deadline", JobRefs(org_id=ctx["org_id"], application_id=ctx["id"],
                                                          campaign_id=ctx["campaign_id"], job_id=ctx["job_id"]))
    return _state(await _candidate_ctx(tx, user, application_id))


def _open_attempt(ctx: dict[str, Any]) -> None:
    if ctx["started_at"] is None:
        raise AppError(409, "quiz_not_started", "Start the quiz first.")
    if ctx["submitted_at"] is not None:
        raise AppError(409, "quiz_submitted", "This quiz has already been submitted.")


async def save_answers(tx: Tx, user: CurrentUser, application_id: UUID, body: AnswersIn) -> AnswersSaved:
    ctx = await _candidate_ctx(tx, user, application_id)
    _open_attempt(ctx)
    if ctx["server_now"] > ctx["deadline_at"] + GRACE:
        raise AppError(409, "quiz_closed", "Time is up. Your saved answers were submitted.")
    snap = _snapshot(ctx)
    bad = set(body.answers) - {q.id for q in snap}
    if bad or len(quiz.clean_answers(snap, body.answers)) != len(body.answers):
        raise AppError(422, "invalid_answer", "One of the answers does not match a question or option.")
    merged = {**quiz.clean_answers(snap, ctx["answers"] or {}), **body.answers}
    # As the candidate: RLS allows the write only while the quiz stage is open.
    row = await tx.fetchone(
        "update quiz_attempts set answers = %s where application_id = %s and submitted_at is null"
        " returning answers, now() as saved_at",
        (Jsonb(merged), application_id))
    if row is None:
        raise AppError(409, "quiz_closed", "This quiz is closed.")
    return AnswersSaved(answers=merged, saved_at=row["saved_at"], deadline_at=ctx["deadline_at"])


async def _finish(tx: Tx, ctx: dict[str, Any], trigger: Literal["candidate", "deadline"]) -> str:
    """Grade and transition, in system context. Idempotent: an attempt is graded once."""
    async with tx.as_system():
        attempt = await tx.fetchone(
            "select answers, submitted_at from quiz_attempts where application_id = %s for update", (ctx["id"],))
        if attempt is None or attempt["submitted_at"] is not None:
            return "already_submitted"
        node: QuizNode = ctx["node"]
        key: dict[str, QuizQuestion] = {q.id: q for q in node.config.questions}
        result = quiz.grade(_snapshot(ctx), key, attempt["answers"] or {})
        answers = quiz.clean_answers(_snapshot(ctx), attempt["answers"] or {})
        await tx.conn.execute(
            "update quiz_attempts set answers = %s, score = %s, submitted_at = now() where application_id = %s",
            (Jsonb(answers), Decimal(str(result.score)), ctx["id"]))
        status: Literal["passed", "failed"] = "passed" if passes(node, result.score) else "failed"
        if ctx["stage_status"] in ("pending", "in_progress", "needs_review", None):
            await transition(tx, ctx["id"], node.id, StageOutcome(status=status, score=result.score,
                                                                  source="system"), ctx["workflow"])
        await tx.conn.execute(
            "update stage_results set evidence = %s, flags = %s where application_id = %s and node_id = %s",
            (Jsonb([r.model_dump() for r in result.results]),
             ["auto_submitted"] if trigger == "deadline" else [], ctx["id"], node.id))
        await tx.conn.execute(
            "insert into events (org_id, type, entity, entity_id, payload) values (%s, 'quiz.submitted',"
            " 'application', %s, %s)",
            (ctx["org_id"], ctx["id"], Jsonb({"trigger": trigger, "correct": result.correct,
                                              "total": result.total})))
    return status


async def submit(tx: Tx, user: CurrentUser, application_id: UUID) -> QuizState:
    ctx = await _candidate_ctx(tx, user, application_id)
    _open_attempt(ctx)
    await _finish(tx, ctx, "candidate")
    return _state(await _candidate_ctx(tx, user, application_id))


# ------------------------------------------------------------------ quiz-deadline job steps

async def deadline_of(application_id: str) -> str | None:
    """When to auto-submit (deadline + grace), as ISO 8601; None if there is nothing to wait for."""
    async with transaction(system_claims()) as tx:
        row = await tx.fetchone("select deadline_at, submitted_at from quiz_attempts where application_id = %s",
                                (application_id,))
    if row is None or row["submitted_at"] is not None:
        return None
    return str((row["deadline_at"] + GRACE).isoformat())


async def auto_submit_if_open(application_id: str) -> str:
    async with transaction(system_claims()) as tx:
        ctx = await _context(tx, application_id)
        if ctx["node"] is None or ctx["started_at"] is None:
            return "no_attempt"
        if ctx["submitted_at"] is not None:
            return "already_submitted"
        if ctx["server_now"] < ctx["deadline_at"] + GRACE:
            return "not_due"
        return await _finish(tx, ctx, "deadline")


# ------------------------------------------------------------------ manager: review

class QuizReview(BaseModel):
    started_at: datetime
    deadline_at: datetime
    submitted_at: datetime | None
    answered: int
    total: int


async def review(tx: Tx, application_id: UUID) -> QuizReview | None:
    row = await tx.fetchone(
        "select started_at, deadline_at, submitted_at, answers, questions_snapshot from quiz_attempts"
        " where application_id = %s", (application_id,))
    if row is None:
        return None
    return QuizReview(started_at=row["started_at"], deadline_at=row["deadline_at"],
                      submitted_at=row["submitted_at"], answered=len(row["answers"] or {}),
                      total=len(row["questions_snapshot"] or []))

