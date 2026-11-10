"""Every Inngest function the app serves at /api/inngest."""

from __future__ import annotations

from typing import Any

import inngest

from app.core.config import get_settings


def all_functions() -> list[inngest.Function[Any]]:
    from app.jobs.functions import housekeeping, selftest

    fns: list[inngest.Function[Any]] = [housekeeping.housekeeping]
    if get_settings().is_dev:
        fns.append(selftest.selftest)  # exit-check function; not served in production
    return fns
