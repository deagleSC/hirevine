"""Embedder interface + the Supabase Edge Function client (backend plan §13 step 4, §20.3)."""

from __future__ import annotations

import hashlib
import math
import re
from functools import lru_cache
from typing import Protocol

import httpx

from app.core.config import get_settings

DIM = 384
BATCH = 32


class EmbedderError(RuntimeError):
    pass


class Embedder(Protocol):
    model: str

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class EdgeFunctionEmbedder:
    model = "gte-small"

    def __init__(self, url: str, key: str):
        self.url, self.key = url, key

    async def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        async with httpx.AsyncClient(timeout=60) as http:
            for i in range(0, len(texts), BATCH):
                r = await http.post(self.url, json={"inputs": texts[i : i + BATCH]},
                                    headers={"x-embed-key": self.key})
                if r.status_code >= 400:
                    raise EmbedderError(f"embed function returned {r.status_code}")
                body = r.json()
                vectors = body["vectors"]
                if body.get("dim") != DIM or len(vectors) != len(texts[i : i + BATCH]):
                    raise EmbedderError("embed function returned an unexpected shape")
                out.extend(vectors)
        return out


_TOKEN = re.compile(r"[a-z0-9+#.]+")


class HashingEmbedder:
    """Dev/test stand-in: a normalised bag of hashed words. Texts that share words are similar,
    which is enough to exercise the prefilter without a model."""

    model = "hash-384"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    @staticmethod
    def _one(text: str) -> list[float]:
        v = [0.0] * DIM
        for tok in _TOKEN.findall(text.lower()):
            h = int.from_bytes(hashlib.blake2b(tok.encode(), digest_size=4).digest(), "big")
            v[h % DIM] += 1.0 if h & 1 else -1.0
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]


@lru_cache
def get_embedder() -> Embedder:
    s = get_settings()
    if s.embed_function_url:
        return EdgeFunctionEmbedder(s.embed_function_url, s.embed_function_key)
    if not s.is_dev:
        raise EmbedderError("EMBED_FUNCTION_URL is required outside dev/test")
    return HashingEmbedder()
