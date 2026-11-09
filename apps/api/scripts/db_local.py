"""Create a local Postgres database and apply the Supabase migrations to it.

Usage:
    uv run python scripts/db_local.py reset hirevine_dev     # drop, create, migrate
    uv run python scripts/db_local.py reset hirevine_test

Connects as the local superuser (ADMIN_DATABASE_URL, default: postgresql:///postgres).
Also gives the hirevine_api role a local password (API_DB_PASSWORD, default: dev).
Local only: Supabase is migrated with the Supabase CLI.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg
from psycopg import sql

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
BOOTSTRAP = REPO_ROOT / "supabase" / "tests" / "local_bootstrap.sql"

ADMIN_URL = os.environ.get("ADMIN_DATABASE_URL", "postgresql:///postgres")
API_PASSWORD = os.environ.get("API_DB_PASSWORD", "dev")


def migration_files() -> list[Path]:
    return sorted(MIGRATIONS.glob("*.sql"))


def reset(db_name: str) -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(
            "select pg_terminate_backend(pid) from pg_stat_activity "
            "where datname = %s and pid <> pg_backend_pid()",
            (db_name,),
        )
        conn.execute(sql.SQL("drop database if exists {}").format(sql.Identifier(db_name)))
        conn.execute(sql.SQL("create database {}").format(sql.Identifier(db_name)))

    db_url = admin_url_for(db_name)
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute(BOOTSTRAP.read_text())
        for path in migration_files():
            try:
                conn.execute(path.read_text())
            except psycopg.Error as exc:
                raise SystemExit(f"migration failed: {path.name}\n{exc}") from exc
        conn.execute(
            sql.SQL("alter role hirevine_api with login password {}").format(
                sql.Literal(API_PASSWORD)
            )
        )
        conn.execute(sql.SQL("grant connect on database {} to hirevine_api").format(sql.Identifier(db_name)))


def admin_url_for(db_name: str) -> str:
    base = ADMIN_URL.rsplit("/", 1)[0]
    return f"{base}/{db_name}"


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "reset":
        raise SystemExit(__doc__)
    reset(sys.argv[2])
    print(f"{sys.argv[2]}: applied {len(migration_files())} migrations")
