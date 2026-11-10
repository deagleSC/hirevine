"""The override eval's expected patches (made by the frontend's diffFormToPatches) are valid
on the backend, and the eval's comparison ignores only what cannot matter."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter

from app.domain.patches import Patch, apply_patches
from app.domain.workflow import Workflow
from evals.override_eval import normalize, same_result

DATA = json.loads((Path(__file__).parents[2] / "evals" / "datasets" / "override.json").read_text())
BASE = Workflow.model_validate(DATA["base"])
P = TypeAdapter(list[Patch])


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda c: c["id"])
def test_expected_patches_apply_on_the_backend(case):
    assert case["expected"] is not None, "run the frontend parity test with UPDATE_PARITY=1"
    apply_patches(BASE, P.validate_python(case["expected"]))


def test_normalize_ignores_new_ids_and_order():
    a = [{"op": "add_criterion", "node": "screening", "criterion": {"id": "cnew1", "name": "Go", "weight": 2, "must_have": False}},
         {"op": "set_cutoff", "node": "screening", "value": 70}]
    b = [a[1], {**a[0], "criterion": {**a[0]["criterion"], "id": "go"}}]
    assert normalize(a, BASE) == normalize(b, BASE)
    c = [{**a[1], "value": 71}]
    assert normalize(a[1:], BASE) != normalize(c, BASE)


def test_same_result_accepts_equivalent_patch_lists():
    expected = [{"op": "update_criterion", "node": "screening", "criterion_id": "c1", "fields": {"weight": 4}}]
    redundant = [{"op": "update_criterion", "node": "screening", "criterion_id": "c1", "fields": {"weight": 4, "must_have": True}}]
    assert same_result(redundant, expected, BASE)  # must_have was already True
    assert not same_result([{"op": "set_cutoff", "node": "screening", "value": 61}], expected, BASE)
