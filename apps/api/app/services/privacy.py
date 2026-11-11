"""Privacy requests (backend plan §18): export and deletion for candidates.

- **Export** is returned straight away as one JSON document (the data per candidate is small), with a
  24-hour signed link to each resume file. Release rules still apply: scores, stage results and
  feedback are included only for applications whose outcome has been released.
- **Deletion** is queued as `data-delete`: it removes the resume files and resume embeddings (which
  have no foreign key), anonymises the user in the event log, then deletes the auth user. The
  database cascades from there: profile, applications, consents, answers, resume text, stage
  results, quiz attempts, interview transcripts, feedback, notifications and data requests.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, Literal, Protocol
from uuid import UUID

import httpx
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.core.auth import CurrentUser
from app.core.config import get_settings
from app.core.db import Tx, system_claims, transaction
from app.core.errors import AppError
from app.jobs.dispatcher import dispatcher
from app.jobs.runs import JobRefs
from app.services.storage import StorageError, get_storage

log = logging.getLogger("hirevine.privacy")


class DeleteIn(BaseModel):
    confirm: str


class DeleteQueued(BaseModel):
    status: Literal["queued"] = "queued"
    request_id: UUID


def _jsonable(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_jsonable(x) for x in v]
    if v is not None and type(v).__name__ == "Decimal":
        return float(v)
    return v


async def export(tx: Tx, user: CurrentUser) -> dict[str, Any]:
    async with tx.as_system():
        profile = await tx.fetchone("select id, role, display_name, adult_confirmed, created_at from profiles"
                                    " where id = %s", (user.user_id,))
        apps = await tx.fetchall(
            """
            select a.id, a.created_at, a.resume_path, a.current_node, j.title as job_title,
                   c.status = 'completed' and coalesce(f.released, false) as released
            from applications a join campaigns c on c.id = a.campaign_id join jobs j on j.id = c.job_id
            left join feedback f on f.application_id = a.id
            where a.candidate_id = %s order by a.created_at
            """, (user.user_id,))
        out_apps = []
        storage = get_storage()
        for a in apps:
            aid = a["id"]
            item: dict[str, Any] = {"id": aid, "job_title": a["job_title"], "applied_at": a["created_at"],
                                    "outcome_released": a["released"]}
            try:
                item["resume_download_url"] = await storage.signed_download(a["resume_path"])
                item["resume_download_expires_in_hours"] = 24
            except StorageError:
                item["resume_download_url"] = None
            item["consents"] = await tx.fetchall(
                "select text_version, providers, created_at from consents where application_id = %s", (aid,))
            item["screening_answers"] = await tx.fetchall(
                "select question_id, answer from screening_answers where application_id = %s", (aid,))
            resume = await tx.fetchone("select redacted_lines from resume_texts where application_id = %s", (aid,))
            item["resume_text_as_processed"] = resume["redacted_lines"] if resume else None
            quiz = await tx.fetchone("select answers, started_at, submitted_at, score from quiz_attempts"
                                     " where application_id = %s", (aid,))
            if quiz is not None:
                q = dict(quiz)
                if not a["released"]:
                    q.pop("score")
                item["quiz"] = q
            iv = await tx.fetchone("select transcript, started_at, finished_at from interview_sessions"
                                   " where application_id = %s", (aid,))
            item["interview"] = dict(iv) if iv else None
            if a["released"]:
                item["stage_results"] = await tx.fetchall(
                    "select node_id, status, score from stage_results where application_id = %s", (aid,))
                fb = await tx.fetchone("select coalesce(edited_text, ai_draft) as text, released_at from feedback"
                                       " where application_id = %s", (aid,))
                item["feedback"] = dict(fb) if fb else None
            out_apps.append(item)
        notes = await tx.fetchall("select type, payload, read_at, created_at from notifications where user_id = %s"
                                  " order by created_at", (user.user_id,))
        requests = await tx.fetchall("select kind, status, created_at, completed_at from data_requests"
                                     " where user_id = %s order by created_at", (user.user_id,))
        await tx.conn.execute(
            "insert into data_requests (user_id, kind, status, completed_at) values (%s, 'export', 'done', now())",
            (user.user_id,))
        await tx.conn.execute(
            "insert into events (actor_id, type, entity, entity_id) values (%s, 'privacy.exported', 'profile', %s)",
            (user.user_id, user.user_id))
    data = {
        "exported_at": datetime.now(UTC),
        "account": {**dict(profile or {}), "email": user.email},
        "applications": out_apps,
        "notifications": notes,
        "data_requests": requests,
    }
    return dict(_jsonable(data))


async def request_delete(tx: Tx, user: CurrentUser, body: DeleteIn) -> DeleteQueued:
    if body.confirm.strip().upper() != "DELETE":
        raise AppError(422, "confirm_mismatch", 'Type DELETE to confirm.')
    async with tx.as_system():
        busy = await tx.fetchone("select id from data_requests where user_id = %s and kind = 'delete'"
                                 " and status in ('queued', 'running')", (user.user_id,))
        if busy:
            return DeleteQueued(request_id=busy["id"])
        row = await tx.fetchone("insert into data_requests (user_id, kind) values (%s, 'delete') returning id",
                                (user.user_id,))
        assert row is not None
    await dispatcher.enqueue(tx, "data_delete", JobRefs(), {"user_id": str(user.user_id), "request_id": str(row["id"])})
    return DeleteQueued(request_id=row["id"])


# ------------------------------------------------------------------ data-delete job step

class AuthAdmin(Protocol):
    async def delete_user(self, user_id: str) -> None: ...


class SupabaseAuthAdmin:
    def __init__(self, base_url: str, service_key: str) -> None:
        self.url = base_url.rstrip("/") + "/auth/v1/admin/users/"
        self.headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}

    async def delete_user(self, user_id: str) -> None:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.delete(self.url + user_id, headers=self.headers)
        if r.status_code not in (200, 204, 404):  # 404: already gone (a retried step)
            raise RuntimeError(f"auth delete failed: {r.status_code}")


class LocalAuthAdmin:
    """Dev/test: the local auth.users table is a stand-in; deleting the profile cascades the same way."""

    async def delete_user(self, user_id: str) -> None:
        async with transaction(system_claims()) as tx:
            await tx.conn.execute("delete from profiles where id = %s", (user_id,))


def get_auth_admin() -> AuthAdmin:
    s = get_settings()
    if s.supabase_url and s.supabase_service_key:
        return SupabaseAuthAdmin(s.supabase_url, s.supabase_service_key)
    if not s.is_dev:
        raise RuntimeError("SUPABASE_SERVICE_KEY is required to delete accounts outside dev/test")
    return LocalAuthAdmin()


async def delete_account(run_id: str) -> str:
    """Idempotent: each part can run again safely if the step is retried."""
    async with transaction(system_claims()) as tx:
        run = await tx.fetchone("select params from job_runs where id = %s", (run_id,))
        user_id = str((run or {}).get("params", {}).get("user_id") or "")
        if not user_id:
            return "no_user"
        await tx.conn.execute("update data_requests set status = 'running' where user_id = %s and kind = 'delete'"
                              " and status = 'queued'", (user_id,))
        apps = await tx.fetchall("select id, resume_path from applications where candidate_id = %s", (user_id,))
    storage = get_storage()
    for a in apps:
        try:
            await storage.delete(a["resume_path"])
        except StorageError as exc:  # a missing file is fine; anything else retries the step
            if "404" not in str(exc):
                raise
    async with transaction(system_claims()) as tx:
        ids = [a["id"] for a in apps]
        await tx.conn.execute("delete from embeddings where kind = 'resume_chunk' and parent_id = any(%s)", (ids,))
        await tx.fetchone("select app.anonymize_actor(%s)", (user_id,))
        await tx.conn.execute(
            "insert into events (type, entity, payload) values ('privacy.deleted', 'profile', %s)",
            (Jsonb({"applications": len(ids)}),))
    await get_auth_admin().delete_user(user_id)
    async with transaction(system_claims()) as tx:  # the cascade also removed any leftover profile rows
        await tx.conn.execute("delete from profiles where id = %s", (user_id,))
    return "deleted"
