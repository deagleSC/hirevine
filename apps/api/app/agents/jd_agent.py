"""JD agent (backend plan §12): extract → ask_missing loop → build_rubric → protected_check →
assemble_workflow. One graph invocation per chat turn, checkpointed by thread_id.

Model calls: one per turn (jd_turn), plus one (jd_rubric) on the turn the draft becomes
complete. Missing fields are decided in code, not by the model.
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict
from uuid import UUID

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel

from app.agents import common
from app.domain.protected import protected_warnings
from app.domain.workflow import (
    Criterion,
    FinalConfig,
    FinalNode,
    InterviewConfig,
    InterviewNode,
    QuizConfig,
    QuizNode,
    RubricItem,
    ScreeningConfig,
    ScreeningNode,
    Workflow,
    chain,
)
from app.llm.prompts.jd import (
    ChatMessage,
    JdRubricOutput,
    JdTurnInput,
    JdTurnOutput,
    JobDraft,
    ProtectedFlag,
    missing_fields,
)
from app.llm.wrapper import deadline_in


class JdState(TypedDict, total=False):
    messages: Annotated[list[dict[str, str]], operator.add]
    draft: dict[str, Any]
    missing: list[str]
    summary: dict[str, Any] | None
    workflow: dict[str, Any] | None
    warnings: list[dict[str, str]]


class JobSummary(BaseModel):
    title: str
    seniority: str
    location: str
    description: str
    must_have_skills: list[str]
    nice_to_have_skills: list[str]


class CriterionWarning(BaseModel):
    criterion: str
    characteristic: str
    reason: str


async def turn(state: JdState) -> JdState:
    msgs = [ChatMessage.model_validate(m) for m in state["messages"][-20:]]
    draft = JobDraft(**(state.get("draft") or {}))
    res = await common.call_structured("structured", "jd_turn", JdTurnInput(messages=msgs, draft=draft),
                                       deadline=deadline_in(55), sync=True)
    out: JdTurnOutput = res.value
    new = out.draft
    return {
        "messages": [{"role": "assistant", "content": out.reply}],
        "draft": new.model_dump(),
        "missing": missing_fields(new),
        "summary": None,
        "workflow": None,
        "warnings": [],
    }


def route(state: JdState) -> str:
    return "ask" if state["missing"] else "build_rubric"


async def build_rubric(state: JdState) -> JdState:
    draft = JobDraft(**state["draft"])
    res = await common.call_structured("structured", "jd_rubric", draft, deadline=deadline_in(55), sync=True)
    out: JdRubricOutput = res.value
    summary = JobSummary(
        title=draft.title or "", seniority=draft.seniority or "", location=draft.location or "",
        description=out.description, must_have_skills=draft.must_have_skills,
        nice_to_have_skills=draft.nice_to_have_skills,
    )
    return {"summary": summary.model_dump(), "workflow": {"rubric": out.model_dump()}}


def protected_check(state: JdState) -> JdState:
    """Keyword list on every criterion, merged with the model's own flags (a warning, not a block)."""
    rubric = JdRubricOutput(**state["workflow"]["rubric"])  # type: ignore[index]
    warnings = {(f.criterion, f.characteristic): f for f in rubric.protected_flags}
    for c in rubric.criteria:
        for ch in protected_warnings(c.name):
            warnings.setdefault((c.name, ch), ProtectedFlag(criterion=c.name, characteristic=ch,
                                                            reason="Matches a protected-characteristic term"))
    return {"warnings": [CriterionWarning(**f.model_dump()).model_dump() for f in warnings.values()]}


def assemble(draft: JobDraft, rubric: JdRubricOutput) -> Workflow:
    """Workflow v1 from the draft and the proposed rubric. Pure."""
    seen: set[str] = set()
    criteria: list[Criterion] = []
    for c in rubric.criteria:
        if c.name.lower() in seen:
            continue
        seen.add(c.name.lower())
        criteria.append(Criterion(id=f"c{len(criteria) + 1}", name=c.name, weight=c.weight, must_have=c.must_have))
    nodes: list[Any] = [ScreeningNode(type="screening", id="screening",
                                      config=ScreeningConfig(cutoff=60, criteria=criteria))]
    if draft.include_quiz:
        nodes.append(QuizNode(type="quiz", id="quiz", config=QuizConfig(pass_mark=60, time_limit_min=max(
            10, min(60, draft.quiz_questions * 2)))))
    if draft.include_interview:
        nodes.append(InterviewNode(type="interview", id="interview", config=InterviewConfig(
            themes=rubric.interview_themes[:10],
            rubric=[RubricItem(id=f"r{i + 1}", name=r.name, weight=r.weight, description=r.description)
                    for i, r in enumerate(rubric.interview_rubric)],
        )))
    nodes.append(FinalNode(type="final", id="final", config=FinalConfig()))
    return chain(nodes)


def assemble_workflow(state: JdState) -> JdState:
    rubric = JdRubricOutput(**state["workflow"]["rubric"])  # type: ignore[index]
    wf = assemble(JobDraft(**state["draft"]), rubric)
    return {"workflow": wf.model_dump(mode="json")}


def build_graph() -> StateGraph:
    g = StateGraph(JdState)
    g.add_node("turn", turn)
    g.add_node("build_rubric", build_rubric)
    g.add_node("protected_check", protected_check)
    g.add_node("assemble_workflow", assemble_workflow)
    g.add_edge(START, "turn")
    g.add_conditional_edges("turn", route, {"ask": END, "build_rubric": "build_rubric"})
    g.add_edge("build_rubric", "protected_check")
    g.add_edge("protected_check", "assemble_workflow")
    g.add_edge("assemble_workflow", END)
    return g


GRAPH = build_graph()


class JdChatState(BaseModel):
    thread_id: UUID
    messages: list[ChatMessage]
    draft: JobDraft
    missing: list[str]
    complete: bool
    summary: JobSummary | None = None
    workflow: Workflow | None = None
    warnings: list[CriterionWarning] = []


def to_view(thread_id: UUID, state: dict[str, Any]) -> JdChatState:
    wf = state.get("workflow")
    complete = not state.get("missing") and bool(wf and "nodes" in wf)
    return JdChatState(
        thread_id=thread_id, messages=[ChatMessage.model_validate(m) for m in state.get("messages", [])],
        draft=JobDraft(**(state.get("draft") or {})), missing=state.get("missing", list(missing_fields(JobDraft()))),
        complete=complete, summary=state.get("summary") if complete else None,
        workflow=Workflow.model_validate(wf) if complete else None,
        warnings=state.get("warnings", []) if complete else [],
    )


async def run_turn(saver: Any, thread_id: UUID, message: str) -> JdChatState:
    graph = GRAPH.compile(checkpointer=saver)
    config: Any = {"configurable": {"thread_id": str(thread_id)}}
    state = await graph.ainvoke({"messages": [{"role": "user", "content": message}]}, config)
    return to_view(thread_id, state)


async def load(saver: Any, thread_id: UUID) -> JdChatState:
    graph = GRAPH.compile(checkpointer=saver)
    snap = await graph.aget_state({"configurable": {"thread_id": str(thread_id)}})
    return to_view(thread_id, dict(snap.values or {}))
