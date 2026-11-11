"""Langfuse tracing (backend plan §11.2), following Langfuse's instrumentation best practices
(https://langfuse.com/docs/observability/best-practices). A no-op unless both keys are set; a
tracing failure never breaks a request or a job.

Shape of the data:
- **One trace per unit of work**: one background-job step (`screen-resume`, `generate-quiz-questions`,
  `score-interview`, `draft-feedback`), or one request-path turn (`chat-job-draft`, `edit-workflow`,
  `ask-interview-question`). Opened with `trace(...)`, which sets the trace name, tags (the feature),
  the session (an application, a job or a chat thread, so related turns and steps group together)
  and an internal user id (a UUID, never an email).
- **One generation per model request** inside it, named after the action (verb first, stable, never
  the model name), with the role-labelled messages as input, the parsed result as output, the model
  OpenRouter actually used, and token usage so Langfuse can price it.
- **Masking**: model inputs are already redacted, but candidates type interview answers freely, so
  every string is masked for emails and phone numbers before export.
- **Flush**: Vercel freezes a function when it returns, so the outermost `trace` flushes on exit.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar
from functools import lru_cache
from typing import Any

from app.core.config import get_settings

log = logging.getLogger("hirevine.llm")

# prompt id → observation name (verb first; stable: dashboards and evaluators key on it).
ACTION: dict[str, str] = {
    "screening_score": "score-resume",
    "quiz_generate": "generate-quiz-questions",
    "interview_next": "ask-interview-question",
    "interview_score": "score-interview",
    "report_draft": "draft-feedback",
    "jd_turn": "chat-job-draft",
    "jd_rubric": "propose-rubric",
    "override_patches": "propose-workflow-edits",
}

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"(?<![\w/])\+?\(?\d[\d\s().-]{8,}\d(?![\w/])")
_depth: ContextVar[int] = ContextVar("langfuse_trace_depth", default=0)


def _mask_value(value: Any) -> Any:
    if isinstance(value, str):
        return _PHONE.sub("[PHONE]", _EMAIL.sub("[EMAIL]", value))
    if isinstance(value, dict):
        return {k: _mask_value(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_mask_value(v) for v in value]
    return value


def mask(*, data: Any, **_: Any) -> Any:
    """Langfuse `mask` hook: emails and phone numbers out of everything exported."""
    return _mask_value(data)


def _environment() -> str:
    return {"prod": "production", "test": "test"}.get(get_settings().app_env, "development")


@lru_cache
def _client() -> Any:
    s = get_settings()
    if not (s.langfuse_public_key and s.langfuse_secret_key):
        return None
    try:
        import os

        from langfuse import Langfuse

        os.environ.setdefault("OTEL_SERVICE_NAME", "hirevine-api")
        return Langfuse(public_key=s.langfuse_public_key, secret_key=s.langfuse_secret_key, base_url=s.langfuse_host,
                        environment=_environment(), release=s.release or None, mask=mask)
    except Exception:  # pragma: no cover - tracing must never break calls
        log.exception("Langfuse init failed; tracing disabled")
        return None


def enabled() -> bool:
    return _client() is not None


class Span:
    """Collects what the caller learns during a call; written to the observation on exit."""

    def __init__(self) -> None:
        self.fields: dict[str, Any] = {}

    def update(self, **fields: Any) -> None:
        self.fields.update(fields)


@contextmanager
def trace(name: str, *, input: Any = None, user_id: str | None = None, session_id: str | None = None,
          tags: list[str] | None = None, metadata: dict[str, str] | None = None) -> Iterator[Span]:
    """Open (or join) a trace for one unit of work. Nested calls add a child span instead of a new
    trace; the outermost one flushes on exit so serverless functions never drop spans."""
    client = _client()
    span = Span()
    depth = _depth.get()
    token = _depth.set(depth + 1)
    stack = ExitStack()
    obs = None
    if client is not None:
        try:
            from langfuse import propagate_attributes

            if depth == 0:
                stack.enter_context(propagate_attributes(
                    user_id=user_id, session_id=session_id, tags=tags, trace_name=name,
                    metadata={k: str(v) for k, v in (metadata or {}).items()}))
            obs = stack.enter_context(client.start_as_current_observation(
                as_type="span", name=name, input=input, metadata=metadata))
        except Exception:  # pragma: no cover
            log.exception("Langfuse trace start failed")
    try:
        yield span
    except Exception as exc:
        span.update(level="ERROR", status_message=f"{type(exc).__name__}: {exc}"[:500])
        raise
    finally:
        try:
            if obs is not None:
                f = dict(span.fields)
                obs.update(output=f.pop("output", None), level=f.pop("level", None),
                           status_message=f.pop("status_message", None), metadata=f or None)
            stack.close()
        except Exception:  # pragma: no cover
            log.exception("Langfuse trace end failed")
        _depth.reset(token)
        if depth == 0:
            flush()


@contextmanager
def generation(prompt_id: str, *, input: Any, metadata: dict[str, Any]) -> Iterator[Span]:
    """One model request. Callers set `output`, `model`, `usage` ({input, output} tokens), and
    optionally `level`/`status_message`; anything else lands in metadata."""
    client = _client()
    span = Span()
    obs = None
    stack = ExitStack()
    if client is not None:
        try:
            obs = stack.enter_context(client.start_as_current_observation(
                as_type="generation", name=ACTION.get(prompt_id, prompt_id.replace("_", "-")),
                input=input, metadata=metadata, version=str(metadata.get("prompt_version", "")) or None))
        except Exception:  # pragma: no cover
            log.exception("Langfuse generation start failed")
    try:
        yield span
    except Exception as exc:
        span.update(level="ERROR", status_message=f"{type(exc).__name__}: {exc}"[:500])
        raise
    finally:
        try:
            if obs is not None:
                f = dict(span.fields)
                usage = dict(f.pop("usage", None) or {})
                cost = usage.pop("cost", None)
                obs.update(
                    output=f.pop("output", None), model=f.pop("model", None), level=f.pop("level", None),
                    status_message=f.pop("status_message", None),
                    usage_details={k: int(v) for k, v in usage.items() if v is not None} or None,
                    # OpenRouter's actual charge: Langfuse has no price table entry for these models.
                    cost_details={"total": float(cost)} if cost else None,
                    metadata={**metadata, **f},
                )
            stack.close()
        except Exception:  # pragma: no cover
            log.exception("Langfuse generation end failed")


def usage_of(resp: Any) -> dict[str, Any]:
    """Token usage, plus OpenRouter's billed cost in USD (requested with `usage: {include: true}`),
    from an OpenAI-style response or final stream chunk."""
    u = getattr(resp, "usage", None)
    if u is None:
        return {}
    return {"input": getattr(u, "prompt_tokens", None), "output": getattr(u, "completion_tokens", None),
            "cost": getattr(u, "cost", None) or (getattr(u, "model_extra", None) or {}).get("cost")}


def flush() -> None:
    client = _client()
    if client is not None:
        try:
            client.flush()
        except Exception:  # pragma: no cover
            log.exception("Langfuse flush failed")
