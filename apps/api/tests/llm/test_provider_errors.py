"""Provider outages (seen in production on 2026-11-11: OpenRouter 504s, 503s, "Provider timed out"
and aborted streams): try the next model once, then raise ProviderUnavailable so background jobs
retry later and request paths say "busy". Text already streamed is never retried."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.core.config import get_settings
from app.llm import budget
from app.llm.errors import ProviderUnavailable, RateLimited
from app.llm.prompts import load_all
from app.llm.prompts.interview import InterviewNextInput
from app.llm.prompts.smoke import PatchInput
from app.llm.wrapper import PROVIDER_RETRY_AFTER, call_structured, deadline_in, stream_text
from tests.llm.conftest import FakeRouter, tool_response

load_all()

INPUT = PatchInput(workflow={"nodes": [{"id": "quiz", "type": "quiz", "cutoff": 70}]}, instruction="Lower it to 65.")
GOOD = {"ops": [{"op": "set_cutoff", "node_id": "quiz", "value": 65}]}
NEXT = InterviewNextInput(title="Engineer", description="APIs", themes=["APIs"], question_number=1, turn_cap=3,
                          transcript=[])


@pytest.fixture(autouse=True)
def roomy_budget(clean_llm_tables, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "llm_daily_cap", 100)
    monkeypatch.setattr(s, "llm_sync_rpm_cap", 100)
    monkeypatch.setattr(s, "llm_structured_models", ["a", "b"])
    monkeypatch.setattr(s, "llm_pilot_mode", False)


def sse(*events: dict[str, Any]) -> httpx.Response:
    body = "".join(f"data: {json.dumps(e)}\n\n" for e in events) + "data: [DONE]\n\n"
    return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})


def chunk(text: str, model: str = "a") -> dict[str, Any]:
    return {"id": "g", "object": "chat.completion.chunk", "created": 0, "model": model,
            "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}]}


ABORTED = {"error": {"message": "Provider timed out after 10588ms", "code": 502}}


async def collect(router: FakeRouter) -> str:
    out = []
    async for t in stream_text("structured", "interview_next", NEXT, deadline=deadline_in(60), client=router.client()):
        out.append(t)
    return "".join(out)


async def test_structured_call_moves_to_the_next_model_after_a_5xx(router):
    router.reply({"error": {"message": "Gateway Timeout"}}, status=504)
    router.reply(tool_response(GOOD, model="b"))
    res = await call_structured("structured", "smoke_patch", INPUT, deadline=deadline_in(60), client=router.client())
    assert res.model_id == "b" and res.attempts == 1
    assert [r["model"] for r in router.requests] == ["a", "b"]
    assert router.requests[1]["models"] == ["b", "a"]
    assert await budget.used_today() == 2  # both HTTP requests count


async def test_structured_call_raises_provider_unavailable_when_both_fail(router):
    router.reply({"error": {"message": "Gateway Timeout"}}, status=504)
    router.reply({"error": {"message": "Service Unavailable"}}, status=503)
    with pytest.raises(ProviderUnavailable) as exc:
        await call_structured("structured", "smoke_patch", INPUT, deadline=deadline_in(60), client=router.client())
    assert exc.value.retry_after == PROVIDER_RETRY_AFTER
    assert isinstance(exc.value, RateLimited)  # every caller already treats this as "retry later"


async def test_a_4xx_is_not_retried(router):
    router.reply({"error": {"message": "bad request"}}, status=400)
    with pytest.raises(Exception) as exc:
        await call_structured("structured", "smoke_patch", INPUT, deadline=deadline_in(60), client=router.client())
    assert not isinstance(exc.value, ProviderUnavailable) and len(router.requests) == 1


async def test_stream_falls_back_before_any_text(router):
    router.queue.append(sse(ABORTED))  # the stream opens with 200, then the provider gives up
    router.queue.append(sse(chunk("How do you ", "b"), chunk("test APIs?", "b")))
    assert await collect(router) == "How do you test APIs?"
    assert [r["model"] for r in router.requests] == ["a", "b"]


async def test_stream_never_retries_after_text_was_sent(router):
    router.queue.append(sse(chunk("How do you "), ABORTED))
    got: list[str] = []
    with pytest.raises(ProviderUnavailable):
        async for t in stream_text("structured", "interview_next", NEXT, deadline=deadline_in(60),
                                   client=router.client()):
            got.append(t)
    assert got == ["How do you "] and len(router.requests) == 1


async def test_stream_gives_up_after_both_models_fail(router):
    router.reply({"error": {"message": "Service Unavailable"}}, status=503)
    router.queue.append(sse(ABORTED))
    with pytest.raises(ProviderUnavailable):
        await collect(router)
    assert len(router.requests) == 2
