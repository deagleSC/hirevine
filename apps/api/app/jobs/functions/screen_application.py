"""`screen-application` (backend plan §10.2, §13): parse → redact → embed → prefilter → score →
verify citations → cutoff → transition. Step outputs are statuses and numbers only (§10.1).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import inngest

from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.functions.common import mark_failed_on_failure, run_id_of
from app.llm import tracing
from app.llm.errors import BudgetExhausted, LLMNotConfigured, NeedsReview, RateLimited, TimeBudgetExceeded
from app.llm.wrapper import deadline_in
from app.pipeline import screen

STEP_SECONDS = 240  # each step must finish inside Vercel's 300 s (§10.1)
PAUSE_TIMEOUT = timedelta(days=7)


async def _model_step(run_id: str, application_id: str, fn: str) -> str:
    """Run a model-calling step and turn model errors into job outcomes:
    budget → deferred (housekeeping resumes after 00:00 UTC); rate limit → Inngest retry later;
    invalid output twice / no models → stage needs_review."""
    step = screen.score if fn == "score" else screen.verify_citations
    try:
        # One trace per model step; all of an application's traces share its session.
        with tracing.trace("screen-resume" if fn == "score" else "verify-resume-quotes",
                           input={"application_id": application_id, "step": fn},
                           session_id=f"application-{application_id}", tags=["screening"],
                           metadata={"application_id": application_id, "job_run_id": run_id}) as t:
            out = await step(application_id, deadline_in(STEP_SECONDS))
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
        await screen.mark_model_failed(application_id)
        return "stop"


async def _on_failure(ctx: inngest.Context) -> None:
    await mark_failed_on_failure(ctx)
    data: Any = ctx.event.data
    original = (data.get("event") or {}).get("data") or {}
    if app_id := original.get("application_id"):
        await screen.mark_model_failed(str(app_id))


@inngest_client.create_function(
    fn_id="screen-application",
    trigger=inngest.TriggerEvent(event="application/submitted"),
    retries=5,
    throttle=inngest.Throttle(limit=10, period=timedelta(minutes=1)),
    concurrency=[inngest.Concurrency(limit=2)],
    on_failure=_on_failure,
)
async def screen_application(ctx: inngest.Context) -> str:
    run_id = run_id_of(ctx)
    app_id = str(ctx.event.data["application_id"])
    if not await ctx.step.run("mark_running", runs.mark_running, run_id, ctx.run_id):
        return "duplicate"

    if await ctx.step.run("check_paused", screen.is_paused, app_id):
        resumed = await ctx.step.wait_for_event(
            "wait_resumed", event="campaign/resumed", if_exp="event.data.campaign_id == async.data.campaign_id",
            timeout=PAUSE_TIMEOUT,
        )
        if resumed is None:
            await ctx.step.run("mark_paused_timeout", runs.mark_failed, run_id, "AI paused for 7 days")
            return "paused"

    if await ctx.step.run("start", screen.start, app_id) == "stop":
        await ctx.step.run("mark_done_dup", runs.mark_done, run_id)
        return "already_done"
    if await ctx.step.run("parse_redact", screen.parse_redact, app_id) == "stop":
        await ctx.step.run("mark_done_review", runs.mark_done, run_id)
        return "needs_review"
    await ctx.step.run("embed", screen.embed, app_id)
    await ctx.step.run("prefilter", screen.prefilter, app_id)

    for name in ("score", "verify_citations"):
        out = await ctx.step.run(name, _model_step, run_id, app_id, name)
        if out == "deferred":
            return "deferred_budget"
        if out == "stop":
            await ctx.step.run(f"mark_done_{name}", runs.mark_done, run_id)
            return "needs_review"

    status = await ctx.step.run("compute_and_transition", screen.compute_and_transition, app_id)
    await ctx.step.run("mark_done", runs.mark_done, run_id)
    return str(status)
