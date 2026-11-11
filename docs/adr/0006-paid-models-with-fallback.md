# ADR 0006: Paid model variants, one fallback, then retry later

Status: accepted (November 2026)

## Decision

Production uses the paid OpenRouter variants of `google/gemma-4-31b-it` (primary) and `nvidia/nemotron-3-ultra-550b-a55b`. Provider failures (5xx, timeouts, aborted streams) switch once to the backup model, then surface as `ProviderUnavailable`: background jobs retry after 60 s (5 retries), interviews say "busy, try again" with the answer saved.

## Why

The free variants returned 429s, 503s, 504s and aborted streams for minutes at a time on 11 Nov 2026, which an interview cannot wait out. A full interview costs about eight requests. Daily request caps and a per-minute cap on request-path calls still bound spend.

## Cost

A paid account; `LLM_SYNC_RPM_CAP` (default 2/min, shared by chats and interviews) must be raised before many candidates interview at once.
