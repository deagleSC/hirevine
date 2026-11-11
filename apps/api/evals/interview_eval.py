"""Interview scoring eval (backend plan §19.2; Phase 7 exit check): is scoring consistent across
repeated runs, and does it agree with the labels?

    uv run python -m evals.interview_eval [--runs 3] [--max-std 5]

Each labelled transcript in datasets/interview_scoring.json is scored `--runs` times with the cache
off, so every run is a real model request (6 cases × 3 runs = 18 against the daily cap). Reports the
run-to-run standard deviation of the 0–100 score per case, and agreement with the labels: strong
cases score at least 70, weak cases at most 30, and the label means are ordered strong > mid > weak.
Passes when the mean standard deviation is at most `--max-std` points and the labels agree.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.agents import interview as agent
from app.core.db import close_pool
from app.domain.interview import Entry
from app.domain.workflow import InterviewConfig, RubricItem
from app.llm.errors import BudgetExhausted, LLMError, RateLimited
from app.llm.prompts import PROMPTS
from app.llm.wrapper import deadline_in

ROOT = Path(__file__).parent
DATASET = ROOT / "datasets" / "interview_scoring.json"
REPORTS = ROOT / "reports"


async def score_once(title: str, config: InterviewConfig, transcript: list[Entry]) -> dict[str, Any]:
    for attempt in range(4):
        try:
            started = time.monotonic()
            result, model_id, _ = await agent.score(title=title, config=config, transcript=transcript,
                                                    deadline=deadline_in(120), cache_enabled=False)
            return {"score": result.score, "items": {i.item_id: i.score for i in result.items},
                    "flags": result.flags, "model": model_id, "latency_s": round(time.monotonic() - started, 1)}
        except RateLimited as exc:
            await asyncio.sleep(max(5.0, exc.retry_after) * (attempt + 1))
    raise RuntimeError("rate limited four times in a row")


async def main(runs: int, max_std: float) -> int:
    data = json.loads(DATASET.read_text())
    config = InterviewConfig(rubric=[RubricItem(**r) for r in data["rubric"]],
                             turn_cap=len(data["cases"][0]["transcript"]) // 2)
    bands: dict[str, list[float]] = data["bands"]
    rows = []
    try:
        for case in data["cases"]:
            transcript = [Entry(**e) for e in case["transcript"]]
            results = []
            for _ in range(runs):
                try:
                    results.append(await score_once(data["title"], config, transcript))
                except (BudgetExhausted, LLMError, RuntimeError) as exc:
                    results.append({"error": str(exc)})
            scores = [r["score"] for r in results if "score" in r]
            mean = statistics.fmean(scores) if scores else None
            std = statistics.pstdev(scores) if len(scores) > 1 else None
            lo, hi = bands.get(case["label"], [0, 100])
            row = {"id": case["id"], "label": case["label"], "scores": scores,
                   "mean": round(mean, 1) if mean is not None else None,
                   "std": round(std, 2) if std is not None else None,
                   "in_band": mean is not None and lo <= mean <= hi, "runs": results}
            rows.append(row)
            print(f"{case['id']:<9} {case['label']:<6} scores={scores} mean={row['mean']} std={row['std']} "
                  f"in_band={row['in_band']}")
    finally:
        await close_pool()

    stds = [r["std"] for r in rows if r["std"] is not None]
    mean_std = round(statistics.fmean(stds), 2) if stds else None
    max_case_std = max(stds) if stds else None
    in_band = sum(r["in_band"] for r in rows)
    complete = all(len(r["scores"]) == runs for r in rows)
    by_label = {lab: statistics.fmean([r["mean"] for r in rows if r["label"] == lab and r["mean"] is not None] or [0])
                for lab in ("strong", "mid", "weak")}
    ordered = by_label["strong"] > by_label["mid"] > by_label["weak"]
    ok = (complete and mean_std is not None and mean_std <= max_std and in_band == len(rows) and ordered)
    summary = {"prompt": f"interview_score@{PROMPTS['interview_score'].version}", "runs": runs,
               "mean_std": mean_std, "max_case_std": max_case_std, "in_band": f"{in_band}/{len(rows)}",
               "label_means": {k: round(v, 1) for k, v in by_label.items()}, "ordered": ordered,
               "target_max_std": max_std, "complete": complete, "pass": ok}
    print(json.dumps(summary, indent=2))
    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / f"interview_v{PROMPTS['interview_score'].version}_{datetime.now(UTC):%Y%m%d}.json"
    out.write_text(json.dumps({"summary": summary, "cases": rows}, indent=2) + "\n")
    print(f"wrote {out}")
    return 0 if ok else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--max-std", type=float, default=5.0)
    args = ap.parse_args()
    raise SystemExit(asyncio.run(main(args.runs, args.max_std)))
