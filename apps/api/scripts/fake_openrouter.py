"""A stand-in for OpenRouter's chat completions API, for end-to-end tests only (frontend plan §11:
"the API with a stubbed LLM"). Point the API at it with OPENROUTER_BASE_URL=http://127.0.0.1:<port>.

    uv run python scripts/fake_openrouter.py 8199

- Streamed requests (interview questions) answer "Question N: …?" in small chunks, slowly enough
  (FAKE_LLM_CHUNK_DELAY seconds per chunk) that a test can reload the page mid-stream.
- Tool calls are answered by output schema: the job chat (a complete draft in one turn, no quiz or
  interview, so the end-to-end chain is short), the rubric, screening (every criterion 4/4, quoting a
  real resume line so the quote check passes), the report draft (citing every ref it was given) and
  interview scoring (every rubric item 3/4, citing answer 1).
Anything else gets a 500, so an unexpected model call fails the test loudly.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DELAY = float(os.environ.get("FAKE_LLM_CHUNK_DELAY", "0.25"))
MODEL = "fake/e2e-model"


def _text(messages: list[dict[str, str]]) -> str:
    return "\n".join(str(m.get("content", "")) for m in messages)


E2E_JOB = {
    "title": "E2E Backend Engineer", "seniority": "mid", "location": "Remote",
    "summary": "Build and run Python APIs on PostgreSQL.", "must_have_skills": ["Python", "PostgreSQL"],
    "nice_to_have_skills": [], "include_quiz": False, "quiz_questions": 3, "include_interview": False,
}


def _structured(schema: str | None, text: str) -> dict[str, object] | None:
    if schema == "JdTurnOutput":
        return {"draft": E2E_JOB, "reply": "Got it. I have everything I need for this role."}
    if schema == "JdRubricOutput":
        return {"description": "You will build and run Python APIs backed by PostgreSQL.",
                "criteria": [{"name": "Python", "weight": 5, "must_have": True},
                             {"name": "PostgreSQL", "weight": 3, "must_have": True}]}
    if schema == "ScreeningOutput":
        crit = re.findall(r"^- (\S+): (.+?)(?: \(must-have\))?$", text.split("Resume:")[0], flags=re.M)
        lines = re.findall(r"^L\d+: (.+)$", text, flags=re.M)
        scores = []
        for cid, name in crit:
            line = next((ln for ln in lines if name.lower() in ln.lower()), None) or next(
                (ln for ln in lines if len(ln) > 20), lines[0] if lines else "")
            scores.append({"criterion_id": cid, "score": 4, "rationale": f"Clear {name} experience.",
                           "quote": line.strip()})
        return {"scores": scores}
    if schema == "QuizGenerateOutput":
        n = int((re.search(r"Write exactly (\d+) questions", text) or [0, 5])[1])
        return {"questions": [{"prompt": f"E2E question {i + 1}: which option is correct?",
                               "options": ["Correct", "Wrong A", "Wrong B", "Wrong C"], "answer_index": 0,
                               "explanation": "The first option is correct.", "difficulty": "easy"}
                              for i in range(n)]}
    if schema == "ReportDraftOutput":
        refs = list(dict.fromkeys(re.findall(r"^\[([a-z]+:[\w-]+)\]", text, flags=re.M)))
        return {"cites": refs, "recommendation": "yes",
                "feedback": "Thank you for applying. Your Python and PostgreSQL experience came through clearly "
                            "in your resume. To grow further, share more about how you test and operate services."}
    return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_: object) -> None:  # quiet
        pass

    def do_GET(self) -> None:
        self._json(200, {"ok": True})

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        messages = body.get("messages", [])
        text = _text(messages)
        if body.get("stream"):
            n = re.search(r"Write question (\d+) of", text)
            question = f"Question {n.group(1) if n else 1}: tell me about a project where you used this skill?"
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.end_headers()
            words = question.split(" ")
            for i, w in enumerate(words):
                chunk = {"id": "fake", "model": MODEL, "object": "chat.completion.chunk", "created": 0,
                         "choices": [{"index": 0, "delta": {"content": w + (" " if i < len(words) - 1 else "")},
                                      "finish_reason": None}]}
                try:
                    self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return
                time.sleep(DELAY)
            self.wfile.write(b"data: [DONE]\n\n")
            return
        tools = body.get("tools") or []
        schema = ((tools[0].get("function") or {}).get("parameters") or {}).get("title") if tools else None
        args = _structured(schema, text)
        if args is not None:
            self._tool(args)
            return
        if "score a job interview transcript" in text:
            ids = re.findall(r"^- (\w+): ", text, flags=re.M)
            args = {"items": [{"item_id": i, "score": 3, "rationale": "Concrete, relevant example.", "answers": [1]}
                              for i in ids]}
            self._json(200, {"id": "fake", "model": MODEL, "object": "chat.completion", "created": 0, "choices": [{
                "index": 0, "finish_reason": "tool_calls", "message": {"role": "assistant", "content": None,
                "tool_calls": [{"id": "c1", "type": "function",
                                "function": {"name": "submit", "arguments": json.dumps(args)}}]}}]})
            return
        self._json(500, {"error": {"message": "fake_openrouter: unexpected request"}})

    def _tool(self, args: dict[str, object]) -> None:
        self._json(200, {"id": "fake", "model": MODEL, "object": "chat.completion", "created": 0, "choices": [{
            "index": 0, "finish_reason": "tool_calls", "message": {"role": "assistant", "content": None,
            "tool_calls": [{"id": "c1", "type": "function",
                            "function": {"name": "submit", "arguments": json.dumps(args)}}]}}]})

    def _json(self, status: int, payload: object) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8199
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
