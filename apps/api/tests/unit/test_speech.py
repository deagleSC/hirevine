"""Speech helpers: accepted recording formats and the OpenRouter request shapes."""

from __future__ import annotations

import httpx
import pytest

from app.core.config import get_settings
from app.core.errors import AppError
from app.services import speech


def test_audio_extension_accepts_browser_recordings_only():
    assert speech.audio_extension("audio/webm;codecs=opus") == "webm"
    assert speech.audio_extension("audio/mp4") == "m4a"
    with pytest.raises(AppError) as e:
        speech.audio_extension("video/webm")
    assert e.value.status == 415


async def test_transcribe_posts_to_openrouter_and_strips(monkeypatch):
    monkeypatch.setattr(get_settings(), "openrouter_api_key", "gk")
    seen: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"], seen["auth"], seen["body"] = str(req.url), req.headers["authorization"], req.content
        return httpx.Response(200, json={"text": " Hello there. "})

    real = httpx.AsyncClient
    monkeypatch.setattr(speech.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    assert await speech.transcribe(b"a" * 4096, "audio/webm") == "Hello there."
    assert seen["url"].endswith("/audio/transcriptions") and seen["auth"] == "Bearer gk"
    assert b"openai/whisper-large-v3-turbo" in seen["body"] and b'filename="answer.webm"' in seen["body"]
    # Too short to be speech: no call.
    assert await speech.transcribe(b"a" * 10, "audio/webm") == ""


async def test_transcribe_maps_provider_failures(monkeypatch):
    monkeypatch.setattr(get_settings(), "openrouter_api_key", "gk")
    real = httpx.AsyncClient
    for status, code in [(429, "voice_busy"), (500, "voice_unavailable")]:
        transport = httpx.MockTransport(lambda _r, s=status: httpx.Response(s, text="no"))
        monkeypatch.setattr(speech.httpx, "AsyncClient", lambda transport=transport, **kw: real(transport=transport, **kw))
        with pytest.raises(AppError) as e:
            await speech.transcribe(b"a" * 4096, "audio/webm")
        assert e.value.code == code
