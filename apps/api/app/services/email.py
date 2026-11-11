"""Email notifications through Resend (backend plan §18; pilot). Off unless RESEND_API_KEY is set.

Every in-app notification (an invitation to the quiz or interview, a released outcome) is emailed
once to the candidate: `send_pending` picks notifications with `emailed_at is null` from the last two
days, sends, and stamps them, so a retried step never sends twice and switching email on later does
not mail an old backlog. Emails link back to the app and never contain scores or feedback text.
Addresses come from Supabase Auth through the admin API (the API's database role cannot read them).
"""

from __future__ import annotations

import html
import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Protocol

import httpx

from app.core.config import get_settings
from app.core.db import system_claims, transaction

log = logging.getLogger("hirevine.email")
BATCH = 50
WINDOW = timedelta(days=2)


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str
    html: str


class Mailer(Protocol):
    async def send(self, email: Email, *, idempotency_key: str) -> None: ...


class ResendMailer:
    def __init__(self, api_key: str, sender: str) -> None:
        self.api_key, self.sender = api_key, sender

    async def send(self, email: Email, *, idempotency_key: str) -> None:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self.api_key}", "Idempotency-Key": idempotency_key},
                json={"from": self.sender, "to": [email.to], "subject": email.subject, "text": email.text,
                      "html": email.html},
            )
        if r.status_code >= 400:
            raise RuntimeError(f"Resend returned {r.status_code}: {r.text[:200]}")


def get_mailer() -> Mailer | None:
    s = get_settings()
    return ResendMailer(s.resend_api_key, s.email_from) if s.resend_api_key else None


async def candidate_email(user_id: str) -> str | None:
    """The address from Supabase Auth (admin API, service key). None in dev or when unknown."""
    s = get_settings()
    if not (s.supabase_url and s.supabase_service_key):
        return None
    async with httpx.AsyncClient(timeout=10) as http:
        r = await http.get(f"{s.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
                           headers={"Authorization": f"Bearer {s.supabase_service_key}",
                                    "apikey": s.supabase_service_key})
    if r.status_code != 200:
        return None
    email = r.json().get("email")
    return email if email and not email.endswith(".invalid") else None


STAGE = {"quiz": "skills quiz", "interview": "AI interview"}


def render(kind: str, payload: dict[str, Any], app_url: str) -> tuple[str, str, str] | None:
    """(subject, text, html) for a notification, or None for kinds that are not emailed."""
    job = str(payload.get("job_title") or "your application")
    app_id = payload.get("application_id")
    if kind == "stage_invited":
        stage = STAGE.get(str(payload.get("stage")), "next step")
        url = f"{app_url}/applications/{app_id}/{payload.get('stage')}"
        subject = f"Your next step for {job}: the {stage}"
        lead = f"You're invited to the {stage} for {job}."
        detail = "It's timed once you start, so open it when you have a quiet moment."
        cta = f"Open the {stage}"
    elif kind == "outcome_released":
        url = f"{app_url}/applications/{app_id}/feedback"
        subject = f"The outcome for {job} is ready"
        lead = f"The hiring team has finished reviewing applications for {job}."
        detail = "Your outcome and personal feedback are ready to read."
        cta = "See your outcome and feedback"
    else:
        return None
    footer = "You're receiving this because you applied through Hirevine. Manage your data from your Account page."
    text = f"{lead}\n\n{detail}\n\n{cta}: {url}\n\n— Hirevine\n\n{footer}"
    e = html.escape
    body = (
        '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;'
        'color:#111">'
        f"<p>{e(lead)}</p><p>{e(detail)}</p>"
        f'<p><a href="{e(url)}" style="display:inline-block;background:#0b65d8;color:#fff;padding:10px 16px;'
        f'border-radius:6px;text-decoration:none">{e(cta)}</a></p>'
        f'<p style="color:#555">— Hirevine</p><p style="color:#777;font-size:12px">{e(footer)}</p></div>'
    )
    return subject, text, body


async def send_pending(limit: int = BATCH) -> int:
    """Email notifications not yet emailed (last two days). Returns how many were sent."""
    mailer = get_mailer()
    if mailer is None:
        return 0
    s = get_settings()
    async with transaction(system_claims()) as tx:
        rows = await tx.fetchall(
            "select id, user_id, type, payload from notifications"
            " where emailed_at is null and created_at > now() - %s order by created_at limit %s", (WINDOW, limit))
    sent = 0
    for r in rows:
        content = render(r["type"], r["payload"] or {}, s.candidate_app_url.rstrip("/"))
        to = await candidate_email(str(r["user_id"])) if content else None
        if content and to:
            subject, text, body = content
            # Resend's idempotency key stops a duplicate if this step is retried after sending.
            await mailer.send(Email(to=to, subject=subject, text=text, html=body),
                              idempotency_key=f"notification-{r['id']}")
            sent += 1
        # Stamped even when skipped (no address, a kind we don't email): never retried forever.
        async with transaction(system_claims()) as tx:
            await tx.conn.execute("update notifications set emailed_at = now() where id = %s", (r["id"],))
    return sent


async def queue(tx: Any) -> None:
    """Ask for a send after this transaction commits (one queued run is enough; it takes all pending)."""
    if get_settings().resend_api_key == "":
        return
    from app.jobs.dispatcher import dispatcher
    from app.jobs.runs import JobRefs

    busy = await tx.fetchone("select 1 from job_runs where type = 'send_emails' and status = 'queued'")
    if not busy:
        await dispatcher.enqueue(tx, "send_emails", JobRefs())
