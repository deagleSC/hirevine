"""Small stand-ins for the screening, quiz and patch tasks, used by evals/smoke_test.py to
pick the primary model (backend plan §11.4). The real prompts arrive in Phases 4–6."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.llm.prompts import UNTRUSTED_RULE, Prompt, register, untrusted

# ------------------------------------------------------------------ screen


class ScreenInput(BaseModel):
    criteria: list[str]
    resume: str  # redacted, with line numbers


class CriterionFinding(BaseModel):
    criterion: str
    met: bool
    quote: str = Field(
        description="Exact text copied from the resume that shows the criterion is met; empty if not met"
    )


class ScreenOutput(BaseModel):
    findings: list[CriterionFinding]
    score: int = Field(ge=0, le=100)


def _screen_user(data: ScreenInput) -> str:
    crit = "\n".join(f"- {c}" for c in data.criteria)
    return f"Criteria:\n{crit}\n\nResume:\n{untrusted(data.resume)}"


SMOKE_SCREEN = register(
    Prompt(
        id="smoke_screen",
        version=1,
        system=(
            "You screen a resume against hiring criteria. For each criterion, decide whether the "
            "resume shows it. When it does, copy a short exact quote from the resume as evidence; "
            "never paraphrase. Then give an overall score from 0 to 100. " + UNTRUSTED_RULE
        ),
        input=ScreenInput,
        output=ScreenOutput,
        user=_screen_user,
        description="Submit one finding per criterion, in the given order, and the overall score.",
    )
)

# -------------------------------------------------------------------- quiz


class QuizInput(BaseModel):
    role: str
    skills: list[str]
    count: int = Field(ge=1, le=10)


class QuizQuestion(BaseModel):
    question: str
    options: list[str] = Field(min_length=4, max_length=4)
    correct_index: int = Field(ge=0, le=3)


class QuizOutput(BaseModel):
    questions: list[QuizQuestion]


def _quiz_user(data: QuizInput) -> str:
    return f"Role: {data.role}\nSkills: {', '.join(data.skills)}\nNumber of questions: {data.count}"


SMOKE_QUIZ = register(
    Prompt(
        id="smoke_quiz",
        version=1,
        system=(
            "You write multiple-choice screening questions for a role. Each question has exactly four "
            "distinct options and exactly one correct answer. Test practical knowledge of the listed "
            "skills. Write exactly the number of questions requested."
        ),
        input=QuizInput,
        output=QuizOutput,
        user=_quiz_user,
        description="Submit the questions.",
    )
)

# ------------------------------------------------------------------- patch


class PatchInput(BaseModel):
    workflow: dict[str, object]
    instruction: str


class SetCutoff(BaseModel):
    op: Literal["set_cutoff"]
    node_id: str
    value: int = Field(ge=0, le=100)


class SetQuizLength(BaseModel):
    op: Literal["set_quiz_length"]
    node_id: str
    value: int = Field(ge=1, le=30)


class RemoveNode(BaseModel):
    op: Literal["remove_node"]
    node_id: str


class PatchOutput(BaseModel):
    ops: list[SetCutoff | SetQuizLength | RemoveNode]


def _patch_user(data: PatchInput) -> str:
    import json

    return f"Workflow:\n{json.dumps(data.workflow, indent=2)}\n\nManager's request: {data.instruction}"


SMOKE_PATCH = register(
    Prompt(
        id="smoke_patch",
        version=1,
        system=(
            "You turn a hiring manager's request into the smallest list of edit operations on a "
            "screening workflow. Use only these operations: set_cutoff (pass mark 0-100 on a screen "
            "or quiz node), set_quiz_length (number of questions on a quiz node), remove_node. Refer to "
            "nodes by their id. Do not add operations the request did not ask for."
        ),
        input=PatchInput,
        output=PatchOutput,
        user=_patch_user,
        description="Submit the operations in the order they should be applied.",
    )
)
