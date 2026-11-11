"""Phase 10 exit check (backend plan §21): dashboard numbers match hand-computed values on a fixed
synthetic campaign (scripts/seed_analytics.py, EXPECTED). Also: RLS scopes analytics to the caller,
and candidates see scores only for released outcomes."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from app.services import analytics as svc
from tests.api.test_applications import published_job
from tests.api.test_auth_and_profile import auth, client, make_manager  # noqa: F401
from tests.conftest import create_auth_user

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import seed_analytics as seed  # noqa: E402

E = seed.EXPECTED


def seeded(db_url: str, org_id: str) -> dict:
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=True) as conn:
        return seed.seed(conn, org_id)


async def test_campaign_dashboard_matches_hand_computed_values(client, migrated_db):  # noqa: F811
    mgr = create_auth_user(migrated_db, "an-mgr@an.test")
    me = await make_manager(client, mgr, org="Analytics Org")
    ids = seeded(migrated_db, me["org_id"])
    d = (await client.get(f"/v1/manager/analytics/campaigns/{ids['campaign_id']}", headers=auth(mgr))).json()

    assert d["applications"] == E["applications"]
    assert [(f["node_id"], f["reached"], f["passed"], f["failed"], f["needs_review"], f["active"], f["drop_off_pct"])
            for f in d["funnel"]] == E["funnel"]
    assert {x["node_id"]: x["bins"] for x in d["distributions"]} == E["bins"]
    assert [(r["delta"], r["cutoff"], r["passing"]) for r in d["cutoff_impact"]] == E["cutoff_impact"]
    assert {t["node_id"]: t["median_hours"] for t in d["time_per_stage"]} == E["median_hours"]
    assert (d["feedback_acceptance"]["share"], d["feedback_acceptance"]["n"]) == E["feedback_acceptance"]
    assert (d["recommendation_agreement"]["share"], d["recommendation_agreement"]["n"]) == E["recommendation_agreement"]
    assert [(m["model_id"], m["stages_scored"]) for m in d["model_usage"]] == E["model_usage"]


async def test_overview_and_isolation(client, migrated_db):  # noqa: F811
    mgr = create_auth_user(migrated_db, "ov-mgr@an.test")
    me = await make_manager(client, mgr, org="Overview Org")
    ids = seeded(migrated_db, me["org_id"])
    from app.core.auth import CurrentUser
    from app.core.db import transaction

    user = CurrentUser(user_id=mgr, email=None, role="manager", org_id=me["org_id"], display_name="M")
    async with transaction(user.claims()) as tx:
        o = await svc.overview(tx, user, today=date(2026, 11, 11))
    assert (o.applications, o.campaigns_completed, o.open_jobs) == (10, 1, 0)
    weeks = {b.start.isoformat(): b.count for b in o.applications_per_week}
    assert len(weeks) == 12 and {k: v for k, v in weeks.items() if v} == E["weeks"]
    assert [b.count for b in o.completed_per_month][-1] == 1
    assert o.time_to_shortlist_hours == E["time_to_shortlist_hours"]
    assert (o.feedback_acceptance.share, o.recommendation_agreement.share) == (0.667, 0.6)

    # Another organisation's manager sees none of it, and cannot open the campaign.
    other = await published_job(client, migrated_db)
    r = await client.get(f"/v1/manager/analytics/campaigns/{ids['campaign_id']}", headers=auth(other["manager"]))
    assert r.status_code == 404
    o2 = (await client.get("/v1/manager/analytics/overview", headers=auth(other["manager"]))).json()
    assert o2["applications"] == 0 and o2["campaigns_completed"] == 0


async def test_candidate_analytics_only_shows_released_scores(client, migrated_db):  # noqa: F811
    mgr = create_auth_user(migrated_db, "cd-mgr@an.test")
    me = await make_manager(client, mgr, org="Cand Org")
    ids = seeded(migrated_db, me["org_id"])
    cand = ids["candidates"][2]  # screening 72, quiz 55 (failed), released
    a = (await client.get("/v1/candidate/analytics", headers=auth(cand))).json()
    assert a["applications"] == 1
    [p] = a["progress"]
    assert (p["status"], p["reached"], p["total"]) == ("outcome_released", 2, 3)
    [s] = a["scores"]
    assert (s["screening"], s["quiz"], s["interview"]) == (72.0, 55.0, None)
    assert a["median_days_to_outcome"] == round((seed.COMPLETED - seed.APPS[2][3]).total_seconds() / 86400, 1)
    assert a["stage_completion"] == {"share": 0.0, "n": 1}  # invited to the quiz; no attempt recorded

    # Unreleased: the same candidate in an open campaign gets no scores for it.
    with psycopg.connect(migrated_db, row_factory=dict_row, autocommit=True) as conn:
        conn.execute("update campaigns set status = 'open', completed_at = null where id = %s", (ids["campaign_id"],))
        conn.execute("update feedback set released = false, released_at = null"
                     " where application_id = %s", (ids["applications"][2],))
    a = (await client.get("/v1/candidate/analytics", headers=auth(cand))).json()
    assert a["scores"] == [] and a["median_days_to_outcome"] is None
    assert a["progress"][0]["status"] != "outcome_released"
