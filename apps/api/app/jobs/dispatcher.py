"""JobDispatcher: queue a job inside the request transaction, send the event after commit
(backend plan §10.4).

- The job_runs row is inserted in the caller's transaction, so a rollback leaves no run.
- The Inngest event is sent only after commit. Its `id` is the job_run_id, so Inngest
  drops duplicate sends (e.g. housekeeping re-sending a run whose first send did arrive).
- A lost send leaves the run `queued`; housekeeping re-sends it after 5 minutes.
"""

from __future__ import annotations

import logging
from typing import Protocol
from uuid import UUID

import inngest

from app.core.db import Tx
from app.jobs import runs
from app.jobs.client import inngest_client
from app.jobs.runs import JobRefs

log = logging.getLogger("hirevine.jobs")

# job type → Inngest event name. Later phases add screening, quiz, interview, report, ...
EVENTS: dict[str, str] = {
    "selftest": "selftest/requested",
}


def event_for(type: str, run_id: UUID, refs: JobRefs) -> inngest.Event:
    return inngest.Event(name=EVENTS[type], id=str(run_id), data=refs.event_data(run_id))


class JobDispatcher(Protocol):
    async def enqueue(self, tx: Tx, type: str, refs: JobRefs) -> UUID: ...
    async def resend(self, run: dict[str, object]) -> None: ...


class InngestDispatcher:
    def __init__(self, client: inngest.Inngest = inngest_client):
        self.client = client

    async def enqueue(self, tx: Tx, type: str, refs: JobRefs) -> UUID:
        if type not in EVENTS:
            raise ValueError(f"Unknown job type {type!r}")
        run_id = await runs.create(tx, type, refs)
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
        await self.client.send(event_for(str(run["type"]), run_id, runs.refs_of(run)))


dispatcher: JobDispatcher = InngestDispatcher()
