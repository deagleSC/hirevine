"""Apply supabase/migrations to a hosted Supabase database.

Reads supabase/.env.migrate (gitignored):
    MIGRATE_DATABASE_URL=postgresql://postgres.<ref>:<db-password>@<session-pooler-host>:5432/postgres
    API_DB_PASSWORD=<a new strong password for the hirevine_api role>

Usage:
    uv run python scripts/migrate_remote.py            # show pending migrations
    uv run python scripts/migrate_remote.py --apply    # apply them, then set the API role's password

Applied versions are recorded in supabase_migrations.schema_migrations, the table the
Supabase CLI uses, so `supabase db push` stays compatible later. Each migration runs in
its own transaction.
"""

from __future__ import annotations

import sys
from pathlib import Path

import psycopg
from psycopg import sql

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
ENV_FILE = REPO_ROOT / "supabase" / ".env.migrate"


def read_env() -> dict[str, str]:
    if not ENV_FILE.exists():
        raise SystemExit(f"missing {ENV_FILE}; see the docstring at the top of this script")
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    for required in ("MIGRATE_DATABASE_URL", "API_DB_PASSWORD"):
        if not env.get(required):
            raise SystemExit(f"{ENV_FILE.name}: {required} is empty")
    if len(env["API_DB_PASSWORD"]) < 16:
        raise SystemExit("API_DB_PASSWORD must be at least 16 characters")
    return env


def main(apply: bool) -> None:
    env = read_env()
    files = sorted(MIGRATIONS.glob("*.sql"))
    with psycopg.connect(env["MIGRATE_DATABASE_URL"], autocommit=True) as conn:
        conn.execute("create schema if not exists supabase_migrations")
        conn.execute(
            "create table if not exists supabase_migrations.schema_migrations "
            "(version text primary key, statements text[], name text)"
        )
        applied = {r[0] for r in conn.execute("select version from supabase_migrations.schema_migrations")}
        pending = [f for f in files if f.name.split("_", 1)[0] not in applied]
        print(f"{len(applied)} applied, {len(pending)} pending")
        for f in pending:
            print(f"  pending: {f.name}")
        if not apply:
            return
        for f in pending:
            version, name = f.name.removesuffix(".sql").split("_", 1)
            with conn.transaction():
                conn.execute(f.read_text())
                conn.execute(
                    "insert into supabase_migrations.schema_migrations (version, name) values (%s, %s)",
                    (version, name),
                )
            print(f"  applied: {f.name}")
        conn.execute(
            sql.SQL("alter role hirevine_api with login password {}").format(sql.Literal(env["API_DB_PASSWORD"]))
        )
        print("hirevine_api: login enabled, password set")
        rows = conn.execute(
            "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace "
            "where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity"
        ).fetchall()
        if rows:
            raise SystemExit(f"RLS is OFF on: {', '.join(r[0] for r in rows)}")
        print("RLS is enabled on every public table")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv)
