"""AI interview (backend plan §12, §15): stream the next question, and score the finished transcript.

Plain async code rather than a LangGraph graph: the transcript in `interview_sessions` is the whole
conversation state and is saved after every turn, so a resumed interview needs no checkpoint.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from app.agents import common
from app.domain import interview
from app.domain.workflow import InterviewConfig
from app.llm.prompts.interview import (
    InterviewNextInput,
    InterviewScoreInput,
    InterviewScoreOutput,
    RubricIn,
    TurnIn,
)


def _turns(transcript: list[interview.Entry]) -> list[TurnIn]:
    return [TurnIn(n=e.n, role=e.role, content=e.content) for e in interview.numbered(transcript)]


def next_question(*, title: str, seniority: str | None, description: str, config: InterviewConfig,
                  transcript: list[interview.Entry], deadline: float) -> AsyncIterator[str]:
    """Stream the next question's text. The caller stores `interview.clean_question(full text)`."""
    inp = InterviewNextInput(
        title=title, seniority=seniority, description=description[:4000], themes=config.themes[:10],
        prompt_additions=config.prompt_additions, question_number=interview.questions_asked(transcript) + 1,
        turn_cap=config.turn_cap, transcript=_turns(transcript)[-20:],
    )
    stream: AsyncIterator[str] = common.stream_text("structured", "interview_next", inp, deadline=deadline)
    return stream


async def score(*, title: str, config: InterviewConfig, transcript: list[interview.Entry], deadline: float,
                cache_enabled: bool = True) -> tuple[interview.Scored, str, int]:
    """Score the transcript against the rubric; returns (result, model id, prompt version)."""
    inp = InterviewScoreInput(
        title=title, rubric=[RubricIn(id=r.id, name=r.name, description=r.description) for r in config.rubric],
        transcript=_turns(transcript),
    )
    res = await common.call_structured("structured", "interview_score", inp, deadline=deadline,
                                       cache_enabled=cache_enabled)
    out: InterviewScoreOutput = res.value
    # Answer k (as cited) → its 1-based position in the transcript, which is what managers see.
    positions = [e.n for e in interview.numbered(transcript) if e.role == "candidate"]
    raw = {i.item_id: (i.score, i.rationale, [positions[k - 1] for k in i.answers if 1 <= k <= len(positions)])
           for i in out.items}
    return interview.score(config.rubric, raw, transcript), res.model_id, res.prompt_version
