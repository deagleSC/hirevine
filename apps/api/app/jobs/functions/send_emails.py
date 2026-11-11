"""`send-emails` (pilot): email pending notifications through Resend, in batches of 50."""

from __future__ import annotations

import inngest

from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.functions.common import mark_failed_on_failure, run_id_of
from app.services import email

MAX_BATCHES = 10


@inngest_client.create_function(
    fn_id="send-emails",
    trigger=inngest.TriggerEvent(event="notifications/created"),
    retries=5,
    concurrency=[inngest.Concurrency(limit=1)],
    on_failure=mark_failed_on_failure,
)
async def send_emails(ctx: inngest.Context) -> int:
    run_id = run_id_of(ctx)
    if not await ctx.step.run("mark_running", runs.mark_running, run_id, ctx.run_id):
        return 0
    total = 0
    for i in range(MAX_BATCHES):
        n = int(await ctx.step.run(f"send_{i}", email.send_pending))
        total += n
        if n < email.BATCH:
            break
    await ctx.step.run("mark_done", runs.mark_done, run_id)
    return total
