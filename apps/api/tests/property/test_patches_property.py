"""Phase 3 exit check (pure part): any sequence of valid patches yields a valid workflow,
invalid patches are rejected with their index and leave the input untouched, and diffs
round-trip."""

from __future__ import annotations

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.domain.patches import PatchError, apply_patches, diff
from app.domain.workflow import Workflow
from tests.strategies import patch_sequences, patches

SETTINGS = settings(max_examples=400, suppress_health_check=[HealthCheck.too_slow], deadline=None)


@SETTINGS
@given(patch_sequences())
def test_any_valid_patch_sequence_yields_a_valid_workflow(case):
    base, ops = case
    snapshot = base.model_dump()
    wf = base
    applied = 0
    for p in ops:
        try:
            result = apply_patches(wf, [p])
        except PatchError as exc:
            assert exc.index == 0
            continue
        Workflow.model_validate(result.workflow.model_dump())  # still valid
        assert [n.id for n in result.workflow.nodes] == [n.id for n in wf.nodes]  # the chain never changes
        wf = result.workflow
        applied += 1
    assert base.model_dump() == snapshot  # inputs are never mutated


@SETTINGS
@given(patch_sequences(max_size=8))
def test_a_batch_is_all_or_nothing_and_names_the_failing_patch(case):
    base, ops = case
    if not ops:
        return
    """Applying a batch equals applying each op in turn; a failure reports the first bad index."""
    wf, first_bad = base, None
    for i, p in enumerate(ops):
        try:
            wf = apply_patches(wf, [p]).workflow
        except PatchError:
            first_bad = i
            break
    if first_bad is None:
        assert apply_patches(base, ops).workflow == wf
    else:
        try:
            apply_patches(base, ops)
        except PatchError as exc:
            assert exc.index == first_bad
        else:
            raise AssertionError("batch should have failed")


@SETTINGS
@given(patch_sequences(max_size=6))
def test_diff_is_empty_exactly_when_nothing_changed(case):
    base, ops = case
    wf = base
    for p in ops:
        try:
            wf = apply_patches(wf, [p]).workflow
        except PatchError:
            pass
    assert (diff(base, wf) == []) == (base == wf)
    assert diff(wf, wf) == []


@SETTINGS
@given(st.data())
def test_untargeted_patches_never_corrupt_a_workflow(data):
    """Fully random patches (mostly invalid): every outcome is a valid workflow or a PatchError."""
    from tests.strategies import workflows

    wf = data.draw(workflows())
    for p in data.draw(st.lists(patches(), max_size=10)):
        try:
            wf = apply_patches(wf, [p]).workflow
        except PatchError:
            continue
        Workflow.model_validate(wf.model_dump())
