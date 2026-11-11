# ADR 0002: Background jobs on Inngest, sent after commit, carrying IDs only

Status: accepted (November 2026)

## Decision

Long work (screening, quiz generation, interview scoring, feedback drafts, notifications, deletion) runs as Inngest functions. A `job_runs` row is inserted in the request's transaction and the event is sent only after commit, carrying record IDs, never resume text or answers. A run is claimed (`queued → running`) before it starts, so duplicate events are harmless; housekeeping re-sends runs still queued after 5 minutes with fresh event IDs.

## Why

Serverless requests cannot hold a minute-long model call, steps retry independently, and Inngest's cloud never holds personal data. The production incident where events arrived before functions were registered (and re-sends with the same ID were silently dropped) led to fresh re-send IDs, claim-before-start, and a CI step that re-registers functions after every API deploy.

## Cost

An external dependency for durability; jobs can be swapped to Postgres behind the same `JobDispatcher` interface if needed. End-to-end tests use an in-process dispatcher (`JOB_DISPATCHER=inline`).
