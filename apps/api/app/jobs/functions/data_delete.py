"""`data-delete` (backend plan §18): erase a candidate's account and data on request. Every part is
idempotent, so a retried step finishes the job without errors."""

from __future__ import annotations

import inngest

from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.functions.common import mark_failed_on_failure, run_id_of
from app.services import privacy


@inngest_client.create_function(
    fn_id="data-delete",
    trigger=inngest.TriggerEvent(event="privacy/delete.requested"),
    retries=5,
    concurrency=[inngest.Concurrency(limit=1)],
    on_failure=mark_failed_on_failure,
)
async def data_delete(ctx: inngest.Context) -> str:
    run_id = run_id_of(ctx)
    if not await ctx.step.run("mark_running", runs.mark_running, run_id, ctx.run_id):
        return "duplicate"
    out = str(await ctx.step.run("delete", privacy.delete_account, run_id))
    await ctx.step.run("mark_done", runs.mark_done, run_id)
    return out
