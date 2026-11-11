"""Applications: upload URL, apply + consent, the candidate tracker, and the manager's campaign
monitor (backend plan §7.2, §7.3, §7.4, §13, §18)."""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.core import ratelimit
from app.core.auth import CurrentUser
from app.core.config import get_settings
from app.core.db import Tx
from app.core.errors import AppError
from app.domain.workflow import Workflow
from app.jobs.dispatcher import WAITING_TYPES, dispatcher
from app.jobs.runs import JobRefs
from app.services.interview import InterviewReview
from app.services.interview import review as interview_review
from app.services.quiz import QuizReview
from app.services.quiz import review as quiz_review
from app.services.report import FeedbackView, feedback_of
from app.services.storage import get_storage

CONTENT_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
_PATH = re.compile(r"^(?P<uid>[0-9a-f-]{36})/(?P<name>[0-9a-f]{32})\.(?P<ext>pdf|docx)$")

CandidateStatus = Literal["received", "in_review", "action_required", "outcome_released"]


# ------------------------------------------------------------------ models

class UploadRequest(BaseModel):
    job_id: UUID
    filename: str = Field(min_length=1, max_length=255)
    content_type: str
    size: int = Field(gt=0)


class UploadUrl(BaseModel):
    resume_path: str
    upload_url: str
    token: str
    expires_in: int = 7200


class ConsentIn(BaseModel):
    text_version: str


class ApplicationCreate(BaseModel):
    job_id: UUID
    resume_path: str
    consent: ConsentIn
    adult_confirmed: bool
    screening_answers: dict[str, str] = Field(default_factory=dict, max_length=20)


class ApplicationCreated(BaseModel):
    id: UUID
    status: Literal["processing"] = "processing"


class TrackerItem(BaseModel):
    id: UUID
    job_id: UUID
    job_title: str
    campaign_id: UUID
    status: CandidateStatus
    next_action: Literal["quiz", "interview"] | None = None
    action_deadline_at: datetime | None = Field(default=None, description="Set once a timed stage has started")
    created_at: datetime


class StageCount(BaseModel):
    node_id: str
    node_type: str
    status: str
    count: int


class MonitorNode(BaseModel):
    id: str
    type: Literal["screening", "quiz", "interview", "final"]
    enabled: bool


class CampaignMonitor(BaseModel):
    id: UUID
    job_id: UUID
    job_title: str
    status: str
    ai_paused: bool
    total: int
    processing: int
    needs_review: int
    counts: list[StageCount]
    nodes: list[MonitorNode]


class ApplicationRow(BaseModel):
    id: UUID
    candidate_name: str | None
    created_at: datetime
    current_node: str | None
    stage_status: str | None
    screening_score: float | None
    flags: list[str]
    prefilter_score: float | None
    job_status: str | None


class ApplicationPage(BaseModel):
    items: list[ApplicationRow]
    next_cursor: str | None


class StageDetail(BaseModel):
    node_id: str
    node_type: str
    status: str
    score: float | None
    evidence: list[dict[str, Any]]
    flags: list[str]
    model_id: str | None
    prompt_version: str | None
    updated_at: datetime


class ResumeView(BaseModel):
    lines: list[str]
    injection_flags: list[dict[str, Any]]
    parser: str


class ApplicationDetail(BaseModel):
    id: UUID
    campaign_id: UUID
    candidate_name: str | None
    created_at: datetime
    current_node: str | None
    prefilter_score: float | None
    stages: list[StageDetail]
    resume: ResumeView | None
    screening_answers: dict[str, str]
    job_status: str | None
    job_error: str | None
    quiz: QuizReview | None = None
    interview: InterviewReview | None = None
    feedback: FeedbackView | None = None


class Queued(BaseModel):
    status: Literal["processing"] = "processing"
    job_run_id: UUID


# ------------------------------------------------------------------ helpers

async def _open_campaign(tx: Tx, job_id: UUID) -> dict[str, Any]:
    """The job's open campaign, visible to candidates only while the job is published (RLS)."""
    row = await tx.fetchone(
        "select c.id, c.workflow_id, j.title from campaigns c join jobs j on j.id = c.job_id"
        " where c.job_id = %s and c.status = 'open'",
        (job_id,),
    )
    if row is None:
        raise AppError(404, "job_not_open", "This job is not accepting applications.")
    return dict(row)


async def _workflow(tx: Tx, workflow_id: UUID) -> Workflow:
    """Workflows are manager-only under RLS; candidates' requests read the pinned one as system."""
    async with tx.as_system():
        row = await tx.fetchone("select definition from workflows where id = %s", (workflow_id,))
    assert row is not None
    return Workflow.model_validate(row["definition"])


def _ip_hash(ip: str | None) -> str | None:
    if not ip:
        return None
    salt = get_settings().cron_secret or "hirevine"
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()


def candidate_status(campaign_status: str, released: bool, node_type: str | None,
                     stage_status: str | None, has_resume_text: bool, *,
                     interview_finished: bool = False) -> tuple[CandidateStatus, str | None]:
    """§7.4. Never reveals a score, a failed cutoff or a rank before release. A finished interview
    is in review while it is scored."""
    if campaign_status == "completed" and released:
        return "outcome_released", None
    if node_type == "interview" and interview_finished:
        return "in_review", None
    if node_type in ("quiz", "interview") and stage_status in ("pending", "in_progress"):
        return "action_required", node_type
    if node_type == "screening" and not has_resume_text and stage_status in (None, "pending"):
        return "received", None
    return "in_review", None


# ------------------------------------------------------------------ candidate

async def upload_url(tx: Tx, user: CurrentUser, body: UploadRequest) -> UploadUrl:
    ext = CONTENT_TYPES.get(body.content_type)
    if ext is None or not body.filename.lower().endswith(f".{ext}"):
        raise AppError(422, "unsupported_file", "Upload a PDF or Word (.docx) file.")
    if body.size > MAX_UPLOAD_BYTES:
        raise AppError(422, "file_too_large", "The file must be 5 MB or smaller.")
    await ratelimit.hit(tx, f"upload:{user.user_id}", get_settings().upload_urls_per_hour, timedelta(hours=1),
                        message="Too many uploads. Try again in an hour.")
    await _open_campaign(tx, body.job_id)
    path = f"{user.user_id}/{uuid.uuid4().hex}.{ext}"
    signed = await get_storage().signed_upload(path)
    return UploadUrl(resume_path=path, upload_url=signed.url, token=signed.token)


async def apply(tx: Tx, user: CurrentUser, body: ApplicationCreate, client_ip: str | None) -> ApplicationCreated:
    s = get_settings()
    if not body.adult_confirmed:
        raise AppError(422, "adult_required", "You must be 18 or older to apply.")
    if body.consent.text_version != s.consent_text_version:
        raise AppError(422, "consent_outdated", "The consent text has changed. Reload the page and review it.",
                       {"current_version": s.consent_text_version})
    m = _PATH.match(body.resume_path)
    if m is None or m["uid"] != str(user.user_id):
        raise AppError(422, "invalid_resume_path", "Upload your resume again.")
    await ratelimit.hit(tx, f"apply:{user.user_id}", s.applications_per_day, timedelta(days=1),
                        message="You have reached today's application limit.")
    camp = await _open_campaign(tx, body.job_id)
    wf = await _workflow(tx, camp["workflow_id"])
    first = wf.first_node().id
    try:
        async with tx.conn.transaction():  # savepoint, so a duplicate can be reported cleanly
            row = await tx.fetchone(
                """
                insert into applications (campaign_id, candidate_id, workflow_id, current_node, resume_path, consent_at)
                values (%s, %s, %s, %s, %s, now()) returning id
                """,
                (camp["id"], user.user_id, camp["workflow_id"], first, body.resume_path),
            )
    except psycopg.errors.UniqueViolation as exc:
        raise AppError(409, "already_applied", "You have already applied to this job.") from exc
    assert row is not None
    app_id = UUID(str(row["id"]))
    await tx.conn.execute(
        "insert into consents (application_id, candidate_id, text_version, providers, ip_hash)"
        " values (%s, %s, %s, %s, %s)",
        (app_id, user.user_id, body.consent.text_version, Jsonb(s.consent_providers), _ip_hash(client_ip)),
    )
    for qid, answer in body.screening_answers.items():
        await tx.conn.execute(
            "insert into screening_answers (application_id, question_id, answer) values (%s, %s, %s)",
            (app_id, qid[:64], answer[:2000]),
        )
    async with tx.as_system():
        await tx.conn.execute(
            "insert into stage_results (application_id, node_id, status) values (%s, %s, 'pending')", (app_id, first)
        )
        org = await tx.fetchone("select org_id from jobs where id = %s", (body.job_id,))
        await tx.conn.execute(
            "insert into events (actor_id, org_id, type, entity, entity_id, payload)"
            " values (%s, %s, 'application.submitted', 'application', %s, jsonb_build_object('campaign_id', %s::text))",
            (user.user_id, org["org_id"] if org else None, app_id, str(camp["id"])),
        )
    await dispatcher.enqueue(tx, "screening", JobRefs(org_id=org["org_id"] if org else None,
                                                      application_id=app_id, campaign_id=camp["id"],
                                                      job_id=body.job_id))
    return ApplicationCreated(id=app_id)


_TRACKER_SQL = """
select a.id, a.campaign_id, a.created_at, a.current_node, c.status as campaign_status, j.id as job_id,
       j.title as job_title, w.definition,
       s.status as stage_status,
       exists (select 1 from resume_texts r where r.application_id = a.id) as has_text,
       coalesce(f.released, false) as released,
       (select q.deadline_at from quiz_attempts q where q.application_id = a.id and q.submitted_at is null)
         as quiz_deadline,
       (select i.deadline_at from interview_sessions i where i.application_id = a.id and i.finished_at is null
          and i.paused_at is null) as interview_deadline,
       exists (select 1 from interview_sessions i where i.application_id = a.id and i.finished_at is not null)
         as interview_finished
from applications a
join campaigns c on c.id = a.campaign_id
join jobs j on j.id = c.job_id
join workflows w on w.id = a.workflow_id
left join stage_results s on s.application_id = a.id and s.node_id = a.current_node
left join feedback f on f.application_id = a.id
where a.candidate_id = %s
"""


async def tracker(tx: Tx, user: CurrentUser, application_id: UUID | None = None) -> list[TrackerItem]:
    # Candidates cannot read jobs after unpublish, workflows, or unreleased stage rows: this read is
    # done as system and filtered to the caller's own applications; only the computed status leaves.
    async with tx.as_system():
        sql = _TRACKER_SQL + (" and a.id = %s" if application_id else "") + " order by a.created_at desc"
        rows = await tx.fetchall(sql, (user.user_id, application_id) if application_id else (user.user_id,))
    out = []
    for r in rows:
        wf = Workflow.model_validate(r["definition"])
        node_type = wf.node(r["current_node"]).type if r["current_node"] else None
        status, action = candidate_status(r["campaign_status"], r["released"], node_type, r["stage_status"],
                                          r["has_text"], interview_finished=r["interview_finished"])
        deadline = {"quiz": r["quiz_deadline"], "interview": r["interview_deadline"]}.get(action or "")
        out.append(TrackerItem(id=r["id"], job_id=r["job_id"], job_title=r["job_title"],
                               campaign_id=r["campaign_id"], status=status, next_action=action,  # type: ignore[arg-type]
                               action_deadline_at=deadline,
                               created_at=r["created_at"]))
    return out


# ------------------------------------------------------------------ manager

async def _campaign(tx: Tx, campaign_id: UUID) -> dict[str, Any]:
    row = await tx.fetchone(
        "select c.*, j.title as job_title, w.definition from campaigns c join jobs j on j.id = c.job_id"
        " join workflows w on w.id = c.workflow_id where c.id = %s",
        (campaign_id,),
    )
    if row is None:
        raise AppError(404, "campaign_not_found", "This campaign does not exist or is not yours.")
    return dict(row)


async def monitor(tx: Tx, campaign_id: UUID) -> CampaignMonitor:
    c = await _campaign(tx, campaign_id)
    wf = Workflow.model_validate(c["definition"])
    types = {n.id: n.type for n in wf.nodes}
    counts = await tx.fetchall(
        """
        select s.node_id, s.status, count(*)::int as n
        from applications a join stage_results s on s.application_id = a.id and s.node_id = a.current_node
        where a.campaign_id = %s group by 1, 2 order by 1, 2
        """,
        (campaign_id,),
    )
    agg = await tx.fetchone(
        """
        select (select count(*) from applications where campaign_id = %(c)s)::int as total,
               (select count(distinct application_id) from job_runs
                 where campaign_id = %(c)s and status in ('queued', 'running', 'deferred_budget', 'paused')
                   and type <> all(%(waiting)s))::int
                 as processing,
               (select count(*) from applications a join stage_results s on s.application_id = a.id
                 where a.campaign_id = %(c)s and s.status = 'needs_review')::int as needs_review
        """,
        {"c": campaign_id, "waiting": list(WAITING_TYPES)},
    )
    assert agg is not None
    return CampaignMonitor(
        id=c["id"], job_id=c["job_id"], job_title=c["job_title"], status=c["status"], ai_paused=c["ai_paused"],
        total=agg["total"], processing=agg["processing"], needs_review=agg["needs_review"],
        counts=[StageCount(node_id=r["node_id"], node_type=types.get(r["node_id"], "unknown"), status=r["status"],
                           count=r["n"]) for r in counts],
        nodes=[MonitorNode(id=n.id, type=n.type, enabled=getattr(n, "enabled", True)) for n in wf.nodes],
    )


_LATEST_RUN = """
left join lateral (select status, last_error from job_runs jr where jr.application_id = a.id
                   and jr.type not in ('quiz_deadline', 'interview_deadline')
                   order by created_at desc limit 1) jr on true
"""


async def list_applications(tx: Tx, campaign_id: UUID, *, node: str | None, status: str | None, flag: str | None,
                            cursor: str | None, limit: int) -> ApplicationPage:
    c = await _campaign(tx, campaign_id)
    screening_id = Workflow.model_validate(c["definition"]).first_node().id
    offset = int(cursor) if cursor and cursor.isdigit() else 0
    rows = await tx.fetchall(
        f"""
        select a.id, p.display_name, a.created_at, a.current_node, cur.status as stage_status,
               scr.score as screening_score, coalesce(scr.flags, '{{}}') as flags, a.prefilter_score,
               jr.status as job_status
        from applications a
        left join profiles p on p.id = a.candidate_id
        left join stage_results cur on cur.application_id = a.id and cur.node_id = a.current_node
        left join stage_results scr on scr.application_id = a.id and scr.node_id = %(scr)s
        {_LATEST_RUN}
        where a.campaign_id = %(c)s
          and (%(node)s::text is null or a.current_node = %(node)s)
          and (%(status)s::text is null or cur.status = %(status)s)
          and (%(flag)s::text is null or %(flag)s = any(scr.flags))
        order by scr.score desc nulls last, a.prefilter_score desc nulls last, a.created_at, a.id
        limit %(lim)s offset %(off)s
        """,
        {"c": campaign_id, "scr": screening_id, "node": node, "status": status, "flag": flag,
         "lim": limit + 1, "off": offset},
    )
    items = [ApplicationRow(
        id=r["id"], candidate_name=r["display_name"], created_at=r["created_at"], current_node=r["current_node"],
        stage_status=r["stage_status"],
        screening_score=float(r["screening_score"]) if r["screening_score"] is not None else None,
        flags=list(r["flags"]), prefilter_score=float(r["prefilter_score"]) if r["prefilter_score"] is not None
        else None, job_status=r["job_status"],
    ) for r in rows[:limit]]
    return ApplicationPage(items=items, next_cursor=str(offset + limit) if len(rows) > limit else None)


async def detail(tx: Tx, campaign_id: UUID, application_id: UUID) -> ApplicationDetail:
    c = await _campaign(tx, campaign_id)
    types = {n.id: n.type for n in Workflow.model_validate(c["definition"]).nodes}
    a = await tx.fetchone(
        f"""
        select a.*, p.display_name, jr.status as job_status, jr.last_error
        from applications a left join profiles p on p.id = a.candidate_id {_LATEST_RUN}
        where a.id = %s and a.campaign_id = %s
        """,
        (application_id, campaign_id),
    )
    if a is None:
        raise AppError(404, "application_not_found", "This application does not exist or is not yours.")
    stages = await tx.fetchall("select * from stage_results where application_id = %s order by created_at",
                               (application_id,))
    rt = await tx.fetchone(
        "select redacted_lines, injection_flags, parser from resume_texts where application_id = %s",
        (application_id,),
    )
    answers = await tx.fetchall("select question_id, answer from screening_answers where application_id = %s",
                                (application_id,))
    return ApplicationDetail(
        id=a["id"], campaign_id=a["campaign_id"], candidate_name=a["display_name"], created_at=a["created_at"],
        current_node=a["current_node"],
        prefilter_score=float(a["prefilter_score"]) if a["prefilter_score"] is not None else None,
        stages=[StageDetail(
            node_id=s["node_id"], node_type=types.get(s["node_id"], "unknown"), status=s["status"],
            score=float(s["score"]) if s["score"] is not None else None,
            evidence=s["evidence"] if isinstance(s["evidence"], list) else [],  # drafts are not shown
            flags=list(s["flags"]), model_id=s["model_id"], prompt_version=s["prompt_version"],
            updated_at=s["updated_at"],
        ) for s in stages],
        resume=ResumeView(lines=list(rt["redacted_lines"]), injection_flags=list(rt["injection_flags"]),
                          parser=rt["parser"]) if rt else None,
        screening_answers={r["question_id"]: r["answer"] for r in answers},
        job_status=a["job_status"], job_error=a["last_error"],
        quiz=await quiz_review(tx, application_id),
        interview=await interview_review(tx, application_id),
        feedback=await feedback_of(tx, application_id),
    )


async def retry(tx: Tx, user: CurrentUser, campaign_id: UUID, application_id: UUID) -> Queued:
    """Re-run screening for an application whose screening stage needs review."""
    c = await _campaign(tx, campaign_id)
    if c["status"] != "open":
        raise AppError(409, "stage_closed", "This campaign is no longer open.")
    screening_id = Workflow.model_validate(c["definition"]).first_node().id
    row = await tx.fetchone(
        "select s.status from applications a join stage_results s on s.application_id = a.id and s.node_id = %s"
        " where a.id = %s and a.campaign_id = %s",
        (screening_id, application_id, campaign_id),
    )
    if row is None:
        raise AppError(404, "application_not_found", "This application does not exist or is not yours.")
    if row["status"] != "needs_review":
        raise AppError(409, "not_retryable", "Only applications that need review can be re-run.")
    busy = await tx.fetchone(
        "select 1 from job_runs where application_id = %s and status in ('queued', 'running')", (application_id,)
    )
    if busy:
        raise AppError(409, "already_processing", "This application is already being processed.")
    run_id = await dispatcher.enqueue(tx, "screening", JobRefs(org_id=user.org_id, application_id=application_id,
                                                               campaign_id=campaign_id, job_id=c["job_id"]))
    async with tx.as_system():
        await tx.conn.execute(
            "insert into events (actor_id, org_id, type, entity, entity_id) values (%s, %s, 'application.retry',"
            " 'application', %s)",
            (user.user_id, user.org_id, application_id),
        )
    return Queued(job_run_id=run_id)
