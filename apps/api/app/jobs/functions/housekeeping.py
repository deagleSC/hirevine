"""Every 30 minutes (backend plan §10.2): keep Supabase awake, re-send lost events, re-queue
budget-deferred runs once the daily cap has reset at 00:00 UTC, and drop old rate-limit counters."""

from __future__ import annotations

import inngest

from app.core import ratelimit
from app.core.db import system_claims, transaction
from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.dispatcher import dispatcher


async def ping_db() -> bool:
    async with transaction(system_claims()) as tx:
        await tx.fetchone("select 1")
    return True


async def resend_stuck_runs() -> int:
    stuck = await runs.stuck_queued()
    for run in stuck:
        await dispatcher.resend(run)
    return len(stuck)


async def purge_rate_limits() -> int:
    async with transaction(system_claims()) as tx:
        return await ratelimit.purge_old(tx)


async def resume_budget_deferred() -> int:
    claimed = await runs.claim_budget_deferred()
    for run in claimed:
        await dispatcher.resend(run)
    return len(claimed)


@inngest_client.create_function(
    fn_id="housekeeping",
    trigger=inngest.TriggerCron(cron="*/30 * * * *"),
    retries=1,
)
async def housekeeping(ctx: inngest.Context) -> dict[str, int]:
    await ctx.step.run("ping_db", ping_db)
    resent = await ctx.step.run("resend_stuck_runs", resend_stuck_runs)
    resumed = await ctx.step.run("resume_budget_deferred", resume_budget_deferred)
    purged = await ctx.step.run("purge_rate_limits", purge_rate_limits)
    return {"resent": resent, "resumed": resumed, "rate_limit_rows_purged": purged}
