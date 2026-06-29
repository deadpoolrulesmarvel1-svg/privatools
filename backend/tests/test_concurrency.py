"""Tests for the heavy-work admission-control semaphore (run_bounded)."""

import asyncio
import sys
import threading
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.utils import concurrency
from backend.app.utils.concurrency import run_bounded


def test_run_bounded_passes_args_and_returns_result():
    assert asyncio.run(run_bounded(lambda a, b: a + b, 3, 4)) == 7
    assert asyncio.run(run_bounded(lambda x=0: x * 2, x=5)) == 10


def test_run_bounded_propagates_exceptions():
    def boom():
        raise ValueError("kaboom")

    try:
        asyncio.run(run_bounded(boom))
    except ValueError as exc:
        assert "kaboom" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("run_bounded swallowed the exception")


def test_run_bounded_caps_concurrency(monkeypatch):
    """With the budget pinned to 2, no more than 2 tasks run the blocking body
    at once even when 10 are launched together — the whole point of the gate."""
    monkeypatch.setattr(concurrency, "MAX_CONCURRENT_HEAVY", 2)
    monkeypatch.setattr(concurrency, "_sem", None)  # force a fresh semaphore

    lock = threading.Lock()
    state = {"now": 0, "peak": 0}

    def work(_):
        with lock:
            state["now"] += 1
            state["peak"] = max(state["peak"], state["now"])
        # Busy just long enough that concurrent tasks overlap.
        end = 0
        for _ in range(200_000):
            end += 1
        with lock:
            state["now"] -= 1
        return end

    async def main():
        await asyncio.gather(*[run_bounded(work, i) for i in range(10)])

    asyncio.run(main())
    assert state["peak"] <= 2, f"semaphore did not bound concurrency: peak={state['peak']}"
    assert state["peak"] >= 1
