"""Error monitoring with Sentry (backend plan §18). Off unless SENTRY_DSN is set.

No personal data leaves: `send_default_pii` is off, request bodies are never attached, cookies and
auth headers are dropped, and emails/phone numbers are masked in every string of an event. Model
outputs and resumes never appear in events because they are not logged.
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import Settings
from app.llm.tracing import _mask_value

log = logging.getLogger("hirevine")
_SENSITIVE_HEADERS = {"authorization", "cookie", "x-forwarded-for", "x-real-ip", "x-inngest-signature"}


def _scrub(event: Any, _hint: Any) -> Any:
    req = event.get("request") or {}
    req.pop("data", None)
    req.pop("cookies", None)
    if isinstance(req.get("headers"), dict):
        req["headers"] = {k: v for k, v in req["headers"].items() if k.lower() not in _SENSITIVE_HEADERS}
    event.pop("user", None)
    return _mask_value(event)


def capture(exc: BaseException, **context: Any) -> None:
    """Report an exception we handled ourselves (the 500 envelope, a job that gave up)."""
    try:
        import sentry_sdk

        if sentry_sdk.get_client().is_active():
            with sentry_sdk.new_scope() as scope:
                for k, v in context.items():
                    scope.set_tag(k, str(v))
                sentry_sdk.capture_exception(exc)
    except Exception:  # pragma: no cover
        pass


def init(settings: Settings) -> bool:
    if not settings.sentry_dsn:
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment={"prod": "production"}.get(settings.app_env, settings.app_env),
            release=settings.release or None,
            send_default_pii=False,
            max_request_body_size="never",
            traces_sample_rate=settings.sentry_traces_sample_rate,
            before_send=_scrub,
            # 4xx are expected answers (validation, auth, limits), not errors worth an alert.
            integrations=[StarletteIntegration(failed_request_status_codes={*range(500, 600)}),
                          FastApiIntegration(failed_request_status_codes={*range(500, 600)})],
        )
        return True
    except Exception:  # pragma: no cover - monitoring must never stop the app
        log.exception("Sentry init failed")
        return False
