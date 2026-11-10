"""Daily cap and request-path RPM bucket (Phase 2 exit check: the budget blocks calls at the limit)."""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime

import pytest

from app.llm import budget
from app.llm.errors import BudgetExhausted, RateLimited

DAY = date(2030, 1, 1)


async def test_budget_blocks_at_the_cap(clean_llm_tables):
    for expected in (1, 2, 3):
        assert await budget.reserve(3, day=DAY) == expected
    with pytest.raises(BudgetExhausted):
        await budget.reserve(3, day=DAY)
    assert await budget.used_today(day=DAY) == 3


async def test_budget_cannot_overshoot_under_concurrency(clean_llm_tables):
    results = await asyncio.gather(*(budget.reserve(5, day=DAY) for _ in range(12)), return_exceptions=True)
    ok = [r for r in results if isinstance(r, int)]
    assert sorted(ok) == [1, 2, 3, 4, 5]
    assert sum(isinstance(r, BudgetExhausted) for r in results) == 7


async def test_zero_cap_blocks_the_first_call(clean_llm_tables):
    with pytest.raises(BudgetExhausted):
        await budget.reserve(0, day=DAY)


async def test_budget_resets_each_utc_day(clean_llm_tables):
    await budget.reserve(1, day=DAY)
    with pytest.raises(BudgetExhausted):
        await budget.reserve(1, day=DAY)
    assert await budget.reserve(1, day=date(2030, 1, 2)) == 1


async def test_per_model_rows_do_not_count_against_the_cap(clean_llm_tables):
    await budget.record_model("b:free", day=DAY)
    await budget.record_model("b:free", day=DAY)
    assert await budget.reserve(1, day=DAY) == 1


async def test_rpm_bucket_limits_each_minute(clean_llm_tables):
    t = datetime(2030, 1, 1, 12, 0, 15, tzinfo=UTC)
    await budget.throttle(2, now=t)
    await budget.throttle(2, now=t)
    with pytest.raises(RateLimited) as exc:
        await budget.throttle(2, now=t)
    assert 40 <= exc.value.retry_after <= 45  # until the next minute
    await budget.throttle(2, now=t.replace(minute=1))  # new minute, new bucket
