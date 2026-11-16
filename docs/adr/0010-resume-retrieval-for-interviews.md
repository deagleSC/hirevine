# ADR 0010: Interview questions are grounded in retrieved resume excerpts

Status: accepted (November 2026)

## Decision

Before each interview question, the API embeds a query (the latest answer, then the interview themes, then the job title), ranks the candidate's stored resume-chunk vectors by cosine similarity (pgvector, HNSW), and passes the top 3 chunks with similarity ≥ 0.2 to `interview_next` (v2) inside `<candidate_data>` tags. Chunk text is rebuilt from the redacted resume lines and used only if its hash matches the stored vector. Any retrieval failure (no vectors, embedder down or slower than 4 s) means no excerpts, never a failed turn.

Resume screening does **not** use retrieval: the whole redacted resume fits in one call, and every score must quote a line, so retrieval could only hide evidence.

## Why

Generic questions ("describe an API you designed") are easy to answer from a script and tell the team little. Questions about the candidate's own projects are more useful and harder to game. The vectors already existed for the screening prefilter, so this added no new pipeline or stored data.

## Consequences

- The interviewer is told never to claim the resume says something it does not; excerpts are untrusted data (prompt-injection rules apply).
- Retrieved chunk ids and similarities are recorded on the Langfuse `interview-turn` trace.
- Follow-ups tracked as issues: hybrid keyword + vector ranking and diversity (#29), a retrieval evaluation set (#28), re-embedding on model change (#30).
