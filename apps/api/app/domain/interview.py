"""AI interview rules (backend plan §15). Pure: no I/O.

The transcript is a list of entries `{role: "interviewer" | "candidate", content, at}`. Entries are
numbered from 1 in transcript order; the scorer cites candidate answers by that number, and
`verify_turns` keeps only numbers that point at a candidate entry.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.domain.workflow import InterviewConfig, RubricItem

MAX_ANSWER_CHARS = 2000
MAX_QUESTION_CHARS = 800
MINUTES_PER_QUESTION = 5
MIN_MINUTES = 15
MAX_SCORE = 4  # each rubric item is scored 0–4

DISCLOSURE = (
    "This interview is conducted by an AI interviewer, not a person. It asks questions about the role, "
    "one at a time, and your answers are scored against the hiring team's rubric. The hiring team sees "
    "the full transcript and makes the decisions. The interviewer will not ask about personal matters "
    "such as age, family, religion, health or nationality."
)
CLOSING = "Thank you, that was the last question. Your answers have been saved and will be reviewed."

Role = Literal["interviewer", "candidate"]


class Entry(BaseModel):
    role: Role
    content: str
    at: datetime | None = None


class NumberedEntry(Entry):
    n: int = Field(description="1-based position in the transcript; the scorer cites candidate answers by it")


def time_limit_min(config: InterviewConfig) -> int:
    return max(MIN_MINUTES, config.turn_cap * MINUTES_PER_QUESTION)


def entries(raw: list[dict[str, object]] | None) -> list[Entry]:
    return [Entry.model_validate(e) for e in raw or []]


def numbered(transcript: list[Entry]) -> list[NumberedEntry]:
    return [NumberedEntry(n=i, **e.model_dump()) for i, e in enumerate(transcript, start=1)]


def questions_asked(transcript: list[Entry]) -> int:
    return sum(e.role == "interviewer" for e in transcript)


def answers_given(transcript: list[Entry]) -> int:
    return sum(e.role == "candidate" for e in transcript)


def awaiting(transcript: list[Entry]) -> Literal["question", "answer"]:
    """What the conversation needs next: a question when it is empty or the candidate spoke last."""
    return "answer" if transcript and transcript[-1].role == "interviewer" else "question"


def clean_question(text: str) -> str:
    """The streamed model text as stored: trimmed, without a leading speaker label, capped."""
    t = text.strip()
    for label in ("Interviewer:", "**Interviewer:**", "AI:", "Question:"):
        if t.startswith(label):
            t = t[len(label):].strip()
    return t[:MAX_QUESTION_CHARS]


def verify_turns(turns: list[int], transcript: list[Entry]) -> list[int]:
    """Cited turn numbers that exist and are candidate answers, deduplicated, in order."""
    out: list[int] = []
    for n in turns:
        if 1 <= n <= len(transcript) and transcript[n - 1].role == "candidate" and n not in out:
            out.append(n)
    return out


class ItemScore(BaseModel):
    item_id: str
    name: str
    weight: int
    score: int = Field(ge=0, le=MAX_SCORE)
    rationale: str
    turns: list[int]
    verified: bool


class Scored(BaseModel):
    score: float = Field(description="Weighted rubric score, 0–100, one decimal")
    items: list[ItemScore]
    flags: list[str]


def score(rubric: list[RubricItem], raw: dict[str, tuple[int, str, list[int]]], transcript: list[Entry]) -> Scored:
    """Weighted rubric score. `raw` maps item id → (score 0–4, rationale, cited turns). An item with
    no verified candidate turn scores 0 and flags `no_evidence`; a missing item counts as 0 too."""
    items: list[ItemScore] = []
    flags: set[str] = set()
    for r in rubric:
        s, rationale, cited = raw.get(r.id, (0, "Not scored.", []))
        turns = verify_turns(cited, transcript)
        ok = bool(turns)
        if not ok and s > 0:
            flags.add("no_evidence")
        items.append(ItemScore(item_id=r.id, name=r.name, weight=r.weight, score=max(0, min(MAX_SCORE, s)) if ok else 0,
                               rationale=rationale, turns=turns, verified=ok))
    total = sum(i.weight for i in items) * MAX_SCORE
    pct = round(100 * sum(i.weight * i.score for i in items) / total, 1) if total else 0.0
    return Scored(score=pct, items=items, flags=sorted(flags))
