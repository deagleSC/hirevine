"""Dev/test only: upload and download for the in-memory resume store, so the browser apply flow and
the data export work without Supabase Storage. Mounted only when APP_ENV is dev or test and no
service key is set (see main.py)."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response

from app.core.errors import AppError
from app.services.storage import MemoryStorage, get_storage

router = APIRouter(prefix="/v1/dev/storage", tags=["dev"], include_in_schema=False)


def _memory() -> MemoryStorage:
    s = get_storage()
    if not isinstance(s, MemoryStorage):
        raise AppError(404, "not_found", "Not found.")
    return s


@router.put("/{path:path}")
async def upload(path: str, request: Request) -> dict[str, str]:
    _memory().put(path, await request.body())
    return {"Key": path}


@router.get("/{path:path}")
async def download(path: str) -> Response:
    data = _memory().objects.get(path)
    if data is None:
        raise AppError(404, "not_found", "Not found.")
    return Response(data, media_type="application/octet-stream")
