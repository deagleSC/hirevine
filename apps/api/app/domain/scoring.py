"""Screening score maths (backend plan §13 step 8)."""

from __future__ import annotations

from app.domain.workflow import Criterion

S_MAX = 4


def match_percent(scores: dict[str, int], criteria: list[Criterion], s_max: int = S_MAX) -> float:
    total_w = sum(c.weight for c in criteria)
    if total_w == 0:
        return 0.0
    return round(100 * sum(c.weight * scores.get(c.id, 0) for c in criteria) / (s_max * total_w), 1)


def must_have_flags(scores: dict[str, int], criteria: list[Criterion]) -> list[str]:
    """Must-haves scored 0: a visible flag for the manager, never an automatic reject."""
    return [c.id for c in criteria if c.must_have and scores.get(c.id, 0) == 0]
