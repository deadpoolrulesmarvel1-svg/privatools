"""Runs password hashing off the event loop, under a concurrency bound.

Two measured problems this solves, both from scrypt being deliberately
expensive:

* **156 ms, blocking.** `hashlib.scrypt` was called straight from an async
  route, so every login stalled that worker's event loop for 156 ms — including
  the file-tool requests sharing it. Hashing now runs in a thread.
* **64 MB per hash.** With a 4 GB container, 64 concurrent hashes exhaust it.
  The per-IP rate limit does not help: an attacker with many IPs, or simply a
  burst of real signups, gets there. A semaphore bounds how many run at once;
  the rest queue, which is the right failure mode — slower logins, not an OOM.

`MAX_CONCURRENT` × 64 MB is the ceiling this adds. Four is deliberately modest:
the box has two cores, so more parallel hashing buys nothing anyway.
"""
from __future__ import annotations

import asyncio
import os

from starlette.concurrency import run_in_threadpool

from . import passwords

MAX_CONCURRENT = int(os.environ.get("PASSWORD_HASH_CONCURRENCY", "4"))

_gate: asyncio.Semaphore | None = None


def _semaphore() -> asyncio.Semaphore:
    # Created lazily: a Semaphore binds to the running loop, and at import time
    # under uvicorn there is not one yet.
    global _gate
    if _gate is None:
        _gate = asyncio.Semaphore(MAX_CONCURRENT)
    return _gate


async def hash_password(password: str) -> str:
    async with _semaphore():
        return await run_in_threadpool(passwords.hash_password, password)


async def verify(password: str, stored: str) -> bool:
    async with _semaphore():
        return await run_in_threadpool(passwords.verify, password, stored)
