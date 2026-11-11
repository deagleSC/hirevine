"""Quiz rules in plain code (backend plan §14): validating generated questions, the candidate-safe
snapshot, and grading. No model is involved after generation: grades come from the answer key.
"""

from __future__ import annotations

import logging
import secrets
from collections.abc import Iterable, Mapping
from typing import Any

from pydantic import BaseModel, ValidationError

from app.domain.workflow import MAX_QUIZ_QUESTIONS, QuizQuestion, normalize_prompt

log = logging.getLogger("hirevine.quiz")


class Dropped(BaseModel):
    index: int
    reason: str


class Validated(BaseModel):
    questions: list[QuizQuestion]
    dropped: list[Dropped]


def _norm_option(text: str) -> str:
    return " ".join(text.split()).lower()


def new_question_id() -> str:
    return f"q-{secrets.token_hex(4)}"


def validate(raw: Iterable[Mapping[str, Any]], *, want: int, existing: Iterable[str] = ()) -> Validated:
    """Keep generated questions that have one in-range answer, distinct options and a prompt not
    already in the quiz (normalized). Stop at `want`. Every dropped question is logged with why."""
    seen = {normalize_prompt(p) for p in existing}
    kept: list[QuizQuestion] = []
    dropped: list[Dropped] = []

    def drop(i: int, reason: str) -> None:
        dropped.append(Dropped(index=i, reason=reason))
        log.info("quiz question %d dropped: %s", i, reason)

    for i, q in enumerate(raw):
        if len(kept) >= want:
            drop(i, "over the requested count")
            continue
        options = [str(o).strip() for o in q.get("options") or []]
        if len({_norm_option(o) for o in options}) != len(options):
            drop(i, "options are not distinct")
            continue
        answer = q.get("answer_index")
        if not isinstance(answer, int) or not 0 <= answer < len(options):
            drop(i, "answer_index is out of range")
            continue
        key = normalize_prompt(str(q.get("prompt") or ""))
        if not key:
            drop(i, "empty prompt")
            continue
        if key in seen:
            drop(i, "duplicate prompt")
            continue
        try:
            question = QuizQuestion(
                id=new_question_id(), prompt=str(q["prompt"]), options=options, answer_index=answer,
                explanation=str(q.get("explanation") or "")[:1000], difficulty=q.get("difficulty") or "medium",
            )
        except ValidationError as exc:
            drop(i, f"invalid: {exc.errors()[0]['msg']}")
            continue
        seen.add(key)
        kept.append(question)
    return Validated(questions=kept, dropped=dropped)


def room(existing: int) -> int:
    return max(0, MAX_QUIZ_QUESTIONS - existing)


# ------------------------------------------------------------------ attempts

class PublicQuestion(BaseModel):
    """What the candidate sees: no answer, no explanation."""

    id: str
    prompt: str
    options: list[str]


def snapshot(questions: Iterable[QuizQuestion]) -> list[PublicQuestion]:
    return [PublicQuestion(id=q.id, prompt=q.prompt, options=list(q.options)) for q in questions]


class QuestionResult(BaseModel):
    question_id: str
    prompt: str
    options: list[str]
    chosen: int | None
    answer_index: int | None
    correct: bool
    explanation: str


class Grade(BaseModel):
    score: float
    correct: int
    total: int
    results: list[QuestionResult]


def clean_answers(snap: list[PublicQuestion], answers: Mapping[str, Any]) -> dict[str, int]:
    """Keep answers to questions in the snapshot whose option index is in range."""
    sizes = {q.id: len(q.options) for q in snap}
    return {qid: a for qid, a in answers.items()
            if qid in sizes and isinstance(a, int) and not isinstance(a, bool) and 0 <= a < sizes[qid]}


def grade(snap: list[PublicQuestion], key: Mapping[str, QuizQuestion], answers: Mapping[str, Any]) -> Grade:
    """score = 100 × correct / total over the snapshot the candidate saw. A question missing from
    the key (removed after the attempt started) counts as incorrect rather than shrinking the paper."""
    chosen = clean_answers(snap, answers)
    results: list[QuestionResult] = []
    for q in snap:
        k = key.get(q.id)
        pick = chosen.get(q.id)
        results.append(QuestionResult(
            question_id=q.id, prompt=q.prompt, options=q.options, chosen=pick,
            answer_index=k.answer_index if k else None,
            correct=k is not None and pick == k.answer_index, explanation=k.explanation if k else "",
        ))
    total = len(snap)
    correct = sum(r.correct for r in results)
    score = round(100 * correct / total, 1) if total else 0.0
    return Grade(score=score, correct=correct, total=total, results=results)
