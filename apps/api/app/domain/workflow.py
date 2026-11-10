"""The workflow definition (backend plan §8.1–8.2).

A workflow is a fixed chain: screening → [quiz] → [interview] → final. Quiz and interview
are optional and can be disabled without being removed. Lists of items (criteria, quiz
questions, rubric items) are keyed by id so patches and diffs can refer to them stably.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Id = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Percent = Annotated[int, Field(ge=0, le=100)]
Weight = Annotated[int, Field(ge=1, le=5)]

NodeType = Literal["screening", "quiz", "interview", "final"]
CHAIN_ORDER: tuple[NodeType, ...] = ("screening", "quiz", "interview", "final")
MAX_QUIZ_QUESTIONS = 30
MAX_THEMES = 10
MAX_PROMPT_ADDITIONS = 2000


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _unique_ids(items: list[BaseModel], what: str) -> None:
    ids = [getattr(i, "id") for i in items]  # noqa: B009
    if len(ids) != len(set(ids)):
        raise ValueError(f"{what} ids must be unique")


def normalize_prompt(text: str) -> str:
    """For duplicate detection: case, spacing and trailing punctuation do not make a question new."""
    return re.sub(r"[\s?.!]+$", "", re.sub(r"\s+", " ", text).strip().lower())


class Criterion(Strict):
    id: Id
    name: Name
    weight: Weight
    must_have: bool = False


class QuizQuestion(Strict):
    id: Id
    prompt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
    options: Annotated[list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]],
                       Field(min_length=3, max_length=5)]
    answer_index: int
    explanation: Annotated[str, StringConstraints(max_length=1000)] = ""
    difficulty: Literal["easy", "medium", "hard"] = "medium"

    @model_validator(mode="after")
    def _one_correct(self) -> QuizQuestion:
        if not 0 <= self.answer_index < len(self.options):
            raise ValueError("answer_index must point at one of the options")
        if len({o.lower() for o in self.options}) != len(self.options):
            raise ValueError("options must be distinct")
        return self


class RubricItem(Strict):
    id: Id
    name: Name
    weight: Weight
    description: Annotated[str, StringConstraints(max_length=500)] = ""


class ScreeningConfig(Strict):
    cutoff: Percent = 60
    criteria: Annotated[list[Criterion], Field(min_length=1, max_length=20)]

    @model_validator(mode="after")
    def _ids(self) -> ScreeningConfig:
        _unique_ids(list(self.criteria), "criterion")
        return self


class QuizConfig(Strict):
    pass_mark: Percent = 60
    time_limit_min: Annotated[int, Field(ge=5, le=120)] = 20
    questions: Annotated[list[QuizQuestion], Field(max_length=MAX_QUIZ_QUESTIONS)] = []

    @model_validator(mode="after")
    def _ids(self) -> QuizConfig:
        _unique_ids(list(self.questions), "question")
        prompts = [normalize_prompt(q.prompt) for q in self.questions]
        if len(prompts) != len(set(prompts)):
            raise ValueError("quiz has duplicate questions")
        return self


class InterviewConfig(Strict):
    prompt_additions: Annotated[str, StringConstraints(max_length=MAX_PROMPT_ADDITIONS)] = ""
    themes: Annotated[list[Name], Field(max_length=MAX_THEMES)] = []
    turn_cap: Annotated[int, Field(ge=3, le=10)] = 6
    rubric: Annotated[list[RubricItem], Field(max_length=10)] = []
    pass_threshold: Percent = 60

    @model_validator(mode="after")
    def _ids(self) -> InterviewConfig:
        _unique_ids(list(self.rubric), "rubric item")
        return self


class FinalConfig(Strict):
    notify_on_complete: bool = True
    ranking: Literal["weighted_mean"] = "weighted_mean"


class ScreeningNode(Strict):
    type: Literal["screening"]
    id: Id
    config: ScreeningConfig


class QuizNode(Strict):
    type: Literal["quiz"]
    id: Id
    enabled: bool = True
    config: QuizConfig


class InterviewNode(Strict):
    type: Literal["interview"]
    id: Id
    enabled: bool = True
    config: InterviewConfig


class FinalNode(Strict):
    type: Literal["final"]
    id: Id
    config: FinalConfig


Node = Annotated[ScreeningNode | QuizNode | InterviewNode | FinalNode, Field(discriminator="type")]


class Workflow(Strict):
    schema_version: Literal[1] = 1
    nodes: list[Node]
    edges: list[tuple[str, str]]

    @model_validator(mode="after")
    def _shape(self) -> Workflow:
        _unique_ids(list(self.nodes), "node")
        types = [n.type for n in self.nodes]
        if types.count("screening") != 1 or types.count("final") != 1:
            raise ValueError("a workflow has exactly one screening node and one final node")
        if types.count("quiz") > 1 or types.count("interview") > 1:
            raise ValueError("a workflow has at most one quiz node and one interview node")
        if types != sorted(types, key=CHAIN_ORDER.index):
            raise ValueError("nodes must be in the order screening → quiz → interview → final")
        expected = [(a.id, b.id) for a, b in zip(self.nodes, self.nodes[1:], strict=False)]
        if [tuple(e) for e in self.edges] != expected:
            raise ValueError("edges must form the linear chain of the nodes, in order")
        return self

    # ------------------------------------------------------------ helpers

    def node(self, node_id: str) -> Node:
        for n in self.nodes:
            if n.id == node_id:
                return n
        raise KeyError(node_id)

    def index_of(self, node_id: str) -> int:
        return [n.id for n in self.nodes].index(node_id)

    def is_enabled(self, node_id: str) -> bool:
        return bool(getattr(self.node(node_id), "enabled", True))

    def first_node(self) -> Node:
        return self.nodes[0]

    def next_enabled(self, node_id: str) -> Node | None:
        """The node a candidate moves to after passing `node_id`; disabled nodes are skipped."""
        for n in self.nodes[self.index_of(node_id) + 1 :]:
            if getattr(n, "enabled", True):
                return n
        return None


def chain(nodes: list[Node]) -> Workflow:
    """Build a workflow from nodes, deriving the edges."""
    return Workflow(nodes=nodes, edges=[(a.id, b.id) for a, b in zip(nodes, nodes[1:], strict=False)])
