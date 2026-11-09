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

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def jwt_issuer(self) -> str | None:
        return f"{self.supabase_url.rstrip('/')}/auth/v1" if self.supabase_url else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
