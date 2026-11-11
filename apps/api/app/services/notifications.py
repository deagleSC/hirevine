"""In-app notifications (backend plan §7.3): stage invites (written by `transition()`) and outcome
releases (written by `notify-release`). Read as the user: RLS limits rows to their own."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

from app.core.auth import CurrentUser
from app.core.db import Tx
from app.core.errors import AppError

NotificationType = Literal["stage_invited", "outcome_released"]


class Notification(BaseModel):
    id: UUID
    type: str
    application_id: UUID | None
    job_title: str | None
    stage: str | None = None
    read: bool
    created_at: datetime


class NotificationList(BaseModel):
    items: list[Notification]
    unread: int


def _item(r: dict[str, Any]) -> Notification:
    p = r["payload"] or {}
    return Notification(id=r["id"], type=r["type"], application_id=p.get("application_id"),
                        job_title=p.get("job_title"), stage=p.get("stage"), read=r["read_at"] is not None,
                        created_at=r["created_at"])


async def list_mine(tx: Tx, user: CurrentUser, limit: int = 30) -> NotificationList:
    rows = await tx.fetchall("select * from notifications where user_id = %s order by created_at desc limit %s",
                             (user.user_id, limit))
    unread = await tx.fetchone("select count(*) as n from notifications where user_id = %s and read_at is null",
                               (user.user_id,))
    return NotificationList(items=[_item(dict(r)) for r in rows], unread=int(unread["n"]) if unread else 0)


async def mark_read(tx: Tx, user: CurrentUser, notification_id: UUID) -> Notification:
    row = await tx.fetchone("update notifications set read_at = coalesce(read_at, now()) where id = %s"
                            " and user_id = %s returning *", (notification_id, user.user_id))
    if row is None:
        raise AppError(404, "notification_not_found", "This notification does not exist.")
    return _item(dict(row))


async def mark_all_read(tx: Tx, user: CurrentUser) -> NotificationList:
    await tx.conn.execute("update notifications set read_at = now() where user_id = %s and read_at is null",
                          (user.user_id,))
    return await list_mine(tx, user)
