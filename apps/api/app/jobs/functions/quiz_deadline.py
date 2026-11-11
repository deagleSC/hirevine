"""`quiz-deadline` (backend plan §10.2, §14): sleep until the attempt's deadline plus a 30 s grace,
then grade the saved answers if the candidate has not submitted. A submitted attempt makes the
final step a no-op."""

from __future__ import annotations

from datetime import datetime

import inngest

from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.functions.common import mark_failed_on_failure, run_id_of
from app.services import quiz


@inngest_client.create_function(
    fn_id="quiz-deadline",
    trigger=inngest.TriggerEvent(event="quiz/started"),
    retries=5,
    on_failure=mark_failed_on_failure,
)
async def quiz_deadline(ctx: inngest.Context) -> str:
    run_id = run_id_of(ctx)
    app_id = str(ctx.event.data["application_id"])
    await ctx.step.run("mark_running", runs.mark_running, run_id, ctx.run_id)
    due = await ctx.step.run("deadline", quiz.deadline_of, app_id)
    if due:
        await ctx.step.sleep_until("wait_for_deadline", datetime.fromisoformat(str(due)))
    out = await ctx.step.run("auto_submit_if_open", quiz.auto_submit_if_open, app_id)
    await ctx.step.run("mark_done", runs.mark_done, run_id)
    return str(out)
