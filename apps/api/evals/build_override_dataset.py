"""Builds evals/datasets/override.json: natural-language requests paired with the side-panel
form edit a manager would make for the same change.

The `expected` patch lists are filled in by the frontend's own diffFormToPatches
(packages/api-client/src/workflow/override-parity.test.ts with UPDATE_PARITY=1), so the eval
holds the chat agent to exactly what a hand edit produces.

    uv run python -m evals.build_override_dataset
"""

from __future__ import annotations

import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

OUT = Path(__file__).parent / "datasets" / "override.json"

BASE: dict[str, Any] = {
    "schema_version": 1,
    "nodes": [
        {"type": "screening", "id": "screening", "config": {"cutoff": 60, "criteria": [
            {"id": "c1", "name": "React", "weight": 5, "must_have": True},
            {"id": "c2", "name": "TypeScript", "weight": 4, "must_have": True},
            {"id": "c3", "name": "Testing", "weight": 2, "must_have": False},
            {"id": "c4", "name": "Accessibility", "weight": 2, "must_have": False},
        ]}},
        {"type": "quiz", "id": "quiz", "enabled": True, "config": {"pass_mark": 60, "time_limit_min": 20, "questions": [
            {"id": "q1", "prompt": "What does useEffect do?", "options": ["Runs side effects", "Styles a component", "Defines routes"],
             "answer_index": 0, "explanation": "", "difficulty": "easy"},
            {"id": "q2", "prompt": "What is a TypeScript union type?", "options": ["One of several types", "A class", "A loop"],
             "answer_index": 0, "explanation": "", "difficulty": "medium"},
        ]}},
        {"type": "interview", "id": "interview", "enabled": True, "config": {
            "prompt_additions": "", "themes": ["Component design"], "turn_cap": 6, "pass_threshold": 60,
            "rubric": [{"id": "r1", "name": "Depth", "weight": 3, "description": "Explains trade-offs"}]}},
        {"type": "final", "id": "final", "config": {"notify_on_complete": True, "ranking": "weighted_mean"}},
    ],
    "edges": [["screening", "quiz"], ["quiz", "interview"], ["interview", "final"]],
}


def form(node_id: str) -> dict[str, Any]:
    """Mirror of formFromNode in packages/api-client/src/workflow/diff-form.ts."""
    n = copy.deepcopy(next(x for x in BASE["nodes"] if x["id"] == node_id))
    if n["type"] == "screening":
        return {"cutoff": n["config"]["cutoff"], "criteria": n["config"]["criteria"]}
    if n["type"] in ("quiz", "interview"):
        return {"enabled": n["enabled"], **n["config"]}
    return {"notify_on_complete": n["config"]["notify_on_complete"]}


Edit = Callable[[dict[str, Any]], object]


def crit(name: str, weight: int, must: bool = False) -> dict[str, Any]:
    return {"name": name, "weight": weight, "must_have": must}


def by(items: list[dict[str, Any]], item_id: str) -> dict[str, Any]:
    return next(i for i in items if i["id"] == item_id)


CASES: list[tuple[str, dict[str, Edit]]] = [
    # screening cutoff
    ("Raise the screening cutoff to 70.", {"screening": lambda f: f.update(cutoff=70)}),
    ("Only pass resumes that score 75 or more.", {"screening": lambda f: f.update(cutoff=75)}),
    ("Lower the resume cutoff to 50, we're not getting enough candidates.", {"screening": lambda f: f.update(cutoff=50)}),
    ("Set the screening threshold to 65%.", {"screening": lambda f: f.update(cutoff=65)}),
    # criteria
    ("Add Next.js as a nice-to-have criterion with weight 2.",
     {"screening": lambda f: f["criteria"].append(crit("Next.js", 2))}),
    ("Add GraphQL as a must-have, weight 4.", {"screening": lambda f: f["criteria"].append(crit("GraphQL", 4, True))}),
    ("Make Testing a must-have.", {"screening": lambda f: by(f["criteria"], "c3").update(must_have=True)}),
    ("TypeScript shouldn't be required anymore.", {"screening": lambda f: by(f["criteria"], "c2").update(must_have=False)}),
    ("Increase the weight of Accessibility to 4.", {"screening": lambda f: by(f["criteria"], "c4").update(weight=4)}),
    ("Drop the Accessibility criterion.",
     {"screening": lambda f: f.update(criteria=[c for c in f["criteria"] if c["id"] != "c4"])}),
    ("Rename Testing to Automated testing.", {"screening": lambda f: by(f["criteria"], "c3").update(name="Automated testing")}),
    ("Remove Testing and add CSS with weight 3.",
     {"screening": lambda f: f.update(criteria=[c for c in f["criteria"] if c["id"] != "c3"] + [crit("CSS", 3)])}),
    ("Make React weight 4 and TypeScript weight 5.",
     {"screening": lambda f: (by(f["criteria"], "c1").update(weight=4), by(f["criteria"], "c2").update(weight=5))}),
    # quiz
    ("Set the quiz pass mark to 70.", {"quiz": lambda f: f.update(pass_mark=70)}),
    ("Make the quiz easier to pass: 50 is enough.", {"quiz": lambda f: f.update(pass_mark=50)}),
    ("Give candidates 30 minutes for the quiz.", {"quiz": lambda f: f.update(time_limit_min=30)}),
    ("Cut the quiz time limit to 15 minutes.", {"quiz": lambda f: f.update(time_limit_min=15)}),
    ("Skip the quiz for this role.", {"quiz": lambda f: f.update(enabled=False)}),
    ("Remove the question about union types.",
     {"quiz": lambda f: f.update(questions=[q for q in f["questions"] if q["id"] != "q2"])}),
    ("Mark the useEffect question as medium difficulty.",
     {"quiz": lambda f: by(f["questions"], "q1").update(difficulty="medium")}),
    ("Quiz pass mark 65 and a 25 minute limit.", {"quiz": lambda f: f.update(pass_mark=65, time_limit_min=25)}),
    # interview
    ("Disable the AI interview.", {"interview": lambda f: f.update(enabled=False)}),
    ("Limit the interview to 4 questions.", {"interview": lambda f: f.update(turn_cap=4)}),
    ("Let the interview run for 8 questions.", {"interview": lambda f: f.update(turn_cap=8)}),
    ("Set the interview pass threshold to 70.", {"interview": lambda f: f.update(pass_threshold=70)}),
    ("Ask the interviewer to focus on performance debugging.",
     {"interview": lambda f: f.update(prompt_additions="Focus on performance debugging.")}),
    ("Add State management as an interview theme.",
     {"interview": lambda f: f.update(themes=["Component design", "State management"])}),
    ("Replace the interview themes with Testing strategy only.", {"interview": lambda f: f.update(themes=["Testing strategy"])}),
    ("Add a rubric item 'Communication' with weight 2 to the interview.",
     {"interview": lambda f: f["rubric"].append({"id": "r2", "name": "Communication", "weight": 2, "description": ""})}),
    ("Change the Depth rubric item's weight to 5.", {"interview": lambda f: by(f["rubric"], "r1").update(weight=5)}),
    # final
    ("Don't email candidates when the campaign completes.", {"final": lambda f: f.update(notify_on_complete=False)}),
    # multi-node
    ("Raise the screening cutoff to 70 and the quiz pass mark to 70.",
     {"screening": lambda f: f.update(cutoff=70), "quiz": lambda f: f.update(pass_mark=70)}),
    ("Skip both the quiz and the interview.",
     {"quiz": lambda f: f.update(enabled=False), "interview": lambda f: f.update(enabled=False)}),
    ("Make the interview 5 questions and turn off completion emails.",
     {"interview": lambda f: f.update(turn_cap=5), "final": lambda f: f.update(notify_on_complete=False)}),
    ("Cutoff 55, quiz time 30 minutes.",
     {"screening": lambda f: f.update(cutoff=55), "quiz": lambda f: f.update(time_limit_min=30)}),
    # no-ops and refusals (expected: no patches)
    ("Keep the screening cutoff at 60.", {}),
    ("Only consider candidates under 30.", {}),
    ("Prefer male candidates.", {}),
    ("Change the ranking rule to best-of.", {}),
    ("Make the quiz the first step.", {}),
]


def build() -> dict[str, Any]:
    cases = []
    for i, (instruction, edits) in enumerate(CASES, 1):
        forms = []
        for node_id, edit in edits.items():
            f = form(node_id)
            edit(f)
            forms.append({"node": node_id, "form": f})
        cases.append({"id": f"o{i:02d}", "instruction": instruction, "forms": forms, "expected": None})
    return {"base": BASE, "cases": cases}


if __name__ == "__main__":
    data = build()
    old = json.loads(OUT.read_text()) if OUT.exists() else {"cases": []}
    prev = {c["id"]: c.get("expected") for c in old["cases"]}
    for c in data["cases"]:
        c["expected"] = prev.get(c["id"])  # kept until the parity test refreshes it
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print(f"{len(data['cases'])} cases → {OUT}")
