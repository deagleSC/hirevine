"""Retrieval over a candidate's resume for the AI interviewer (RAG).

Screening already chunks the redacted resume and stores one vector per chunk (`embeddings`,
kind `resume_chunk`). Before each question we embed a query built from the role's themes and the
latest answer, rank the stored chunks by cosine similarity (pgvector HNSW), and hand the best few
to the interviewer so it can ask about the candidate's own work.

The chunk text is not stored with the vector: it is rebuilt from `resume_texts.redacted_lines` with
the same chunker, and a chunk is only used when its hash still matches the stored one. Only redacted
text is ever returned. Retrieval is best effort: any failure returns no excerpts and the interview
carries on with the role context alone.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from app.core.db import system_claims, transaction
from app.pipeline.chunk import chunk_lines
from app.services.embedder import get_embedder

log = logging.getLogger(__name__)

TOP_K = 3
MIN_SIMILARITY = 0.2
EMBED_TIMEOUT_S = 4.0
MAX_QUERY_CHARS = 1500


@dataclass(frozen=True)
class Excerpt:
    chunk_index: int
    text: str
    similarity: float


def build_query(*, title: str, themes: list[str], last_answer: str | None) -> str:
    """What the next question should be about: the latest answer (to follow up on), then the themes."""
    parts = [last_answer or "", " ".join(themes), title]
    return "\n".join(p for p in parts if p).strip()[:MAX_QUERY_CHARS]


async def resume_excerpts(application_id: str, query: str, k: int = TOP_K) -> list[Excerpt]:
    """The `k` resume chunks most similar to `query`, best first; [] when none are usable."""
    if not query:
        return []
    try:
        embedder = get_embedder()
        [vector] = await asyncio.wait_for(embedder.embed([query]), EMBED_TIMEOUT_S)
        async with transaction(system_claims()) as tx:
            rows = await tx.fetchall(
                """
                select e.chunk_index, e.text_hash, 1 - (e.embedding <=> %(q)s::vector) as similarity
                  from embeddings e
                 where e.parent_id = %(app)s and e.kind = 'resume_chunk' and e.embedding_model = %(m)s
                 order by e.embedding <=> %(q)s::vector
                 limit %(k)s
                """,
                {"q": str(vector), "app": application_id, "m": embedder.model, "k": k},
            )
            if not rows:
                return []
            lines = await tx.fetchone(
                "select redacted_lines from resume_texts where application_id = %s", (application_id,))
    except Exception as exc:  # retrieval must never break the interview
        log.warning("resume retrieval failed for %s: %s", application_id, exc)
        return []
    chunks = {c.index: c for c in chunk_lines(list(lines["redacted_lines"]) if lines else [])}
    out: list[Excerpt] = []
    for r in rows:
        c = chunks.get(r["chunk_index"])
        sim = float(r["similarity"])
        if c is None or c.text_hash != r["text_hash"] or sim < MIN_SIMILARITY:
            continue
        out.append(Excerpt(chunk_index=c.index, text=c.text, similarity=round(sim, 4)))
    return out
