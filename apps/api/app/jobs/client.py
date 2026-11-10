"""The Inngest client. In dev/test it talks to the local dev server (`npx inngest-cli dev`)."""

from __future__ import annotations

import inngest

from app.core.config import get_settings

_s = get_settings()

inngest_client = inngest.Inngest(
    app_id="hirevine",
    is_production=not _s.is_dev,
    event_key=_s.inngest_event_key or None,
    signing_key=_s.inngest_signing_key or None,
)
