# ADR 0004: Outcomes are released to everyone at once, by the manager

Status: accepted (November 2026)

## Decision

Candidates see stage results and feedback only after the manager completes the campaign, which releases everyone in one transaction. AI drafts the feedback; the manager edits it, can exclude candidates, and can score stuck stages by hand.

## Why

People make the decisions, candidates are not told early outcomes that may change, and everyone gets feedback, including those who stopped at screening. Enforced by RLS (`app.application_released`), checked by `tests/rls/test_rls_release.py` and the release e2e test.

## Cost

Candidates wait until the whole campaign ends; a rolling release would need a different rule.
