"""Fixtures for LLM-layer tests: a clean budget/cache, and a fake OpenRouter."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from openai import AsyncOpenAI

from tests.conftest import admin


@pytest.fixture
def clean_llm_tables(migrated_db: str):
    with admin(migrated_db) as conn:
        conn.execute("truncate llm_budget, llm_rpm, llm_cache")
    yield migrated_db
    from app.core.db import close_pool  # noqa: F401  (pool is reused across tests)


def tool_response(args: dict[str, Any] | str, model: str = "a:free") -> dict[str, Any]:
    raw = args if isinstance(args, str) else json.dumps(args)
    return {
        "id": "gen-1", "object": "chat.completion", "created": 0, "model": model,
        "choices": [{"index": 0, "finish_reason": "tool_calls", "message": {
            "role": "assistant", "content": None,
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "submit", "arguments": raw}}],
        }}],
    }


class FakeRouter:
    """Replays queued responses and records the requests it receives."""

    def __init__(self) -> None:
        self.queue: list[httpx.Response | Callable[[httpx.Request], httpx.Response]] = []
        self.requests: list[dict[str, Any]] = []

    def reply(self, body: dict[str, Any], status: int = 200, headers: dict[str, str] | None = None) -> None:
        self.queue.append(httpx.Response(status, json=body, headers=headers))

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        if not self.queue:
            raise AssertionError("Unexpected model call")
        nxt = self.queue.pop(0)
        return nxt(request) if callable(nxt) else nxt

    def client(self) -> AsyncOpenAI:
        return AsyncOpenAI(
            api_key="test", base_url="http://openrouter.test/api/v1", max_retries=0,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(self.handler)),
        )


@pytest.fixture
def router() -> FakeRouter:
    return FakeRouter()
