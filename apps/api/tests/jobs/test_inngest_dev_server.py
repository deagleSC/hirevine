"""Phase 2 exit check against the real Inngest dev server (backend plan §19.1 'Jobs'):
a queued item runs to completion, and a failing step is retried without repeating the
steps that already finished.

Opt-in, because it downloads the Inngest CLI and starts two servers:
    INNGEST_DEV_TESTS=1 uv run pytest tests/jobs/test_inngest_dev_server.py
"""

from __future__ import annotations

import asyncio
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import httpx
import inngest
import pytest

from app.core.db import transaction
from app.jobs import runs
from app.jobs.dispatcher import InngestDispatcher
from app.jobs.runs import JobRefs
from tests.conftest import API_DB_URL, admin, create_auth_user, create_profile, manager_claims

INNGEST_CLI = "inngest-cli@1.50.0"
API_DIR = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.skipif(
    os.environ.get("INNGEST_DEV_TESTS") != "1" or shutil.which("npx") is None,
    reason="set INNGEST_DEV_TESTS=1 (needs npx) to run against the Inngest dev server",
)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(url: str, timeout: float = 120) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            if httpx.get(url, timeout=2).status_code < 500:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    raise TimeoutError(url)


@pytest.fixture(scope="module")
def dev_server(migrated_db) -> Iterator[str]:
    api_port, inngest_port = free_port(), free_port()
    inngest_url = f"http://127.0.0.1:{inngest_port}"
    env = {**os.environ, "APP_ENV": "test", "DATABASE_URL": API_DB_URL, "INNGEST_DEV": inngest_url}
    api = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(api_port), "--log-level", "warning"],
        cwd=API_DIR, env=env,
    )
    dev = subprocess.Popen(
        ["npx", "--yes", INNGEST_CLI, "dev", "--port", str(inngest_port), "--no-discovery",
         "-u", f"http://127.0.0.1:{api_port}/api/inngest"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        wait_for(f"http://127.0.0.1:{api_port}/healthz")
        wait_for(f"{inngest_url}/health")
        # Wait until the dev server has synced our functions.
        end = time.time() + 60
        while time.time() < end:
            apps = httpx.get(f"{inngest_url}/dev", timeout=5).json()
            fns = {f["slug"] for f in (apps.get("functions") or [])}
            if any(s.endswith("selftest") for s in fns):
                break
            time.sleep(1)
        yield inngest_url
    finally:
        for p in (dev, api):
            p.terminate()
            p.wait(timeout=10)


def step_counts(db: str, run_id: uuid.UUID) -> dict[str, int]:
    with admin(db) as conn:
        rows = conn.execute(
            "select payload->>'step' as step, count(*) as n from events"
            " where type = 'selftest.step' and entity_id = %s group by 1", (run_id,),
        ).fetchall()
    return {r["step"]: r["n"] for r in rows}


async def test_queued_run_completes_and_failed_step_retries_alone(dev_server, migrated_db):
    mgr = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:8]}@inngest.test"),
                         "manager", "Inn Gest", "Inngest Org")
    client = inngest.Inngest(app_id="hirevine", is_production=False, event_api_base_url=dev_server)
    async with transaction(manager_claims(mgr)) as tx:
        run_id = await InngestDispatcher(client).enqueue(tx, "selftest", JobRefs(org_id=mgr["org_id"]))

    deadline = time.time() + 120
    while time.time() < deadline:
        run = await runs.get(run_id)
        if run and run["status"] in ("done", "failed"):
            break
        await asyncio.sleep(1)
    run = await runs.get(run_id)
    assert run and run["status"] == "done", run
    assert run["inngest_run_id"]
    # `first` ran once even though the function was re-entered after `flaky` failed;
    # `flaky` ran twice (fail, then succeed); `last` ran once.
    assert step_counts(migrated_db, run_id) == {"first": 1, "flaky": 2, "last": 1}
