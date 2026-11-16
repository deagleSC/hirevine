"""Speech for the voice interview (backend plan §15).

Both go through OpenRouter's OpenAI-compatible audio endpoints: `transcribe` turns a spoken answer
into text, `synthesize` reads a question aloud. Audio is only held in memory for the call and is
never stored.
"""

from __future__ import annotations

import logging

import httpx

from app.core.config import Settings, get_settings
from app.core.errors import AppError

log = logging.getLogger("hirevine.speech")

AUDIO_TYPES = {
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/x-m4a": "m4a", "audio/aac": "m4a",
}
MIN_AUDIO_BYTES = 1024  # anything smaller is a click, not an answer


def audio_extension(content_type: str | None) -> str:
    base = (content_type or "").split(";")[0].strip().lower()
    ext = AUDIO_TYPES.get(base)
    if ext is None:
        raise AppError(415, "unsupported_audio", "This recording format is not supported. Try another browser.")
    return ext


def _headers(s: Settings) -> dict[str, str]:
    return {"Authorization": f"Bearer {s.openrouter_api_key}", "X-Title": "Hirevine"}


def _unavailable() -> AppError:
    return AppError(503, "voice_unavailable", "Voice is unavailable right now. Your saved answers are safe; try again.")


async def transcribe(audio: bytes, content_type: str | None) -> str:
    s = get_settings()
    ext = audio_extension(content_type)
    if len(audio) > s.max_answer_audio_bytes:
        raise AppError(413, "audio_too_large", "This answer is too long. Keep each answer under a few minutes.")
    if len(audio) < MIN_AUDIO_BYTES:
        return ""
    if not s.openrouter_api_key:
        raise _unavailable()
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                f"{s.openrouter_base_url.rstrip('/')}/audio/transcriptions",
                headers=_headers(s),
                data={"model": s.stt_model, "response_format": "json", "temperature": "0"},
                files={"file": (f"answer.{ext}", audio, content_type.split(";")[0] if content_type else "")},
            )
    except httpx.HTTPError as exc:
        log.warning("transcription failed: %s", exc)
        raise _unavailable() from exc
    if r.status_code == 429:
        raise AppError(429, "voice_busy", "Transcription is busy right now. Your recording was not saved; try again.")
    if r.status_code >= 400:
        log.warning("transcription failed: %s %s", r.status_code, r.text[:300])
        raise _unavailable()
    return str(r.json().get("text") or "").strip()


async def synthesize(text: str) -> tuple[bytes, str]:
    """The spoken question and its media type (MP3 from real providers)."""
    s = get_settings()
    if not s.openrouter_api_key:
        raise _unavailable()
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                f"{s.openrouter_base_url.rstrip('/')}/audio/speech",
                headers=_headers(s),
                json={"model": s.tts_model, "voice": s.tts_voice, "input": text, "response_format": "mp3",
                      "instructions": "Speak as a calm, friendly professional interviewer, at a measured pace."},
            )
    except httpx.HTTPError as exc:
        log.warning("speech synthesis failed: %s", exc)
        raise _unavailable() from exc
    if r.status_code >= 400:
        log.warning("speech synthesis failed: %s %s", r.status_code, r.text[:300])
        raise _unavailable()
    return r.content, r.headers.get("content-type", "audio/mpeg").split(";")[0]
