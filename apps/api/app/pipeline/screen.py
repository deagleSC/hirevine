"""The `screen-application` steps against the database (backend plan §13). Each function takes
IDs only, is idempotent, and returns a small status string or number, never resume content
(Inngest stores step outputs, §10.1). All work runs in system context.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from psycopg.types.json import Jsonb

from app.agents import screening as agent
from app.core.db import Tx, system_claims, transaction
from app.domain.state_machine import StageOutcome, passes, transition
from app.domain.workflow import Criterion, ScreeningNode, Workflow
from app.pipeline import injection, parse, redact
from app.pipeline.chunk import chunk_lines, text_hash
from app.services.embedder import get_embedder
from app.services.storage import ObjectNotFound, get_storage

StepStatus = Literal["ok", "stop"]
EDUCATION = re.compile(r"\b(?:degree|education|bachelor|master|phd|b\.?tech|m\.?tech|mba|graduate|diploma)\b",
                       re.IGNORECASE)
# Prefilter weights (§13 step 5). Signals are each in [0, 1].
W_FTS, W_TRGM, W_COS = 0.3, 0.3, 0.4


@dataclass
class AppContext:
    application_id: UUID
    campaign_id: UUID
    resume_path: str | None
    ai_paused: bool
    workflow_id: UUID
    workflow: Workflow

    @property
    def node(self) -> ScreeningNode:
        n = self.workflow.first_node()
        assert isinstance(n, ScreeningNode)
        return n

    @property
    def criteria(self) -> list[Criterion]:
        return list(self.node.config.criteria)


async def load(tx: Tx, application_id: UUID | str) -> AppContext:
    row = await tx.fetchone(
        """
        select a.id, a.campaign_id, a.resume_path, c.ai_paused, w.id as workflow_id, w.definition
        from applications a join campaigns c on c.id = a.campaign_id join workflows w on w.id = a.workflow_id
        where a.id = %s
        """,
        (application_id,),
    )
    if row is None:
        raise LookupError(f"application {application_id} not found")
    return AppContext(row["id"], row["campaign_id"], row["resume_path"], row["ai_paused"], row["workflow_id"],
                      Workflow.model_validate(row["definition"]))


async def _stage(tx: Tx, ctx: AppContext) -> dict[str, Any] | None:
    return await tx.fetchone("select * from stage_results where application_id = %s and node_id = %s",
                             (ctx.application_id, ctx.node.id))


async def _update_open_stage(tx: Tx, ctx: AppContext, **fields: Any) -> None:
    """Write to the screening row only while it is not terminal (a retried step is a no-op)."""
    sets = ", ".join(f"{k} = %({k})s" for k in fields)
    params = {k: Jsonb(v) if k == "evidence" else v for k, v in fields.items()}
    await tx.conn.execute(
        f"update stage_results set {sets}, updated_at = now()"
        " where application_id = %(a)s and node_id = %(n)s and status in ('pending', 'in_progress', 'needs_review')",
        {**params, "a": ctx.application_id, "n": ctx.node.id},
    )


async def _needs_review(tx: Tx, ctx: AppContext, flag: str) -> None:
    await transition(tx, ctx.application_id, ctx.node.id, StageOutcome(status="needs_review", source="system"),
                     ctx.workflow)
    await tx.conn.execute(
        "update stage_results set flags = array(select distinct unnest(flags || %s::text[]))"
        " where application_id = %s and node_id = %s",
        ([flag], ctx.application_id, ctx.node.id),
    )


# ------------------------------------------------------------------ steps

async def is_paused(application_id: str) -> bool:
    async with transaction(system_claims()) as tx:
        return (await load(tx, application_id)).ai_paused


async def start(application_id: str) -> StepStatus:
    """Move screening to in_progress. 'stop' if it already finished (a duplicate run)."""
    async with transaction(system_claims()) as tx:
        ctx = await load(tx, application_id)
        stage = await _stage(tx, ctx)
        if stage is not None and stage["status"] in ("passed", "failed"):
            return "stop"
        await transition(tx, ctx.application_id, ctx.node.id, StageOutcome(status="in_progress", source="system"),
                         ctx.workflow)
    return "ok"


async def parse_redact(application_id: str) -> StepStatus:
    async with transaction(system_claims()) as tx:
        ctx = await load(tx, application_id)
    flag: str | None
    parsed: parse.ParsedResume | None
    if not ctx.resume_path:
        flag = "missing_resume"
        parsed = None
    else:
        try:
            parsed = parse.parse(await get_storage().download(ctx.resume_path))
            flag = None if parsed.readable else "unreadable"
        except ObjectNotFound:
            parsed, flag = None, "missing_resume"
        except parse.UnsupportedFile:
            parsed, flag = None, "unreadable"
    async with transaction(system_claims()) as tx:
        if parsed is None or flag:
            await _needs_review(tx, ctx, flag or "unreadable")
            return "stop"
        keep_education = any(EDUCATION.search(c.name) for c in ctx.criteria)
        # The applicant's profile name (emails are removed by pattern; auth.users is not readable here).
        who = await tx.fetchone("select p.display_name from applications a join profiles p on p.id = a.candidate_id"
                                " where a.id = %s", (ctx.application_id,))
        known = [str(who["display_name"] or "")] if who else []
        red = redact.redact(parsed.lines, keep_education=keep_education, known_names=known)
        flags = injection.scan(red.lines, parsed.hidden_text)
        await tx.conn.execute(
            """
            insert into resume_texts (application_id, raw_text, redacted_text, redacted_lines, parser, injection_flags)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (application_id) do update set raw_text = excluded.raw_text,
              redacted_text = excluded.redacted_text, redacted_lines = excluded.redacted_lines,
              parser = excluded.parser, injection_flags = excluded.injection_flags
            """,
            (ctx.application_id, "\n".join(parsed.lines), red.text, Jsonb(red.lines), parsed.parser, Jsonb(flags)),
        )
        if flags:
            await tx.conn.execute(
                "update stage_results set flags = array(select distinct unnest(flags || '{possible_injection}'))"
                " where application_id = %s and node_id = %s",
                (ctx.application_id, ctx.node.id),
            )
    return "ok"


async def _lines(tx: Tx, application_id: UUID) -> list[str]:
    row = await tx.fetchone("select redacted_lines from resume_texts where application_id = %s", (application_id,))
    return list(row["redacted_lines"]) if row else []


async def _store_vectors(tx: Tx, parent_id: UUID, kind: str, texts: list[str], model: str) -> int:
    """Embed texts not already stored under the same hash and model; returns how many were embedded."""
    existing = {
        (r["chunk_index"], r["text_hash"])
        for r in await tx.fetchall(
            "select chunk_index, text_hash from embeddings where parent_id = %s and kind = %s and embedding_model = %s",
            (parent_id, kind, model),
        )
    }
    todo = [(i, t) for i, t in enumerate(texts) if (i, text_hash(t)) not in existing]
    if todo:
        vectors = await get_embedder().embed([t for _, t in todo])
        for (i, t), v in zip(todo, vectors, strict=True):
            await tx.conn.execute(
                """
                insert into embeddings (parent_id, kind, chunk_index, text_hash, embedding, embedding_model)
                values (%s, %s, %s, %s, %s::vector, %s)
                on conflict (parent_id, kind, chunk_index) do update
                  set text_hash = excluded.text_hash, embedding = excluded.embedding,
                      embedding_model = excluded.embedding_model, created_at = now()
                """,
                (parent_id, kind, i, text_hash(t), "[" + ",".join(f"{x:.6f}" for x in v) + "]", model),
            )
    await tx.conn.execute("delete from embeddings where parent_id = %s and kind = %s and chunk_index >= %s",
                          (parent_id, kind, len(texts)))
    return len(todo)


async def embed(application_id: str) -> int:
    model = get_embedder().model
    async with transaction(system_claims()) as tx:
        ctx = await load(tx, application_id)
        chunks = [c.text for c in chunk_lines(await _lines(tx, ctx.application_id))]
        n = await _store_vectors(tx, ctx.application_id, "resume_chunk", chunks, model)
        n += await _store_vectors(tx, ctx.workflow_id, "criterion", [c.name for c in ctx.criteria], model)
    return n


async def prefilter(application_id: str) -> float:
    """Shortlist score in [0, 1] (§13 step 5). Orders work when the budget is short; never rejects."""
    async with transaction(system_claims()) as tx:
        ctx = await load(tx, application_id)
        model = get_embedder().model
        rows = await tx.fetchall(
            """
            with crit as (
              select ord - 1 as idx, lower(name) as term from unnest(%(names)s::text[]) with ordinality as t(name, ord)
            ), terms as (
              select c.idx, c.term as t from crit c
              union select c.idx, a.alias from crit c
                join skill_aliases s on s.alias = c.term or s.canonical = c.term
                join skill_aliases a on a.canonical = s.canonical
              union select c.idx, s.canonical from crit c join skill_aliases s on s.alias = c.term
            )
            select c.idx,
              coalesce((select ts_rank(r.fts, plainto_tsquery('english', c.term), 32)
                        from resume_texts r where r.application_id = %(app)s), 0) as fts,
              coalesce((select max(word_similarity(t.t, lower(r.redacted_text)))
                        from terms t, resume_texts r where t.idx = c.idx and r.application_id = %(app)s), 0) as trgm,
              coalesce((select max(1 - (rc.embedding <=> ce.embedding))
                        from embeddings rc, embeddings ce
                        where rc.parent_id = %(app)s and rc.kind = 'resume_chunk' and rc.embedding_model = %(m)s
                          and ce.parent_id = %(wf)s and ce.kind = 'criterion' and ce.chunk_index = c.idx
                          and ce.embedding_model = %(m)s), 0) as cos
            from crit c order by c.idx
            """,
            {"names": [c.name for c in ctx.criteria], "app": ctx.application_id, "wf": ctx.workflow_id, "m": model},
        )
        weights = [c.weight for c in ctx.criteria]
        per = [W_FTS * float(r["fts"]) + W_TRGM * float(r["trgm"]) + W_COS * max(0.0, float(r["cos"])) for r in rows]
        value = round(sum(w * p for w, p in zip(weights, per, strict=True)) / sum(weights), 4) if per else 0.0
        await tx.conn.execute("update applications set prefilter_score = %s where id = %s",
                              (Decimal(str(value)), ctx.application_id))
    return value


async def score(application_id: str, deadline: float) -> StepStatus:
    """One packed model call; the draft is kept on the open stage row until verification."""
    async with transaction(system_claims()) as tx:
        ctx = await load(tx, application_id)
        lines = await _lines(tx, ctx.application_id)
    draft = await agent.score(ctx.criteria, lines, deadline=deadline)
    async with transaction(system_claims()) as tx:
        await _update_open_stage(tx, ctx, evidence={"draft": draft})
    return "ok"


async def verify_citations(application_id: str, deadline: float) -> StepStatus:
    async with transaction(system_claims()) as tx:
        ctx = await load(tx, application_id)
        lines = await _lines(tx, ctx.application_id)
        stage = await _stage(tx, ctx)
    ev = (stage or {}).get("evidence")
    if not isinstance(ev, dict) or "draft" not in ev:
        return "ok"  # already verified on an earlier attempt
    async with transaction(system_claims()) as tx:
        row = await tx.fetchone("select injection_flags from resume_texts where application_id = %s",
                                (ctx.application_id,))
    flagged = {int(f["line_no"]) for f in (row or {}).get("injection_flags") or [] if f.get("line_no")}
    result = await agent.verify(ctx.criteria, lines, ev["draft"], deadline=deadline, flagged_lines=flagged)
    async with transaction(system_claims()) as tx:
        await _update_open_stage(tx, ctx, evidence=[e.model_dump() for e in result.evidence],
                                 score=Decimal(str(result.match)), model_id=result.model_id,
                                 prompt_version=f"screening_score@{result.prompt_version}")
        await tx.conn.execute(
            "update stage_results set flags = array(select distinct unnest(flags || %s::text[]))"
            " where application_id = %s and node_id = %s",
            (result.flags, ctx.application_id, ctx.node.id),
        )
    return "ok"


async def compute_and_transition(application_id: str) -> str:
    """Apply the cutoff to the verified match score. Returns the resulting stage status."""
    async with transaction(system_claims()) as tx:
        ctx = await load(tx, application_id)
        stage = await _stage(tx, ctx)
        if stage is None or stage["status"] in ("passed", "failed"):
            return stage["status"] if stage else "missing"
        if stage["score"] is None or not isinstance(stage["evidence"], list):
            await _needs_review(tx, ctx, "not_scored")
            return "needs_review"
        match = float(stage["score"])
        status: Literal["passed", "failed"] = "passed" if passes(ctx.node, match) else "failed"
        await transition(tx, ctx.application_id, ctx.node.id, StageOutcome(status=status, score=match),
                         ctx.workflow)
    return status


async def mark_model_failed(application_id: str) -> None:
    async with transaction(system_claims()) as tx:
        await _needs_review(tx, await load(tx, application_id), "model_failed")
