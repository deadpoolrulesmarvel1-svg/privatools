"""Structured JSON logging for PrivaTools.

One JSON dict per log line. Standard fields:

    ts          ISO8601 UTC timestamp
    level       INFO / WARNING / ERROR / ...
    msg         the rendered log message
    request_id  per-request token (12 hex chars) or "-" outside a request

Optional fields when relevant (set via ``logger.info(..., extra=...)``
or attached automatically by ``access_log`` / error handlers):

    endpoint, method, status, duration_ms, error_class, file_bytes

We deliberately log byte counts, MIME types, and error class names — never
filenames, query strings, or file content. The deploy target is a single
VM; ``jq`` over stdout is the dashboard.

The ``request_id`` is propagated via a :data:`request_id_var` contextvar
so any ``logger.info("…")`` inside a request handler automatically gets
the right ID without callers passing it through.

stdlib ``logging`` only — no structlog/loguru deps.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import sys
import traceback
from datetime import datetime, timezone
from typing import Any


# ---------------------------------------------------------------------------
# Context propagation
# ---------------------------------------------------------------------------
# A request-scoped ID that every log record emitted while handling a
# request is tagged with. Set by :class:`RequestIDMiddleware` early in
# the middleware stack, read by the JSON formatter below. Default "-" so
# startup / background-task logs never KeyError on the field.
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)


# ---------------------------------------------------------------------------
# JSON formatter
# ---------------------------------------------------------------------------
# Fields we copy verbatim from `record.__dict__` if the caller passed them
# via ``extra={"endpoint": ..., ...}``. Anything else passed in ``extra``
# is dropped — narrow allowlist so we never accidentally serialise a
# ``UploadFile`` or large bytes object that a caller forgot to convert.
_EXTRA_FIELDS = (
    "endpoint",
    "method",
    "status",
    "duration_ms",
    "error_class",
    "file_bytes",
)


class JSONFormatter(logging.Formatter):
    """Emit one JSON object per log record.

    Why a custom formatter rather than e.g. ``python-json-logger``: keeps
    the dependency set narrow (stdlib only) and lets us pin the exact
    schema downstream tooling expects.
    """

    def format(self, record: logging.LogRecord) -> str:  # type: ignore[override]
        # Always include the core fields. ISO8601 with Z so log shippers
        # parse timestamps in UTC without ambiguity.
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }

        # Prefer the explicit ``request_id`` if the caller passed one via
        # ``extra=``; otherwise fall back to the contextvar. The filter
        # below guarantees the attribute exists on every record.
        rid = getattr(record, "request_id", None)
        if not rid or rid == "-":
            rid = request_id_var.get()
        payload["request_id"] = rid

        # Copy the optional structured fields when set.
        for field in _EXTRA_FIELDS:
            if hasattr(record, field):
                value = getattr(record, field)
                if value is not None:
                    payload[field] = value

        # Tracebacks — include as a string so the line stays one JSON
        # object. We never let exceptions inside the formatter take down
        # logging (would crash the request).
        if record.exc_info:
            try:
                payload["traceback"] = "".join(
                    traceback.format_exception(*record.exc_info)
                )
            except Exception:  # noqa: BLE001 — formatter must not raise
                payload["traceback"] = "<unformattable>"

        if record.stack_info:
            payload["stack"] = record.stack_info

        try:
            return json.dumps(payload, ensure_ascii=False, default=str)
        except Exception:  # noqa: BLE001
            # If the message contains something non-serialisable, fall
            # back to a minimal record so we still get _something_ in
            # the log stream.
            return json.dumps(
                {
                    "ts": payload["ts"],
                    "level": payload["level"],
                    "msg": "<unserialisable log record>",
                    "request_id": payload.get("request_id", "-"),
                },
                ensure_ascii=False,
            )


class _RequestIDFilter(logging.Filter):
    """Ensure every record has a ``request_id`` attribute.

    The JSON formatter is defensive about missing attrs, but having a
    filter here lets other (third-party) formatters that interpolate
    ``%(request_id)s`` work too — e.g. uvicorn's own formatter once we
    let it through to stderr.
    """

    def filter(self, record: logging.LogRecord) -> bool:  # type: ignore[override]
        if not hasattr(record, "request_id"):
            record.request_id = request_id_var.get()
        return True


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
_CONFIGURED_FLAG = "_privatools_logging_configured"


def configure_logging(level: str | None = None) -> None:
    """Install the JSON formatter on the root logger.

    Idempotent: safe to call from ``main.py`` import time and from tests
    that import the app twice. Reading the level from ``LOG_LEVEL`` lets
    ops dial up DEBUG without redeploying.

    Honours ``LOG_FORMAT=text`` for a grep-friendly fallback (handy when
    SSH'd into the VM and you want human-readable lines without piping
    through ``jq``). Default is ``json``.
    """
    level_name = (level or os.environ.get("LOG_LEVEL", "INFO")).upper()
    numeric_level = getattr(logging, level_name, logging.INFO)

    root = logging.getLogger()
    if getattr(root, _CONFIGURED_FLAG, False):
        root.setLevel(numeric_level)
        return

    handler = logging.StreamHandler(stream=sys.stdout)
    fmt = os.environ.get("LOG_FORMAT", "json").lower()
    if fmt == "text":
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S",
            )
        )
    else:
        handler.setFormatter(JSONFormatter())
    handler.addFilter(_RequestIDFilter())

    # Replace existing handlers — we want a single, consistent stream.
    root.handlers = [handler]
    root.setLevel(numeric_level)

    # Quiet uvicorn's duplicate access log; ours has more context.
    # Set log_config=None on the uvicorn launch command to also disable
    # uvicorn's default handlers — see deploy/README.md.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    # httpx is noisy at INFO during tests (every TestClient request).
    logging.getLogger("httpx").setLevel(logging.WARNING)

    setattr(root, _CONFIGURED_FLAG, True)


def route_uvicorn_logging() -> None:
    """Route uvicorn's own loggers through the root JSON handler.

    uvicorn installs its own stderr handlers with ``propagate=False`` when it
    boots — AFTER :func:`configure_logging` runs at import time — so uvicorn's
    error/startup lines (bind failures, worker crashes, reload notices) bypass
    our JSON stream and are lost to aggregation. Call this from the lifespan
    startup, which runs *after* uvicorn configures logging, to clear those
    handlers and let the records propagate up to the root JSON handler.

    Idempotent and harmless under the test client (no uvicorn handlers exist
    to clear there).
    """
    for name in ("uvicorn", "uvicorn.error", "uvicorn.asgi", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
    # Our AccessLogMiddleware emits the structured access line; keep uvicorn's
    # own (now-propagating) access logger quiet so we don't double-log.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
