"""Final report rules (backend plan §16). Pure: no I/O.

Ranking: the mean of the enabled stage scores (screening, quiz, interview), weighted equally, ties
broken by the screening match. A stage without a score is left out of the mean. The suggested
recommendation comes from the AI draft when there is one, otherwise from the overall score.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel

Recommendation = Literal["strong_yes", "yes", "maybe", "no"]
SCORED_TYPES = ("screening", "quiz", "interview")


class StageScore(BaseModel):
    node_id: str
    node_type: str
    status: str
    score: float | None


def overall(stages: list[StageScore]) -> float | None:
    scores = [s.score for s in stages if s.node_type in SCORED_TYPES and s.score is not None]
    return round(sum(scores) / len(scores), 1) if scores else None


def screening_score(stages: list[StageScore]) -> float:
    return next((s.score for s in stages if s.node_type == "screening" and s.score is not None), 0.0)


def rank_key(stages: list[StageScore]) -> tuple[float, float]:
    """Sort descending by this key: overall score, then screening match."""
    return (overall(stages) or 0.0, screening_score(stages))


def rule_recommendation(stages: list[StageScore]) -> Recommendation:
    """The fallback suggestion: a failed stage is "no"; otherwise bands on the overall score."""
    if any(s.status == "failed" for s in stages):
        return "no"
    o = overall(stages) or 0.0
    if o >= 85:
        return "strong_yes"
    if o >= 70:
        return "yes"
    if o >= 55:
        return "maybe"
    return "no"


Outcome = Literal["shortlisted", "not_selected"]


def candidate_outcome(*, reached_final: bool, excluded: bool, recommendation: Recommendation | None) -> Outcome:
    """What a candidate is told on release. Shortlisted means they reached the final list, were not
    excluded, and the hiring team's recommendation (or the suggestion they kept) is yes or strong yes."""
    if reached_final and not excluded and recommendation in ("strong_yes", "yes"):
        return "shortlisted"
    return "not_selected"


TEMPLATE = (
    "Thank you for applying for {title} and for the time you put into the process. "
    "The hiring team has now completed its review. {outcome_line} "
    "We appreciate your interest and wish you the best in your search."
)
OUTCOME_LINES = {
    "shortlisted": "You have been shortlisted, and the team will be in touch about next steps.",
    "not_selected": "On this occasion your application will not be taken further.",
}


def neutral_feedback(title: str, outcome: Outcome) -> str:
    """Released when there is no draft and the manager wrote nothing."""
    return TEMPLATE.format(title=title, outcome_line=OUTCOME_LINES[outcome])


def valid_citations(cited: list[str], known: set[str]) -> list[str]:
    """Cited evidence refs that exist, deduplicated, in order."""
    out: list[str] = []
    for c in cited:
        c = c.strip()
        if c in known and c not in out:
            out.append(c)
    return out


_REF = re.compile(r"\s*[\[(](?:screening|quiz|interview):[\w-]+(?:\s*,\s*(?:screening|quiz|interview):[\w-]+)*[\])]")


def strip_refs(text: str) -> str:
    """Remove evidence refs a model wrote into the candidate-facing text ("… services [screening:c1].")."""
    return re.sub(r"[ \t]+([.,;:!?])", r"\1", _REF.sub("", text)).strip()
