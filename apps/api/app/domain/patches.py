"""Workflow patch operations, the pure applier, diff and undo (backend plan §8.3–8.4).

`apply_patches` copies the base, applies each op in order, re-validates the whole workflow,
and returns the result with a diff and any warnings. It never mutates its input. Any
invalid op raises PatchError with that op's index, so the API can point at it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, ValidationError

from app.domain.protected import protected_warnings
from app.domain.workflow import (
    MAX_PROMPT_ADDITIONS,
    Criterion,
    Id,
    Name,
    Percent,
    QuizQuestion,
    RubricItem,
    Strict,
    Weight,
    Workflow,
    normalize_prompt,
)

# ------------------------------------------------------------------ ops


class SetCutoff(Strict):
    op: Literal["set_cutoff"]
    node: Id
    value: Percent


class SetPassMark(Strict):
    """Quiz pass mark, or the interview's pass threshold."""

    op: Literal["set_pass_mark"]
    node: Id
    value: Percent


class SetTimeLimit(Strict):
    op: Literal["set_time_limit"]
    node: Id
    value: Annotated[int, Field(ge=5, le=120)]


class AddCriterion(Strict):
    op: Literal["add_criterion"]
    node: Id
    criterion: Criterion


class CriterionFields(Strict):
    name: Name | None = None
    weight: Weight | None = None
    must_have: bool | None = None


class UpdateCriterion(Strict):
    op: Literal["update_criterion"]
    node: Id
    criterion_id: Id
    fields: CriterionFields


class RemoveCriterion(Strict):
    op: Literal["remove_criterion"]
    node: Id
    criterion_id: Id


class AddQuizQuestion(Strict):
    op: Literal["add_quiz_question"]
    node: Id
    question: QuizQuestion


class ReplaceQuizQuestion(Strict):
    op: Literal["replace_quiz_question"]
    node: Id
    question_id: Id
    question: QuizQuestion


class RemoveQuizQuestion(Strict):
    op: Literal["remove_quiz_question"]
    node: Id
    question_id: Id


class EditInterviewPrompt(Strict):
    op: Literal["edit_interview_prompt"]
    node: Id
    prompt_additions: Annotated[str, StringConstraints(max_length=MAX_PROMPT_ADDITIONS)]


class SetInterviewThemes(Strict):
    op: Literal["set_interview_themes"]
    node: Id
    themes: Annotated[list[Name], Field(max_length=10)]


class UpdateInterviewRubric(Strict):
    op: Literal["update_interview_rubric"]
    node: Id
    rubric: Annotated[list[RubricItem], Field(max_length=10)]


class SetTurnCap(Strict):
    op: Literal["set_turn_cap"]
    node: Id
    value: Annotated[int, Field(ge=3, le=10)]


class ToggleNode(Strict):
    op: Literal["toggle_node"]
    node: Id
    enabled: bool


class SetNotify(Strict):
    op: Literal["set_notify"]
    value: bool


Patch = Annotated[
    SetCutoff | SetPassMark | SetTimeLimit | AddCriterion | UpdateCriterion | RemoveCriterion
    | AddQuizQuestion | ReplaceQuizQuestion | RemoveQuizQuestion | EditInterviewPrompt
    | SetInterviewThemes | UpdateInterviewRubric | SetTurnCap | ToggleNode | SetNotify,
    Field(discriminator="op"),
]


class PatchList(BaseModel):
    patches: list[Patch]


# ---------------------------------------------------------------- results


class PatchError(ValueError):
    def __init__(self, index: int, message: str):
        super().__init__(f"patch {index}: {message}")
        self.index = index
        self.message = message


class DiffEntry(BaseModel):
    """One changed value. `path` uses ids, e.g. `n1.cutoff`, `n1.criteria[c2].weight`."""

    path: str
    kind: Literal["added", "removed", "changed"]
    node_id: str
    before: Any = None
    after: Any = None


class Warning(BaseModel):
    patch_index: int
    code: Literal["protected_characteristic"]
    message: str


@dataclass
class ApplyResult:
    workflow: Workflow
    diff: list[DiffEntry]
    warnings: list[Warning] = field(default_factory=list)

    @property
    def changed_nodes(self) -> list[str]:
        """Changed node ids, in chain order."""
        order = [n.id for n in self.workflow.nodes]
        return sorted({d.node_id for d in self.diff if d.node_id in order}, key=order.index)


# ---------------------------------------------------------------- applier


def _find(items: list[dict[str, Any]], item_id: str, what: str) -> int:
    for i, item in enumerate(items):
        if item["id"] == item_id:
            return i
    raise ValueError(f"no {what} with id {item_id!r}")


def _node(data: dict[str, Any], node_id: str, *types: str) -> dict[str, Any]:
    for n in data["nodes"]:
        if n["id"] == node_id:
            if types and n["type"] not in types:
                raise ValueError(f"node {node_id!r} is a {n['type']} node; this change needs {' or '.join(types)}")
            return n
    raise ValueError(f"no node with id {node_id!r}")


def _final(data: dict[str, Any]) -> dict[str, Any]:
    return next(n for n in data["nodes"] if n["type"] == "final")


def _apply_one(data: dict[str, Any], p: BaseModel) -> list[str]:
    """Mutate `data` (a workflow dict) with one op. Returns warning messages."""
    warns: list[str] = []
    match p:
        case SetCutoff():
            _node(data, p.node, "screening")["config"]["cutoff"] = p.value
        case SetPassMark():
            n = _node(data, p.node, "quiz", "interview")
            n["config"]["pass_mark" if n["type"] == "quiz" else "pass_threshold"] = p.value
        case SetTimeLimit():
            _node(data, p.node, "quiz")["config"]["time_limit_min"] = p.value
        case AddCriterion():
            crit = _node(data, p.node, "screening")["config"]["criteria"]
            if any(c["id"] == p.criterion.id for c in crit):
                raise ValueError(f"criterion id {p.criterion.id!r} already exists")
            crit.append(p.criterion.model_dump())
            warns += [f"'{p.criterion.name}' may screen on {w}" for w in protected_warnings(p.criterion.name)]
        case UpdateCriterion():
            crit = _node(data, p.node, "screening")["config"]["criteria"]
            i = _find(crit, p.criterion_id, "criterion")
            changes = p.fields.model_dump(exclude_none=True)
            if not changes:
                raise ValueError("update_criterion needs at least one field")
            crit[i].update(changes)
            if "name" in changes:
                warns += [f"'{changes['name']}' may screen on {w}" for w in protected_warnings(changes["name"])]
        case RemoveCriterion():
            crit = _node(data, p.node, "screening")["config"]["criteria"]
            if len(crit) == 1:
                raise ValueError("screening needs at least one criterion")
            del crit[_find(crit, p.criterion_id, "criterion")]
        case AddQuizQuestion():
            qs = _node(data, p.node, "quiz")["config"]["questions"]
            if any(q["id"] == p.question.id for q in qs):
                raise ValueError(f"question id {p.question.id!r} already exists")
            if any(normalize_prompt(q["prompt"]) == normalize_prompt(p.question.prompt) for q in qs):
                raise ValueError("the quiz already has this question")
            qs.append(p.question.model_dump())
        case ReplaceQuizQuestion():
            qs = _node(data, p.node, "quiz")["config"]["questions"]
            i = _find(qs, p.question_id, "question")
            others = [q for j, q in enumerate(qs) if j != i]
            if any(normalize_prompt(q["prompt"]) == normalize_prompt(p.question.prompt) for q in others):
                raise ValueError("the quiz already has this question")
            if p.question.id != p.question_id and any(q["id"] == p.question.id for q in others):
                raise ValueError(f"question id {p.question.id!r} already exists")
            qs[i] = p.question.model_dump()
        case RemoveQuizQuestion():
            qs = _node(data, p.node, "quiz")["config"]["questions"]
            del qs[_find(qs, p.question_id, "question")]
        case EditInterviewPrompt():
            _node(data, p.node, "interview")["config"]["prompt_additions"] = p.prompt_additions
        case SetInterviewThemes():
            _node(data, p.node, "interview")["config"]["themes"] = list(p.themes)
        case UpdateInterviewRubric():
            _node(data, p.node, "interview")["config"]["rubric"] = [r.model_dump() for r in p.rubric]
        case SetTurnCap():
            _node(data, p.node, "interview")["config"]["turn_cap"] = p.value
        case ToggleNode():
            _node(data, p.node, "quiz", "interview")["enabled"] = p.enabled
        case SetNotify():
            _final(data)["config"]["notify_on_complete"] = p.value
        case _:  # pragma: no cover - the discriminated union makes this unreachable
            raise ValueError(f"unknown op {p!r}")
    return warns


def apply_patches(base: Workflow, patches: list[Patch]) -> ApplyResult:
    data = base.model_dump(mode="json")
    warnings: list[Warning] = []
    for i, p in enumerate(patches):
        try:
            for message in _apply_one(data, p):
                warnings.append(Warning(patch_index=i, code="protected_characteristic", message=message))
            # Validate after each op so the error names the op that broke the workflow.
            Workflow.model_validate(data)
        except ValidationError as exc:
            first = exc.errors()[0]
            raise PatchError(i, str(first.get("msg", exc))) from exc
        except ValueError as exc:
            raise PatchError(i, str(exc)) from exc
    result = Workflow.model_validate(data)
    return ApplyResult(result, diff(base, result), warnings)


# ------------------------------------------------------------------- diff

_ITEM_LISTS = {"criteria", "questions", "rubric"}


def _diff_value(path: str, node_id: str, a: Any, b: Any, out: list[DiffEntry]) -> None:
    if a == b:
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for k in list(a) + [k for k in b if k not in a]:
            sub = f"{path}.{k}" if path else k
            if k not in b:
                out.append(DiffEntry(path=sub, kind="removed", node_id=node_id, before=a[k]))
            elif k not in a:
                out.append(DiffEntry(path=sub, kind="added", node_id=node_id, after=b[k]))
            else:
                _diff_value(sub, node_id, a[k], b[k], out)
        return
    leaf = path.rsplit(".", 1)[-1]
    if leaf in _ITEM_LISTS and isinstance(a, list) and isinstance(b, list):
        by_a = {i["id"]: i for i in a}
        by_b = {i["id"]: i for i in b}
        for item in a:
            if item["id"] not in by_b:
                out.append(DiffEntry(path=f"{path}[{item['id']}]", kind="removed", node_id=node_id, before=item))
        for item in b:
            if item["id"] not in by_a:
                out.append(DiffEntry(path=f"{path}[{item['id']}]", kind="added", node_id=node_id, after=item))
            else:
                _diff_value(f"{path}[{item['id']}]", node_id, by_a[item["id"]], item, out)
        if [i["id"] for i in a if i["id"] in by_b] != [i["id"] for i in b if i["id"] in by_a]:
            out.append(DiffEntry(path=f"{path}.order", kind="changed", node_id=node_id,
                                 before=[i["id"] for i in a], after=[i["id"] for i in b]))
        return
    out.append(DiffEntry(path=path, kind="changed", node_id=node_id, before=a, after=b))


def diff(a: Workflow, b: Workflow) -> list[DiffEntry]:
    """Per-node differences, keyed by node id. Nodes are never added or removed by patches."""
    out: list[DiffEntry] = []
    a_nodes = {n.id: n.model_dump(mode="json") for n in a.nodes}
    for n in b.nodes:
        after = n.model_dump(mode="json")
        before = a_nodes.get(n.id)
        if before is None:
            out.append(DiffEntry(path=n.id, kind="added", node_id=n.id, after=after))
            continue
        flat_a = {k: v for k, v in before.items() if k != "config"} | before["config"]
        flat_b = {k: v for k, v in after.items() if k != "config"} | after["config"]
        _diff_value(n.id, n.id, flat_a, flat_b, out)
    for node_id, before in a_nodes.items():
        if node_id not in {n.id for n in b.nodes}:
            out.append(DiffEntry(path=node_id, kind="removed", node_id=node_id, before=before))
    return out


# --------------------------------------------------------------- describe


def describe(p: BaseModel, wf: Workflow | None = None) -> str:
    """One plain-language line per patch, for the chat drawer and the audit log."""

    def label(node_id: str) -> str:
        if wf is None:
            return node_id
        try:
            return wf.node(node_id).type
        except KeyError:
            return node_id

    match p:
        case SetCutoff():
            return f"Set the screening cutoff to {p.value}"
        case SetPassMark():
            return f"Set the {label(p.node)} pass mark to {p.value}"
        case SetTimeLimit():
            return f"Set the quiz time limit to {p.value} minutes"
        case AddCriterion():
            must = ", must-have" if p.criterion.must_have else ""
            return f"Add criterion '{p.criterion.name}' (weight {p.criterion.weight}{must})"
        case UpdateCriterion():
            parts = ", ".join(f"{k} → {v}" for k, v in p.fields.model_dump(exclude_none=True).items())
            return f"Update criterion {p.criterion_id}: {parts}"
        case RemoveCriterion():
            return f"Remove criterion {p.criterion_id}"
        case AddQuizQuestion():
            return f"Add quiz question: {p.question.prompt[:80]}"
        case ReplaceQuizQuestion():
            return f"Replace quiz question {p.question_id}"
        case RemoveQuizQuestion():
            return f"Remove quiz question {p.question_id}"
        case EditInterviewPrompt():
            return "Edit the interview prompt additions"
        case SetInterviewThemes():
            return f"Set interview themes: {', '.join(p.themes) or 'none'}"
        case UpdateInterviewRubric():
            return f"Update the interview rubric ({len(p.rubric)} items)"
        case SetTurnCap():
            return f"Set the interview length to {p.value} questions"
        case ToggleNode():
            return f"{'Enable' if p.enabled else 'Disable'} the {label(p.node)} step"
        case SetNotify():
            return f"{'Notify' if p.value else 'Do not notify'} candidates when the campaign completes"
    return str(p)  # pragma: no cover
