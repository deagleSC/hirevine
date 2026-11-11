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

import asyncio
import inspect
import logging
from types import SimpleNamespace
from typing import Any, Protocol
from uuid import UUID, uuid4

import inngest

from app.core.config import get_settings
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
    "data_delete": "privacy/delete.requested",
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


class _InlineStep:
    """Just enough of `ctx.step` for inline runs: steps run once, sleeps and waits return at once."""

    async def run(self, _id: str, fn: Any, *args: Any) -> Any:
        out = fn(*args)
        return await out if inspect.isawaitable(out) else out

    async def sleep_until(self, _id: str, _until: object) -> None:
        return None

    async def wait_for_event(self, _id: str, **_: Any) -> None:
        return None


class InlineDispatcher:
    """Dev/test only (JOB_DISPATCHER=inline): runs each job's function in this process right after
    commit, so end-to-end tests exercise the real pipeline without an Inngest server. Jobs that only
    wait for a deadline are queued but not run. No retries: a failure is logged and marks the run failed."""

    def __init__(self) -> None:
        self._tasks: set[asyncio.Task[None]] = set()

    async def enqueue(self, tx: Tx, type: str, refs: JobRefs, params: dict[str, Any] | None = None) -> UUID:
        if type not in EVENTS:
            raise ValueError(f"Unknown job type {type!r}")
        run_id = await runs.create(tx, type, refs, params)
        if type in WAITING_TYPES:
            return run_id
        event = event_for(type, run_id, refs)

        async def start() -> None:
            task = asyncio.create_task(self._run(event))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

        tx.after_commit(start)
        return run_id

    async def resend(self, run: dict[str, object]) -> None:
        await self._run(event_for(str(run["type"]), UUID(str(run["id"])), runs.refs_of(run), resend=True))

    async def _run(self, event: inngest.Event) -> None:
        from app.jobs.functions import all_functions

        fn = next((f for f in all_functions() if any(getattr(t, "event", None) == event.name for t in f._triggers)),
                  None)
        if fn is None:
            log.error("inline: no function for %s", event.name)
            return
        ctx = SimpleNamespace(event=event, run_id=f"inline-{event.id}", step=_InlineStep())
        try:
            await fn._handler(ctx)  # type: ignore[misc,arg-type]
        except Exception as exc:
            log.exception("inline: %s failed", event.name)
            await runs.mark_failed(str(event.data["job_run_id"]), str(exc))


def _make_dispatcher() -> JobDispatcher:
    s = get_settings()
    if s.job_dispatcher == "inline":
        if not s.is_dev:
            raise RuntimeError("JOB_DISPATCHER=inline is for dev/test only")
        return InlineDispatcher()
    return InngestDispatcher()


dispatcher: JobDispatcher = _make_dispatcher()
