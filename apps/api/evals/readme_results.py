"""Write the README's results table from the latest eval reports (backend plan §19.2: "the README
table is generated from these files").

    uv run python -m evals.readme_results     # rewrites the block between the RESULTS markers

Numbers are only ever copied from evals/reports/*.json; nothing here is typed in by hand.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

REPORTS = Path(__file__).parent / "reports"
README = Path(__file__).resolve().parents[3] / "README.md"
START, END = "<!-- RESULTS:START -->", "<!-- RESULTS:END -->"


def latest(prefix: str) -> tuple[str, dict[str, Any]]:
    files = sorted(REPORTS.glob(f"{prefix}_*.json"), key=lambda p: (_version(p), p.name))
    if not files:
        raise SystemExit(f"no {prefix} report in {REPORTS}")
    return files[-1].name, json.loads(files[-1].read_text())


def _version(p: Path) -> int:
    m = re.search(r"_v(\d+)_", p.name)
    return int(m.group(1)) if m else 0


def pct(x: float | None) -> str:
    return "—" if x is None else f"{round(100 * x)}%"


def table() -> str:
    rows: list[tuple[str, str, str, str]] = []
    f, r = latest("screening")
    s = r["summary"]
    rows.append(("Resume screening (12 labelled resumes, 3 bands)",
                 f"Rank agreement (Spearman) **{s['spearman']}**; precision@4 **{pct(s['precision_at_4'])}**; "
                 f"quotes found on the first try **{pct(s['citation_validity_first_try'])}**",
                 f"Strong ≥ {s['min_strong']}, mid ≤ {s['max_mid']}, weak ≤ {s['max_weak']}", f))
    f, r = latest("bias")
    b = r["summary"]
    rows.append(("Bias audit (6 resumes × 3 name swaps in 2 layouts + gendered signals)",
                 f"Variants over tolerance **{pct(b['share_over_tolerance'])}** of {b['variants']}; "
                 f"mean absolute change **{b['mean_abs_delta']}** pts, max **{b['max_abs_delta']}**",
                 f"Tolerance {b['tolerance']} pts from re-run noise; "
                 f"names reaching the model: {b['names_reaching_model']}",
                 f))
    f, r = latest("injection")
    i = r["summary"]
    rows.append(("Prompt injection (4 resumes × 3 planted instructions)",
                 f"Scores changed **{pct(i['share_score_changed'])}**; flagged **{pct(i['share_flagged'])}**",
                 f"Largest increase {i['max_increase']} pts", f))
    f, r = latest("interview")
    v = r["summary"]
    rows.append(("Interview scoring (6 labelled transcripts × 3 runs)",
                 f"Run-to-run std dev **{v['mean_std']}** pts (max {v['max_case_std']}); "
                 f"labels in band **{v['in_band']}**",
                 f"Target ≤ {v['target_max_std']} pts; mean score by label: "
                 + ", ".join(f"{k} {m:g}" for k, m in (v.get("label_means") or {}).items()), f))
    f, r = latest("override")
    rows.append((f"Workflow editing by chat ({r['cases']} requests)",
                 f"Same patches as the hand edit **{pct(r['exact_match_rate'])}** ({r['passed']}/{r['cases']})",
                 f"Target {pct(r['target'])}", f))
    head = "| Eval | Result | Notes | Report |\n| --- | --- | --- | --- |\n"
    body = "\n".join(f"| {a} | {b} | {c} | `evals/reports/{d}` |" for a, b, c, d in rows)
    return head + body


def main() -> None:
    text = README.read_text()
    if START not in text or END not in text:
        raise SystemExit("README has no RESULTS markers")
    new = re.sub(re.escape(START) + r".*?" + re.escape(END), f"{START}\n{table()}\n{END}", text, flags=re.S)
    README.write_text(new)
    print(table())


if __name__ == "__main__":
    main()
