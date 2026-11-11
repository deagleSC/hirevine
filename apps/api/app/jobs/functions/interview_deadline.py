"""`interview-deadline` (backend plan §10.2, §15): sleep until the session's deadline plus a 30 s
grace, then finish it if it is still open. A pause moves the deadline (or, while paused, the check
waits for the two-day pause limit), so the function re-reads the deadline and sleeps again."""

from __future__ import annotations

from datetime import datetime

import inngest

from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.functions.common import mark_failed_on_failure, run_id_of
from app.services import interview

MAX_CHECKS = 12  # each pause can push the deadline once; more than this is not a real session


@inngest_client.create_function(
    fn_id="interview-deadline",
    trigger=inngest.TriggerEvent(event="interview/started"),
    retries=5,
    on_failure=mark_failed_on_failure,
)
async def interview_deadline(ctx: inngest.Context) -> str:
    run_id = run_id_of(ctx)
    app_id = str(ctx.event.data["application_id"])
    if not await ctx.step.run("mark_running", runs.mark_running, run_id, ctx.run_id):
        return "duplicate"
    out = "not_due"
    for i in range(MAX_CHECKS):
        due = await ctx.step.run(f"deadline_{i}", interview.deadline_of, app_id)
        if not due:
            out = "already_finished"
            break
        await ctx.step.sleep_until(f"wait_{i}", datetime.fromisoformat(str(due)))
        out = str(await ctx.step.run(f"finish_if_open_{i}", interview.finish_if_open, app_id))
        if out != "not_due":
            break
    await ctx.step.run("mark_done", runs.mark_done, run_id)
    return out
