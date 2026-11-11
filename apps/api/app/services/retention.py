"""Retention (backend plan §18): candidate data is deleted RETENTION_DAYS (180) after a campaign
completes. Runs daily as `retention-purge`.

For each due campaign, in batches: delete the resume files, the resume embeddings (no foreign key),
then the applications themselves, which cascades to consents, screening answers, resume text, stage
results and evidence, quiz attempts, interview transcripts, feedback and notifications about them.
The campaign and job stay, with `purged_at` set, so the manager can see why a campaign is empty.
Candidate accounts are not deleted here (candidates delete their own from the Account page).
Every step is idempotent: a retried batch finds fewer rows and carries on.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from psycopg.types.json import Jsonb

from app.core.config import get_settings
from app.core.db import system_claims, transaction
from app.services.storage import StorageError, get_storage

BATCH = 100


async def due_campaigns(now: datetime | None = None) -> list[str]:
    cutoff = (now or datetime.now(UTC)) - timedelta(days=get_settings().retention_days)
    async with transaction(system_claims()) as tx:
        rows = await tx.fetchall(
            "select id from campaigns where status = 'completed' and purged_at is null and completed_at < %s"
            " order by completed_at limit 50", (cutoff,))
    return [str(r["id"]) for r in rows]


async def purge_batch(campaign_id: str) -> int:
    """Delete up to BATCH applications of one campaign (files first). Returns how many were deleted."""
    async with transaction(system_claims()) as tx:
        apps = await tx.fetchall("select id, resume_path from applications where campaign_id = %s limit %s",
                                 (campaign_id, BATCH))
    storage = get_storage()
    for a in apps:
        try:
            await storage.delete(a["resume_path"])
        except StorageError as exc:  # already gone is fine; anything else retries the step
            if "404" not in str(exc):
                raise
    ids = [a["id"] for a in apps]
    if not ids:
        return 0
    async with transaction(system_claims()) as tx:
        await tx.conn.execute("delete from embeddings where kind = 'resume_chunk' and parent_id = any(%s)", (ids,))
        await tx.conn.execute(
            "delete from notifications where payload ->> 'application_id' = any(%s)", ([str(i) for i in ids],))
        await tx.conn.execute("delete from applications where id = any(%s)", (ids,))
    return len(ids)


async def finish(campaign_id: str, deleted: int) -> dict[str, Any]:
    async with transaction(system_claims()) as tx:
        left = await tx.fetchone("select count(*) as n from applications where campaign_id = %s", (campaign_id,))
        if left and int(left["n"]):
            return {"done": False, "left": int(left["n"])}
        row = await tx.fetchone(
            "update campaigns c set purged_at = now() from jobs j where c.id = %s and j.id = c.job_id"
            " and c.purged_at is null returning j.org_id", (campaign_id,))
        if row is not None:
            await tx.conn.execute(
                "insert into events (org_id, type, entity, entity_id, payload) values (%s, 'retention.purged',"
                " 'campaign', %s, %s)",
                (row["org_id"], campaign_id, Jsonb({"applications": deleted,
                                                     "retention_days": get_settings().retention_days})))
    return {"done": True, "deleted": deleted}
