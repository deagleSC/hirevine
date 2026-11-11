"""The pre-run demo campaign (backend plan §21; Phase 11): a completed campaign with synthetic
candidates, so the deployed app shows a full pipeline (funnel, scores, evidence, feedback, analytics)
without anyone applying. Built on the hand-checked analytics seed, with resumes, cited evidence and
feedback text added, and the job marked `is_demo` so every page about it says the data is synthetic.

    uv run python scripts/seed_demo.py <admin database URL> <org_id>

Run against production only with the owner's go-ahead: it inserts synthetic candidate profiles
(`demo-*@demo.hirevine.invalid`, no sign-in possible) into the organisation.
"""

from __future__ import annotations

import json
import sys
from typing import Any

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import seed_analytics  # noqa: E402

TITLE = "Demo: Backend Engineer (synthetic candidates)"
ROLES = ["payments", "logistics", "health records", "data platform", "e-commerce", "travel bookings",
         "agency websites", "reporting", "marketing site", "support tooling"]


def resume(i: int, score: float | None) -> list[str]:
    strong = (score or 0) >= 60
    area = ROLES[i % len(ROLES)]
    lines = ["[NAME] - Backend Engineer", "[EMAIL], [PHONE]", "Experience"]
    if strong:
        lines += [f"Senior Engineer on the {area} platform (2019-2025)",
                  f"Built Python services for {area}, deployed with Docker on AWS.",
                  "Designed PostgreSQL schemas and tuned slow queries with indexes."]
    else:
        lines += [f"Developer working on {area} (2021-2025)", "Maintained internal tools and scripts.",
                  "Worked with spreadsheets and basic SQL reports."]
    return lines + ["Skills: Python, SQL, Git"]


def seed(conn: psycopg.Connection[Any], org_id: str) -> dict[str, Any]:
    ids = seed_analytics.seed(conn, org_id)
    conn.execute("update jobs set title = %s, is_demo = true, description = %s where id = %s",
                 (TITLE, "A demo campaign with synthetic candidates, run through the full pipeline.", ids["job_id"]))
    for i, (app_id, cand) in enumerate(zip(ids["applications"], ids["candidates"], strict=True)):
        score = seed_analytics.APPS[i][0]
        lines = resume(i, score)
        conn.execute("update profiles set display_name = %s where id = %s", (f"Demo candidate {i + 1}", cand))
        conn.execute("update auth.users set email = %s where id = %s",
                     (f"demo-{i + 1}-{cand[:6]}@demo.hirevine.invalid", cand))
        text = "\n".join(lines)
        conn.execute("insert into resume_texts (application_id, raw_text, redacted_text, redacted_lines, parser)"
                     " values (%s, %s, %s, %s, 'demo')", (app_id, text, text, json.dumps(lines)))
        if score is not None:
            good = score >= 60
            evidence = [{"criterion_id": "c1", "name": "Python", "weight": 5, "must_have": True,
                         "score": 4 if good else 1, "rationale": "Builds Python services." if good else "Only scripts.",
                         "quote": lines[4], "line_no": 5, "verified": True}]
            conn.execute("update stage_results set evidence = %s where application_id = %s and node_id = 'screening'",
                         (json.dumps(evidence), app_id))
        conn.execute("update feedback set ai_draft = coalesce(ai_draft, %s), edited_text = case when edited_text is not"
                     " null then %s else null end where application_id = %s",
                     ("Thank you for applying. Your Python work on production services stood out; to grow further,"
                      " share more about how you test and monitor what you build.",
                      "Thanks for applying. We liked your Python service work and would like to talk about next steps.",
                      app_id))
    return ids


if __name__ == "__main__":
    url, org = sys.argv[1], sys.argv[2]
    with psycopg.connect(url, row_factory=dict_row, autocommit=False) as c:
        out = seed(c, org)
        c.commit()
    print(json.dumps({"campaign_id": out["campaign_id"], "job_id": out["job_id"]}))
