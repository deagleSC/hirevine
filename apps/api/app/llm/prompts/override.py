"""Natural-language workflow edits → patches (backend plan §12, override_agent)."""

from __future__ import annotations

import json
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from app.domain.patches import Patch
from app.llm.prompts import Prompt, register


class OverrideTurn(BaseModel):
    instruction: str
    explanation: str


class OverrideInput(BaseModel):
    workflow: dict[str, object]
    instruction: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    history: list[OverrideTurn] = Field(default_factory=list, max_length=10)
    previous_error: str | None = None


class OverrideOutput(BaseModel):
    patches: list[Patch] = Field(max_length=30)
    explanation: Annotated[str, StringConstraints(min_length=1, max_length=1000)] = Field(
        description="One or two sentences on what the patches do, or why nothing can be changed"
    )


def _user(data: OverrideInput) -> str:
    parts = [f"Current workflow (JSON):\n{json.dumps(data.workflow, indent=2)}"]
    if data.history:
        parts.append("Earlier requests in this conversation:\n" + "\n".join(
            f"- {t.instruction} → {t.explanation}" for t in data.history))
    parts.append(f"Manager's request: {data.instruction}")
    if data.previous_error:
        parts.append(f"Your previous answer was rejected: {data.previous_error}\nFix it.")
    return "\n\n".join(parts)


OVERRIDE_PATCHES = register(
    Prompt(
        id="override_patches",
        version=1,
        system=(
            "You turn a hiring manager's request into the smallest list of edit operations on their screening "
            "workflow. Use only the operations in the schema, and refer to nodes and items by the ids in the "
            "current workflow. Rules: set_cutoff is for the screening node; set_pass_mark is the quiz pass mark "
            "or the interview pass threshold; toggle_node works only on quiz or interview nodes; "
            "update_criterion lists only the fields that change; new criteria and rubric items need new short "
            "ids that are not already used; update_interview_rubric replaces the whole rubric, so include the "
            "items to keep. Never add operations the request did not ask for, and do not repeat a value that is "
            "already set. If the request cannot be done with these operations, or would screen on a protected "
            "characteristic (age, gender, marital status, religion, caste, disability, nationality), return no "
            "operations and explain why."
        ),
        input=OverrideInput,
        output=OverrideOutput,
        user=_user,
        description="Submit the operations, in order, and a short explanation.",
    )
)
