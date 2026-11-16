"""The API must start in production even before Inngest is configured."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[2]

SCRIPT = """
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
assert c.get("/healthz").status_code == 200
print("inngest", c.get("/api/inngest").status_code)
"""


def run_prod(**extra: str) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("INNGEST_")}
    env.update({"APP_ENV": "prod", **extra})
    # cwd outside the API dir so apps/api/.env is not read: this is production's environment.
    return subprocess.run([sys.executable, "-c", SCRIPT], cwd="/", env={**env, "PYTHONPATH": str(API_DIR)},
                          capture_output=True, text=True, timeout=60)


def test_prod_without_signing_key_starts_and_disables_inngest():
    r = run_prod()
    assert r.returncode == 0, r.stderr
    assert "inngest 404" in r.stdout


def test_prod_with_signing_key_serves_inngest():
    r = run_prod(INNGEST_SIGNING_KEY="signkey-prod-" + "ab" * 32)
    assert r.returncode == 0, r.stderr
    assert "inngest 404" not in r.stdout


def test_cors_allows_preview_origins_matching_the_regex(monkeypatch):
    from fastapi.testclient import TestClient

    from app.core.config import get_settings
    from app.main import create_app

    monkeypatch.setattr(get_settings(), "cors_origin_regex",
                        r"^https://hirevine-(candidate|manager)-[a-z0-9-]+\.vercel\.app$")
    c = TestClient(create_app())

    def preflight(origin: str):
        return c.options("/v1/me", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})

    ok = preflight("https://hirevine-candidate-git-ui-polish-team.vercel.app")
    assert ok.headers.get("access-control-allow-origin") == "https://hirevine-candidate-git-ui-polish-team.vercel.app"
    assert "access-control-allow-origin" not in preflight("https://evil-hirevine-candidate.vercel.app").headers
