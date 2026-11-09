"""Database access: one transaction per request, with the caller's claims set locally.

Every request runs inside `transaction(claims)`. The claims are written with
`set_config('app.claims', ..., true)`, which is local to the transaction (the SET LOCAL
equivalent), so it is safe behind Supavisor in transaction mode. RLS policies read them
through the app.* helper functions.

`Tx.after_commit` registers callbacks that run only after a successful commit; the job
dispatcher uses it to send Inngest events (backend plan §10.4).
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import DictRow, dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import get_settings

_pool: AsyncConnectionPool[AsyncConnection[DictRow]] | None = None
_pool_lock = asyncio.Lock()


async def get_pool() -> AsyncConnectionPool[AsyncConnection[DictRow]]:
    global _pool
    async with _pool_lock:
        if _pool is None:
            settings = get_settings()
            _pool = AsyncConnectionPool(
                settings.database_url,
                min_size=0,
                max_size=settings.db_pool_max,
                open=False,
                # prepare_threshold=None: no server-side prepared statements, required by the
                # transaction-mode pooler. autocommit + explicit transaction() blocks.
                kwargs={"autocommit": True, "prepare_threshold": None, "row_factory": dict_row},
            )
            await _pool.open(wait=False)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


class Tx:
    def __init__(self, conn: AsyncConnection[DictRow]):
        self.conn = conn
        self._after_commit: list[Callable[[], Awaitable[None]]] = []

    async def set_claims(self, claims: dict[str, Any]) -> None:
        await self.conn.execute("select set_config('app.claims', %s, true)", (json.dumps(claims),))

    def after_commit(self, callback: Callable[[], Awaitable[None]]) -> None:
        self._after_commit.append(callback)

    async def fetchone(self, query: str, params: Any = None) -> DictRow | None:
        cur = await self.conn.execute(query, params)
        return await cur.fetchone()

    async def fetchall(self, query: str, params: Any = None) -> list[DictRow]:
        cur = await self.conn.execute(query, params)
        return await cur.fetchall()


@asynccontextmanager
async def transaction(claims: dict[str, Any]) -> AsyncIterator[Tx]:
    pool = await get_pool()
    async with pool.connection() as conn:
        tx = Tx(conn)
        async with conn.transaction():
            await tx.set_claims(claims)
            yield tx
    # Only reached when the transaction committed.
    for callback in tx._after_commit:
        await callback()


def system_claims() -> dict[str, Any]:
    """Claims for background work with no end user (explicit 'system' RLS policies)."""
    return {"role": "system"}
