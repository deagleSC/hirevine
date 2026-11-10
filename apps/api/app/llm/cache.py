"""llm_cache read/write (backend plan §11.2). Keys cover prompt id + version, the model
list and the canonical input, so any change to those misses the cache."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.core.db import system_claims, transaction


def canonical_json(value: BaseModel | dict[str, Any]) -> str:
    data = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def cache_key(prompt_id: str, version: int, models: list[str], input: BaseModel | dict[str, Any]) -> str:
    material = json.dumps([prompt_id, version, models, canonical_json(input)], separators=(",", ":"))
    return hashlib.sha256(material.encode()).hexdigest()


async def get(key: str) -> dict[str, Any] | None:
    async with transaction(system_claims()) as tx:
        row = await tx.fetchone("select response, model_id, prompt_version from llm_cache where key_hash = %s", (key,))
    return dict(row) if row else None


async def put(key: str, response: dict[str, Any], *, model_id: str, prompt_id: str, prompt_version: int) -> None:
    async with transaction(system_claims()) as tx:
        await tx.conn.execute(
            """
            insert into llm_cache (key_hash, response, model_id, prompt_id, prompt_version)
            values (%s, %s, %s, %s, %s)
            on conflict (key_hash) do nothing
            """,
            (key, Jsonb(response), model_id, prompt_id, prompt_version),
        )
