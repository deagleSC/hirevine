"""Quiz generation (backend plan §14): one call for the whole paper, validate in code, and one
retry for the shortfall if too few questions survive. Plain async code: Inngest steps give the
durability, and there is no conversation to checkpoint."""

from __future__ import annotations

from typing import Literal

from app.agents import common
from app.domain import quiz
from app.domain.workflow import QuizQuestion
from app.llm.prompts.quiz import QuizGenerateInput, QuizGenerateOutput


async def generate(*, title: str, seniority: str | None, description: str, skills: list[str], count: int,
                   difficulty: Literal["easy", "medium", "hard", "mixed"], existing: list[str],
                   deadline: float) -> list[QuizQuestion]:
    """Up to `count` valid questions that do not repeat `existing` prompts. May return fewer."""
    kept: list[QuizQuestion] = []
    for _ in range(2):  # the first call, then one retry for whatever is missing
        missing = count - len(kept)
        if missing <= 0:
            break
        avoid = existing + [q.prompt for q in kept]
        inp = QuizGenerateInput(title=title, seniority=seniority, description=description[:6000],
                                skills=skills[:20], count=missing, difficulty=difficulty, avoid=avoid[-30:])
        res = await common.call_structured("structured", "quiz_generate", inp, deadline=deadline)
        out: QuizGenerateOutput = res.value
        checked = quiz.validate((q.model_dump() for q in out.questions), want=missing, existing=avoid)
        kept.extend(checked.questions)
    return kept
