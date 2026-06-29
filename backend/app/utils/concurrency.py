"""Process-wide admission control for heavy (CPU/subprocess) work.

The deep research found there is no global cap on concurrent heavy operations:
~6 default-executor threads per worker, several services nest their own pools
inside that, and nothing bounds the total. On the 2-core VM this oversubscribes
under load and the failure mode is a *cliff* (correlated 504/OOM), not a slope.

`run_bounded` gates heavy work behind a process-wide semaphore AND runs it in a
DEDICATED bounded thread pool, separate from asyncio's shared default executor.
Two problems this solves:

1. Admission control. The semaphore is GENEROUS (so normal load never queues) —
   it only engages under a spike, converting cliff-edge collapse into bounded
   queueing. Tune with `MAX_CONCURRENT_HEAVY`.
2. The timed-out-thread leak. When a request times out (or the client
   disconnects), asyncio cancels the awaiting coroutine and the semaphore frees
   immediately — but CPython can't kill the thread, so the blocking op runs to
   completion. In the shared default executor that leaked thread would starve
   *light* `to_thread` work (file copies, small reads) too. Here it only ever
   consumes one of at most `MAX_CONCURRENT_HEAVY` dedicated "heavy" threads, so
   leaked/slow ops degrade into bounded queueing of heavy work and leave the
   rest of the event loop's threads alone.

The semaphore + pool are per-worker (each uvicorn worker imports this module
once) and created lazily on first use.
"""

from __future__ import annotations

import asyncio
import contextvars
import functools
import os
from concurrent.futures import ThreadPoolExecutor


def _budget() -> int:
    raw = os.environ.get("MAX_CONCURRENT_HEAVY", "").strip()
    if raw:
        try:
            v = int(raw)
            if v > 0:
                return v
        except ValueError:
            pass
    # Generous default: ~4× cores. Bounds the worst pileup without constraining
    # normal bursts. (Under a CFS quota os.cpu_count() can over-report; that
    # errs toward a larger budget, which is the safe direction here.)
    return max(4, (os.cpu_count() or 2) * 4)


MAX_CONCURRENT_HEAVY = _budget()

_sem: asyncio.Semaphore | None = None
_executor: ThreadPoolExecutor | None = None


def _semaphore() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(MAX_CONCURRENT_HEAVY)
    return _sem


def _heavy_executor() -> ThreadPoolExecutor:
    """Dedicated, bounded thread pool for heavy blocking work — sized to match
    the admission semaphore so at most MAX_CONCURRENT_HEAVY heavy threads ever
    exist, isolated from asyncio's shared default executor."""
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(
            max_workers=MAX_CONCURRENT_HEAVY, thread_name_prefix="heavy"
        )
    return _executor


async def run_bounded(func, /, *args, **kwargs):
    """Run a blocking `func` off the event loop in the bounded heavy-work pool,
    gated by the heavy-work semaphore. Drop-in for
    `await asyncio.to_thread(func, *args, **kwargs)`.

    The semaphore frees on cancellation. The thread itself can't be killed
    (CPython), but it runs in the dedicated bounded pool, so a leaked op is
    isolated to a heavy slot and never starves the default executor. The current
    context (request-id contextvar et al.) is copied into the thread, matching
    `asyncio.to_thread`, so service-side logs keep their request correlation.
    """
    ctx = contextvars.copy_context()
    loop = asyncio.get_running_loop()
    async with _semaphore():
        return await loop.run_in_executor(
            _heavy_executor(), functools.partial(ctx.run, func, *args, **kwargs)
        )


def shutdown() -> None:
    """Tear down the heavy-work pool (best effort). For lifespan shutdown/tests."""
    global _executor
    if _executor is not None:
        _executor.shutdown(wait=False, cancel_futures=True)
        _executor = None
