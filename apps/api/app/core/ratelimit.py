"""DB-backed fixed-window limits (backend plan §18), counted in `rate_limits` in system context."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.core.db import Tx
from app.core.errors import AppError


def _window_start(now: datetime, window: timedelta) -> datetime:
    epoch = datetime(2000, 1, 1, tzinfo=UTC)
    n = (now - epoch) // window
    return epoch + n * window


async def hit(tx: Tx, key: str, limit: int, window: timedelta, *, message: str) -> None:
    """Count one use of `key`; 429 `rate_limited` once `limit` is exceeded in the window.
    Counts inside the caller's transaction, so a rejected request also rolls back its count."""
    start = _window_start(datetime.now(UTC), window)
    async with tx.as_system():
        row = await tx.fetchone(
            """
            insert into rate_limits (key, window_start, count) values (%s, %s, 1)
            on conflict (key, window_start) do update set count = rate_limits.count + 1
            returning count
            """,
            (key, start),
        )
    if row is not None and row["count"] > limit:
        retry = int((start + window - datetime.now(UTC)).total_seconds()) + 1
        raise AppError(429, "rate_limited", message, {"retry_after": retry})
