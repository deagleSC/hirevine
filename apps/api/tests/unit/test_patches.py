"""Patch ops, errors, diff paths and warnings (backend plan §8.3)."""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from app.domain.patches import Patch, PatchError, apply_patches, describe
from app.domain.workflow import (
    Criterion,
    FinalConfig,
    FinalNode,
    InterviewConfig,
    InterviewNode,
    QuizConfig,
    QuizNode,
    QuizQuestion,
    RubricItem,
    ScreeningConfig,
    ScreeningNode,
    Workflow,
    chain,
)

P = TypeAdapter(list[Patch])


def wf() -> Workflow:
    return chain([
        ScreeningNode(type="screening", id="n1", config=ScreeningConfig(cutoff=60, criteria=[
            Criterion(id="c1", name="React", weight=3, must_have=True), Criterion(id="c2", name="SQL", weight=2)])),
        QuizNode(type="quiz", id="n2", config=QuizConfig(pass_mark=60, questions=[
            QuizQuestion(id="q1", prompt="What is JSX?", options=["A", "B", "C"], answer_index=0)])),
        InterviewNode(type="interview", id="n3", config=InterviewConfig(rubric=[
            RubricItem(id="r1", name="Communication", weight=2)])),
        FinalNode(type="final", id="n4", config=FinalConfig()),
    ])


def apply(*ops):
    return apply_patches(wf(), P.validate_python(list(ops)))


def test_set_cutoff_and_diff_path():
    r = apply({"op": "set_cutoff", "node": "n1", "value": 75})
    assert r.workflow.node("n1").config.cutoff == 75
    assert [(d.path, d.before, d.after) for d in r.diff] == [("n1.cutoff", 60, 75)]
    assert r.changed_nodes == ["n1"]


def test_pass_mark_targets_quiz_pass_mark_and_interview_threshold():
    r = apply({"op": "set_pass_mark", "node": "n2", "value": 70}, {"op": "set_pass_mark", "node": "n3", "value": 55})
    assert r.workflow.node("n2").config.pass_mark == 70
    assert r.workflow.node("n3").config.pass_threshold == 55


def test_wrong_node_type_names_the_patch_index():
    with pytest.raises(PatchError) as exc:
        apply({"op": "set_notify", "value": False}, {"op": "set_cutoff", "node": "n2", "value": 50})
    assert exc.value.index == 1
    assert "screening" in exc.value.message


def test_criteria_add_update_remove_with_id_paths():
    r = apply(
        {"op": "add_criterion", "node": "n1", "criterion": {"id": "c3", "name": "Testing", "weight": 1}},
        {"op": "update_criterion", "node": "n1", "criterion_id": "c2", "fields": {"weight": 5}},
        {"op": "remove_criterion", "node": "n1", "criterion_id": "c1"},
    )
    assert [c.id for c in r.workflow.node("n1").config.criteria] == ["c2", "c3"]
    paths = {(d.path, d.kind) for d in r.diff}
    assert ("n1.criteria[c1]", "removed") in paths
    assert ("n1.criteria[c3]", "added") in paths
    assert ("n1.criteria[c2].weight", "changed") in paths


def test_last_criterion_cannot_be_removed():
    with pytest.raises(PatchError, match="at least one criterion"):
        apply({"op": "remove_criterion", "node": "n1", "criterion_id": "c1"},
              {"op": "remove_criterion", "node": "n1", "criterion_id": "c2"})


def test_protected_characteristic_warns_but_applies():
    crit = {"id": "c3", "name": "Young team player", "weight": 2}
    r = apply({"op": "add_criterion", "node": "n1", "criterion": crit})
    assert [w.code for w in r.warnings] == ["protected_characteristic"]
    assert "age" in r.warnings[0].message
    assert r.workflow.node("n1").config.criteria[-1].id == "c3"


def test_duplicate_quiz_question_is_rejected_after_normalizing():
    q = {"id": "q2", "prompt": "  what is   JSX ", "options": ["x", "y", "z"], "answer_index": 1}
    with pytest.raises(PatchError, match="already has this question"):
        apply({"op": "add_quiz_question", "node": "n2", "question": q})


def test_quiz_question_needs_one_valid_correct_answer():
    with pytest.raises(ValidationError):
        P.validate_python([{"op": "add_quiz_question", "node": "n2",
                            "question": {"id": "q2", "prompt": "p", "options": ["a", "b", "c"], "answer_index": 3}}])


def test_toggle_only_quiz_or_interview():
    assert apply({"op": "toggle_node", "node": "n2", "enabled": False}).workflow.is_enabled("n2") is False
    with pytest.raises(PatchError):
        apply({"op": "toggle_node", "node": "n1", "enabled": False})


def test_disabled_nodes_are_skipped_for_next_node():
    w = apply({"op": "toggle_node", "node": "n2", "enabled": False}).workflow
    assert w.next_enabled("n1").id == "n3"
    assert w.next_enabled("n4") is None


def test_prompt_additions_length_is_capped():
    with pytest.raises(ValidationError):
        P.validate_python([{"op": "edit_interview_prompt", "node": "n3", "prompt_additions": "x" * 2001}])


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        P.validate_python([{"op": "set_cutoff", "node": "n1", "value": 50, "sneaky": True}])


def test_input_is_never_mutated():
    base = wf()
    before = base.model_dump()
    apply_patches(base, P.validate_python([{"op": "set_cutoff", "node": "n1", "value": 10}]))
    assert base.model_dump() == before


def test_describe_is_plain_language():
    p = P.validate_python([{"op": "toggle_node", "node": "n2", "enabled": False}])[0]
    assert describe(p, wf()) == "Disable the quiz step"


@pytest.mark.parametrize("nodes", [
    ["final"], ["screening"], ["screening", "screening", "final"], ["quiz", "screening", "final"],
    ["screening", "interview", "quiz", "final"],
])
def test_invalid_chains_are_rejected(nodes):
    cfg = {"screening": {"criteria": [{"id": "c", "name": "x", "weight": 1}]}, "quiz": {}, "interview": {}, "final": {}}
    defs = [{"type": t, "id": f"n{i}", "config": cfg[t]} for i, t in enumerate(nodes)]
    with pytest.raises(ValidationError):
        edges = [[a["id"], b["id"]] for a, b in zip(defs, defs[1:], strict=False)]
        Workflow.model_validate({"nodes": defs, "edges": edges})


def test_edges_must_match_the_chain():
    data = wf().model_dump()
    data["edges"] = [["n1", "n3"], ["n3", "n4"]]
    with pytest.raises(ValidationError):
        Workflow.model_validate(data)


# The orderings packages/api-client/src/workflow/diff-form.ts relies on (same patch lists
# its tests produce), applied by the real backend.

def test_frontend_order_replacing_every_criterion_applies():
    go = {"id": "cnew1", "name": "Go", "weight": 4, "must_have": False}
    r = apply(
        {"op": "add_criterion", "node": "n1", "criterion": go},
        {"op": "remove_criterion", "node": "n1", "criterion_id": "c1"},
        {"op": "remove_criterion", "node": "n1", "criterion_id": "c2"},
    )
    assert [c.id for c in r.workflow.node("n1").config.criteria] == ["cnew1"]


def test_frontend_order_reworded_question_applies():
    q = {"id": "qnew1", "prompt": "What is JSX?", "options": ["X", "Y", "Z"], "answer_index": 1}
    r = apply({"op": "remove_quiz_question", "node": "n2", "question_id": "q1"},
              {"op": "add_quiz_question", "node": "n2", "question": q})
    assert [x.id for x in r.workflow.node("n2").config.questions] == ["qnew1"]
    with pytest.raises(PatchError):  # the opposite order trips the duplicate check
        apply({"op": "add_quiz_question", "node": "n2", "question": q},
              {"op": "remove_quiz_question", "node": "n2", "question_id": "q1"})
