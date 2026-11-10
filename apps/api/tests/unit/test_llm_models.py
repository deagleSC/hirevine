"""Model selection and pilot-mode allowlist (backend plan §11.1)."""

from __future__ import annotations

import pytest

from app.core.config import Settings
from app.llm.errors import LLMNotConfigured
from app.llm.models import check_model_config, models_for, provider_prefs


def settings(**kw) -> Settings:
    base = dict(llm_structured_models=["a:free", "b:free", "c:free"], llm_bulk_models=["bulk:free"])
    return Settings(**{**base, **kw})


def test_role_lists_keep_order():
    s = settings()
    assert models_for("structured", s) == ["a:free", "b:free", "c:free"]
    assert models_for("bulk", s) == ["bulk:free"]


def test_pilot_mode_keeps_only_allowlisted_models_in_order():
    s = settings(llm_pilot_mode=True, llm_pilot_allowlist=["c:free", "a:free", "bulk:free"])
    assert models_for("structured", s) == ["a:free", "c:free"]


def test_pilot_mode_with_nothing_allowed_fails_startup():
    s = settings(llm_pilot_mode=True, llm_pilot_allowlist=["a:free"])
    with pytest.raises(LLMNotConfigured):
        check_model_config(s)  # bulk has no allowed model


def test_pilot_mode_denies_provider_data_collection():
    assert "data_collection" not in provider_prefs(settings())
    assert provider_prefs(settings(llm_pilot_mode=True, llm_pilot_allowlist=["a:free"]))["data_collection"] == "deny"
