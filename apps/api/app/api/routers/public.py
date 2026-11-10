"""Published jobs, no sign-in needed (backend plan §7.3): browse, detail, share-link resolution."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.db import transaction
from app.core.errors import ERROR_RESPONSES, AppError
from app.domain.workflow import Workflow

router = APIRouter(prefix="/v1/public", tags=["public"], responses=ERROR_RESPONSES)

PUBLIC = {"role": "public"}


class PublicStage(BaseModel):
    type: Literal["screening", "quiz", "interview", "final"]
    time_limit_min: int | None = None
    question_count: int | None = None
    turn_cap: int | None = None


class PublicJob(BaseModel):
    id: UUID
    title: str
    description: str
    location: str | None
    seniority: str | None
    published_at: str


class PublicJobDetail(PublicJob):
    stages: list[PublicStage]


class PublicJobPage(BaseModel):
    items: list[PublicJob]
    next_cursor: str | None


def _stages(definition: dict[str, Any]) -> list[PublicStage]:
    """What a candidate will go through: stage types and limits, never criteria, cutoffs or answers."""
    out = []
    for n in Workflow.model_validate(definition).nodes:
        if not getattr(n, "enabled", True):
            continue
        st = PublicStage(type=n.type)
        if n.type == "quiz":
            st.time_limit_min, st.question_count = n.config.time_limit_min, len(n.config.questions)
        elif n.type == "interview":
            st.turn_cap = n.config.turn_cap
        out.append(st)
    return out


_JOB = """
select j.id, j.title, j.description, j.location, j.seniority, c.created_at as published_at, c.workflow_id
from jobs j join campaigns c on c.job_id = j.id and c.status = 'open'
where j.status = 'published'
"""


@router.get("/jobs", response_model=PublicJobPage)
async def list_jobs(q: str | None = None, location: str | None = None, seniority: str | None = None,
                    cursor: str | None = None, limit: int = Query(20, ge=1, le=50)) -> PublicJobPage:
    offset = int(cursor) if cursor and cursor.isdigit() else 0
    async with transaction(PUBLIC) as tx:
        rows = await tx.fetchall(
            _JOB + """
            and (%(q)s::text is null or j.search @@ websearch_to_tsquery('english', %(q)s))
            and (%(loc)s::text is null or j.location ilike '%%' || %(loc)s || '%%')
            and (%(sen)s::text is null or j.seniority = %(sen)s)
            order by case when %(q)s::text is null then 0
                          else ts_rank(j.search, websearch_to_tsquery('english', %(q)s)) end desc,
                     c.created_at desc, j.id
            limit %(lim)s offset %(off)s
            """,
            {"q": q or None, "loc": location or None, "sen": seniority or None, "lim": limit + 1, "off": offset},
        )
    items = [PublicJob(**{**r, "published_at": r["published_at"].isoformat()}) for r in rows[:limit]]
    return PublicJobPage(items=items, next_cursor=str(offset + limit) if len(rows) > limit else None)


async def _detail(job_id: UUID) -> PublicJobDetail:
    async with transaction(PUBLIC) as tx:
        row = await tx.fetchone(_JOB + " and j.id = %s", (job_id,))
        if row is None:
            raise AppError(404, "job_not_found", "This job is not open.")
        async with tx.as_system():  # workflows are manager-only; only stage types and limits leave
            wf = await tx.fetchone("select definition from workflows where id = %s", (row["workflow_id"],))
    assert wf is not None
    return PublicJobDetail(**{**row, "published_at": row["published_at"].isoformat()},
                           stages=_stages(wf["definition"]))


@router.get("/jobs/{job_id}", response_model=PublicJobDetail)
async def get_job(job_id: UUID) -> PublicJobDetail:
    return await _detail(job_id)


@router.get("/share/{slug}", response_model=PublicJobDetail)
async def resolve_share(slug: str) -> PublicJobDetail:
    async with transaction(PUBLIC) as tx:
        row = await tx.fetchone("select job_id from job_share_links where slug = %s", (slug,))
    if row is None:
        raise AppError(404, "job_not_found", "This link is no longer active.")
    return await _detail(row["job_id"])


class ConsentInfo(BaseModel):
    text_version: str
    providers: list[str]


@router.get("/consent", response_model=ConsentInfo)
async def consent() -> ConsentInfo:
    """The consent version applications must quote, and the processors named in the consent text (§18)."""
    s = get_settings()
    return ConsentInfo(text_version=s.consent_text_version, providers=s.consent_providers)
