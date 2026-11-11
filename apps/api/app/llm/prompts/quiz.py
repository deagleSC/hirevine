"""Quiz generation: the whole paper in one call, from the job and its rubric (backend plan §14).

The output schema is deliberately loose (any option count, any answer index): `domain.quiz.validate`
drops bad questions one by one, so one malformed question does not fail the whole call.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, Field, StringConstraints

from app.llm.prompts import Prompt, register

Difficulty = Literal["easy", "medium", "hard"]


class QuizGenerateInput(BaseModel):
    title: str
    seniority: str | None = None
    description: str = Field(max_length=6000)
    skills: list[str] = Field(description="Rubric criteria to cover, most important first", max_length=20)
    count: int = Field(ge=1, le=30)
    difficulty: Difficulty | Literal["mixed"] = "mixed"
    avoid: list[str] = Field(default_factory=list, description="Questions already in the quiz", max_length=30)


class GeneratedQuestion(BaseModel):
    # Models often name this field "question" (seen with gemma-4); accept the common spellings.
    prompt: Annotated[str, StringConstraints(max_length=1000)] = Field(
        validation_alias=AliasChoices("prompt", "question", "text"), description="The question text")
    options: list[Annotated[str, StringConstraints(max_length=300)]] = Field(max_length=6)
    answer_index: int = Field(description="0-based index of the single correct option")
    explanation: Annotated[str, StringConstraints(max_length=1000)] = Field(
        default="", description="One or two sentences on why the answer is correct")
    difficulty: Difficulty = "medium"


class QuizGenerateOutput(BaseModel):
    questions: list[GeneratedQuestion] = Field(max_length=40)


def _user(data: QuizGenerateInput) -> str:
    skills = "\n".join(f"- {s}" for s in data.skills) or "- (use the description)"
    parts = [
        f"Role: {data.title}" + (f" ({data.seniority})" if data.seniority else ""),
        f"Description:\n{data.description}",
        f"Skills to cover:\n{skills}",
        f"Write exactly {data.count} questions. Difficulty: "
        + ("a mix of easy, medium and hard" if data.difficulty == "mixed" else data.difficulty) + ".",
    ]
    if data.avoid:
        parts.append("The quiz already has these questions; do not repeat or rephrase them:\n"
                     + "\n".join(f"- {q}" for q in data.avoid))
    return "\n\n".join(parts)


QUIZ_GENERATE = register(
    Prompt(
        id="quiz_generate",
        version=2,  # v2: accept "question"/"text" for the prompt field
        system=(
            "You write multiple-choice screening quizzes for a hiring team. Each question tests practical, "
            "job-relevant knowledge of one listed skill, spread across the skills in order of importance. "
            "Give 4 options (3 to 5 allowed) with exactly one correct answer; the other options must be "
            "plausible but clearly wrong to an expert, and all options must be distinct. Never use 'all of the "
            "above' or 'none of the above'. Questions must be answerable without external material, must not "
            "depend on a specific company's internal tools, and must not touch on age, gender, ethnicity, "
            "religion, disability, family, nationality or any other personal characteristic. Write each "
            "explanation in one or two sentences, and set answer_index to the 0-based position of the correct "
            "option. Vary where the correct option appears."
        ),
        input=QuizGenerateInput,
        output=QuizGenerateOutput,
        user=_user,
        description="Submit the quiz questions.",
    )
)
