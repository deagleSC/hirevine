"""Langfuse spans for model calls (backend plan §11.2). A no-op unless both keys are set.

Only redacted inputs ever reach call_structured, so spans may carry inputs. Tracing
failures never break a call.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from typing import Any

from app.core.config import get_settings

log = logging.getLogger("hirevine.llm")


class Span:
    def __init__(self, inner: Any = None):
        self._inner = inner
        self.fields: dict[str, Any] = {}

    def update(self, **fields: Any) -> None:
        self.fields.update(fields)


@lru_cache
def _client() -> Any:
    s = get_settings()
    if not (s.langfuse_public_key and s.langfuse_secret_key):
        return None
    try:
        from langfuse import Langfuse

        return Langfuse(
            public_key=s.langfuse_public_key,
            secret_key=s.langfuse_secret_key,
            host=s.langfuse_host,
            environment=s.app_env,
        )
    except Exception:  # pragma: no cover - tracing must never break calls
        log.exception("Langfuse init failed; tracing disabled")
        return None


@contextmanager
def generation(name: str, *, input: Any, metadata: dict[str, Any]) -> Iterator[Span]:
    client = _client()
    span = Span()
    obs = None
    if client is not None:
        try:
            obs = client.start_observation(name=name, as_type="generation", input=input, metadata=metadata)
        except Exception:  # pragma: no cover
            log.exception("Langfuse span start failed")
    try:
        yield span
    except Exception as exc:
        span.update(level="ERROR", status_message=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        if obs is not None:
            try:
                f = dict(span.fields)
                obs.update(
                    output=f.pop("output", None),
                    model=f.pop("model", None),
                    level=f.pop("level", None),
                    status_message=f.pop("status_message", None),
                    metadata={**metadata, **f},
                )
                obs.end()
            except Exception:  # pragma: no cover
                log.exception("Langfuse span end failed")


def flush() -> None:
    client = _client()
    if client is not None:
        try:
            client.flush()
        except Exception:  # pragma: no cover
            log.exception("Langfuse flush failed")
