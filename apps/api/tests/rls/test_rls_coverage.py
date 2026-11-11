"""RLS review (Phase 11): every table the API role can reach has row-level security switched on and
at least one policy, so a new table cannot ship readable by everyone. The few tables without
policies on purpose are listed with the reason."""

from __future__ import annotations

from tests.conftest import admin

# Tables the API role uses only through security-definer functions or not at all.
NO_POLICY_OK: dict[str, str] = {}


def test_every_api_table_has_rls_and_a_policy(migrated_db):
    with admin(migrated_db) as conn:
        rows = conn.execute(
            """
            select c.relname as table, c.relrowsecurity as rls,
                   (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
                   has_table_privilege('hirevine_api', c.oid, 'select') as api_can_select
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
            order by c.relname
            """).fetchall()
    reachable = [r for r in rows if r["api_can_select"]]
    assert reachable, "expected the API role to reach some tables"
    no_rls = [r["table"] for r in reachable if not r["rls"]]
    no_policy = [r["table"] for r in reachable if r["policies"] == 0 and r["table"] not in NO_POLICY_OK]
    assert no_rls == [], f"RLS is off on: {no_rls}"
    assert no_policy == [], f"No policies on: {no_policy}"


def test_unauthenticated_claims_see_nothing(migrated_db):
    """With no claims at all (a bug that forgot to set them), every RLS table reads as empty."""
    from tests.conftest import as_claims

    with admin(migrated_db) as conn:
        tables = [r["relname"] for r in conn.execute(
            "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace"
            " where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity"
            " and has_table_privilege('hirevine_api', c.oid, 'select')").fetchall()]
        populated = {t for t in tables if conn.execute(f"select exists (select 1 from {t}) e").fetchone()["e"]}
    with as_claims(None) as conn:
        leaking = [t for t in populated
                   if t not in ("jobs", "campaigns", "job_share_links", "skill_aliases")  # public job board reads
                   and conn.execute(f"select exists (select 1 from {t}) e").fetchone()["e"]]
    assert leaking == [], f"Readable without claims: {leaking}"
