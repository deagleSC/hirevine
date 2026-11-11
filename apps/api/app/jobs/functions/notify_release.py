"""`notify-release` (backend plan §10.2, §16): after a campaign completes with notifying on, add an
in-app notification for every released application, one step per batch of 50 (fewer executions)."""

from __future__ import annotations

import inngest

from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.functions.common import mark_failed_on_failure, run_id_of
from app.services import report


@inngest_client.create_function(
    fn_id="notify-release",
    trigger=inngest.TriggerEvent(event="campaign/completed"),
    retries=5,
    on_failure=mark_failed_on_failure,
)
async def notify_release(ctx: inngest.Context) -> int:
    run_id = run_id_of(ctx)
    campaign_id = str(ctx.event.data["campaign_id"])
    if not await ctx.step.run("mark_running", runs.mark_running, run_id, ctx.run_id):
        return 0
    targets: list[str] = list(await ctx.step.run("targets", report.release_targets, campaign_id))
    sent = 0
    for i in range(0, len(targets), report.NOTIFY_BATCH):
        sent += int(await ctx.step.run(f"notify_{i // report.NOTIFY_BATCH}", report.notify_batch, campaign_id,
                                       targets[i:i + report.NOTIFY_BATCH]))
    await ctx.step.run("mark_done", runs.mark_done, run_id)
    return sent
