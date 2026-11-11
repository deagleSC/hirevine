"""`draft-report` (backend plan §10.2, §16): one model call drafts the candidate's feedback and a
suggested recommendation from the stored evidence. Queued when an application reaches the final
stage or fails one. A failed draft is not fatal: release falls back to a neutral message."""

from __future__ import annotations

from datetime import timedelta

import inngest

from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.functions.common import mark_failed_on_failure, run_id_of
from app.llm import tracing
from app.llm.errors import BudgetExhausted, LLMNotConfigured, NeedsReview, RateLimited, TimeBudgetExceeded
from app.llm.wrapper import deadline_in
from app.services import report

STEP_SECONDS = 240


async def _draft(run_id: str, application_id: str = "") -> str:
    try:
        session = f"application-{application_id}" if application_id else None
        with tracing.trace("draft-candidate-feedback", input={"application_id": application_id}, session_id=session,
                           tags=["report"],
                           metadata={"application_id": application_id, "job_run_id": run_id}) as t:
            out = await report.draft_and_save(run_id, deadline_in(STEP_SECONDS))
            t.update(output=out)
            return out
    except BudgetExhausted:
        await runs.mark_deferred_budget(run_id)
        return "deferred"
    except RateLimited as exc:
        raise inngest.RetryAfterError(str(exc), timedelta(seconds=max(5, exc.retry_after))) from exc
    except TimeBudgetExceeded as exc:
        raise inngest.RetryAfterError(str(exc), timedelta(seconds=5)) from exc
    except (NeedsReview, LLMNotConfigured) as exc:
        await runs.mark_failed(run_id, f"The AI could not draft this feedback ({exc}). Write it by hand.")
        return "failed"


@inngest_client.create_function(
    fn_id="draft-report",
    trigger=inngest.TriggerEvent(event="report/draft.requested"),
    retries=5,
    throttle=inngest.Throttle(limit=3, period=timedelta(minutes=1)),
    concurrency=[inngest.Concurrency(limit=1)],
    on_failure=mark_failed_on_failure,
)
async def draft_report(ctx: inngest.Context) -> str:
    run_id = run_id_of(ctx)
    if not await ctx.step.run("mark_running", runs.mark_running, run_id, ctx.run_id):
        return "duplicate"
    return str(await ctx.step.run("draft", _draft, run_id, str(ctx.event.data.get("application_id") or "")))
