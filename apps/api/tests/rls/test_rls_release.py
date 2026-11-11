"""Phase 8 exit check (backend plan §16): a candidate cannot see outcomes or feedback before release.

Rows exist the whole time; only the campaign's status decides what the candidate's role can read.
Checked directly against Postgres with the candidate's claims, so no API code is involved.
"""

from __future__ import annotations

import uuid

import pytest
from psycopg.types.json import Jsonb

from tests.conftest import admin, as_claims, candidate_claims, create_auth_user, create_profile


@pytest.fixture
def scored_application(migrated_db):
    mgr = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:6]}@rel.test"), "manager", "M", "Rel Org")
    cand = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:6]}@rel.test"), "candidate", "C")
    other = create_profile(create_auth_user(migrated_db, f"{uuid.uuid4().hex[:6]}@rel.test"), "candidate", "O")
    with admin(migrated_db) as conn:
        job = conn.execute("insert into jobs (org_id, title, status) values (%s, 'Release Test', 'published')"
                           " returning id", (mgr["org_id"],)).fetchone()["id"]
        wf = conn.execute("insert into workflows (job_id, version, definition) values (%s, 1, '{}') returning id",
                          (job,)).fetchone()["id"]
        camp = conn.execute("insert into campaigns (job_id, workflow_id, status) values (%s, %s, 'open') returning id",
                            (job, wf)).fetchone()["id"]
        app = conn.execute("insert into applications (campaign_id, candidate_id, workflow_id, current_node)"
                           " values (%s, %s, %s, 'final') returning id", (camp, cand["id"], wf)).fetchone()["id"]
        conn.execute("insert into stage_results (application_id, node_id, status, score, evidence) values"
                     " (%s, 'screening', 'passed', 82, %s)", (app, Jsonb([{"criterion_id": "c1"}])))
        conn.execute("insert into feedback (application_id, ai_draft, ai_recommendation, edited_text, recommendation)"
                     " values (%s, 'Draft', 'yes', 'Edited', 'strong_yes')", (app,))
    return {"campaign": camp, "app": app, "cand": cand, "other": other}


def visible(claims, app_id) -> tuple[int, int]:
    with as_claims(claims) as conn:
        s = conn.execute("select count(*) n from stage_results where application_id = %s", (app_id,)).fetchone()["n"]
        f = conn.execute("select count(*) n from feedback where application_id = %s", (app_id,)).fetchone()["n"]
    return s, f


def test_outcomes_and_feedback_are_hidden_until_release(migrated_db, scored_application):
    a = scored_application
    # Before release: nothing, even though both rows exist and are the candidate's own.
    assert visible(candidate_claims(a["cand"]), a["app"]) == (0, 0)

    # Completing alone (campaign status) opens stage results; feedback also needs `released`.
    with admin(migrated_db) as conn:
        conn.execute("update campaigns set status = 'completed', completed_at = now() where id = %s", (a["campaign"],))
    assert visible(candidate_claims(a["cand"]), a["app"]) == (1, 0)
    with admin(migrated_db) as conn:
        conn.execute("update feedback set released = true, released_at = now() where application_id = %s", (a["app"],))
    assert visible(candidate_claims(a["cand"]), a["app"]) == (1, 1)

    # Never someone else's.
    assert visible(candidate_claims(a["other"]), a["app"]) == (0, 0)


def test_candidates_cannot_write_or_release_feedback(migrated_db, scored_application):
    a = scored_application
    with as_claims(candidate_claims(a["cand"])) as conn:
        r = conn.execute("update feedback set released = true, released_at = now() where application_id = %s",
                         (a["app"],))
        assert r.rowcount == 0
        r = conn.execute("update stage_results set score = 100 where application_id = %s", (a["app"],))
        assert r.rowcount == 0
