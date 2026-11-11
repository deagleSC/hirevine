"""WorkflowService: apply, preview, undo and version history (backend plan §8.4).

Every change creates a new version; history is never rewritten. `apply` locks the latest
version row, so two concurrent edits from the same base cannot both win: the second gets
409 stale_base_version and the UI re-previews against the new base.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.core.db import Tx
from app.core.errors import AppError
from app.domain.patches import ApplyResult, DiffEntry, Patch, PatchError, Warning, apply_patches, describe, diff
from app.domain.workflow import Workflow

Source = Literal["panel", "chat", "undo", "agent"]


class WorkflowVersion(BaseModel):
    id: UUID
    version: int
    parent_version: int | None
    definition: Workflow
    created_at: str


class VersionSummary(BaseModel):
    version: int
    parent_version: int | None
    created_at: str
    created_by: UUID | None


class Preview(BaseModel):
    base_version: int
    diff: list[DiffEntry]
    resulting_definition: Workflow
    warnings: list[Warning]
    descriptions: list[str]
    affects_running_campaign: bool
    affected_stage_note: str | None = None


class Applied(Preview):
    version: int
    repinned_applications: int = 0


def _version(row: dict[str, Any]) -> WorkflowVersion:
    return WorkflowVersion(
        id=row["id"], version=row["version"], parent_version=row["parent_version"],
        definition=Workflow.model_validate(row["definition"]), created_at=row["created_at"].isoformat(),
    )


async def _job_org(tx: Tx, job_id: UUID) -> UUID:
    row = await tx.fetchone("select org_id from jobs where id = %s", (job_id,))
    if row is None:
        raise AppError(404, "job_not_found", "This job does not exist or is not yours.")
    return UUID(str(row["org_id"]))


async def latest(tx: Tx, job_id: UUID, *, lock: bool = False) -> WorkflowVersion:
    row = await tx.fetchone(
        "select * from workflows where job_id = %s order by version desc limit 1" + (" for update" if lock else ""),
        (job_id,),
    )
    if row is None:
        await _job_org(tx, job_id)  # 404 for a job the caller cannot see
        raise AppError(404, "workflow_not_found", "This job has no workflow yet.")
    return _version(dict(row))


async def versions(tx: Tx, job_id: UUID) -> list[VersionSummary]:
    await _job_org(tx, job_id)
    rows = await tx.fetchall(
        "select version, parent_version, created_at, created_by from workflows where job_id = %s order by version desc",
        (job_id,),
    )
    return [VersionSummary(version=r["version"], parent_version=r["parent_version"],
                           created_at=r["created_at"].isoformat(), created_by=r["created_by"]) for r in rows]


async def get_version(tx: Tx, job_id: UUID, version: int) -> WorkflowVersion:
    row = await tx.fetchone("select * from workflows where job_id = %s and version = %s", (job_id, version))
    if row is None:
        raise AppError(404, "workflow_version_not_found", f"Version {version} does not exist.")
    return _version(dict(row))


async def create_initial(tx: Tx, job_id: UUID, workflow: Workflow, actor: UUID | None) -> WorkflowVersion:
    row = await tx.fetchone(
        "insert into workflows (job_id, version, definition, schema_version, created_by)"
        " values (%s, 1, %s, %s, %s) returning *",
        (job_id, Jsonb(workflow.model_dump(mode="json")), workflow.schema_version, actor),
    )
    assert row is not None
    return _version(dict(row))


def require_runnable(wf: Workflow) -> None:
    """A live workflow must be one candidates can finish: an enabled quiz needs questions and an
    enabled interview needs a rubric to be scored against."""
    for n in wf.nodes:
        if n.type == "interview" and n.enabled and not n.config.rubric:  # type: ignore[union-attr]
            raise AppError(422, "interview_has_no_rubric",
                           "The interview has no rubric. Add rubric items, or turn the interview off.",
                           {"node": n.id})
        if n.type == "quiz" and n.enabled and not n.config.questions:  # type: ignore[union-attr]
            raise AppError(422, "quiz_has_no_questions",
                           "The quiz has no questions. Add or generate questions, or turn the quiz off.",
                           {"node": n.id})


def _apply(base: Workflow, patches: list[Patch]) -> ApplyResult:
    try:
        return apply_patches(base, patches)
    except PatchError as exc:
        raise AppError(422, "invalid_patch", exc.message, {"patch_index": exc.index}) from exc


async def _open_campaign(tx: Tx, job_id: UUID) -> dict[str, Any] | None:
    row = await tx.fetchone(
        "select id, workflow_id from campaigns where job_id = %s and status = 'open' order by created_at desc limit 1",
        (job_id,),
    )
    return dict(row) if row else None


async def _affected(tx: Tx, campaign_id: UUID, wf: Workflow, changed: list[str]) -> tuple[list[UUID], int, str | None]:
    """Applications that move to the new version (not yet at the earliest changed node) and
    those that keep theirs. Uses node order from the new definition; node ids are stable."""
    if not changed:
        return [], 0, None
    first_changed = min(wf.index_of(n) for n in changed)
    async with tx.as_system():
        rows = await tx.fetchall(
            "select id, current_node from applications where campaign_id = %s and status = 'active'", (campaign_id,)
        )
    order = {n.id: i for i, n in enumerate(wf.nodes)}
    move = [r["id"] for r in rows if r["current_node"] is None or order.get(r["current_node"], 0) < first_changed]
    keep = len(rows) - len(move)
    stage = wf.nodes[first_changed].type
    note = (
        f"{len(move)} candidate{'s' if len(move) != 1 else ''} who have not reached the {stage} step yet will use "
        f"this version; {keep} already at or past it keep the version they started with."
    )
    return move, keep, note


async def preview(tx: Tx, job_id: UUID, base_version: int, patches: list[Patch]) -> Preview:
    current = await latest(tx, job_id)
    if current.version != base_version:
        raise AppError(409, "stale_base_version", "The workflow changed since you opened it.",
                       {"latest_version": current.version})
    result = _apply(current.definition, patches)
    campaign = await _open_campaign(tx, job_id)
    note = None
    if campaign:
        _, _, note = await _affected(tx, campaign["id"], result.workflow, result.changed_nodes)
    return Preview(
        base_version=base_version, diff=result.diff, resulting_definition=result.workflow, warnings=result.warnings,
        descriptions=[describe(p, current.definition) for p in patches],
        affects_running_campaign=campaign is not None, affected_stage_note=note,
    )


async def _commit_version(
    tx: Tx, job_id: UUID, base: WorkflowVersion, result: ApplyResult, *, actor: UUID | None,
    source: Source, patches: list[Patch], descriptions: list[str],
) -> Applied:
    org_id = await _job_org(tx, job_id)
    new_version = base.version + 1
    row = await tx.fetchone(
        "insert into workflows (job_id, version, parent_version, definition, schema_version, created_by)"
        " values (%s, %s, %s, %s, %s, %s) returning id",
        (job_id, new_version, base.version, Jsonb(result.workflow.model_dump(mode="json")),
         result.workflow.schema_version, actor),
    )
    assert row is not None
    new_id = row["id"]
    for i, p in enumerate(patches):
        await tx.conn.execute(
            "insert into events (actor_id, org_id, type, entity, entity_id, payload)"
            " values (%s, %s, 'workflow.patch_applied', 'job', %s, %s)",
            (actor, org_id, job_id, Jsonb({"version": new_version, "source": source, "index": i,
                                           "patch": p.model_dump(mode="json"), "description": descriptions[i]})),
        )

    campaign = await _open_campaign(tx, job_id)
    moved: list[UUID] = []
    note = None
    if campaign:
        require_runnable(result.workflow)
        moved, _, note = await _affected(tx, campaign["id"], result.workflow, result.changed_nodes)
        notify = next(n for n in result.workflow.nodes if n.type == "final").config.notify_on_complete  # type: ignore[union-attr]
        await tx.conn.execute(
            "update campaigns set workflow_id = %s, notify_on_complete = %s where id = %s",
            (new_id, notify, campaign["id"]),
        )
        if moved:
            async with tx.as_system():
                await tx.conn.execute(
                    "update applications set workflow_id = %s, updated_at = now() where id = any(%s)", (new_id, moved)
                )
                await tx.conn.execute(
                    "insert into events (actor_id, org_id, type, entity, entity_id, payload)"
                    " select %s, %s, 'workflow.repinned', 'application', a, %s from unnest(%s::uuid[]) a",
                    (actor, org_id, Jsonb({"version": new_version}), moved),
                )

    return Applied(
        base_version=base.version, version=new_version, diff=result.diff, resulting_definition=result.workflow,
        warnings=result.warnings, descriptions=descriptions, affects_running_campaign=campaign is not None,
        affected_stage_note=note, repinned_applications=len(moved),
    )


async def apply(tx: Tx, job_id: UUID, base_version: int, patches: list[Patch], *,
                source: Source, actor: UUID | None) -> Applied:
    if not patches:
        raise AppError(422, "no_patches", "There is nothing to apply.")
    base = await latest(tx, job_id, lock=True)
    if base.version != base_version:
        raise AppError(409, "stale_base_version", "The workflow changed since you opened it.",
                       {"latest_version": base.version})
    result = _apply(base.definition, patches)
    descriptions = [describe(p, base.definition) for p in patches]
    return await _commit_version(tx, job_id, base, result, actor=actor, source=source,
                                 patches=patches, descriptions=descriptions)


async def undo(tx: Tx, job_id: UUID, *, actor: UUID | None) -> Applied:
    """Restore the parent of the latest version, as a new version (`source: undo`)."""
    base = await latest(tx, job_id, lock=True)
    if base.parent_version is None:
        raise AppError(409, "nothing_to_undo", "This is the first version; there is nothing to undo.")
    parent = await get_version(tx, job_id, base.parent_version)
    result = ApplyResult(parent.definition, diff(base.definition, parent.definition))
    return await _commit_version(tx, job_id, base, result, actor=actor, source="undo", patches=[],
                                 descriptions=[f"Undo to version {parent.version}"])
