# ADR 0009: The AI interview is spoken; recordings are transcribed and discarded

Status: accepted (November 2026)

## Decision

In production the AI interview is voice only. Each question is synthesised with OpenRouter's speech endpoint (`elevenlabs/eleven-flash-v2.5`) and served per question number, so the browser caches each question separately. The candidate records one take per answer in the browser (MediaRecorder: webm/opus, mp4 fallback); the API sends the audio to OpenRouter's transcription endpoint (`openai/whisper-large-v3-turbo`) and saves only the transcript. Typed answers are refused in voice mode. Dev defaults to typed answers (`INTERVIEW_ANSWER_MODE`).

## Why

Spoken answers are closer to a real screening call and harder to paste from elsewhere. Keeping every model call on OpenRouter means one key, one budget and one processor to disclose. Not storing audio keeps the data held about candidates to the transcript, which is what is scored and what the hiring team reads.

## Consequences

- Consent text and the privacy notice say answers are transcribed and recordings are not kept (consent version `2026-11-16`).
- No edits after recording: one take per question, like a call.
- WebKit drops the first ~1.5 s of a recording, so the UI waits for the first audio chunk before showing "Recording".
- Transcription errors are visible in the transcript the hiring team reads; scoring prompts ignore accent and writing style.
