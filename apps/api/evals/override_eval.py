"""Override agent eval (backend plan §19.2; Phase 4 exit check): for each request in
datasets/override.json, does the chat agent propose the same patches a hand edit produces?

    uv run python -m evals.override_eval [--limit N] [--target 0.85]

Comparison ignores what cannot matter: ids the agent invents for new items, and the order of
patches when the result is the same. Runs through call_structured (cache on), so each model
request counts against the daily cap once; reruns of unchanged cases are free.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from langgraph.checkpoint.memory import InMemorySaver
from pydantic import TypeAdapter

from app.agents import override_agent
from app.core.db import close_pool
from app.domain.patches import Patch, apply_patches
from app.domain.workflow import Workflow
from app.llm import budget
from app.llm.errors import BudgetExhausted, LLMError, RateLimited
from app.llm.prompts import PROMPTS

ROOT = Path(__file__).parent
DATASET = ROOT / "datasets" / "override.json"
REPORTS = ROOT / "reports"
_patches = TypeAdapter(list[Patch])


def normalize(patches: list[dict[str, Any]], base: Workflow) -> list[str]:
    """Order-insensitive, and blind to ids of newly created items."""
    known = {c.id for n in base.nodes for key in ("criteria", "questions", "rubric")
             for c in getattr(n.config, key, [])}
    out = []
    for p in patches:
        p = json.loads(json.dumps(p))
        for key in ("criterion", "question"):
            if key in p and p[key].get("id") not in known:
                p[key].pop("id", None)
        if p.get("op") == "update_interview_rubric":
            for r in p["rubric"]:
                if r["id"] not in known:
                    r.pop("id")
        out.append(json.dumps(p, sort_keys=True))
    return sorted(out)


def same_result(got: list[dict[str, Any]], expected: list[dict[str, Any]], base: Workflow) -> bool:
    """Fallback check: different patches, identical workflow (ids of new items aside)."""
    try:
        a = apply_patches(base, _patches.validate_python(got)).workflow.model_dump(mode="json")
        b = apply_patches(base, _patches.validate_python(expected)).workflow.model_dump(mode="json")
    except Exception:  # noqa: BLE001
        return False

    def strip(wf: dict[str, Any]) -> str:
        for n in wf["nodes"]:
            for key in ("criteria", "questions", "rubric"):
                for item in n["config"].get(key, []):
                    item["id"] = "_"
        return json.dumps(wf, sort_keys=True)

    return strip(a) == strip(b)


async def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--target", type=float, default=0.85)
    args = ap.parse_args(argv)

    data = json.loads(DATASET.read_text())
    base = Workflow.model_validate(data["base"])
    cases = data["cases"][: args.limit]
    print(f"{len(cases)} cases (budget used today: {await budget.used_today()})")

    results, latencies = [], []
    try:
        for c in cases:
            started = time.monotonic()
            try:
                for attempt in range(4):  # rate limits are about pacing, not the agent: wait and retry
                    try:
                        res = await override_agent.run(InMemorySaver(), uuid4(), base, c["instruction"])
                        break
                    except RateLimited as exc:
                        if attempt == 3:
                            raise
                        await asyncio.sleep(min(exc.retry_after, 60) + 1)
            except BudgetExhausted:
                print("Daily request cap reached; stopping (cached results are kept).")
                break
            except LLMError as exc:
                results.append({"id": c["id"], "ok": False, "error": f"{type(exc).__name__}: {exc}"})
                print(f"  {c['id']} ERROR {type(exc).__name__}")
                continue
            latencies.append(time.monotonic() - started)
            got = [p.model_dump(mode="json") for p in res.patches]
            exact = normalize(got, base) == normalize(c["expected"], base)
            ok = exact or same_result(got, c["expected"], base)
            results.append({"id": c["id"], "ok": ok, "exact": exact, "instruction": c["instruction"],
                            "expected": c["expected"], "got": got, "explanation": res.explanation, "error": res.error})
            print(f"  {c['id']} {'ok ' if ok else 'MISS'} {c['instruction'][:60]}")
    finally:
        await close_pool()

    done = len(results)
    passed = sum(r["ok"] for r in results)
    rate = passed / done if done else 0.0
    report = {
        "run_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "prompt_version": PROMPTS["override_patches"].version,
        "cases": done, "passed": passed, "exact_match_rate": round(rate, 3), "target": args.target,
        "met_target": done == len(cases) and rate >= args.target,
        "p50_s": round(sorted(latencies)[len(latencies) // 2], 2) if latencies else None,
        "misses": [r for r in results if not r["ok"]],
    }
    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / f"override_v{report['prompt_version']}_{datetime.now(UTC):%Y%m%d}.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"\n{passed}/{done} = {rate:.0%} (target {args.target:.0%}) → {out.relative_to(ROOT.parent)}")
    return 0 if report["met_target"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
