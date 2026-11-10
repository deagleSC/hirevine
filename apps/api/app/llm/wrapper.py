"""`call_structured`: the one way to get structured output from a model (backend plan §11.2).

Order of operations: cache → daily budget → (request path only) RPM bucket → model call
with a forced tool call → validate → one retry with the validation error → NeedsReview.
Every HTTP request to OpenRouter counts against the daily budget, retries included.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import openai
from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError

from app.core.config import get_settings
from app.llm import budget, cache, tracing
from app.llm.errors import LLMNotConfigured, NeedsReview, RateLimited, TimeBudgetExceeded
from app.llm.models import ModelRole, models_for, provider_prefs
from app.llm.prompts import PROMPTS, Prompt

log = logging.getLogger("hirevine.llm")

TOOL_NAME = "submit"
MIN_CALL_SECONDS = 5.0  # don't start a model call with less time than this left


@dataclass(frozen=True)
class StructuredResult[T: BaseModel]:
    value: T
    model_id: str
    prompt_version: int
    cached: bool
    attempts: int


def deadline_in(seconds: float) -> float:
    """A wall-clock deadline. Inngest steps pass `deadline_in(240)` (§10.1)."""
    return time.time() + seconds


def remaining(deadline: float) -> float:
    return deadline - time.time()


def ensure_time(deadline: float) -> None:
    if remaining(deadline) < MIN_CALL_SECONDS:
        raise TimeBudgetExceeded("Not enough time left in this step for another model call")


@lru_cache
def default_client() -> AsyncOpenAI:
    s = get_settings()
    if not s.openrouter_api_key:
        raise LLMNotConfigured("OPENROUTER_API_KEY is not set")
    return AsyncOpenAI(
        api_key=s.openrouter_api_key,
        base_url=s.openrouter_base_url,
        max_retries=0,  # retries are ours (validation) or Inngest's (transient)
        default_headers={"X-Title": "Hirevine"},
    )


def tool_for(schema: type[BaseModel], description: str) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {"name": TOOL_NAME, "description": description, "parameters": schema.model_json_schema()},
    }


_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


def _arguments(resp: Any) -> str | None:
    """Tool-call arguments, or JSON in the message content for models that ignore tool_choice."""
    if not getattr(resp, "choices", None):
        return None
    msg = resp.choices[0].message
    for call in msg.tool_calls or []:
        if call.function and call.function.name == TOOL_NAME:
            return call.function.arguments
    content = (msg.content or "").strip()
    if not content:
        return None
    m = _FENCE.match(content)
    return m.group(1) if m else content


def _retry_message(error: ValidationError | json.JSONDecodeError) -> dict[str, str]:
    detail = str(error)[:2000]
    return {
        "role": "user",
        "content": (
            f"Your last answer did not match the required schema:\n{detail}\n"
            f"Call the `{TOOL_NAME}` tool again with corrected arguments only."
        ),
    }


async def call_structured[T: BaseModel](
    role: ModelRole,
    prompt_id: str,
    input: BaseModel,
    schema: type[T] | None = None,
    *,
    deadline: float,
    cache_enabled: bool = True,
    sync: bool = False,
    client: AsyncOpenAI | None = None,
    models: list[str] | None = None,
) -> StructuredResult[T]:
    """`models` overrides the role's list; the smoke test uses it to measure one model at a time."""
    prompt: Prompt[Any, Any] = PROMPTS[prompt_id]
    out_schema: type[T] = schema or prompt.output
    models = list(models) if models else models_for(role)
    key = cache.cache_key(prompt.id, prompt.version, models, input)

    with tracing.generation(
        prompt.id,
        input=input.model_dump(mode="json"),
        metadata={"prompt_id": prompt.id, "prompt_version": prompt.version, "role": role, "models": models},
    ) as span:
        if cache_enabled and (hit := await cache.get(key)) is not None:
            span.update(output=hit["response"], model=hit["model_id"], cached=True, attempts=0)
            return StructuredResult(
                out_schema.model_validate(hit["response"]), hit["model_id"], prompt.version, True, 0
            )

        llm = client or default_client()
        messages: list[dict[str, Any]] = list(prompt.render(input))
        tool = tool_for(out_schema, prompt.description or f"Return the {prompt.id} result.")
        last_error = "no attempt made"
        started = time.monotonic()

        for attempt in (1, 2):
            ensure_time(deadline)
            await budget.reserve()
            if sync:
                await budget.throttle()
            try:
                resp = await llm.chat.completions.create(  # type: ignore[call-overload]
                    model=models[0],
                    messages=messages,
                    tools=[tool],
                    tool_choice={"type": "function", "function": {"name": TOOL_NAME}},
                    temperature=0,
                    timeout=min(get_settings().llm_request_timeout_s, remaining(deadline)),
                    extra_body={"models": models, "provider": provider_prefs()},
                )
            except openai.RateLimitError as exc:
                retry_after = float(exc.response.headers.get("retry-after", 20)) if exc.response else 20.0
                raise RateLimited("Model provider rate limit", retry_after=retry_after) from exc

            served_by = getattr(resp, "model", None) or models[0]
            await budget.record_model(served_by)
            args = _arguments(resp)
            if args is None:
                # OpenRouter's free pool answers overload with an empty completion.
                raise RateLimited("Empty response from model provider", retry_after=10.0)
            try:
                value = out_schema.model_validate_json(args)
            except (ValidationError, json.JSONDecodeError) as exc:
                last_error = str(exc)[:500]
                log.info("%s attempt %d invalid output from %s: %s", prompt.id, attempt, served_by, last_error)
                messages.append({"role": "assistant", "content": args[:4000]})
                messages.append(_retry_message(exc))
                continue

            dumped = value.model_dump(mode="json")
            await cache.put(key, dumped, model_id=served_by, prompt_id=prompt.id, prompt_version=prompt.version)
            span.update(
                output=dumped, model=served_by, cached=False, attempts=attempt,
                fallback_used=served_by != models[0], latency_s=round(time.monotonic() - started, 3),
            )
            return StructuredResult(value, served_by, prompt.version, False, attempt)

        span.update(level="WARNING", status_message=f"needs_review: {last_error}", attempts=2)
        raise NeedsReview(prompt.id, last_error)
