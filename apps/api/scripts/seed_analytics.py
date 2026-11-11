"""A fixed synthetic campaign for the analytics exit check (backend plan §21, Phase 10). Every number
the dashboards show for it is worked out by hand in EXPECTED, and both the API test and the
Playwright check compare against that.

    uv run python scripts/seed_analytics.py <database> <org_id>    # prints the campaign id

Shape: screening (cutoff 60) → quiz (pass mark 60) → final, 10 applicants, completed on 2026-11-04.
- Screening scores 95, 85, 72, 65, 61 (pass), 58, 50, 40, 33 (fail), and one needs review.
- Quiz for the 5 who passed: 90, 70 (pass), 55 (fail), one in progress, one not started.
- Durations (created → decided): screening 2 h for seven, 4 h for two; quiz 1 h, 3 h, 5 h.
- Feedback: 6 AI drafts, 2 of them edited; 5 rows with both recommendations, 3 agreeing.
- Applications: 4 in the week of 2026-10-26 (the first on 27 Oct 09:00), 6 in the week of 2026-11-02;
  time to shortlist is 27 Oct 09:00 → 4 Nov 12:00 = 195 h.
"""

from __future__ import annotations

import json
import sys
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from psycopg.rows import dict_row

COMPLETED = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)
FIRST = COMPLETED - timedelta(hours=48)  # 2026-11-02 12:00 (week of 11-02); earlier ones are in October
TITLE = "Analytics Seed Role"

WORKFLOW = {
    "schema_version": 1,
    "nodes": [
        {"type": "screening", "id": "screening", "config": {"cutoff": 60, "criteria": [
            {"id": "c1", "name": "Python", "weight": 5, "must_have": True}]}},
        {"type": "quiz", "id": "quiz", "enabled": True, "config": {"pass_mark": 60, "time_limit_min": 20, "questions": [
            {"id": "q1", "prompt": "Q?", "options": ["a", "b", "c"], "answer_index": 0, "explanation": "",
             "difficulty": "easy"}]}},
        {"type": "final", "id": "final", "config": {"notify_on_complete": False, "ranking": "weighted_mean"}},
    ],
    "edges": [["screening", "quiz"], ["quiz", "final"]],
}

# (screening score or None for needs_review, screening hours, quiz (score, status, hours) or None, applied_at)
APPS: list[tuple[float | None, float, tuple[float | None, str, float] | None, datetime]] = [
    (95, 2, (90, "passed", 1), FIRST),
    (85, 2, (70, "passed", 3), FIRST + timedelta(hours=1)),
    (72, 2, (55, "failed", 5), FIRST + timedelta(hours=2)),
    (65, 2, (None, "in_progress", 0), FIRST + timedelta(hours=3)),
    (61, 2, (None, "pending", 0), FIRST + timedelta(hours=4)),
    (58, 2, None, FIRST + timedelta(hours=5)),
    (50, 2, None, datetime(2026, 10, 27, 9, tzinfo=UTC)),
    (40, 4, None, datetime(2026, 10, 28, 9, tzinfo=UTC)),
    (33, 4, None, datetime(2026, 10, 29, 9, tzinfo=UTC)),
    (None, 0, None, datetime(2026, 10, 30, 9, tzinfo=UTC)),
]
# feedback per application index: (ai_draft?, edited?, recommendation, ai_recommendation)
FEEDBACK = {0: (True, False, "yes", "yes"), 1: (True, True, "yes", "strong_yes"), 2: (True, False, "no", "no"),
            3: (True, True, "maybe", "yes"), 4: (True, False, "maybe", "maybe"), 5: (True, False, None, "no")}

EXPECTED: dict[str, Any] = {
    "applications": 10,
    "funnel": [("screening", 10, 5, 4, 1, 0, None), ("quiz", 5, 2, 1, 0, 2, 50.0), ("final", 2, 0, 0, 0, 2, 60.0)],
    "bins": {"screening": [0, 0, 0, 1, 1, 2, 2, 1, 1, 1], "quiz": [0, 0, 0, 0, 0, 1, 0, 1, 0, 1]},
    "cutoff_impact": [(-10, 50, 7), (-5, 55, 6), (0, 60, 5), (5, 65, 4), (10, 70, 3)],
    "median_hours": {"screening": 2.0, "quiz": 3.0},
    "feedback_acceptance": (0.667, 6),
    "recommendation_agreement": (0.6, 5),
    "model_usage": [("model-a", 8), ("model-b", 1)],
    "time_to_shortlist_hours": 195.0,
    "weeks": {"2026-10-26": 4, "2026-11-02": 6},
}


def seed(conn: psycopg.Connection[Any], org_id: str) -> dict[str, Any]:
    """Insert the campaign as a superuser connection. Returns ids."""
    job = conn.execute("insert into jobs (org_id, title, location, seniority, status) values"
                       " (%s, %s, 'Remote', 'mid', 'closed') returning id", (org_id, TITLE)).fetchone()["id"]
    wf = conn.execute("insert into workflows (job_id, version, definition) values (%s, 1, %s) returning id",
                      (job, json.dumps(WORKFLOW))).fetchone()["id"]
    camp = conn.execute("insert into campaigns (job_id, workflow_id, status, completed_at, created_at)"
                        " values (%s, %s, 'completed', %s, %s) returning id",
                        (job, wf, COMPLETED, FIRST - timedelta(days=10))).fetchone()["id"]
    candidates, apps = [], []
    for i, (s_score, s_hours, quiz, applied) in enumerate(APPS):
        uid = uuid.uuid4()
        conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, f"seed{i}-{uid.hex[:6]}@seed.test"))
        conn.execute("insert into profiles (id, role, display_name, adult_confirmed) values"
                     " (%s, 'candidate', %s, true)", (uid, f"Seed Candidate {i + 1}"))
        node = "screening" if s_score is None or s_score < 60 else ("final" if quiz and quiz[1] == "passed" else "quiz")
        app = conn.execute("insert into applications (campaign_id, candidate_id, workflow_id, current_node,"
                           " resume_path, consent_at, created_at) values (%s, %s, %s, %s, %s, %s, %s) returning id",
                           (camp, uid, wf, node, f"{uid}/r.pdf", applied, applied)).fetchone()["id"]
        status = "needs_review" if s_score is None else ("passed" if s_score >= 60 else "failed")
        model = None if s_score is None else ("model-b" if i == 8 else "model-a")
        conn.execute("insert into stage_results (application_id, node_id, status, score, model_id, created_at,"
                     " updated_at) values (%s, 'screening', %s, %s, %s, %s, %s)",
                     (app, status, s_score, model, applied, applied + timedelta(hours=s_hours)))
        if quiz is not None:
            q_score, q_status, q_hours = quiz
            start = applied + timedelta(hours=s_hours)
            conn.execute("insert into stage_results (application_id, node_id, status, score, created_at, updated_at)"
                         " values (%s, 'quiz', %s, %s, %s, %s)",
                         (app, q_status, q_score, start, start + timedelta(hours=q_hours)))
            if q_status == "passed":
                conn.execute("insert into stage_results (application_id, node_id, status)"
                             " values (%s, 'final', 'pending')", (app,))
        draft, edited, rec, ai_rec = FEEDBACK.get(i, (False, False, None, None))
        conn.execute("insert into feedback (application_id, ai_draft, edited_text, recommendation, ai_recommendation,"
                     " released, released_at) values (%s, %s, %s, %s, %s, true, %s)",
                     (app, "Draft." if draft else None, "Edited." if edited else None, rec, ai_rec, COMPLETED))
        candidates.append(str(uid))
        apps.append(str(app))
    return {"campaign_id": str(camp), "job_id": str(job), "candidates": candidates, "applications": apps}


if __name__ == "__main__":
    sys.path.insert(0, __file__.rsplit("/", 1)[0])
    import db_local

    database, org = sys.argv[1], sys.argv[2]
    with psycopg.connect(db_local.admin_url_for(database), row_factory=dict_row, autocommit=True) as c:
        print(seed(c, org)["campaign_id"])
