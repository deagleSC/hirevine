"""Every Inngest function the app serves at /api/inngest."""

from __future__ import annotations

from typing import Any

import inngest

from app.core.config import get_settings


def all_functions() -> list[inngest.Function[Any]]:
    from app.jobs.functions import (
        generate_quiz,
        housekeeping,
        interview_deadline,
        quiz_deadline,
        score_interview,
        screen_application,
        selftest,
    )

    fns: list[inngest.Function[Any]] = [housekeeping.housekeeping, screen_application.screen_application,
                                        generate_quiz.generate_quiz, quiz_deadline.quiz_deadline,
                                        interview_deadline.interview_deadline, score_interview.score_interview]
    if get_settings().is_dev:
        fns.append(selftest.selftest)  # exit-check function; not served in production
    return fns
