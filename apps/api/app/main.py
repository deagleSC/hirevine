"""FastAPI application: the only gateway to the database and the only caller of models."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import inngest.fast_api
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.api.routers import analytics, dev_storage, me, public
from app.api.routers.candidate import account as candidate_account
from app.api.routers.candidate import applications as candidate_applications
from app.api.routers.candidate import interview as candidate_interview
from app.api.routers.candidate import quiz as candidate_quiz
from app.api.routers.manager import campaigns as manager_campaigns
from app.api.routers.manager import jobs as manager_jobs
from app.api.routers.manager import org as manager_org
from app.api.routers.manager import workflows as manager_workflows
from app.core.config import get_settings
from app.core.db import close_pool, transaction
from app.core.errors import install_error_handlers
from app.jobs.client import inngest_client
from app.jobs.functions import all_functions
from app.llm import tracing
from app.llm.models import check_model_config

log = logging.getLogger("hirevine")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    tracing.flush()
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
    check_model_config(settings)  # pilot mode with no allowed model must not start
    app = FastAPI(title="Hirevine API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # bearer tokens, no cookies
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type", "x-upsert"],  # x-upsert: dev storage uploads
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
    app.include_router(candidate_account.router)
    app.include_router(analytics.router)
    if settings.is_dev and not settings.supabase_service_key:
        app.include_router(dev_storage.router)
    app.include_router(manager_org.router)
    app.include_router(manager_jobs.router)
    app.include_router(manager_workflows.router)
    app.include_router(manager_campaigns.router)
    app.include_router(candidate_applications.router)
    app.include_router(candidate_quiz.router)
    app.include_router(candidate_interview.router)
    app.include_router(public.router)

    # Inngest calls this endpoint to run function steps; it verifies request signatures in production.
    # The SDK refuses to start in production without a signing key, so a missing key must not take
    # the whole API down: skip the endpoint and log it. Jobs stay queued until the key is set.
    if settings.is_dev or settings.inngest_signing_key:
        inngest.fast_api.serve(app, inngest_client, all_functions(), serve_path="/api/inngest")
    else:
        log.warning("INNGEST_SIGNING_KEY is not set: /api/inngest is disabled and background jobs will not run")
    for route in app.router.routes:  # internal transport, not part of the public API or generated client
        if getattr(route, "path", None) == "/api/inngest":
            route.include_in_schema = False  # type: ignore[attr-defined]
    app.openapi_schema = None
    return app


app = create_app()
