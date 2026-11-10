"""Jobs for managers: list, detail, edit, create from a confirmed chat, publish (backend plan §7.2)."""

from __future__ import annotations

import secrets
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, StringConstraints

from app.core.auth import CurrentUser
from app.core.db import Tx
from app.core.errors import AppError
from app.domain.workflow import Workflow
from app.services import workflows as wf_svc

JobStatus = Literal["draft", "published", "closed"]


class CampaignSummary(BaseModel):
    id: UUID
    status: Literal["draft", "open", "completed"]
    applicants: int
    share_slug: str | None = None


class Job(BaseModel):
    id: UUID
    title: str
    description: str
    location: str | None
    seniority: str | None
    status: JobStatus
    workflow_version: int | None
    campaign: CampaignSummary | None = None
    created_at: str
    updated_at: str


class JobUpdate(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] | None = None
    description: Annotated[str, StringConstraints(max_length=8000)] | None = None
    location: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    seniority: Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)] | None = None


class Published(BaseModel):
    job_id: UUID
    campaign_id: UUID
    workflow_version: int
    share_slug: str


_JOB_SQL = """
select j.*,
  (select max(version) from workflows w where w.job_id = j.id) as workflow_version,
  c.id as campaign_id, c.status as campaign_status,
  (select count(*) from applications a where a.campaign_id = c.id) as applicants,
  (select slug from job_share_links s where s.job_id = j.id and s.revoked_at is null
     order by created_at desc limit 1) as share_slug
from jobs j
left join lateral (select * from campaigns c where c.job_id = j.id order by created_at desc limit 1) c on true
"""


def _job(r: dict[str, Any]) -> Job:
    camp = None
    if r.get("campaign_id"):
        camp = CampaignSummary(id=r["campaign_id"], status=r["campaign_status"], applicants=r["applicants"] or 0,
                               share_slug=r["share_slug"])
    return Job(
        id=r["id"], title=r["title"], description=r["description"], location=r["location"],
        seniority=r["seniority"], status=r["status"], workflow_version=r["workflow_version"], campaign=camp,
        created_at=r["created_at"].isoformat(), updated_at=r["updated_at"].isoformat(),
    )


async def list_jobs(tx: Tx) -> list[Job]:
    # Managers can read their org's applications for the count, via RLS.
    rows = await tx.fetchall(_JOB_SQL + " order by j.updated_at desc")
    return [_job(dict(r)) for r in rows]


async def get_job(tx: Tx, job_id: UUID) -> Job:
    row = await tx.fetchone(_JOB_SQL + " where j.id = %s", (job_id,))
    if row is None:
        raise AppError(404, "job_not_found", "This job does not exist or is not yours.")
    return _job(dict(row))


async def update_job(tx: Tx, job_id: UUID, body: JobUpdate, user: CurrentUser) -> Job:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return await get_job(tx, job_id)
    sets = ", ".join(f"{k} = %({k})s" for k in changes)
    row = await tx.fetchone(f"update jobs set {sets}, updated_at = now() where id = %(id)s returning id",
                            {**changes, "id": job_id})
    if row is None:
        raise AppError(404, "job_not_found", "This job does not exist or is not yours.")
    await tx.conn.execute(
        "insert into events (actor_id, org_id, type, entity, entity_id, payload)"
        " values (%s, %s, 'job.updated', 'job', %s, jsonb_build_object('fields', %s::text[]))",
        (user.user_id, user.org_id, job_id, list(changes)),
    )
    return await get_job(tx, job_id)


async def create_job(tx: Tx, user: CurrentUser, *, title: str, description: str, location: str | None,
                     seniority: str | None, workflow: Workflow) -> UUID:
    row = await tx.fetchone(
        "insert into jobs (org_id, title, description, location, seniority) values (%s, %s, %s, %s, %s) returning id",
        (user.org_id, title, description, location, seniority),
    )
    assert row is not None
    job_id = UUID(str(row["id"]))
    await wf_svc.create_initial(tx, job_id, workflow, user.user_id)
    await tx.conn.execute(
        "insert into events (actor_id, org_id, type, entity, entity_id) values (%s, %s, 'job.created', 'job', %s)",
        (user.user_id, user.org_id, job_id),
    )
    return job_id


def _slug(title: str) -> str:
    base = "".join(ch if ch.isalnum() else "-" for ch in title.lower()).strip("-")
    base = "-".join(p for p in base.split("-") if p)[:40].strip("-") or "job"
    return f"{base}-{secrets.token_hex(3)}"


async def publish(tx: Tx, job_id: UUID, user: CurrentUser) -> Published:
    """Freeze the latest version for a new open campaign, publish the job, create a share link."""
    job = await tx.fetchone("select id, title, status from jobs where id = %s for update", (job_id,))
    if job is None:
        raise AppError(404, "job_not_found", "This job does not exist or is not yours.")
    open_c = await tx.fetchone("select id from campaigns where job_id = %s and status = 'open'", (job_id,))
    if open_c is not None:
        raise AppError(409, "already_published", "This job already has an open campaign.",
                       {"campaign_id": str(open_c["id"])})
    latest = await wf_svc.latest(tx, job_id)
    wf = latest.definition
    final = next(n for n in wf.nodes if n.type == "final")
    camp = await tx.fetchone(
        "insert into campaigns (job_id, workflow_id, status, notify_on_complete) values (%s, %s, 'open', %s)"
        " returning id",
        (job_id, latest.id, final.config.notify_on_complete),  # type: ignore[union-attr]
    )
    assert camp is not None
    await tx.conn.execute("update jobs set status = 'published', updated_at = now() where id = %s", (job_id,))
    slug = _slug(job["title"])
    await tx.conn.execute("insert into job_share_links (slug, job_id) values (%s, %s)", (slug, job_id))
    await tx.conn.execute(
        "insert into events (actor_id, org_id, type, entity, entity_id, payload)"
        " values (%s, %s, 'job.published', 'job', %s,"
        " jsonb_build_object('campaign_id', %s::text, 'workflow_version', %s::int))",
        (user.user_id, user.org_id, job_id, str(camp["id"]), latest.version),
    )
    return Published(job_id=job_id, campaign_id=camp["id"], workflow_version=latest.version, share_slug=slug)


