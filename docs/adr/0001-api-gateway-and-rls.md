# ADR 0001: The API is the only gateway; RLS is the backstop

Status: accepted (November 2026)

## Decision

Both web apps talk only to the FastAPI service; only the API talks to Postgres and to models. Every request runs in one transaction with the caller's claims set (`app.claims`), and row-level security on every table decides what that transaction can see. Background jobs run with explicit `system` claims.

## Why

A bug in a route (a missing `where org_id = …`) cannot leak another organisation's rows, because the database refuses. The release rule (candidates see results and feedback only after the campaign completes) is enforced the same way, so no code path can bypass it. `tests/rls` checks isolation, the release rule, and that every reachable table has RLS and a policy.

## Cost

Every new query must be thought about under RLS; a few reads (the tracker, workflows for candidates) are done as `system` after an explicit ownership check, and those are reviewed by hand.
