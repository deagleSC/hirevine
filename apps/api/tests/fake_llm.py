"""A scripted stand-in for call_structured: per prompt id, a queue of outputs (or exceptions),
and a record of every input it was given."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from pydantic import BaseModel

from app.llm.prompts import PROMPTS, load_all
from app.llm.wrapper import StructuredResult

load_all()


class FakeLLM:
    def __init__(self) -> None:
        self.queue: dict[str, list[Any]] = defaultdict(list)
        self.calls: list[tuple[str, BaseModel]] = []

    def on(self, prompt_id: str, *outputs: dict[str, Any] | Exception) -> FakeLLM:
        self.queue[prompt_id].extend(outputs)
        return self

    async def __call__(self, role: str, prompt_id: str, input: BaseModel, schema: Any = None, **_: Any):
        self.calls.append((prompt_id, input))
        if not self.queue[prompt_id]:
            raise AssertionError(f"Unexpected model call: {prompt_id}")
        out = self.queue[prompt_id].pop(0)
        if isinstance(out, Exception):
            raise out
        prompt = PROMPTS[prompt_id]
        return StructuredResult((schema or prompt.output).model_validate(out), "fake:free", prompt.version, False, 1)

    def inputs(self, prompt_id: str) -> list[BaseModel]:
        return [i for p, i in self.calls if p == prompt_id]
