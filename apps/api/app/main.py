"""FastAPI application: the only gateway to the database and the only caller of models."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.api.routers import me
from app.api.routers.candidate import applications as candidate_applications
from app.api.routers.manager import org as manager_org
from app.core.config import get_settings
from app.core.db import close_pool, transaction
from app.core.errors import install_error_handlers


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await close_pool()


class Health(BaseModel):
    ok: bool
    db: bool | None = None


class ServiceInfo(BaseModel):
    service: str = "hirevine-api"
    version: str = "0.1.0"
    docs: str = "/docs"
    health: str = "/healthz"


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Hirevine API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # bearer tokens, no cookies
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
    )
    install_error_handlers(app)

    @app.get("/", response_model=ServiceInfo, tags=["health"])
    async def root() -> ServiceInfo:
        return ServiceInfo()

    @app.get("/healthz", response_model=Health, response_model_exclude_none=True, tags=["health"])
    async def healthz(db: bool = False) -> Health:
        if not db:
            return Health(ok=True)
        async with transaction({}) as tx:
            await tx.fetchone("select 1")
        return Health(ok=True, db=True)

    app.include_router(me.router)
    app.include_router(manager_org.router)
    app.include_router(candidate_applications.router)
    return app


app = create_app()
