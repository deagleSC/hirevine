"""Override agent (backend plan §12): interpret → validate (dry-run apply_patches) → one retry
with the error. Checkpointed by thread_id, so follow-ups ("and lower it a bit more") have the
earlier requests as context. Returns patches; it never applies them."""

from __future__ import annotations

from typing import Any, TypedDict
from uuid import UUID

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, TypeAdapter

from app.agents import common
from app.domain.patches import Patch, PatchError, apply_patches, describe
from app.domain.workflow import Workflow
from app.llm.prompts.override import OverrideInput, OverrideOutput, OverrideTurn
from app.llm.wrapper import deadline_in

MAX_ATTEMPTS = 2
_patches = TypeAdapter(list[Patch])


class OverrideState(TypedDict, total=False):
    workflow: dict[str, Any]
    instruction: str
    history: list[dict[str, str]]
    patches: list[dict[str, Any]]
    explanation: str
    error: str | None
    attempts: int


async def interpret(state: OverrideState) -> OverrideState:
    inp = OverrideInput(
        workflow=state["workflow"], instruction=state["instruction"],
        history=[OverrideTurn(**h) for h in state.get("history", [])[-10:]],
        previous_error=state.get("error"),
    )
    res = await common.call_structured("structured", "override_patches", inp, deadline=deadline_in(55), sync=True,
                                       cache_enabled=state.get("attempts", 0) == 0)
    out: OverrideOutput = res.value
    return {"patches": [p.model_dump(mode="json") for p in out.patches], "explanation": out.explanation,
            "attempts": state.get("attempts", 0) + 1}


def validate(state: OverrideState) -> OverrideState:
    try:
        apply_patches(Workflow.model_validate(state["workflow"]), _patches.validate_python(state["patches"]))
    except PatchError as exc:
        return {"error": f"operation {exc.index}: {exc.message}"}
    return {"error": None}


def route(state: OverrideState) -> str:
    return "retry" if state.get("error") and state.get("attempts", 0) < MAX_ATTEMPTS else "done"


def remember(state: OverrideState) -> OverrideState:
    history = list(state.get("history", []))
    history.append({"instruction": state["instruction"], "explanation": state.get("explanation", "")})
    return {"history": history[-10:]}


def build_graph() -> StateGraph:
    g = StateGraph(OverrideState)
    g.add_node("interpret", interpret)
    g.add_node("validate", validate)
    g.add_node("remember", remember)
    g.add_edge(START, "interpret")
    g.add_edge("interpret", "validate")
    g.add_conditional_edges("validate", route, {"retry": "interpret", "done": "remember"})
    g.add_edge("remember", END)
    return g


GRAPH = build_graph()


class OverrideResult(BaseModel):
    thread_id: UUID
    patches: list[Patch]
    descriptions: list[str]
    explanation: str
    error: str | None = None


async def run(saver: Any, thread_id: UUID, workflow: Workflow, instruction: str) -> OverrideResult:
    graph = GRAPH.compile(checkpointer=saver)
    config: Any = {"configurable": {"thread_id": str(thread_id)}}
    state = await graph.ainvoke(
        {"workflow": workflow.model_dump(mode="json"), "instruction": instruction, "patches": [], "error": None,
         "attempts": 0},
        config,
    )
    error = state.get("error")
    patches = [] if error else _patches.validate_python(state.get("patches", []))
    return OverrideResult(
        thread_id=thread_id, patches=patches, descriptions=[describe(p, workflow) for p in patches],
        explanation=state.get("explanation", ""), error=error,
    )
