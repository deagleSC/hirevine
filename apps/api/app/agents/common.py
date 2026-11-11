"""Shared plumbing for agents: checkpointer, thread ownership, LLM error mapping."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.core.auth import CurrentUser
from app.core.db import Tx
from app.core.errors import AppError
from app.llm import wrapper
from app.llm.errors import BudgetExhausted, LLMNotConfigured, NeedsReview, RateLimited, TimeBudgetExceeded

# Indirection so tests can swap the model call without touching the graphs.
call_structured: Callable[..., Any] = wrapper.call_structured
stream_text: Callable[..., Any] = wrapper.stream_text


@asynccontextmanager
async def checkpointer(tx: Tx) -> AsyncIterator[AsyncPostgresSaver]:
    """A saver bound to the request transaction, in system context (checkpoint tables are
    system-only). Callers check thread ownership in agent_threads before using it."""
    async with tx.as_system():
        yield AsyncPostgresSaver(tx.conn)  # type: ignore[arg-type]


async def own_thread(
    tx: Tx, user: CurrentUser, thread_id: UUID, kind: str, job_id: UUID | None = None
) -> dict[str, Any]:
    """The caller's thread, or 404. RLS on agent_threads limits rows to the caller."""
    row = await tx.fetchone("select * from agent_threads where thread_id = %s and kind = %s", (thread_id, kind))
    if row is None or (job_id is not None and row["job_id"] != job_id):
        raise AppError(404, "thread_not_found", "This conversation does not exist or is not yours.")
    return dict(row)


async def new_thread(tx: Tx, user: CurrentUser, kind: str, job_id: UUID | None = None) -> UUID:
    row = await tx.fetchone(
        "insert into agent_threads (kind, org_id, user_id, job_id) values (%s, %s, %s, %s) returning thread_id",
        (kind, user.org_id, user.user_id, job_id),
    )
    assert row is not None
    return UUID(str(row["thread_id"]))


@asynccontextmanager
async def llm_errors() -> AsyncIterator[None]:
    """Model failures as API errors the frontend can show."""
    try:
        yield
    except RateLimited as exc:
        raise AppError(429, "model_busy", "The AI is busy right now. Try again in a minute.",
                       {"retry_after": round(exc.retry_after)}) from exc
    except BudgetExhausted as exc:
        raise AppError(429, "daily_ai_limit", "Today's AI limit is used up. It resets at midnight UTC.") from exc
    except (NeedsReview, TimeBudgetExceeded) as exc:
        raise AppError(502, "agent_failed", "The AI could not produce a valid answer. Try rephrasing.") from exc
    except LLMNotConfigured as exc:
        raise AppError(503, "ai_not_configured", "AI features are not configured on this server.") from exc
