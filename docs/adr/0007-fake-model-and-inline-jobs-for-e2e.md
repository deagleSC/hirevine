# ADR 0007: End-to-end tests run the real pipeline against a fake model

Status: accepted (November 2026)

## Decision

Playwright starts the API with `JOB_DISPATCHER=inline` (jobs run in-process after commit), an in-memory resume store served at `/v1/dev/storage`, and `scripts/fake_openrouter.py`, which answers each prompt by output schema (and streams interview questions slowly enough to reload mid-stream). All of this is dev/test only and refused in production.

## Why

`e2e/journey.spec.ts` drives the whole product (job chat → publish → apply with an upload → screening → release → feedback with citations) deterministically in about 90 s, with no model spend and no Inngest server.

## Cost

The fake must learn each new prompt's schema; real-model quality is measured separately by the evals.
