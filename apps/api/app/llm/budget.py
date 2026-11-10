"""Daily request cap and the request-path RPM bucket (backend plan §11.2).

Both use a single conditional upsert, so concurrent callers cannot overshoot the cap:
the update only happens while the counter is below the limit, and no returned row
means the limit was reached. Each runs in its own system transaction so a reservation
sticks even if the caller's transaction later rolls back (the request was still made).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from app.core.config import get_settings
from app.core.db import system_claims, transaction
from app.llm.errors import BudgetExhausted, RateLimited

TOTAL = "*"  # llm_budget row that carries the account-wide daily counter


def _today() -> date:
    return datetime.now(UTC).date()


async def reserve(cap: int | None = None, *, day: date | None = None) -> int:
    """Count one request against today's cap. Returns the new count or raises BudgetExhausted."""
    limit = get_settings().llm_daily_cap if cap is None else cap
    async with transaction(system_claims()) as tx:
        row = await tx.fetchone(
            """
            insert into llm_budget (day, model_id, requests_used) values (%(day)s, %(total)s, 1)
            on conflict (day, model_id) do update set requests_used = llm_budget.requests_used + 1
              where llm_budget.requests_used < %(cap)s
            returning requests_used
            """,
            {"day": day or _today(), "total": TOTAL, "cap": limit},
        )
    # A fresh row is inserted with 1 even when cap is 0, so check the cap here too.
    if row is None or row["requests_used"] > limit:
        raise BudgetExhausted(f"Daily model request cap of {limit} reached")
    return int(row["requests_used"])


async def record_model(model_id: str, *, day: date | None = None) -> None:
    """Per-model usage, from the model OpenRouter actually used (shows fallbacks)."""
    async with transaction(system_claims()) as tx:
        await tx.fetchone(
            """
            insert into llm_budget (day, model_id, requests_used) values (%s, %s, 1)
            on conflict (day, model_id) do update set requests_used = llm_budget.requests_used + 1
            returning requests_used
            """,
            (day or _today(), model_id),
        )


async def used_today(*, day: date | None = None) -> int:
    async with transaction(system_claims()) as tx:
        row = await tx.fetchone(
            "select requests_used from llm_budget where day = %s and model_id = %s", (day or _today(), TOTAL)
        )
    return int(row["requests_used"]) if row else 0


async def throttle(cap: int | None = None, *, now: datetime | None = None) -> None:
    """Request-path guard: at most `cap` model calls per minute. Raises RateLimited."""
    limit = get_settings().llm_sync_rpm_cap if cap is None else cap
    t = now or datetime.now(UTC)
    bucket = t.replace(second=0, microsecond=0)
    async with transaction(system_claims()) as tx:
        row = await tx.fetchone(
            """
            insert into llm_rpm (minute_bucket, requests) values (%(b)s, 1)
            on conflict (minute_bucket) do update set requests = llm_rpm.requests + 1
              where llm_rpm.requests < %(cap)s
            returning requests
            """,
            {"b": bucket, "cap": limit},
        )
        # Old buckets are useless after a minute; trim opportunistically.
        await tx.conn.execute("delete from llm_rpm where minute_bucket < %s", (bucket - timedelta(minutes=10),))
    if row is None or row["requests"] > limit:
        retry_after = 60 - t.second - t.microsecond / 1e6
        raise RateLimited(f"More than {limit} model requests this minute", retry_after=max(retry_after, 1.0))
