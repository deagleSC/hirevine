"""Failures of the LLM layer. Background steps let these propagate so Inngest retries them,
except BudgetExhausted (defer to tomorrow) and NeedsReview (a person takes over)."""

from __future__ import annotations


class LLMError(Exception):
    pass


class BudgetExhausted(LLMError):
    """The daily request cap is used up. Callers defer the work until 00:00 UTC."""


class RateLimited(LLMError):
    """Too many requests right now. `retry_after` is in seconds."""

    def __init__(self, message: str, retry_after: float):
        super().__init__(message)
        self.retry_after = retry_after


class TimeBudgetExceeded(LLMError):
    """Not enough time left before the step deadline to make another model call."""


class NeedsReview(LLMError):
    """The model did not return valid output after the retry. The stage goes to a person."""

    def __init__(self, prompt_id: str, last_error: str):
        super().__init__(f"{prompt_id}: {last_error}")
        self.prompt_id = prompt_id
        self.last_error = last_error


class LLMNotConfigured(LLMError):
    """No OpenRouter key, or pilot mode left no allowed model."""
