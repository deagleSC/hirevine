"""All runtime configuration, read from environment variables (backend plan §20.2)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["dev", "test", "prod"] = "dev"

    # Supavisor transaction-mode URL in production, user hirevine_api (never the service role).
    database_url: str = "postgresql://hirevine_api:dev@localhost:5432/hirevine_dev"
    db_pool_max: int = 5

    # Token verification. Projects on asymmetric signing keys use JWKS from SUPABASE_URL;
    # projects still on the legacy shared secret set SUPABASE_JWT_SECRET (HS256).
    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    supabase_jwt_aud: str = "authenticated"

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://localhost:3001"]
    )
    cron_secret: str = ""

    # Supabase Storage (backend plan §20.2). The service key is used ONLY by SupabaseStorage for
    # signed URLs and downloads, never for database access. Without it (dev/test), an in-memory
    # store is used.
    supabase_service_key: str = ""
    resume_bucket: str = "resumes"

    # Embeddings Edge Function (§20.3). Without a URL (dev/test), a deterministic hashing embedder.
    embed_function_url: str = ""
    embed_function_key: str = ""

    # Consent (§18): the version of the consent text the candidate app shows. Applications must
    # quote this exact version; bump it whenever the text or the provider list changes.
    consent_text_version: str = "2026-11-10"
    consent_providers: list[str] = Field(
        default_factory=lambda: ["Supabase", "OpenRouter", "Inngest", "Langfuse", "Vercel"]
    )

    # Abuse limits (§18).
    applications_per_day: int = 10
    upload_urls_per_hour: int = 20

    # LLM (backend plan §11.1). Model lists are ordered: OpenRouter falls back down the list.
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_structured_models: list[str] = Field(
        default_factory=lambda: [
            # Checked against OpenRouter on 2026-11-10 (free + tool calling). Order from the smoke
            # test (evals/reports/smoke_20261110.json): Nemotron Ultra 8/8 valid; Gemmas rate-limited.
            "nvidia/nemotron-3-ultra-550b-a55b:free",
            "google/gemma-4-31b-it:free",
            "google/gemma-4-26b-a4b-it:free",
        ]
    )
    llm_bulk_models: list[str] = Field(default_factory=lambda: ["nvidia/nemotron-3.5-lightning:free"])
    llm_pilot_mode: bool = False
    llm_pilot_allowlist: list[str] = Field(default_factory=list)
    llm_daily_cap: int = 50
    llm_rpm_cap: int = 20
    # Share of llm_rpm_cap left for request-path calls once the Inngest throttles are counted
    # (screening 10 + quiz 2 + interview 3 + report 3 = 18 of 20).
    llm_sync_rpm_cap: int = 2
    llm_request_timeout_s: float = 60.0

    # Tracing. Off unless both keys are set.
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"

    # Inngest. In dev/test the SDK talks to the local dev server (INNGEST_DEV=1) and needs no keys.
    inngest_event_key: str = ""
    inngest_signing_key: str = ""

    @property
    def is_dev(self) -> bool:
        return self.app_env in ("dev", "test")

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def jwt_issuer(self) -> str | None:
        return f"{self.supabase_url.rstrip('/')}/auth/v1" if self.supabase_url else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
