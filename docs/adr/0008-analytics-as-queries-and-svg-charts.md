# ADR 0008: Analytics as RLS-scoped queries, charts as small SVG components

Status: accepted (November 2026)

## Decision

Dashboards are plain SQL in `services/analytics.py`, run as the caller, rather than database views; charts are small shared components (`packages/ui/blocks/charts.tsx`) rather than a charting library.

## Why

Same RLS guarantees as `security_invoker` views, with the queries next to their tests and no migration. Every chart is single-series, so a library adds bundle weight without adding capability; each chart has a table view and keyboard tooltips. The numbers are checked against a hand-computed synthetic campaign.

## Cost

Multi-series or zoomable charts would justify a library later.
