"""Feedback drafting (backend plan §16): one call per application, from the stored evidence only.

The draft is addressed to the candidate and released to them when the campaign completes (after the
manager edits it). It cites evidence by ref; code drops refs that do not exist.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from app.llm.prompts import UNTRUSTED_RULE, Prompt, register, untrusted
from app.llm.prompts.interview import PROTECTED


class StageIn(BaseModel):
    node_type: str
    status: str
    score: float | None


class EvidenceIn(BaseModel):
    ref: str = Field(description='e.g. "screening:c1", "quiz:q3", "interview:r2"')
    stage: str
    summary: str = Field(description="What was assessed and the result")
    quote: str = Field(default="", description="The candidate's own words, if any")


class ReportDraftInput(BaseModel):
    title: str
    reached_final: bool
    stages: list[StageIn]
    evidence: list[EvidenceIn] = Field(max_length=60)


class ReportDraftOutput(BaseModel):
    cites: list[str] = Field(max_length=12, description="Refs of the evidence the feedback draws on")
    feedback: Annotated[str, StringConstraints(min_length=40, max_length=2000)] = Field(
        description="The feedback to the candidate, 120 to 220 words")
    recommendation: Literal["strong_yes", "yes", "maybe", "no"] = Field(
        description="Your suggestion to the hiring team; never mentioned in the feedback")


def _user(data: ReportDraftInput) -> str:
    stages = "\n".join(f"- {s.node_type}: {s.status}" + (f", score {s.score:g}" if s.score is not None else "")
                       for s in data.stages)
    ev = []
    for e in data.evidence:
        line = f"[{e.ref}] ({e.stage}) {e.summary}"
        if e.quote:
            line += "\n" + untrusted(e.quote)
        ev.append(line)
    return "\n\n".join([
        f"Role: {data.title}",
        "The candidate " + ("reached the final list." if data.reached_final else "did not reach the final list."),
        f"Stages:\n{stages}",
        "Evidence:\n" + ("\n\n".join(ev) or "(none)"),
    ])


REPORT_DRAFT = register(
    Prompt(
        id="report_draft",
        version=2,  # v2: refs go in `cites` only; v1 put "[screening:c1]" markers in the candidate's text
        system=(
            "You draft feedback for a job candidate on behalf of a hiring team, and suggest a recommendation "
            "to the team. Write to the candidate in the second person, in 120 to 220 words: thank them, name "
            "two or three specific strengths and one or two specific areas to develop, each grounded in the "
            "evidence, and end on a constructive note. Base every point only on the listed evidence and cite "
            "the refs you used. Be honest but kind; do not promise or hint at a hiring decision, and do not "
            "mention scores, ranks, rubric names, cutoffs or that an AI was involved. Never mention or infer "
            f"{PROTECTED}. " + UNTRUSTED_RULE
        ),
        input=ReportDraftInput,
        output=ReportDraftOutput,
        user=_user,
        description="Submit the feedback draft.",
    )
)
