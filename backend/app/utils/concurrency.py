"""Process-wide admission control for heavy (CPU/subprocess) work.

The deep research found there is no global cap on concurrent heavy operations:
~6 default-executor threads per worker, several services nest their own pools
inside that, and nothing bounds the total. On the 2-core VM this oversubscribes
under load and the failure mode is a *cliff* (correlated 504/OOM), not a slope.

`run_bounded` wraps `asyncio.to_thread` with a single process-wide semaphore.
The default is GENEROUS (so normal load never queues) — it only engages under a
spike, converting cliff-edge collapse into bounded queueing. Tune with
`MAX_CONCURRENT_HEAVY`; this is intentionally conservative until a production
load profile justifies a tighter value.

The semaphore is per-worker (each uvicorn worker imports this module once) and
created lazily on first use, inside the running loop.
"""

from __future__ import annotations

import asyncio
import os


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


def _semaphore() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(MAX_CONCURRENT_HEAVY)
    return _sem


async def run_bounded(func, /, *args, **kwargs):
    """Run a blocking `func` off the event loop, gated by the global heavy-work
    semaphore. Drop-in for `await asyncio.to_thread(func, *args, **kwargs)`."""
    async with _semaphore():
        return await asyncio.to_thread(func, *args, **kwargs)
