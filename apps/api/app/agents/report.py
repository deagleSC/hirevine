"""Feedback draft (backend plan §16): build the evidence list from stored stage results, make one
call, and keep only citations that point at real evidence."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.agents import common
from app.domain import interview, report
from app.llm.prompts.report import EvidenceIn, ReportDraftInput, ReportDraftOutput, StageIn


class Draft(BaseModel):
    feedback: str
    recommendation: report.Recommendation
    citations: list[str]
    model_id: str
    prompt_version: int


def evidence_for(stages: list[dict[str, Any]], transcript: list[interview.Entry]) -> list[EvidenceIn]:
    """Stage evidence as citable items. Screening quotes come from the redacted resume, so no
    personal details reach the prompt; interview items carry the candidate's cited answers."""
    out: list[EvidenceIn] = []
    for s in stages:
        raw = s.get("evidence")
        items: list[Any] = raw if isinstance(raw, list) else []
        for e in items:
            if not isinstance(e, dict):
                continue
            if s["node_type"] == "screening" and "criterion_id" in e:
                out.append(EvidenceIn(ref=f"screening:{e['criterion_id']}", stage="resume screening",
                                      summary=f"{e.get('name')}: {e.get('score')}/4. {e.get('rationale', '')}",
                                      quote=str(e.get("quote") or "") if e.get("verified") else ""))
            elif s["node_type"] == "quiz" and "question_id" in e:
                verdict = "answered correctly" if e.get("correct") else (
                    "not answered" if e.get("chosen") is None else "answered incorrectly")
                out.append(EvidenceIn(ref=f"quiz:{e['question_id']}", stage="skills quiz",
                                      summary=f"{e.get('prompt')} ({verdict}). {e.get('explanation', '')}"))
            elif s["node_type"] == "interview" and "item_id" in e:
                quotes = [transcript[n - 1].content for n in e.get("turns") or [] if 0 < n <= len(transcript)]
                out.append(EvidenceIn(ref=f"interview:{e['item_id']}", stage="interview",
                                      summary=f"{e.get('name')}: {e.get('score')}/4. {e.get('rationale', '')}",
                                      quote="\n".join(q[:600] for q in quotes[:2])))
    return out[:60]


async def draft(*, title: str, reached_final: bool, stages: list[dict[str, Any]],
                transcript: list[interview.Entry], deadline: float) -> Draft:
    evidence = evidence_for(stages, transcript)
    inp = ReportDraftInput(
        title=title, reached_final=reached_final,
        stages=[StageIn(node_type=s["node_type"], status=s["status"],
                        score=float(s["score"]) if s.get("score") is not None else None) for s in stages],
        evidence=evidence,
    )
    res = await common.call_structured("structured", "report_draft", inp, deadline=deadline)
    out: ReportDraftOutput = res.value
    cites = report.valid_citations(out.cites, {e.ref for e in evidence})
    return Draft(feedback=report.strip_refs(out.feedback), recommendation=out.recommendation, citations=cites,
                 model_id=res.model_id, prompt_version=res.prompt_version)
