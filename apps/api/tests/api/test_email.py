"""Email notifications through Resend: each notification is emailed once, with a link and no scores."""

from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.jobs import dispatcher as dispatcher_mod
from app.jobs.dispatcher import InngestDispatcher
from app.services import email
from tests.api.test_applications import llm, storage  # noqa: F401
from tests.api.test_auth_and_profile import client  # noqa: F401
from tests.conftest import admin
from tests.jobs.test_dispatcher import FakeInngest


class FakeMailer:
    def __init__(self) -> None:
        self.sent: list[tuple[email.Email, str]] = []

    async def send(self, mail: email.Email, *, idempotency_key: str) -> None:
        self.sent.append((mail, idempotency_key))


@pytest.fixture
def mail(monkeypatch) -> FakeMailer:
    fake = FakeMailer()
    s = get_settings()
    monkeypatch.setattr(s, "resend_api_key", "re_test")
    monkeypatch.setattr(s, "candidate_app_url", "https://candidates.example/")
    monkeypatch.setattr(email, "get_mailer", lambda: fake)

    async def address(user_id: str) -> str | None:
        return f"{user_id[:8]}@candidate.test"

    monkeypatch.setattr(email, "candidate_email", address)
    return fake


async def test_an_invitation_is_emailed_once(client, migrated_db, storage, llm, mail, monkeypatch):  # noqa: F811
    from tests.api.test_quiz import at_quiz, inngest  # noqa: F401

    events = FakeInngest()
    monkeypatch.setattr(dispatcher_mod, "dispatcher", InngestDispatcher(events))  # type: ignore[arg-type]
    from app.services import applications as app_svc
    from app.services import quiz as quiz_svc

    monkeypatch.setattr(app_svc, "dispatcher", InngestDispatcher(FakeInngest()))  # type: ignore[arg-type]
    monkeypatch.setattr(quiz_svc, "dispatcher", InngestDispatcher(FakeInngest()))  # type: ignore[arg-type]
    with admin(migrated_db) as conn:
        conn.execute("update notifications set emailed_at = now()")  # isolate from earlier tests
    job, cand, app_id = await at_quiz(client, migrated_db, storage, llm)

    assert [e.name for e in events.sent] == ["notifications/created"]  # queued by the stage transition
    assert await email.send_pending() == 1
    [(sent, key)] = mail.sent
    assert sent.to == f"{str(cand)[:8]}@candidate.test" and key.startswith("notification-")
    assert sent.subject == "Your next step for Backend Engineer: the skills quiz"
    assert f"https://candidates.example/applications/{app_id}/quiz" in sent.text
    assert "score" not in sent.text.lower() and "<a href=" in sent.html
    assert await email.send_pending() == 0  # stamped: never sent twice
    assert len(mail.sent) == 1


async def test_release_email_and_skips(migrated_db, mail):
    from tests.conftest import create_auth_user, create_profile

    cand = create_profile(create_auth_user(migrated_db, "rel-mail@candidate.test"), "candidate", "Rel")
    with admin(migrated_db) as conn:
        conn.execute("update notifications set emailed_at = now()")
        conn.execute("insert into notifications (user_id, type, payload) values (%s, 'outcome_released', %s)",
                     (cand["id"], '{"application_id": "a1", "job_title": "Data Engineer"}'))
        conn.execute("insert into notifications (user_id, type, payload, created_at) values"
                     " (%s, 'outcome_released', '{}', now() - interval '3 days')", (cand["id"],))  # too old
    assert await email.send_pending() == 1
    sent = mail.sent[-1][0]
    assert sent.subject == "The outcome for Data Engineer is ready"
    assert "https://candidates.example/applications/a1/feedback" in sent.text


async def test_no_key_means_no_email(migrated_db, monkeypatch):
    monkeypatch.setattr(get_settings(), "resend_api_key", "")
    assert email.get_mailer() is None and await email.send_pending() == 0
    assert email.render("stage_invited", {"stage": "interview", "job_title": "X", "application_id": "a"}, "u")[0] \
        == "Your next step for X: the AI interview"
    assert email.render("something_else", {}, "u") is None
