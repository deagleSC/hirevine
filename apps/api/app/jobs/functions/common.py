"""Helpers shared by job functions."""

from __future__ import annotations

from typing import Any

import inngest

from app.jobs import runs


def run_id_of(ctx: inngest.Context) -> str:
    return str(ctx.event.data["job_run_id"])


async def mark_failed_on_failure(ctx: inngest.Context) -> None:
    """on_failure handler: Inngest gave up after its retries. The triggering event is nested
    in the `inngest/function.failed` event's data."""
    data: Any = ctx.event.data
    original = (data.get("event") or {}).get("data") or {}
    error = (data.get("error") or {}).get("message") or "Job failed"
    run_id = original.get("job_run_id")
    if run_id:
        await runs.mark_failed(str(run_id), str(error))
