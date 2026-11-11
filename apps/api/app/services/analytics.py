"""Analytics (backend plan §17). Plain SQL run as the caller, so RLS scopes every number: a manager
sees their organisation, a candidate sees their own applications and only released results.

Queries rather than database views: they live next to their tests, and with RLS applied to the
caller the effect is the same as `security_invoker` views.
"""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.auth import CurrentUser
from app.core.db import Tx
from app.core.errors import AppError
from app.domain.workflow import ScreeningNode, Workflow
from app.services.applications import candidate_status

BINS = 10
CUTOFF_DELTAS = (-10, -5, 0, 5, 10)


# ------------------------------------------------------------------ models

class FunnelStep(BaseModel):
    node_id: str
    node_type: str
    reached: int
    passed: int
    failed: int
    needs_review: int
    active: int = Field(description="Pending or in progress")
    drop_off_pct: float | None = Field(description="Share of the previous step's reached who did not reach this one")


class Distribution(BaseModel):
    node_id: str
    node_type: str
    bins: list[int] = Field(description="10 counts: 0–9, 10–19, …, 90–100")
    cutoff: int | None = None
    scored: int


class CutoffRow(BaseModel):
    delta: int
    cutoff: int
    passing: int


class StageTime(BaseModel):
    node_id: str
    node_type: str
    median_hours: float | None
    completed: int


class Ratio(BaseModel):
    share: float | None = Field(description="0–1, or null when there is nothing to measure")
    n: int


class ModelUse(BaseModel):
    model_id: str
    stages_scored: int


class CampaignAnalytics(BaseModel):
    campaign_id: UUID
    job_title: str
    status: str
    applications: int
    funnel: list[FunnelStep]
    distributions: list[Distribution]
    cutoff_impact: list[CutoffRow]
    time_per_stage: list[StageTime]
    feedback_acceptance: Ratio = Field(description="Released AI drafts sent without edits")
    recommendation_agreement: Ratio = Field(description="Manager recommendation equal to the AI suggestion")
    model_usage: list[ModelUse]


class Bucket(BaseModel):
    start: date
    count: int


class Overview(BaseModel):
    open_jobs: int
    applications: int
    campaigns_completed: int
    applications_per_week: list[Bucket]
    completed_per_month: list[Bucket]
    time_to_shortlist_hours: float | None = Field(description="Median, first application → campaign completed")
    feedback_acceptance: Ratio
    recommendation_agreement: Ratio


class Progress(BaseModel):
    application_id: UUID
    job_title: str
    status: str
    reached: int
    total: int


class ReleasedScore(BaseModel):
    application_id: UUID
    job_title: str
    released_at: date
    screening: float | None
    quiz: float | None
    interview: float | None


class CandidateAnalytics(BaseModel):
    applications: int
    applications_per_week: list[Bucket]
    progress: list[Progress]
    scores: list[ReleasedScore] = Field(description="Released applications only, oldest first")
    median_days_to_outcome: float | None
    stage_completion: Ratio = Field(description="Quizzes and interviews finished out of those invited to")


# ------------------------------------------------------------------ helpers

def _bins(scores: list[float]) -> list[int]:
    out = [0] * BINS
    for s in scores:
        out[min(BINS - 1, max(0, int(s // 10)))] += 1
    return out


def _ratio(row: dict[str, Any] | None) -> Ratio:
    n = int((row or {}).get("n") or 0)
    hits = int((row or {}).get("hits") or 0)
    return Ratio(share=round(hits / n, 3) if n else None, n=n)


_FEEDBACK_RATIOS = """
select
  count(*) filter (where f.released and f.ai_draft is not null) as acc_n,
  count(*) filter (where f.released and f.ai_draft is not null and f.edited_text is null) as acc_hits,
  count(*) filter (where f.recommendation is not null and f.ai_recommendation is not null) as agr_n,
  count(*) filter (where f.recommendation is not null and f.recommendation = f.ai_recommendation) as agr_hits
from feedback f join applications a on a.id = f.application_id
"""


def _ratios(row: dict[str, Any] | None) -> tuple[Ratio, Ratio]:
    r = row or {}
    return (_ratio({"n": r.get("acc_n"), "hits": r.get("acc_hits")}),
            _ratio({"n": r.get("agr_n"), "hits": r.get("agr_hits")}))


# ------------------------------------------------------------------ manager: one campaign

async def campaign(tx: Tx, campaign_id: UUID) -> CampaignAnalytics:
    c = await tx.fetchone(
        "select c.id, c.status, j.title, w.definition from campaigns c join jobs j on j.id = c.job_id"
        " join workflows w on w.id = c.workflow_id where c.id = %s", (campaign_id,))
    if c is None:
        raise AppError(404, "campaign_not_found", "This campaign does not exist or is not yours.")
    wf = Workflow.model_validate(c["definition"])
    nodes = [n for n in wf.nodes if getattr(n, "enabled", True)]
    apps = await tx.fetchone("select count(*) as n from applications where campaign_id = %s", (campaign_id,))
    rows = await tx.fetchall(
        """
        select s.node_id, s.status, s.score, s.model_id,
               extract(epoch from (s.updated_at - s.created_at)) / 3600.0 as hours
        from stage_results s join applications a on a.id = s.application_id
        where a.campaign_id = %s
        """, (campaign_id,))
    by_node: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_node.setdefault(r["node_id"], []).append(dict(r))

    funnel: list[FunnelStep] = []
    prev: int | None = None
    for n in nodes:
        rs = by_node.get(n.id, [])
        count = {k: sum(r["status"] == k for r in rs) for k in ("passed", "failed", "needs_review")}
        reached = len(rs)
        funnel.append(FunnelStep(
            node_id=n.id, node_type=n.type, reached=reached, passed=count["passed"], failed=count["failed"],
            needs_review=count["needs_review"], active=reached - sum(count.values()),
            drop_off_pct=round(100 * (1 - reached / prev), 1) if prev else None))
        prev = reached

    dists = []
    for n in nodes:
        if n.type == "final":
            continue
        scores = [float(r["score"]) for r in by_node.get(n.id, []) if r["score"] is not None]
        cutoff = n.config.cutoff if isinstance(n, ScreeningNode) else (
            getattr(n.config, "pass_mark", None) or getattr(n.config, "pass_threshold", None))
        dists.append(Distribution(node_id=n.id, node_type=n.type, bins=_bins(scores), cutoff=cutoff,
                                  scored=len(scores)))

    screening = next(n for n in nodes if isinstance(n, ScreeningNode))
    sscores = [float(r["score"]) for r in by_node.get(screening.id, []) if r["score"] is not None]
    impact = []
    for d in CUTOFF_DELTAS:
        cut = max(0, min(100, screening.config.cutoff + d))
        impact.append(CutoffRow(delta=d, cutoff=cut, passing=sum(s >= cut for s in sscores)))

    times = []
    for n in nodes:
        if n.type == "final":
            continue
        done = sorted(float(r["hours"]) for r in by_node.get(n.id, []) if r["status"] in ("passed", "failed"))
        times.append(StageTime(node_id=n.id, node_type=n.type, completed=len(done),
                               median_hours=round(_median(done), 2) if done else None))

    ratios = await tx.fetchone(_FEEDBACK_RATIOS + " where a.campaign_id = %s", (campaign_id,))
    acc, agr = _ratios(ratios)
    models: dict[str, int] = {}
    for r in rows:
        if r["model_id"]:
            models[r["model_id"]] = models.get(r["model_id"], 0) + 1
    return CampaignAnalytics(
        campaign_id=campaign_id, job_title=c["title"], status=c["status"], applications=int(apps["n"] if apps else 0),
        funnel=funnel, distributions=dists, cutoff_impact=impact, time_per_stage=times, feedback_acceptance=acc,
        recommendation_agreement=agr,
        model_usage=[ModelUse(model_id=m, stages_scored=k) for m, k in sorted(models.items(), key=lambda x: -x[1])],
    )


def _median(xs: list[float]) -> float:
    k = len(xs)
    return xs[k // 2] if k % 2 else (xs[k // 2 - 1] + xs[k // 2]) / 2


# ------------------------------------------------------------------ manager: overview

async def overview(tx: Tx, user: CurrentUser, *, today: date | None = None) -> Overview:
    t = "coalesce(%(today)s::date, current_date)"
    p = {"today": today}
    totals = await tx.fetchone(
        """
        select (select count(*) from jobs where status = 'published') as open_jobs,
               (select count(*) from applications) as applications,
               (select count(*) from campaigns where status = 'completed') as completed
        """)
    weeks = await tx.fetchall(
        f"""
        select w::date as start, count(a.id) as count
        from generate_series(date_trunc('week', {t}) - interval '11 weeks', date_trunc('week', {t}),
                             interval '1 week') w
        left join applications a on date_trunc('week', a.created_at) = w
        group by w order by w
        """, p)
    months = await tx.fetchall(
        f"""
        select m::date as start, count(c.id) as count
        from generate_series(date_trunc('month', {t}) - interval '11 months', date_trunc('month', {t}),
                             interval '1 month') m
        left join campaigns c on c.status = 'completed' and date_trunc('month', c.completed_at) = m
        group by m order by m
        """, p)
    shortlist = await tx.fetchone(
        """
        select percentile_cont(0.5) within group (order by extract(epoch from c.completed_at - f.first) / 3600.0)
               as hours
        from campaigns c
        join lateral (select min(a.created_at) as first from applications a where a.campaign_id = c.id) f on true
        where c.status = 'completed' and f.first is not null
        """)
    acc, agr = _ratios(await tx.fetchone(_FEEDBACK_RATIOS))
    h = shortlist["hours"] if shortlist else None
    return Overview(
        open_jobs=int(totals["open_jobs"]) if totals else 0, applications=int(totals["applications"]) if totals else 0,
        campaigns_completed=int(totals["completed"]) if totals else 0,
        applications_per_week=[Bucket(start=r["start"], count=r["count"]) for r in weeks],
        completed_per_month=[Bucket(start=r["start"], count=r["count"]) for r in months],
        time_to_shortlist_hours=round(float(h), 1) if h is not None else None,
        feedback_acceptance=acc, recommendation_agreement=agr,
    )


# ------------------------------------------------------------------ candidate

async def candidate(tx: Tx, user: CurrentUser, *, today: date | None = None) -> CandidateAnalytics:
    apps = await tx.fetchall("select id, created_at, campaign_id, workflow_id, current_node from applications"
                             " where candidate_id = %s order by created_at", (user.user_id,))
    weeks = await tx.fetchall(
        """
        select w::date as start, count(a.id) as count
        from generate_series(date_trunc('week', coalesce(%(today)s::date, current_date)) - interval '11 weeks',
                             date_trunc('week', coalesce(%(today)s::date, current_date)), interval '1 week') w
        left join applications a on a.candidate_id = %(u)s and date_trunc('week', a.created_at) = w
        group by w order by w
        """, {"today": today, "u": user.user_id})
    # Released stage results and feedback through RLS (nothing before release).
    released = await tx.fetchall(
        "select f.application_id, f.released_at from feedback f where f.released"
        " and f.application_id = any(%s)", ([a["id"] for a in apps],))
    rel = {r["application_id"]: r["released_at"] for r in released}
    stage_rows = await tx.fetchall(
        "select application_id, node_id, score from stage_results where application_id = any(%s)",
        ([a["id"] for a in apps],))
    scores: dict[Any, dict[str, Any]] = {}
    for r in stage_rows:
        scores.setdefault(r["application_id"], {})[r["node_id"]] = r["score"]
    async with tx.as_system():  # workflows, current stage and attempts for the caller's own applications
        meta = await tx.fetchall(
            """
            select a.id, j.title, w.definition, c.status as campaign_status, s.status as stage_status,
                   exists (select 1 from resume_texts r where r.application_id = a.id) as has_text,
                   (select count(*) from stage_results x where x.application_id = a.id) as reached,
                   (select count(*) from stage_results x join workflows ww on ww.id = a.workflow_id
                     where x.application_id = a.id and x.node_id in (
                       select n->>'id' from jsonb_array_elements(ww.definition->'nodes') n
                       where n->>'type' in ('quiz', 'interview'))) as invited,
                   (select count(*) from quiz_attempts q where q.application_id = a.id and q.submitted_at is not null)
                   + (select count(*) from interview_sessions i where i.application_id = a.id
                      and i.finished_at is not null) as finished
            from applications a join campaigns c on c.id = a.campaign_id join jobs j on j.id = c.job_id
            join workflows w on w.id = a.workflow_id
            left join stage_results s on s.application_id = a.id and s.node_id = a.current_node
            where a.candidate_id = %s order by a.created_at
            """, (user.user_id,))
    progress, out_scores, days, invited, finished = [], [], [], 0, 0
    created = {a["id"]: a["created_at"] for a in apps}
    for m in meta:
        wf = Workflow.model_validate(m["definition"])
        enabled = [n for n in wf.nodes if getattr(n, "enabled", True)]
        node_type = next((n.type for n in enabled if n.id == next(
            (a["current_node"] for a in apps if a["id"] == m["id"]), None)), None)
        status, _ = candidate_status(m["campaign_status"], m["id"] in rel, node_type, m["stage_status"], m["has_text"])
        progress.append(Progress(application_id=m["id"], job_title=m["title"], status=status,
                                 reached=min(int(m["reached"]), len(enabled)), total=len(enabled)))
        invited += int(m["invited"])
        finished += int(m["finished"])
        if m["id"] in rel:
            by_type = {n.type: scores.get(m["id"], {}).get(n.id) for n in enabled}
            f = lambda v: float(v) if v is not None else None  # noqa: E731
            out_scores.append(ReleasedScore(application_id=m["id"], job_title=m["title"],
                                            released_at=rel[m["id"]].date(), screening=f(by_type.get("screening")),
                                            quiz=f(by_type.get("quiz")), interview=f(by_type.get("interview"))))
            days.append((rel[m["id"]] - created[m["id"]]).total_seconds() / 86400)
    out_scores.sort(key=lambda s: s.released_at)
    return CandidateAnalytics(
        applications=len(apps), applications_per_week=[Bucket(start=r["start"], count=r["count"]) for r in weeks],
        progress=progress, scores=out_scores,
        median_days_to_outcome=round(_median(sorted(days)), 1) if days else None,
        stage_completion=Ratio(share=round(finished / invited, 3) if invited else None, n=invited),
    )
