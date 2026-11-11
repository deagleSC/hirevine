"""`retention-purge` (backend plan §18): daily at 03:00 UTC, delete candidate data of campaigns that
completed more than RETENTION_DAYS ago, one step per batch of 100 applications."""

from __future__ import annotations

import inngest

from app.jobs.client import inngest_client
from app.services import retention

MAX_BATCHES = 200  # per run; anything left is picked up the next day


@inngest_client.create_function(
    fn_id="retention-purge",
    trigger=inngest.TriggerCron(cron="0 3 * * *"),
    retries=3,
    concurrency=[inngest.Concurrency(limit=1)],
)
async def retention_purge(ctx: inngest.Context) -> dict[str, int]:
    campaigns: list[str] = list(await ctx.step.run("due_campaigns", retention.due_campaigns))
    total, batches = 0, 0
    for cid in campaigns:
        deleted = 0
        while batches < MAX_BATCHES:
            n = int(await ctx.step.run(f"purge_{cid}_{batches}", retention.purge_batch, cid))
            batches += 1
            deleted += n
            if n < retention.BATCH:
                break
        await ctx.step.run(f"finish_{cid}", retention.finish, cid, deleted)
        total += deleted
    return {"campaigns": len(campaigns), "applications_deleted": total}
