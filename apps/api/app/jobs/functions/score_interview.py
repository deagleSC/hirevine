"""`score-interview` (backend plan §10.2, §15): one model call scores the transcript against the
rubric with turn citations; code verifies the citations, weights the items and transitions the stage."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import inngest

from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.functions.common import mark_failed_on_failure, run_id_of
from app.llm.errors import BudgetExhausted, LLMNotConfigured, NeedsReview, RateLimited, TimeBudgetExceeded
from app.llm.wrapper import deadline_in
from app.services import interview

STEP_SECONDS = 240


async def _score(run_id: str, application_id: str) -> str:
    try:
        return await interview.score_and_transition(run_id, deadline_in(STEP_SECONDS))
    except BudgetExhausted:
        await runs.mark_deferred_budget(run_id)
        return "deferred"
    except RateLimited as exc:
        raise inngest.RetryAfterError(str(exc), timedelta(seconds=max(5, exc.retry_after))) from exc
    except TimeBudgetExceeded as exc:
        raise inngest.RetryAfterError(str(exc), timedelta(seconds=5)) from exc
    except (NeedsReview, LLMNotConfigured) as exc:
        await interview.mark_model_failed(application_id)
        await runs.mark_failed(run_id, str(exc))
        return "needs_review"


async def _on_failure(ctx: inngest.Context) -> None:
    await mark_failed_on_failure(ctx)
    data: Any = ctx.event.data
    original = (data.get("event") or {}).get("data") or {}
    if original.get("application_id"):
        await interview.mark_model_failed(str(original["application_id"]))


@inngest_client.create_function(
    fn_id="score-interview",
    trigger=inngest.TriggerEvent(event="interview/finished"),
    retries=5,
    throttle=inngest.Throttle(limit=3, period=timedelta(minutes=1)),
    concurrency=[inngest.Concurrency(limit=1)],
    on_failure=_on_failure,
)
async def score_interview(ctx: inngest.Context) -> str:
    run_id = run_id_of(ctx)
    app_id = str(ctx.event.data["application_id"])
    if not await ctx.step.run("mark_running", runs.mark_running, run_id, ctx.run_id):
        return "duplicate"
    return str(await ctx.step.run("score", _score, run_id, app_id))
