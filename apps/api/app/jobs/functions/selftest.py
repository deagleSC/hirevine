"""Phase 2 exit check (dev/test only): a queued item runs to completion, and a failing step
is retried without repeating the steps that already finished.

Each step appends an event row, so a test can count how many times each step body ran.
`flaky` fails on its first execution for a run and succeeds on the next.
"""

from __future__ import annotations

from datetime import timedelta

import inngest
from psycopg.types.json import Jsonb

from app.core.db import system_claims, transaction
from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.functions.common import mark_failed_on_failure, run_id_of


async def record_step(run_id: str, step: str) -> int:
    """Log one execution of a step body; return how many times it has run for this job run."""
    async with transaction(system_claims()) as tx:
        await tx.conn.execute(
            "insert into events (type, entity, entity_id, payload) values ('selftest.step', 'job_run', %s, %s)",
            (run_id, Jsonb({"step": step})),
        )
        row = await tx.fetchone(
            "select count(*) as n from events"
            " where type = 'selftest.step' and entity_id = %s and payload->>'step' = %s",
            (run_id, step),
        )
    return int(row["n"]) if row else 0


async def first(run_id: str) -> str:
    await record_step(run_id, "first")
    return "first-done"


async def flaky(run_id: str) -> str:
    if await record_step(run_id, "flaky") == 1:
        raise RuntimeError("selftest: planned failure on first attempt")
    return "flaky-done"


async def last(run_id: str, a: str, b: str) -> str:
    await record_step(run_id, "last")
    return f"{a}+{b}"


@inngest_client.create_function(
    fn_id="selftest",
    trigger=inngest.TriggerEvent(event="selftest/requested"),
    retries=2,
    throttle=inngest.Throttle(limit=10, period=timedelta(minutes=1)),
    concurrency=[inngest.Concurrency(limit=1)],
    on_failure=mark_failed_on_failure,
)
async def selftest(ctx: inngest.Context) -> str:
    run_id = run_id_of(ctx)
    if not await ctx.step.run("mark_running", runs.mark_running, run_id, ctx.run_id):
        return "duplicate"
    a = await ctx.step.run("first", first, run_id)
    b = await ctx.step.run("flaky", flaky, run_id)
    out = await ctx.step.run("last", last, run_id, a, b)
    await ctx.step.run("mark_done", runs.mark_done, run_id)
    return out
