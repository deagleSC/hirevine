"""JobDispatcher: queue a job inside the request transaction, send the event after commit
(backend plan §10.4).

- The job_runs row is inserted in the caller's transaction, so a rollback leaves no run.
- The Inngest event is sent only after commit, with the job_run_id as its `id`.
- A run still `queued` after 5 minutes is re-sent by housekeeping with a fresh event id. Inngest
  drops a repeated id for 24 h even when no function consumed the first event (e.g. the app was
  not yet synced), so reusing the id would strand the run. `runs.mark_running` only claims a
  queued run, so a duplicate start exits without doing anything.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol
from uuid import UUID, uuid4

import inngest

from app.core.db import Tx
from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.runs import JobRefs

log = logging.getLogger("hirevine.jobs")

# job type → Inngest event name.
EVENTS: dict[str, str] = {
    "selftest": "selftest/requested",
    "screening": "application/submitted",
    "quiz_generate": "quiz/generate.requested",
    "quiz_deadline": "quiz/started",
    "interview_deadline": "interview/started",
    "interview_score": "interview/finished",
    "report_draft": "report/draft.requested",
    "notify_release": "campaign/completed",
}
# Runs that wait rather than work (they sleep until a deadline). Monitors do not count them as processing.
WAITING_TYPES = ("quiz_deadline", "interview_deadline")


def event_id(run_id: UUID, resend: bool = False) -> str:
    """The first send uses the run id; every re-send gets a unique id so Inngest never drops it."""
    return f"{run_id}:{uuid4().hex[:12]}" if resend else str(run_id)


def event_for(type: str, run_id: UUID, refs: JobRefs, resend: bool = False) -> inngest.Event:
    return inngest.Event(name=EVENTS[type], id=event_id(run_id, resend), data=refs.event_data(run_id))


class JobDispatcher(Protocol):
    async def enqueue(self, tx: Tx, type: str, refs: JobRefs, params: dict[str, Any] | None = None) -> UUID: ...
    async def resend(self, run: dict[str, object]) -> None: ...


class InngestDispatcher:
    def __init__(self, client: inngest.Inngest = inngest_client):
        self.client = client

    async def enqueue(self, tx: Tx, type: str, refs: JobRefs, params: dict[str, Any] | None = None) -> UUID:
        if type not in EVENTS:
            raise ValueError(f"Unknown job type {type!r}")
        run_id = await runs.create(tx, type, refs, params)
        event = event_for(type, run_id, refs)

        async def send() -> None:
            try:
                await self.client.send(event)
            except Exception:
                # The run stays queued; housekeeping.resend_stuck_runs retries the send.
                log.exception("Inngest send failed for job_run %s; housekeeping will resend", run_id)

        tx.after_commit(send)
        return run_id

    async def resend(self, run: dict[str, object]) -> None:
        run_id = UUID(str(run["id"]))
        await self.client.send(event_for(str(run["type"]), run_id, runs.refs_of(run), resend=True))


dispatcher: JobDispatcher = InngestDispatcher()
