"""A stand-in for OpenRouter's chat completions API, for end-to-end tests only (frontend plan §11:
"the API with a stubbed LLM"). Point the API at it with OPENROUTER_BASE_URL=http://127.0.0.1:<port>.

    uv run python scripts/fake_openrouter.py 8199

- Streamed requests (interview questions) answer "Question N: …?" in small chunks, slowly enough
  (FAKE_LLM_CHUNK_DELAY seconds per chunk) that a test can reload the page mid-stream.
- `interview_score` tool calls score every rubric item 3/4, citing answer 1.
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
