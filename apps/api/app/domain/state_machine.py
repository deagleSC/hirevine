"""Pipeline state machine (backend plan §9). Phase 3 skeleton: the pure rules and an
idempotent `transition()`. Phases 5–8 add the job each stage starts.

    per application, per node:   pending → in_progress → passed | failed | needs_review
                                 needs_review → in_progress (retry / manual score)
    campaign:                    draft → open → completed (terminal)
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal
from uuid import UUID

from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.core.db import Tx
from app.domain.workflow import Node, Workflow

StageStatus = Literal["pending", "in_progress", "passed", "failed", "needs_review"]
CampaignStatus = Literal["draft", "open", "completed"]

STAGE_TRANSITIONS: dict[StageStatus, set[StageStatus]] = {
    "pending": {"in_progress"},
    "in_progress": {"passed", "failed", "needs_review"},
    "needs_review": {"in_progress", "passed", "failed"},  # retry, or manual score
    "passed": set(),
    "failed": set(),
}
TERMINAL: set[StageStatus] = {"passed", "failed"}
CAMPAIGN_TRANSITIONS: dict[CampaignStatus, set[CampaignStatus]] = {
    "draft": {"open"}, "open": {"completed"}, "completed": set(),
}


def can_transition(a: StageStatus, b: StageStatus) -> bool:
    return b in STAGE_TRANSITIONS[a]


def can_transition_campaign(a: CampaignStatus, b: CampaignStatus) -> bool:
    return b in CAMPAIGN_TRANSITIONS[a]


def passes(node: Node, score: float) -> bool:
    """Pass rules (§6). `final` never auto-passes: only campaign completion closes it."""
    match node.type:
        case "screening":
            return score >= node.config.cutoff
        case "quiz":
            return score >= node.config.pass_mark
        case "interview":
            return score >= node.config.pass_threshold
        case _:
            return False


class StageOutcome(BaseModel):
    status: Literal["in_progress", "passed", "failed", "needs_review"]
    score: float | None = Field(default=None, ge=0, le=100)
    source: Literal["ai", "manual", "system"] = "ai"


class TransitionResult(BaseModel):
    changed: bool
    next_node: str | None = None


async def transition(tx: Tx, application_id: UUID, node_id: str, outcome: StageOutcome,
                     workflow: Workflow) -> TransitionResult:
    """Record a stage outcome. Idempotent on (application_id, node_id): terminal rows never
    change, so a retried job is a no-op. Runs in system context (background jobs)."""
    row = await tx.fetchone(
        """
        insert into stage_results (application_id, node_id, status, score)
        values (%(a)s, %(n)s, %(s)s, %(score)s)
        on conflict (application_id, node_id) do update
          set status = excluded.status, score = coalesce(excluded.score, stage_results.score), updated_at = now()
          where stage_results.status in ('pending', 'in_progress', 'needs_review')
        returning id
        """,
        {"a": application_id, "n": node_id, "s": outcome.status,
         "score": Decimal(str(outcome.score)) if outcome.score is not None else None},
    )
    if row is None:
        return TransitionResult(changed=False)

    nxt: str | None = None
    reached_final = False
    if outcome.status == "passed":
        node = workflow.next_enabled(node_id)
        if node is not None:
            reached_final = node.type == "final"
            nxt = node.id
            await tx.conn.execute(
                "update applications set current_node = %s, updated_at = now() where id = %s", (nxt, application_id)
            )
            await tx.conn.execute(
                "insert into stage_results (application_id, node_id, status) values (%s, %s, 'pending')"
                " on conflict (application_id, node_id) do nothing",
                (application_id, nxt),
            )

    if nxt is not None and not reached_final:
        # In-app invite to the next timed stage (quiz or interview). Email is a pilot item (§18).
        await tx.conn.execute(
            """
            insert into notifications (user_id, type, payload)
            select a.candidate_id, 'stage_invited',
                   jsonb_build_object('application_id', a.id::text, 'job_title', j.title, 'stage', %s::text)
            from applications a join campaigns c on c.id = a.campaign_id join jobs j on j.id = c.job_id
            where a.id = %s
            """, (workflow.node(nxt).type, application_id))

    if reached_final or outcome.status == "failed":
        # Everyone gets an outcome on release: draft feedback for finalists and for candidates who
        # stopped at a failed stage (§16). Imported here: services depend on this module.
        from app.services.report import queue_draft

        await queue_draft(tx, application_id)

    await tx.conn.execute(
        "insert into events (type, entity, entity_id, payload) values ('stage.transition', 'application', %s, %s)",
        (application_id, Jsonb({"from": node_id, "to": nxt, "status": outcome.status, "score": outcome.score,
                                "source": outcome.source})),
    )
    return TransitionResult(changed=True, next_node=nxt)
