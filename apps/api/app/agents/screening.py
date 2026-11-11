"""Screening: score → verify citations → retry failed criteria once → finalize (backend plan §12, §13).

Inngest's steps already give durability between score and verify, so this is plain async code
rather than a LangGraph graph: there is no conversation state to checkpoint.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.agents import common
from app.domain.scoring import match_percent, must_have_flags
from app.domain.workflow import Criterion
from app.llm.prompts.screening import CriterionIn, CriterionScore, RetryNote, ScreeningInput, ScreeningOutput
from app.pipeline.citations import locate


class Evidence(BaseModel):
    criterion_id: str
    name: str
    weight: int
    must_have: bool
    score: int
    rationale: str
    quote: str
    line_no: int | None
    verified: bool


class ScreeningResult(BaseModel):
    evidence: list[Evidence]
    match: float
    flags: list[str]
    model_id: str
    prompt_version: int


def _inputs(criteria: list[Criterion], lines: list[str], retry: list[RetryNote] | None = None) -> ScreeningInput:
    wanted = {r.criterion_id for r in retry or []}
    crit = [CriterionIn(id=c.id, name=c.name, must_have=c.must_have) for c in criteria
            if not wanted or c.id in wanted]
    return ScreeningInput(criteria=crit, resume_lines=lines, retry=retry or [])


def _by_id(out: ScreeningOutput, criteria: list[Criterion]) -> dict[str, CriterionScore]:
    known = {c.id for c in criteria}
    got: dict[str, CriterionScore] = {}
    for s in out.scores:
        if s.criterion_id in known and s.criterion_id not in got:
            got[s.criterion_id] = s
    return got


def _failed(scores: dict[str, CriterionScore], lines: list[str]) -> list[RetryNote]:
    """Criteria with a positive score whose quote is missing or not in the resume."""
    return [RetryNote(criterion_id=cid, rejected_quote=s.quote[:200]) for cid, s in scores.items()
            if s.score > 0 and locate(s.quote, lines) is None]


async def score(criteria: list[Criterion], lines: list[str], *, deadline: float) -> dict[str, Any]:
    """Step `score`: one packed call. Returns raw per-criterion scores (JSON-able) + call metadata."""
    res = await common.call_structured("structured", "screening_score", _inputs(criteria, lines), deadline=deadline)
    scores = _by_id(res.value, criteria)
    return {"scores": {k: v.model_dump() for k, v in scores.items()},
            "model_id": res.model_id, "prompt_version": res.prompt_version}


async def verify(criteria: list[Criterion], lines: list[str], draft: dict[str, Any], *,
                 deadline: float, flagged_lines: set[int] | frozenset[int] = frozenset()) -> ScreeningResult:
    """Step `verify_citations`: check every quote, retry the failures once, then score unsupported
    criteria 0 with the flag `no_evidence`. Criteria the model skipped also score 0. A quote from a
    line the injection scan flagged (`flagged_lines`, 1-based) is not evidence: the criterion scores 0
    and the result gets `flagged_quote` (the stuffed-keywords eval case, Phase 11)."""
    scores = {k: CriterionScore.model_validate(v) for k, v in draft["scores"].items()}
    failed = _failed(scores, lines)
    if failed:
        res = await common.call_structured("structured", "screening_score",
                                           _inputs(criteria, lines, failed), deadline=deadline)
        retried = {f.criterion_id for f in failed}
        for cid, again in _by_id(res.value, criteria).items():
            if cid in retried:
                scores[cid] = again

    evidence: list[Evidence] = []
    flags: set[str] = set()
    for c in criteria:
        s = scores.get(c.id)
        line_no = locate(s.quote, lines) if s and s.quote else None
        if line_no is not None and line_no in flagged_lines and s and s.score > 0:
            flags.add("flagged_quote")
            line_no = None
        verified = line_no is not None
        value = s.score if s and (verified or s.score == 0) else 0
        if s and s.score > 0 and not verified:
            flags.add("no_evidence")
        evidence.append(Evidence(
            criterion_id=c.id, name=c.name, weight=c.weight, must_have=c.must_have, score=value,
            rationale=s.rationale if s else "Not assessed by the model.", quote=s.quote if s and verified else "",
            line_no=line_no, verified=verified,
        ))
    points = {e.criterion_id: e.score for e in evidence}
    if must_have_flags(points, criteria):
        flags.add("missing_must_have")
    return ScreeningResult(evidence=evidence, match=match_percent(points, criteria), flags=sorted(flags),
                           model_id=draft["model_id"], prompt_version=draft["prompt_version"])
