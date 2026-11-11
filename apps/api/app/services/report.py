"""Final report and campaign completion (backend plan §16, §7.2–7.3).

- Every application that reaches the final stage, or fails a stage, gets a `draft-report` run: an AI
  feedback draft from its stored evidence, with a suggested recommendation.
- Managers see the ranked final list, edit feedback (`edited_text`, `recommendation`, `excluded`,
  `manager_note`), score stages that need review by hand, and complete the campaign.
- Completing is one transaction: the campaign and job close and every application's feedback is
  released. Only then does RLS let candidates read their stage results and feedback. If notifying is
  on, `notify-release` adds an in-app notification per candidate in batches of 50.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.agents import report as agent
from app.core.auth import CurrentUser
from app.core.db import Tx, system_claims, transaction
from app.core.errors import AppError
from app.domain import interview, report
from app.domain.state_machine import StageOutcome, passes, transition
from app.domain.workflow import FinalNode, Workflow
from app.jobs.dispatcher import dispatcher
from app.jobs.runs import JobRefs

log = logging.getLogger("hirevine.report")

NOTIFY_BATCH = 50
FeedbackStatus = Literal["none", "drafting", "draft", "edited"]
Standing = Literal["final", "failed", "needs_review", "in_progress"]


# ------------------------------------------------------------------ models

class FeedbackView(BaseModel):
    ai_draft: str | None
    ai_recommendation: report.Recommendation | None
    edited_text: str | None
    recommendation: report.Recommendation | None
    manager_note: str | None
    excluded: bool
    released: bool
    released_at: datetime | None
    citations: list[str]
    updated_at: datetime | None


class FeedbackPatch(BaseModel):
    edited_text: str | None = Field(default=None, max_length=4000)
    recommendation: report.Recommendation | None = None
    excluded: bool | None = None
    manager_note: str | None = Field(default=None, max_length=2000)


class FinalRow(BaseModel):
    rank: int | None = Field(description="1-based among finalists who are not excluded; null otherwise")
    application_id: UUID
    candidate_name: str | None
    standing: Standing
    overall: float | None
    stages: list[report.StageScore]
    flags: list[str]
    suggested: report.Recommendation = Field(description="AI draft's suggestion, else the score rule")
    recommendation: report.Recommendation | None = Field(description="The manager's choice, if made")
    feedback_status: FeedbackStatus
    feedback_preview: str | None
    excluded: bool


class FinalReport(BaseModel):
    campaign_id: UUID
    job_title: str
    status: str
    completed_at: datetime | None
    notify_on_complete: bool
    total: int
    finalists: int
    in_progress: int
    unedited: int = Field(description="Applications whose feedback is still an unedited AI draft or missing")
    rows: list[FinalRow]


class ManualScoreIn(BaseModel):
    node_id: str
    score: float = Field(ge=0, le=100)
    note: str = Field(min_length=1, max_length=1000)


class CompleteIn(BaseModel):
    confirm_title: str = Field(description="The job title, typed by the manager to confirm")
    notify: bool | None = Field(default=None, description="Override the campaign's notify setting")


class CompleteResult(BaseModel):
    status: Literal["completed"] = "completed"
    completed_at: datetime
    released: int
    notified: bool


class CandidateStage(BaseModel):
    node_type: str
    status: str
    score: float | None


class ResumeCitation(BaseModel):
    criterion: str
    line_no: int
    quote: str


class QuizAnswer(BaseModel):
    prompt: str
    options: list[str]
    chosen: int | None
    answer_index: int | None
    correct: bool
    explanation: str


class InterviewMoment(BaseModel):
    topic: str
    question: str | None
    answer: str
    turn: int


class CandidateFeedback(BaseModel):
    """What a candidate sees after release. Evidence is their own material: quoted resume lines (on
    their redacted resume), their quiz answers with explanations, and the interview answers that were
    cited. Per-criterion scores, AI rationales and the manager's note and recommendation are not shown."""

    job_title: str
    released_at: datetime
    outcome: report.Outcome
    feedback: str
    stages: list[CandidateStage]
    citations: list[str]
    resume_lines: list[str] = Field(default_factory=list)
    resume_citations: list[ResumeCitation] = Field(default_factory=list)
    quiz_answers: list[QuizAnswer] = Field(default_factory=list)
    interview_moments: list[InterviewMoment] = Field(default_factory=list)


# ------------------------------------------------------------------ draft-report

async def queue_draft(tx: Tx, application_id: UUID | str) -> UUID | None:
    """Called from `transition()` (system context) when an application reaches final or fails a
    stage. Skipped once the campaign is completed or while a draft is already queued."""
    row = await tx.fetchone(
        """
        select a.id, a.campaign_id, c.job_id, j.org_id, c.status as campaign_status,
               exists (select 1 from job_runs r where r.application_id = a.id and r.type = 'report_draft'
                         and r.status in ('queued', 'running', 'deferred_budget')) as busy
        from applications a join campaigns c on c.id = a.campaign_id join jobs j on j.id = c.job_id
        where a.id = %s
        """, (application_id,))
    if row is None or row["campaign_status"] != "open" or row["busy"]:
        return None
    return await dispatcher.enqueue(tx, "report_draft", JobRefs(
        org_id=row["org_id"], application_id=row["id"], campaign_id=row["campaign_id"], job_id=row["job_id"]))


async def _stages(tx: Tx, application_id: UUID | str, wf: Workflow) -> list[dict[str, Any]]:
    rows = await tx.fetchall(
        "select node_id, status, score, evidence, flags from stage_results where application_id = %s",
        (application_id,))
    by_id = {r["node_id"]: dict(r) for r in rows}
    out = []
    for n in wf.nodes:
        if n.type == "final" or not getattr(n, "enabled", True) or n.id not in by_id:
            continue
        out.append({**by_id[n.id], "node_type": n.type})
    return out


async def draft_and_save(run_id: str, deadline: float) -> str:
    """Step of `draft-report`. Reads evidence, calls the model outside any transaction, then saves
    the draft (never touching the manager's edits) and marks the run done in one transaction."""
    async with transaction(system_claims()) as tx:
        run = await tx.fetchone("select * from job_runs where id = %s", (run_id,))
        if run is None or run["status"] in ("done", "failed"):
            return "skipped"
        app = await tx.fetchone(
            """
            select a.id, a.current_node, c.status as campaign_status, j.title, w.definition, i.transcript
            from applications a join campaigns c on c.id = a.campaign_id join jobs j on j.id = c.job_id
            join workflows w on w.id = a.workflow_id
            left join interview_sessions i on i.application_id = a.id
            where a.id = %s
            """, (run["application_id"],))
        if app is None or app["campaign_status"] != "open":
            await _done(tx, run_id)
            return "skipped"
        wf = Workflow.model_validate(app["definition"])
        stages = await _stages(tx, app["id"], wf)
    final_id = next(n.id for n in wf.nodes if isinstance(n, FinalNode))
    d = await agent.draft(title=app["title"], reached_final=app["current_node"] == final_id, stages=stages,
                          transcript=interview.entries(app["transcript"]), deadline=deadline)
    async with transaction(system_claims()) as tx:
        c = await tx.fetchone("select c.status from applications a join campaigns c on c.id = a.campaign_id"
                              " where a.id = %s for update of c", (app["id"],))
        if c is None or c["status"] != "open":  # completed while the model ran: never change released text
            await _done(tx, run_id)
            return "skipped"
        await tx.conn.execute(
            """
            insert into feedback (application_id, ai_draft, ai_recommendation, citations, updated_at)
            values (%(a)s, %(t)s, %(r)s, %(c)s, now())
            on conflict (application_id) do update
              set ai_draft = excluded.ai_draft, ai_recommendation = excluded.ai_recommendation,
                  citations = excluded.citations, updated_at = now()
            """, {"a": app["id"], "t": d.feedback, "r": d.recommendation, "c": Jsonb(d.citations)})
        await tx.conn.execute(
            "insert into events (type, entity, entity_id, payload) values ('feedback.drafted', 'application', %s, %s)",
            (app["id"], Jsonb({"model_id": d.model_id, "prompt_version": d.prompt_version,
                               "citations": len(d.citations)})))
        await _done(tx, run_id)
    return "done"


async def _done(tx: Tx, run_id: str) -> None:
    await tx.conn.execute("update job_runs set status = 'done', last_error = null, updated_at = now() where id = %s",
                          (run_id,))


# ------------------------------------------------------------------ manager: final list

async def _campaign(tx: Tx, campaign_id: UUID, *, lock: bool = False) -> dict[str, Any]:
    row = await tx.fetchone(
        "select c.*, j.title as job_title, j.org_id, w.definition from campaigns c join jobs j on j.id = c.job_id"
        " join workflows w on w.id = c.workflow_id where c.id = %s" + (" for update of c" if lock else ""),
        (campaign_id,))
    if row is None:
        raise AppError(404, "campaign_not_found", "This campaign does not exist or is not yours.")
    return dict(row)


def _standing(stages: list[report.StageScore], at_final: bool) -> Standing:
    if at_final:
        return "final"
    if any(s.status == "failed" for s in stages):
        return "failed"
    if any(s.status == "needs_review" for s in stages):
        return "needs_review"
    return "in_progress"


def _feedback_status(fb: dict[str, Any] | None, drafting: bool) -> FeedbackStatus:
    if fb and fb.get("edited_text"):
        return "edited"
    if drafting:
        return "drafting"
    return "draft" if fb and fb.get("ai_draft") else "none"


async def final_report(tx: Tx, campaign_id: UUID) -> FinalReport:
    c = await _campaign(tx, campaign_id)
    rows = await tx.fetchall(
        """
        select a.id, a.current_node, a.workflow_id, w.definition, p.display_name,
               f.ai_draft, f.ai_recommendation, f.edited_text, f.recommendation, f.excluded,
               exists (select 1 from job_runs r where r.application_id = a.id and r.type = 'report_draft'
                         and r.status in ('queued', 'running', 'deferred_budget')) as drafting,
               coalesce((select json_agg(json_build_object('node_id', s.node_id, 'status', s.status,
                                                           'score', s.score, 'flags', s.flags))
                         from stage_results s where s.application_id = a.id), '[]') as stages
        from applications a join workflows w on w.id = a.workflow_id
        left join profiles p on p.id = a.candidate_id
        left join feedback f on f.application_id = a.id
        where a.campaign_id = %s
        """, (campaign_id,))
    out: list[FinalRow] = []
    for r in rows:
        wf = Workflow.model_validate(r["definition"])
        final_id = next(n.id for n in wf.nodes if isinstance(n, FinalNode))
        by_id = {s["node_id"]: s for s in r["stages"]}
        stages = [report.StageScore(node_id=n.id, node_type=n.type, status=by_id[n.id]["status"],
                                    score=float(by_id[n.id]["score"]) if by_id[n.id]["score"] is not None else None)
                  for n in wf.nodes if n.type in report.SCORED_TYPES and getattr(n, "enabled", True) and n.id in by_id]
        fb = dict(r) if r["ai_draft"] or r["edited_text"] or r["recommendation"] or r["excluded"] else None
        out.append(FinalRow(
            rank=None, application_id=r["id"], candidate_name=r["display_name"],
            standing=_standing(stages, r["current_node"] == final_id), overall=report.overall(stages),
            stages=stages, flags=sorted({f for s in r["stages"] for f in s["flags"] or []}),
            suggested=r["ai_recommendation"] or report.rule_recommendation(stages),
            recommendation=r["recommendation"], feedback_status=_feedback_status(fb, r["drafting"]),
            feedback_preview=(r["edited_text"] or r["ai_draft"] or None), excluded=bool(r["excluded"]),
        ))
    order = {"final": 0, "needs_review": 1, "in_progress": 2, "failed": 3}
    out.sort(key=lambda x: (order[x.standing], x.excluded, -(x.overall or 0.0),
                            -report.screening_score(x.stages)))
    n = 0
    for row in out:
        if row.standing == "final" and not row.excluded:
            n += 1
            row.rank = n
    return FinalReport(
        campaign_id=campaign_id, job_title=c["job_title"], status=c["status"], completed_at=c["completed_at"],
        notify_on_complete=c["notify_on_complete"], total=len(out),
        finalists=sum(r.standing == "final" for r in out),
        in_progress=sum(r.standing in ("in_progress", "needs_review") for r in out),
        unedited=sum(r.feedback_status in ("none", "draft", "drafting") for r in out), rows=out,
    )


# ------------------------------------------------------------------ manager: feedback and manual score

async def _application(tx: Tx, campaign_id: UUID, application_id: UUID) -> dict[str, Any]:
    c = await _campaign(tx, campaign_id)
    a = await tx.fetchone("select id from applications where id = %s and campaign_id = %s",
                          (application_id, campaign_id))
    if a is None:
        raise AppError(404, "application_not_found", "This application does not exist or is not yours.")
    return c


def _view(row: dict[str, Any] | None) -> FeedbackView:
    r = row or {}
    return FeedbackView(ai_draft=r.get("ai_draft"), ai_recommendation=r.get("ai_recommendation"),
                        edited_text=r.get("edited_text"), recommendation=r.get("recommendation"),
                        manager_note=r.get("manager_note"), excluded=bool(r.get("excluded")),
                        released=bool(r.get("released")), released_at=r.get("released_at"),
                        citations=list(r.get("citations") or []), updated_at=r.get("updated_at"))


async def feedback_of(tx: Tx, application_id: UUID) -> FeedbackView | None:
    row = await tx.fetchone("select * from feedback where application_id = %s", (application_id,))
    return _view(dict(row)) if row else None


async def update_feedback(tx: Tx, user: CurrentUser, campaign_id: UUID, application_id: UUID,
                          body: FeedbackPatch) -> FeedbackView:
    c = await _application(tx, campaign_id, application_id)
    if c["status"] != "open":
        raise AppError(409, "campaign_completed", "This campaign is complete; feedback has been released.")
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise AppError(422, "nothing_to_update", "Send at least one field to change.")
    if "edited_text" in changes and changes["edited_text"] is not None and not changes["edited_text"].strip():
        changes["edited_text"] = None  # clearing the text falls back to the AI draft
    if changes.get("excluded") is None:
        changes.pop("excluded", None)  # a boolean column: null means "no change"
    async with tx.as_system():  # managers may update but not create feedback rows (RLS)
        await tx.conn.execute("insert into feedback (application_id) values (%s) on conflict do nothing",
                              (application_id,))
    sets = ", ".join(f"{k} = %({k})s" for k in changes)
    row = await tx.fetchone(f"update feedback set {sets}, updated_at = now() where application_id = %(a)s"
                            " returning *", {**changes, "a": application_id})
    if row is None:
        raise AppError(404, "application_not_found", "This application does not exist or is not yours.")
    async with tx.as_system():
        await tx.conn.execute(
            "insert into events (actor_id, org_id, type, entity, entity_id, payload) values (%s, %s,"
            " 'feedback.edited', 'application', %s, %s)",
            (user.user_id, user.org_id, application_id, Jsonb({"fields": sorted(changes)})))
    return _view(dict(row))


async def manual_score(tx: Tx, user: CurrentUser, campaign_id: UUID, application_id: UUID,
                       body: ManualScoreIn) -> report.StageScore:
    c = await _application(tx, campaign_id, application_id)
    if c["status"] != "open":
        raise AppError(409, "campaign_completed", "This campaign is complete.")
    async with tx.as_system():
        app = await tx.fetchone("select w.definition from applications a join workflows w on w.id = a.workflow_id"
                                " where a.id = %s", (application_id,))
        assert app is not None
        wf = Workflow.model_validate(app["definition"])
        node = next((n for n in wf.nodes if n.id == body.node_id), None)
        if node is None or node.type not in report.SCORED_TYPES:
            raise AppError(422, "invalid_stage", "This stage cannot be scored by hand.")
        stage = await tx.fetchone("select status from stage_results where application_id = %s and node_id = %s"
                                  " for update", (application_id, node.id))
        if stage is None or stage["status"] != "needs_review":
            raise AppError(409, "not_reviewable", "Only a stage that needs review can be scored by hand.")
        status: Literal["passed", "failed"] = "passed" if passes(node, body.score) else "failed"
        await tx.conn.execute(
            "update stage_results set scored_by = %s, manual_note = %s,"
            " flags = array(select distinct unnest(flags || '{manual_score}'::text[]))"
            " where application_id = %s and node_id = %s", (user.user_id, body.note, application_id, node.id))
        await transition(tx, application_id, node.id,
                         StageOutcome(status=status, score=round(body.score, 1), source="manual"), wf)
        await tx.conn.execute(
            "insert into events (actor_id, org_id, type, entity, entity_id, payload) values (%s, %s,"
            " 'stage.manual_score', 'application', %s, %s)",
            (user.user_id, user.org_id, application_id, Jsonb({"node_id": node.id, "score": body.score})))
    return report.StageScore(node_id=node.id, node_type=node.type, status=status, score=round(body.score, 1))


# ------------------------------------------------------------------ manager: complete

async def complete(tx: Tx, user: CurrentUser, campaign_id: UUID, body: CompleteIn) -> CompleteResult:
    c = await _campaign(tx, campaign_id, lock=True)
    if c["status"] != "open":
        raise AppError(409, "already_completed", "This campaign is already complete.")
    if body.confirm_title.strip().casefold() != c["job_title"].strip().casefold():
        raise AppError(422, "confirm_mismatch", "Type the job title exactly to confirm.")
    notify = c["notify_on_complete"] if body.notify is None else body.notify
    async with tx.as_system():
        row = await tx.fetchone(
            "update campaigns set status = 'completed', completed_at = now(), notify_on_complete = %s"
            " where id = %s returning completed_at", (notify, campaign_id))
        assert row is not None
        await tx.conn.execute("update jobs set status = 'closed', updated_at = now() where id = %s", (c["job_id"],))
        # Everyone gets an outcome: applications without a feedback row get one (the neutral text is
        # filled in when the candidate reads it), then all are released together.
        await tx.conn.execute(
            "insert into feedback (application_id) select id from applications where campaign_id = %s"
            " on conflict (application_id) do nothing", (campaign_id,))
        released = await tx.fetchone(
            """
            with r as (update feedback set released = true, released_at = now()
                       where application_id in (select id from applications where campaign_id = %s)
                       returning 1)
            select count(*) as n from r
            """, (campaign_id,))
        n = int(released["n"]) if released else 0
        await tx.conn.execute(
            "insert into events (actor_id, org_id, type, entity, entity_id, payload) values"
            " (%s, %s, 'campaign.completed', 'campaign', %s, %s), (%s, %s, 'feedback.released', 'campaign', %s, %s)",
            (user.user_id, c["org_id"], campaign_id, Jsonb({"notify": notify}),
             user.user_id, c["org_id"], campaign_id, Jsonb({"applications": n})))
    if notify and n:
        await dispatcher.enqueue(tx, "notify_release", JobRefs(org_id=c["org_id"], campaign_id=campaign_id,
                                                              job_id=c["job_id"]))
    return CompleteResult(completed_at=row["completed_at"], released=n, notified=bool(notify and n))


# ------------------------------------------------------------------ notify-release job steps

async def release_targets(campaign_id: str) -> list[str]:
    async with transaction(system_claims()) as tx:
        rows = await tx.fetchall(
            "select a.id from applications a join feedback f on f.application_id = a.id"
            " where a.campaign_id = %s and f.released order by a.created_at", (campaign_id,))
    return [str(r["id"]) for r in rows]


async def notify_batch(campaign_id: str, application_ids: list[str]) -> int:
    """In-app notifications for one batch. Idempotent: a retried batch adds nothing twice."""
    async with transaction(system_claims()) as tx:
        rows = await tx.fetchall(
            """
            insert into notifications (user_id, type, payload)
            select a.candidate_id, 'outcome_released',
                   jsonb_build_object('application_id', a.id::text, 'campaign_id', a.campaign_id::text,
                                      'job_title', j.title)
            from applications a join campaigns c on c.id = a.campaign_id join jobs j on j.id = c.job_id
            where a.id = any(%s::uuid[]) and a.campaign_id = %s
            on conflict (user_id, (payload ->> 'application_id')) where type = 'outcome_released' do nothing
            returning id
            """, (application_ids, campaign_id))
        if rows:
            from app.services.email import queue as queue_email

            await queue_email(tx)
    return len(rows)


# ------------------------------------------------------------------ candidate: released feedback

async def candidate_feedback(tx: Tx, user: CurrentUser, application_id: UUID) -> CandidateFeedback:
    """Read as the candidate: RLS shows feedback and stage results only after release, so before
    that (or for someone else's application) this is a 404."""
    fb = await tx.fetchone("select * from feedback where application_id = %s", (application_id,))
    if fb is None or not fb["released"]:
        raise AppError(404, "feedback_not_available", "Feedback is not available yet.")
    stage_rows = await tx.fetchall("select node_id, status, score from stage_results where application_id = %s",
                                   (application_id,))
    async with tx.as_system():  # workflow, job title and evidence, for this (already authorised) application
        app = await tx.fetchone(
            "select a.current_node, a.candidate_id, j.title, w.definition, r.redacted_lines, i.transcript"
            " from applications a join campaigns c on c.id = a.campaign_id join jobs j on j.id = c.job_id"
            " join workflows w on w.id = a.workflow_id left join resume_texts r on r.application_id = a.id"
            " left join interview_sessions i on i.application_id = a.id where a.id = %s", (application_id,))
        evidence_rows = await tx.fetchall("select node_id, evidence from stage_results where application_id = %s",
                                          (application_id,))
    if app is None or app["candidate_id"] != user.user_id:
        raise AppError(404, "feedback_not_available", "Feedback is not available yet.")
    wf = Workflow.model_validate(app["definition"])
    final_id = next(n.id for n in wf.nodes if isinstance(n, FinalNode))
    by_id = {r["node_id"]: r for r in stage_rows}
    stages = [CandidateStage(node_type=n.type, status=by_id[n.id]["status"],
                             score=float(by_id[n.id]["score"]) if by_id[n.id]["score"] is not None else None)
              for n in wf.nodes if n.type in report.SCORED_TYPES and n.id in by_id]
    rec = fb["recommendation"] or fb["ai_recommendation"]
    outcome = report.candidate_outcome(reached_final=app["current_node"] == final_id, excluded=fb["excluded"],
                                       recommendation=rec)
    text = fb["edited_text"] or fb["ai_draft"] or report.neutral_feedback(app["title"], outcome)
    types = {n.id: n.type for n in wf.nodes}
    resume_cites: list[ResumeCitation] = []
    quiz_answers: list[QuizAnswer] = []
    moments: list[InterviewMoment] = []
    transcript = interview.entries(app["transcript"])
    for r in evidence_rows:
        items = r["evidence"] if isinstance(r["evidence"], list) else []
        kind = types.get(r["node_id"])
        for e in items:
            if not isinstance(e, dict):
                continue
            if kind == "screening" and e.get("verified") and e.get("line_no"):
                resume_cites.append(ResumeCitation(criterion=str(e.get("name")), line_no=int(e["line_no"]),
                                                   quote=str(e.get("quote") or "")))
            elif kind == "quiz" and "question_id" in e:
                quiz_answers.append(QuizAnswer(prompt=e["prompt"], options=list(e.get("options") or []),
                                               chosen=e.get("chosen"), answer_index=e.get("answer_index"),
                                               correct=bool(e.get("correct")), explanation=e.get("explanation") or ""))
            elif kind == "interview" and "item_id" in e:
                for n in e.get("turns") or []:
                    if 0 < n <= len(transcript) and transcript[n - 1].role == "candidate":
                        q = transcript[n - 2].content if n >= 2 and transcript[n - 2].role == "interviewer" else None
                        moments.append(InterviewMoment(topic=str(e.get("name")), question=q,
                                                       answer=transcript[n - 1].content, turn=n))
    return CandidateFeedback(
        job_title=app["title"], released_at=fb["released_at"], outcome=outcome, feedback=text, stages=stages,
        citations=list(fb["citations"] or []) if not fb["edited_text"] else [],
        resume_lines=list(app["redacted_lines"] or []) if resume_cites else [], resume_citations=resume_cites,
        quiz_answers=quiz_answers, interview_moments=moments,
    )
