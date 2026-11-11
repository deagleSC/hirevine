"""`generate-quiz` (backend plan §10.2, §14): one model call writes the paper, code validates it,
and the questions land in the workflow as `add_quiz_question` patches. Step outputs are statuses only."""

from __future__ import annotations

from datetime import timedelta

import inngest

from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.functions.common import mark_failed_on_failure, run_id_of
from app.llm import tracing
from app.llm.errors import BudgetExhausted, LLMNotConfigured, NeedsReview, RateLimited, TimeBudgetExceeded
from app.llm.wrapper import deadline_in
from app.services import quiz

STEP_SECONDS = 240


async def _generate(run_id: str, job_id: str = "") -> str:
    try:
        with tracing.trace("generate-quiz", input={"job_id": job_id}, session_id=f"job-{job_id}" if job_id else None,
                           tags=["quiz"],
                           metadata={"job_id": job_id, "job_run_id": run_id}) as t:
            out = await quiz.generate_and_patch(run_id, deadline_in(STEP_SECONDS))
            t.update(output=out)
            return out
    except BudgetExhausted:
        await runs.mark_deferred_budget(run_id)
        return "deferred"
    except RateLimited as exc:
        raise inngest.RetryAfterError(str(exc), timedelta(seconds=max(5, exc.retry_after))) from exc
    except TimeBudgetExceeded as exc:
        raise inngest.RetryAfterError(str(exc), timedelta(seconds=5)) from exc
    except (NeedsReview, LLMNotConfigured):
        await runs.mark_failed(run_id, "The model could not write valid questions. Try again, or add them by hand.")
        return "failed"


@inngest_client.create_function(
    fn_id="generate-quiz",
    trigger=inngest.TriggerEvent(event="quiz/generate.requested"),
    retries=5,
    throttle=inngest.Throttle(limit=2, period=timedelta(minutes=1)),
    concurrency=[inngest.Concurrency(limit=1)],
    on_failure=mark_failed_on_failure,
)
async def generate_quiz(ctx: inngest.Context) -> str:
    run_id = run_id_of(ctx)
    if not await ctx.step.run("mark_running", runs.mark_running, run_id, ctx.run_id):
        return "duplicate"
    return str(await ctx.step.run("generate", _generate, run_id, str(ctx.event.data.get("job_id") or "")))
