"""Storage interface + Supabase Storage (backend plan §3, §18).

Resumes go straight from the browser to a private bucket through a signed upload URL; the
API never proxies the file. The `screen-application` job downloads it with the service key.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol
from urllib.parse import quote

import httpx

from app.core.config import get_settings


class StorageError(RuntimeError):
    pass


class ObjectNotFound(StorageError):
    pass


@dataclass(frozen=True)
class SignedUpload:
    path: str
    url: str  # PUT the file here (no auth header needed; the token is in the URL)
    token: str


class Storage(Protocol):
    async def signed_upload(self, path: str) -> SignedUpload: ...
    async def signed_download(self, path: str, expires_in: int = 86400) -> str: ...
    async def download(self, path: str) -> bytes: ...
    async def delete(self, path: str) -> None: ...


class SupabaseStorage:
    def __init__(self, base_url: str, service_key: str, bucket: str):
        self.base = base_url.rstrip("/") + "/storage/v1"
        self.bucket = bucket
        self.headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}

    def _obj(self, path: str) -> str:
        return f"{self.bucket}/{quote(path)}"

    async def signed_upload(self, path: str) -> SignedUpload:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.post(f"{self.base}/object/upload/sign/{self._obj(path)}", headers=self.headers)
        if r.status_code >= 400:
            raise StorageError(f"signed upload URL failed: {r.status_code}")
        rel = r.json()["url"]  # "/object/upload/sign/<bucket>/<path>?token=..."
        token = httpx.URL(rel).params.get("token", "")
        return SignedUpload(path=path, url=f"{self.base}{rel}", token=token)

    async def signed_download(self, path: str, expires_in: int = 86400) -> str:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.post(f"{self.base}/object/sign/{self._obj(path)}", headers=self.headers,
                                json={"expiresIn": expires_in})
        if r.status_code in (400, 404):
            raise ObjectNotFound(path)
        if r.status_code >= 400:
            raise StorageError(f"signed download URL failed: {r.status_code}")
        return f"{self.base}{r.json()['signedURL']}"

    async def download(self, path: str) -> bytes:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(f"{self.base}/object/{self._obj(path)}", headers=self.headers)
        if r.status_code in (400, 404):
            raise ObjectNotFound(path)
        if r.status_code >= 400:
            raise StorageError(f"download failed: {r.status_code}")
        return r.content

    async def delete(self, path: str) -> None:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.request("DELETE", f"{self.base}/object/{self.bucket}", headers=self.headers,
                                   json={"prefixes": [path]})
        if r.status_code >= 400:
            raise StorageError(f"delete failed: {r.status_code}")


class MemoryStorage:
    """Dev/test stand-in. Its URLs point at /v1/dev/storage on this API (mounted only in dev/test),
    so a browser can upload and download for real; tests can also call `put` directly."""

    def __init__(self, api_url: str = "http://127.0.0.1:8000") -> None:
        self.objects: dict[str, bytes] = {}
        self.api_url = api_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self.api_url}/v1/dev/storage/{quote(path)}"

    async def signed_upload(self, path: str) -> SignedUpload:
        return SignedUpload(path=path, url=self._url(path) + "?token=memory", token="memory")

    async def signed_download(self, path: str, expires_in: int = 86400) -> str:
        if path not in self.objects:
            raise ObjectNotFound(path)
        return self._url(path)

    def put(self, path: str, data: bytes) -> None:
        self.objects[path] = data

    async def download(self, path: str) -> bytes:
        try:
            return self.objects[path]
        except KeyError:
            raise ObjectNotFound(path) from None

    async def delete(self, path: str) -> None:
        self.objects.pop(path, None)


@lru_cache
def get_storage() -> Storage:
    s = get_settings()
    if s.supabase_url and s.supabase_service_key:
        return SupabaseStorage(s.supabase_url, s.supabase_service_key, s.resume_bucket)
    if not s.is_dev:
        raise StorageError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required outside dev/test")
    return MemoryStorage(s.public_api_url)
