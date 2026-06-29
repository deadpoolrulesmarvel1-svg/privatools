"""HTTP middleware and global exception handlers.

Public surface intentionally minimal — :func:`register_error_handlers`
attaches the JSON error mappers in `error_handlers.py`,
:class:`RequestIDMiddleware` tags each request with an ID for log
correlation, and :class:`AccessLogMiddleware` emits one structured log
line per request. Configure logging once at import time via
:func:`configure_logging`.
"""

from .access_log import AccessLogMiddleware
from .brotli import BrotliMiddleware
from .error_handlers import register_error_handlers
from .observability import (
    InFlightMiddleware,
    inflight_count,
    max_rss_mb,
    peak_inflight,
)
from .request_id import RequestIDMiddleware, configure_logging

__all__ = [
    "AccessLogMiddleware",
    "BrotliMiddleware",
    "register_error_handlers",
    "InFlightMiddleware",
    "inflight_count",
    "peak_inflight",
    "max_rss_mb",
    "RequestIDMiddleware",
    "configure_logging",
]
