"""Resume screening: one packed call scores every criterion with a quoted citation (backend plan §13 step 6)."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from app.llm.prompts import UNTRUSTED_RULE, Prompt, register, untrusted


class CriterionIn(BaseModel):
    id: str
    name: str
    must_have: bool = False


class RetryNote(BaseModel):
    criterion_id: str
    rejected_quote: str


class ScreeningInput(BaseModel):
    criteria: list[CriterionIn] = Field(min_length=1, max_length=20)
    resume_lines: list[str] = Field(description="Redacted resume, one entry per line, in order")
    retry: list[RetryNote] = Field(default_factory=list, description="Quotes that were not found in the resume")


class CriterionScore(BaseModel):
    criterion_id: str
    score: int = Field(ge=0, le=4, description="0 none, 1 weak, 2 partial, 3 solid, 4 strong evidence")
    rationale: Annotated[str, StringConstraints(max_length=320)] = Field(description="At most 40 words")
    quote: Annotated[str, StringConstraints(max_length=400)] = Field(
        description="Exact text copied from one resume line that supports the score; empty only when score is 0"
    )


class ScreeningOutput(BaseModel):
    scores: list[CriterionScore] = Field(max_length=20)


def _user(data: ScreeningInput) -> str:
    crit = "\n".join(f"- {c.id}: {c.name}" + (" (must-have)" if c.must_have else "") for c in data.criteria)
    resume = "\n".join(f"L{i}: {line}" for i, line in enumerate(data.resume_lines, start=1))
    parts = [f"Criteria (score each one, using its id):\n{crit}", f"Resume:\n{untrusted(resume)}"]
    if data.retry:
        notes = "\n".join(f"- {r.criterion_id}: \"{r.rejected_quote}\"" for r in data.retry)
        parts.append(
            "Your earlier quotes for these criteria do not appear in the resume:\n" + notes + "\n"
            "Score only these criteria again. Copy the quote character for character from a single line "
            "(without the L-number prefix), or give score 0 with an empty quote if there is no evidence."
        )
    return "\n\n".join(parts)


SCREENING_SCORE = register(
    Prompt(
        id="screening_score",
        version=1,
        system=(
            "You screen a redacted resume against a hiring rubric. For every criterion, give a score from 0 to 4 "
            "based only on evidence written in the resume: 0 no evidence, 1 weak or indirect, 2 partial, 3 solid, "
            "4 strong and specific. Give a rationale of at most 40 words, and a quote copied exactly from one "
            "resume line (without its L-number) that supports the score. Never invent or paraphrase a quote; if "
            "nothing supports the criterion, score 0 and leave the quote empty. Placeholders such as [NAME] or "
            "[EDUCATION REMOVED] mark removed personal details: never guess what they hide, and never let name, "
            "gender, age, location, school prestige or writing style affect a score. " + UNTRUSTED_RULE
        ),
        input=ScreeningInput,
        output=ScreeningOutput,
        user=_user,
        description="Submit one score per criterion.",
    )
)
