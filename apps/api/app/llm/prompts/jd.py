"""Job-description chat prompts (backend plan §12, jd_agent)."""

from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from app.llm.prompts import Prompt, register

Seniority = Literal["intern", "junior", "mid", "senior", "lead", "principal"]
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class JobDraft(BaseModel):
    title: Short | None = None
    seniority: Seniority | None = None
    location: Short | None = Field(default=None, description="City, region, or 'Remote'")
    summary: Annotated[str, StringConstraints(max_length=1500)] | None = Field(
        default=None, description="Two or three sentences on what the role does"
    )
    must_have_skills: list[Short] = Field(default_factory=list, max_length=8)
    nice_to_have_skills: list[Short] = Field(default_factory=list, max_length=8)
    include_quiz: bool = True
    quiz_questions: Annotated[int, Field(ge=3, le=20)] = 10
    include_interview: bool = True


REQUIRED: dict[str, str] = {
    "title": "the job title",
    "seniority": "the seniority level",
    "location": "the location (or remote)",
    "must_have_skills": "the must-have skills",
}


def missing_fields(d: JobDraft) -> list[str]:
    """Decided in code, not by the model: what still has to be asked."""
    return [k for k in REQUIRED if not getattr(d, k)]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(max_length=4000)]


class JdTurnInput(BaseModel):
    messages: list[ChatMessage]
    draft: JobDraft


class JdTurnOutput(BaseModel):
    draft: JobDraft = Field(description="The draft updated with everything the manager has said so far")
    reply: Annotated[str, StringConstraints(min_length=1, max_length=1500)] = Field(
        description="Your next message to the manager"
    )


def _turn_user(data: JdTurnInput) -> str:
    convo = "\n".join(f"{m.role.upper()}: {m.content}" for m in data.messages)
    return (
        f"Current draft (JSON):\n{json.dumps(data.draft.model_dump(), indent=2)}\n\n"
        f"Conversation so far:\n{convo}\n\n"
        f"Required fields: {', '.join(REQUIRED)}."
    )


JD_TURN = register(
    Prompt(
        id="jd_turn",
        version=1,
        system=(
            "You help a hiring manager describe a role so Hirevine can build a screening pipeline. "
            "Update the draft with every fact the manager has given: never invent facts, keep values they "
            "already gave unless they change them, and leave unknown fields empty. Skills are short noun "
            "phrases ('React', 'PostgreSQL'), at most 8 each. If the manager says to skip the quiz or the "
            "interview, set include_quiz or include_interview to false. "
            "Then write a short, friendly reply: if any required field is still missing, ask for the missing "
            "ones in one message (at most two questions); otherwise summarize the role in one or two "
            "sentences and say the proposed pipeline is ready to review. "
            "Never ask about or record age, gender, marital status, religion, caste, disability or "
            "nationality; if the manager mentions them as requirements, say Hirevine cannot screen on them."
        ),
        input=JdTurnInput,
        output=JdTurnOutput,
        user=_turn_user,
        description="Submit the updated draft and your reply.",
    )
)


class ProposedCriterion(BaseModel):
    name: Short
    weight: Annotated[int, Field(ge=1, le=5)]
    must_have: bool = False


class ProposedRubricItem(BaseModel):
    name: Short
    weight: Annotated[int, Field(ge=1, le=5)]
    description: Annotated[str, StringConstraints(max_length=500)] = ""


class ProtectedFlag(BaseModel):
    criterion: Short
    characteristic: Short
    reason: Annotated[str, StringConstraints(max_length=300)]


class JdRubricOutput(BaseModel):
    description: Annotated[str, StringConstraints(min_length=1, max_length=4000)] = Field(
        description="A job description candidates will read: role, responsibilities, requirements"
    )
    criteria: Annotated[list[ProposedCriterion], Field(min_length=1, max_length=10)]
    interview_themes: Annotated[list[Short], Field(max_length=6)] = Field(default_factory=list)
    interview_rubric: Annotated[list[ProposedRubricItem], Field(max_length=6)] = Field(default_factory=list)
    protected_flags: list[ProtectedFlag] = Field(default_factory=list)


def _rubric_user(data: JobDraft) -> str:
    return f"Role draft (JSON):\n{json.dumps(data.model_dump(), indent=2)}"


JD_RUBRIC = register(
    Prompt(
        id="jd_rubric",
        version=1,
        system=(
            "You design resume-screening criteria and an interview rubric for a role. Criteria are concrete, "
            "checkable from a resume, and job-related: one per must-have skill (must_have true, weight 4 or 5), "
            "plus a few for nice-to-have skills and relevant experience (weight 1 to 3). Interview themes and "
            "rubric items assess how the candidate applies those skills. Also write a job description of "
            "120 to 250 words. Finally, list in protected_flags any criterion that could screen on a protected "
            "characteristic (age, gender, marital or family status, religion, caste, disability, nationality "
            "or origin), including proxies such as 'young', 'native speaker' or 'recent graduate only'."
        ),
        input=JobDraft,
        output=JdRubricOutput,
        user=_rubric_user,
        description="Submit the description, criteria, interview plan and any protected-characteristic flags.",
    )
)
