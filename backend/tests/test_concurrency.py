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
    monkeypatch.setattr(concurrency, "_executor", None)  # and a fresh sized pool

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


def test_run_bounded_uses_dedicated_heavy_pool():
    name = asyncio.run(run_bounded(lambda: threading.current_thread().name))
    assert name.startswith("heavy"), name


def test_leaked_heavy_op_does_not_starve_light_io(monkeypatch):
    """A heavy op that keeps running after its request is cancelled (CPython
    can't kill the thread) occupies a DEDICATED heavy thread, not the shared
    default executor — so light asyncio.to_thread work still runs immediately.
    This isolation is the point of the separate pool."""
    monkeypatch.setattr(concurrency, "MAX_CONCURRENT_HEAVY", 1)
    monkeypatch.setattr(concurrency, "_sem", None)
    monkeypatch.setattr(concurrency, "_executor", None)

    started = threading.Event()
    release = threading.Event()

    def slow(_):
        started.set()
        release.wait(3.0)  # long op that ignores cancellation

    async def main():
        task = asyncio.create_task(run_bounded(slow, 0))
        while not started.is_set():
            await asyncio.sleep(0.01)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        # heavy pool (size 1) is now occupied by the leaked thread; a light
        # default-executor to_thread must still run promptly.
        try:
            return await asyncio.wait_for(asyncio.to_thread(lambda: "ok"), timeout=2.0)
        finally:
            release.set()

    assert asyncio.run(main()) == "ok"
