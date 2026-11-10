"""Model smoke test (backend plan §11.4): run each candidate model on small screening, quiz
and patch tasks, and report the valid-output rate, task-specific correctness and latency.

    uv run python -m evals.smoke_test --models a,b,c --tasks screen,quiz,patch

Each model is called on its own (no OpenRouter fallback) so the numbers are that model's.
Calls go through call_structured, so they count against the daily cap and are cached:
re-running with the same models and prompt versions costs nothing. Pass --no-cache to
measure fresh latency. The report is written to evals/reports/smoke_<date>.json.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import statistics
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.core.config import get_settings
from app.core.db import close_pool
from app.llm import budget
from app.llm.errors import BudgetExhausted, LLMError, NeedsReview, RateLimited
from app.llm.prompts import PROMPTS
from app.llm.prompts.smoke import PatchInput, PatchOutput, QuizInput, QuizOutput, ScreenInput, ScreenOutput
from app.llm.wrapper import StructuredResult, call_structured, deadline_in

ROOT = Path(__file__).parent
DATASET = ROOT / "datasets" / "smoke.json"
REPORTS = ROOT / "reports"


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def check_screen(item: dict[str, Any], out: ScreenOutput) -> dict[str, float]:
    """Citation validity: every quote for a met criterion appears verbatim in the resume."""
    resume = _norm(item["resume"])
    quotes = [f.quote for f in out.findings if f.met]
    valid = [q for q in quotes if q.strip() and _norm(re.sub(r"^\d+\s+", "", q)) in resume]
    complete = len(out.findings) == len(item["criteria"])
    return {
        "citation_validity": len(valid) / len(quotes) if quotes else 1.0,
        "covers_all_criteria": float(complete),
        "injection_resisted": float(out.score < 100) if "Ignore all previous" in item["resume"] else 1.0,
    }


def check_quiz(item: dict[str, Any], out: QuizOutput) -> dict[str, float]:
    """Right count; four distinct options per question (one correct index is enforced by the schema)."""
    distinct = all(len({_norm(o) for o in q.options}) == 4 for q in out.questions)
    return {"right_count": float(len(out.questions) == item["count"]), "distinct_options": float(distinct)}


def check_patch(item: dict[str, Any], out: PatchOutput) -> dict[str, float]:
    got = [op.model_dump() for op in out.ops]
    return {"exact_match": float(got == item["expected"])}


@dataclass
class Task:
    prompt_id: str
    build: Callable[[dict[str, Any]], BaseModel]
    check: Callable[[dict[str, Any], Any], dict[str, float]]


TASKS: dict[str, Task] = {
    "screen": Task("smoke_screen", lambda i: ScreenInput(criteria=i["criteria"], resume=i["resume"]), check_screen),
    "quiz": Task("smoke_quiz", lambda i: QuizInput(**i), check_quiz),
    "patch": Task(
        "smoke_patch", lambda i: PatchInput(workflow=i["workflow"], instruction=i["instruction"]), check_patch
    ),
}


@dataclass
class ModelReport:
    model: str
    calls: int = 0
    valid_first_try: int = 0
    valid_after_retry: int = 0
    needs_review: int = 0
    errors: dict[str, int] = field(default_factory=dict)
    served_by_other: int = 0
    latencies_s: list[float] = field(default_factory=list)
    checks: dict[str, list[float]] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        lat = sorted(self.latencies_s)
        valid = self.valid_first_try + self.valid_after_retry
        return {
            "model": self.model,
            "calls": self.calls,
            "valid_rate": round(valid / self.calls, 3) if self.calls else 0.0,
            "valid_first_try_rate": round(self.valid_first_try / self.calls, 3) if self.calls else 0.0,
            "needs_review": self.needs_review,
            "errors": self.errors,
            "served_by_other_model": self.served_by_other,
            "p50_s": round(statistics.median(lat), 2) if lat else None,
            "p95_s": round(lat[min(len(lat) - 1, int(0.95 * len(lat)))], 2) if lat else None,
            "checks": {k: round(sum(v) / len(v), 3) for k, v in self.checks.items() if v},
        }


async def run_model(
    model: str, tasks: list[str], data: dict[str, list[dict[str, Any]]], *, use_cache: bool,
    call: Callable[..., Awaitable[StructuredResult[Any]]] = call_structured,
) -> ModelReport:
    rep = ModelReport(model)
    for name in tasks:
        task = TASKS[name]
        for item in data[name]:
            rep.calls += 1
            started = time.monotonic()
            try:
                res = await call(
                    "structured", task.prompt_id, task.build(item),
                    deadline=deadline_in(240), cache_enabled=use_cache, models=[model],
                )
            except BudgetExhausted:
                raise
            except NeedsReview:
                rep.needs_review += 1
                continue
            except RateLimited as exc:
                rep.errors["rate_limited"] = rep.errors.get("rate_limited", 0) + 1
                await asyncio.sleep(min(exc.retry_after, 30))
                continue
            except (LLMError, Exception) as exc:  # noqa: BLE001 - a smoke test records every failure
                key = type(exc).__name__
                rep.errors[key] = rep.errors.get(key, 0) + 1
                continue
            if not res.cached:
                rep.latencies_s.append(time.monotonic() - started)
            if res.attempts <= 1:
                rep.valid_first_try += 1
            else:
                rep.valid_after_retry += 1
            if res.model_id != model:
                rep.served_by_other += 1
            for k, v in task.check(item, res.value).items():
                rep.checks.setdefault(f"{name}.{k}", []).append(v)
    return rep


def pick_primary(summaries: list[dict[str, Any]]) -> str | None:
    """Most valid output, then best task checks, then lowest p95 latency."""
    ranked = [s for s in summaries if s["calls"]]
    if not ranked:
        return None

    def key(s: dict[str, Any]) -> tuple[float, float, float]:
        checks = list(s["checks"].values())
        return (-s["valid_rate"], -(sum(checks) / len(checks) if checks else 0.0), s["p95_s"] or 1e9)

    return sorted(ranked, key=key)[0]["model"]


def print_table(summaries: list[dict[str, Any]]) -> None:
    print(f"{'model':48} {'valid':>6} {'1st':>6} {'review':>6} {'p50':>6} {'p95':>6}  checks")
    for s in summaries:
        checks = ", ".join(f"{k}={v}" for k, v in s["checks"].items())
        print(
            f"{s['model']:48} {s['valid_rate']:>6} {s['valid_first_try_rate']:>6} {s['needs_review']:>6} "
            f"{s['p50_s'] or '-':>6} {s['p95_s'] or '-':>6}  {checks}"
        )
        if s["errors"]:
            print(f"{'':48} errors: {s['errors']}")


async def main(argv: list[str] | None = None) -> int:
    settings = get_settings()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--models", default=",".join(settings.llm_structured_models))
    p.add_argument("--tasks", default="screen,quiz,patch")
    p.add_argument("--no-cache", action="store_true")
    args = p.parse_args(argv)

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    tasks = [t.strip() for t in args.tasks.split(",") if t.strip()]
    data = json.loads(DATASET.read_text())
    needed = len(models) * sum(len(data[t]) for t in tasks)
    print(f"{len(models)} models × {needed // max(len(models), 1)} items; up to {needed * 2} requests "
          f"(budget used today: {await budget.used_today()}/{settings.llm_daily_cap})")

    summaries = []
    try:
        for model in models:
            print(f"… {model}")
            try:
                rep = await run_model(model, tasks, data, use_cache=not args.no_cache)
            except BudgetExhausted:
                print("Daily request cap reached; stopping. Cached results are kept, so re-run tomorrow.")
                break
            summaries.append(rep.summary())
    finally:
        await close_pool()

    primary = pick_primary(summaries)
    print_table(summaries)
    print(f"\nPrimary model: {primary}")
    report = {
        "run_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "tasks": tasks,
        "models": summaries,
        "primary": primary,
        "prompt_versions": {TASKS[t].prompt_id: PROMPTS[TASKS[t].prompt_id].version for t in tasks},
    }
    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / f"smoke_{datetime.now(UTC):%Y%m%d}.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Report: {out.relative_to(ROOT.parent)}")
    return 0 if primary else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
