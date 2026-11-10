"""Role → ordered model list (backend plan §11.1)."""

from __future__ import annotations

from typing import Literal

from app.core.config import Settings, get_settings
from app.llm.errors import LLMNotConfigured

ModelRole = Literal["structured", "bulk"]


def models_for(role: ModelRole, settings: Settings | None = None) -> list[str]:
    """Models for a role, first choice first. In pilot mode, only allowlisted models remain."""
    s = settings or get_settings()
    models = list(s.llm_structured_models if role == "structured" else s.llm_bulk_models)
    if s.llm_pilot_mode:
        allowed = set(s.llm_pilot_allowlist)
        models = [m for m in models if m in allowed]
    if not models:
        raise LLMNotConfigured(f"No models left for role '{role}'" + (" in pilot mode" if s.llm_pilot_mode else ""))
    return models


def check_model_config(settings: Settings | None = None) -> None:
    """Fail startup when pilot mode leaves a role with no model (§11.1)."""
    s = settings or get_settings()
    if s.llm_pilot_mode:
        for role in ("structured", "bulk"):
            models_for(role, s)  # type: ignore[arg-type]


def provider_prefs(settings: Settings | None = None) -> dict[str, object]:
    """OpenRouter provider routing. In pilot mode, never send prompts to hosts that may train on them."""
    s = settings or get_settings()
    prefs: dict[str, object] = {"allow_fallbacks": True}
    if s.llm_pilot_mode:
        prefs["data_collection"] = "deny"
    return prefs
