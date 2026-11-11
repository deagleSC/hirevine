# ADR 0005: LangGraph only where a conversation needs a checkpoint

Status: accepted (November 2026)

## Decision

The job-creation and workflow-editing chats use LangGraph with Postgres checkpoints. Screening, quiz generation, interview turns, scoring and drafts are plain async functions that call `call_structured` / `stream_text` directly; the interview's state is its transcript row, saved after every turn.

## Why

Fewer moving parts and one source of truth for each piece of state. Resuming an interview needs only the transcript; streaming works without graph plumbing.

## Cost

If an interview ever needs branching tool use, it would move to a graph.
