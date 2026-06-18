import asyncio
import logging
import os
import re
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse, RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from .rate_limit import limiter
from .seo_meta import blog_content_mtime_ns, inject_seo
from .middleware import (
    AccessLogMiddleware,
    RequestIDMiddleware,
    configure_logging,
    register_error_handlers,
)
from .utils.health import run_readiness_checks

# Configure root logger as early as possible so import-time messages
# (router registration, lifespan startup) are captured with the same
# format as request-time logs.
configure_logging()
logger = logging.getLogger("privatools")

from .routes import (
    merge, split, compress, pdf_to_image, image_to_pdf, rotate, protect,
    unlock, watermark, pdf_to_word, page_numbers, ocr, office_to_pdf, metadata,
    extract_pages, delete_pages, pdf_to_text, pdf_to_excel, pdf_to_pptx,
    strip_metadata, delete_annotations, repair, crop, resize, flatten,
    header_footer, bates_numbering, grayscale, bookmarks, pdf_to_pdfa,
    extract_images, organize_pages, alternate_mix, split_bookmarks, split_by_size,
    nup, overlay, fill_form, compare, deskew,
    sign, redact, html_to_pdf, edit_pdf, qr_code,
    remove_blank_pages, auto_crop, invert_colors, pdf_security, pdf_extra,
    non_pdf_tools, image_ocr,
    phase1_tools,
    phase2_tools,
    phase3_tools,
    phase4_tools,
    phase5_tools,
    phase6_tools,
    reverse_pdf,
    booklet,
    sitemap,
    og_image,
    new_tools,
    v12_tools,
    phase7_tools,
    transparency,
    developer,
    analytics,
)
from .utils.cleanup import cleanup_old_files, ensure_temp_dir


# Janitor interval / max-age — tunable from the environment so the
# defaults (sweep every 5 min, drop files older than 10 min) can be
# tightened in tests or relaxed for slower workers without a deploy.
_JANITOR_INTERVAL = int(os.environ.get("CLEANUP_INTERVAL_SECONDS", "300"))
_JANITOR_MAX_AGE = int(os.environ.get("TEMP_MAX_AGE_SECONDS", "600"))
_BUILD_SHA = os.environ.get("PRIVATOOLS_BUILD_SHA", "unknown").strip() or "unknown"
_BUILD_SHA_SHORT = _BUILD_SHA[:12] if _BUILD_SHA != "unknown" else "unknown"


def _health_payload(status: str = "ok") -> dict[str, str]:
    return {
        "status": status,
        "build_sha": _BUILD_SHA,
        "build_sha_short": _BUILD_SHA_SHORT,
    }


async def _cleanup_task():
    """Background janitor: sweep TEMP_DIR on a fixed cadence.

    Sleeps first so we don't compete with startup work. Catches and
    logs per-iteration exceptions so a transient FS error never
    silently kills the loop — without this, a long-running worker
    could accumulate disk usage indefinitely after a single failure.
    """
    while True:
        try:
            await asyncio.sleep(_JANITOR_INTERVAL)
            cleanup_old_files(_JANITOR_MAX_AGE)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — never let the janitor die
            logger.exception("cleanup task iteration failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_temp_dir()
    logger.info(
        "lifespan: TEMP_DIR ready, janitor every %ds, max-age %ds",
        _JANITOR_INTERVAL,
        _JANITOR_MAX_AGE,
    )
    # Skip rembg pre-warm — it can hang on the numba import path under the
    # slim image. The first remove-background request will warm the model
    # lazily; subsequent ones are fast.
    try:
        import fitz  # PyMuPDF
        logger.info("PyMuPDF loaded: %s", fitz.version)
    except Exception:
        logger.warning("PyMuPDF failed to import — fitz-backed tools will 500")
    task = asyncio.create_task(_cleanup_task())
    try:
        yield
    finally:
        task.cancel()
        # Give the task a moment to unwind so its `finally` clauses run
        # before the event loop closes. Suppress CancelledError — that
        # is the expected outcome.
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        logger.info("lifespan: shutdown complete")


_is_prod = os.environ.get("ENVIRONMENT", "").lower() == "production"


def _env_positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------
# Limiter instance is defined in `app.rate_limit` so route modules can
# import it without pulling in `app.main` (which imports every route at
# startup and would create a circular dependency). We do NOT install
# SlowAPIMiddleware — per-route `@limiter.limit(...)` decorators already
# fire on their own, and adding the middleware would change rate-limit
# semantics across every route in one go.

# ---------------------------------------------------------------------------
# Security headers middleware
# ---------------------------------------------------------------------------
_SCRIPT_TAG_RE = re.compile(r"<script\b(?![^>]*\bnonce=)", re.IGNORECASE)
_WASM_EVAL_PATHS = {"/tool/summarize-pdf", "/tool/smart-redact"}


def _inject_csp_nonce(html: str, nonce: str | None) -> str:
    if not nonce:
        return html
    return _SCRIPT_TAG_RE.sub(f'<script nonce="{nonce}"', html)


def _content_security_policy(path: str, nonce: str) -> str:
    script_src = [
        "'self'",
        f"'nonce-{nonce}'",
    ]
    if path in _WASM_EVAL_PATHS:
        script_src.append("'wasm-unsafe-eval'")

    return (
        "default-src 'self'; "
        f"script-src {' '.join(script_src)}; "
        "style-src 'self' 'unsafe-inline'; "
        "font-src 'self'; "
        "img-src 'self' data: blob:; "
        # connect-src allows HF transformers to fetch the local-AI models
        # (Summarize PDF, Smart Redact). Models are downloaded once and cached
        # in the browser; the request never carries user file content.
        "connect-src 'self' https://huggingface.co https://cdn.jsdelivr.net; "
        "worker-src 'self' blob:; "
        "frame-ancestors 'none';"
    )


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        nonce = secrets.token_urlsafe(16)
        request.state.csp_nonce = nonce
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Embedder-Policy"] = "credentialless"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        # Force Cache-Control: no-store on dynamic /api/ responses so tool
        # outputs (per-user, per-request) are never retained by a shared
        # CDN, transparent proxy, or browser back/forward cache. Skip
        # routes that already set their own Cache-Control (sitemap +
        # og-image emit a long max-age via `cache_response`).
        if request.url.path.startswith("/api/") and "cache-control" not in {
            k.lower() for k in response.headers
        }:
            response.headers["Cache-Control"] = "no-store, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        if request.url.scheme == "https" or os.environ.get("FORCE_HSTS"):
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        response.headers["Content-Security-Policy"] = _content_security_policy(
            request.url.path, nonce
        )
        return response

# ---------------------------------------------------------------------------
# SPA SEO middleware — inject per-route meta tags into index.html responses
# ---------------------------------------------------------------------------
_SKIP_SEO_PREFIXES = (
    "/api/", "/api-docs", "/sitemap", "/robots", "/manifest", "/sw.js",
    "/icons", "/assets", "/favicon", "/og-image", "/llms",
    "/.well-known/",
    # Health / readiness probes must return JSON, never the SPA shell.
    "/healthz", "/readyz",
    # Search-engine site verification files — must serve their actual content
    # (a short token), not the SPA index.html shell. Adding generic prefixes
    # so future verification files for the same engines don't need a redeploy.
    "/google", "/BingSiteAuth", "/yandex", "/baidu_verify",
)
_STATIC_EXTENSIONS = {
    ".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    ".ico", ".woff", ".woff2", ".ttf", ".otf", ".map", ".json",
    ".xml", ".txt", ".pdf", ".mp4", ".mp3", ".wav", ".ogg", ".zip",
}

# Path to the built index.html — same root as _frontend_path computed below
_INDEX_HTML = Path(__file__).parent.parent.parent / "frontend" / "dist" / "index.html"


from functools import lru_cache

@lru_cache(maxsize=256)
def _get_seo_html(path: str, _index_mtime_ns: int, _blog_mtime_ns: int) -> str:
    """Cache SEO HTML keyed by path plus generated frontend content mtimes."""
    html = _INDEX_HTML.read_text("utf-8")
    return inject_seo(html, path)


def _index_mtime_ns() -> int:
    try:
        return _INDEX_HTML.stat().st_mtime_ns
    except OSError:
        return 0


class SPASEOMiddleware(BaseHTTPMiddleware):
    """
    For SPA routes (anything that is NOT an API call or a static asset),
    serve index.html directly with per-route <title>/<meta> already injected
    in the HTML string.  This runs BEFORE StaticFiles gets a chance to 404,
    so crawlers always receive correct metadata without JavaScript execution.
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Pass through API, sitemap, and other non-HTML paths unchanged
        for prefix in _SKIP_SEO_PREFIXES:
            if path.startswith(prefix):
                return await call_next(request)

        # Pass through requests for real static assets (JS, CSS, images…)
        suffix = Path(path).suffix.lower()
        if suffix in _STATIC_EXTENSIONS:
            return await call_next(request)

        # Canonicalize trailing slashes — 301 to the non-slashed version so
        # Google doesn't see /about and /about/ as two URLs with two different
        # self-referential canonicals (Search Console reports this as
        # "Alternative page with proper canonical tag"). Root path "/" is the
        # one exception: it must stay as "/".
        if len(path) > 1 and path.endswith("/"):
            target = path.rstrip("/") or "/"
            if request.url.query:
                target = f"{target}?{request.url.query}"
            return RedirectResponse(url=target, status_code=301)

        # SPA route — serve index.html directly with injected meta tags.
        # Do NOT call call_next: StaticFiles would return a JSON 404 for any
        # path that doesn't correspond to a file on disk.
        if _INDEX_HTML.exists():
            try:
                from .seo_meta import path_is_known
                html = _get_seo_html(path, _index_mtime_ns(), blog_content_mtime_ns())
                html = _inject_csp_nonce(html, getattr(request.state, "csp_nonce", None))
                # Unknown paths (e.g. /tool/nonexistent-slug, /not-found, /404)
                # return HTTP 404 with a proper "Page not found" SSR body
                # rendered by inject_seo — without this, the 404 page inherits
                # the homepage title/H1 and Google flags it as Soft 404.
                status = 200 if path_is_known(path) else 404
                return HTMLResponse(content=html, status_code=status)
            except Exception as exc:
                logger.error("SPA SEO injection failed for %s: %s", path, exc)
        else:
            logger.warning("SPA index.html not found at %s — tool pages will 404", _INDEX_HTML)

        return await call_next(request)


# ---------------------------------------------------------------------------
# Max upload size (500 MB — 24 GB RAM server)
# ---------------------------------------------------------------------------
# This is a Content-Length pre-check — cheap and catches almost every
# oversize upload before the request body is even read. Chunked
# (Transfer-Encoding: chunked) uploads without a Content-Length header
# slip past here; the per-route `read_upload` / `stream_upload_to_disk`
# helpers in `app.utils.route_helpers` re-enforce the same cap on the
# stream itself, so an attacker can't bypass the limit by omitting the
# header.
MAX_UPLOAD_BYTES = _env_positive_int("MAX_UPLOAD_MB", 500) * 1024 * 1024

class UploadSizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            content_length = request.headers.get("content-length")
            if content_length:
                try:
                    size = int(content_length)
                except ValueError:
                    return JSONResponse(
                        status_code=400,
                        content={"detail": "Invalid Content-Length header."},
                    )
                if size > MAX_UPLOAD_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={
                            "detail": (
                                f"File is too large — maximum upload size is "
                                f"{MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
                            )
                        },
                    )
        return await call_next(request)


# ---------------------------------------------------------------------------
# Request timeout middleware — prevent long-running operations from hanging
# ---------------------------------------------------------------------------
_REQUEST_TIMEOUT = _env_positive_int("REQUEST_TIMEOUT_SECONDS", 120)

class RequestTimeoutMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            return await asyncio.wait_for(call_next(request), timeout=_REQUEST_TIMEOUT)
        except asyncio.TimeoutError:
            logger.warning("Request timed out: %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=504,
                content={"detail": f"Request timed out after {_REQUEST_TIMEOUT} seconds."},
            )


# ---------------------------------------------------------------------------
# Request logging — the structured access log lives in
# :mod:`app.middleware.access_log` so the middleware module stays the
# single source of truth for request lifecycle behaviour. See
# :class:`AccessLogMiddleware` for the field schema and slow-request
# WARNING threshold.
# ---------------------------------------------------------------------------


app = FastAPI(
    title="PDF Studio API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api-docs",
    redoc_url=None if _is_prod else "/redoc",
)

# Wire rate limiter (slowapi)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Wire global exception handlers — translates ToolError + bare Python
# exceptions (FileNotFoundError, MemoryError, pikepdf.PasswordError…)
# into JSON bodies with frontend-friendly `detail` strings. Registered
# AFTER the rate-limit handler so RateLimitExceeded keeps its dedicated
# 429 path (slowapi exposes a Retry-After header that our generic
# handler wouldn't add).
register_error_handlers(app)

# CORS origin allow-list. We keep it small and explicit — no wildcards.
# Dev defaults cover local Vite + the FastAPI dev server.
_default_origins = "http://localhost:8000,http://localhost:8080,http://localhost:5173"
_origins = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",")
    if o.strip()
]
if "*" in _origins:
    logger.warning("ALLOWED_ORIGINS contains '*' — refusing for safety, falling back to defaults")
    _origins = [o for o in _origins if o != "*"]

# Trusted Host allow-list — rejects requests whose Host header doesn't
# match. Prevents host-header injection / cache-poisoning attacks behind
# a misconfigured proxy.
#
# Resolution order:
#   1. TRUSTED_HOSTS env var (explicit, comma-separated, highest priority)
#   2. Hostnames derived from ALLOWED_ORIGINS env (so a deployment that
#      already configures CORS gets a sane Host allowlist for free)
#   3. Hard-coded dev defaults (localhost, 127.0.0.1, testserver)
#
# Why #2 exists: an earlier rev only used #1 + #3, which fail-closed
# rejected every public request on a deployment that set ALLOWED_ORIGINS
# but not TRUSTED_HOSTS. Deriving from CORS origins keeps prod working
# without needing two near-duplicate env vars.
_explicit_trusted = os.environ.get("TRUSTED_HOSTS", "").strip()
_default_hosts = ["127.0.0.1", "localhost", "testserver"]
if _explicit_trusted:
    _trusted_hosts = [h.strip() for h in _explicit_trusted.split(",") if h.strip()]
else:
    _derived: list[str] = []
    for o in os.environ.get("ALLOWED_ORIGINS", "").split(","):
        o = o.strip()
        if not o:
            continue
        # Strip scheme + path + port to get the bare hostname.
        host = o.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0]
        if host:
            _derived.append(host)
    # Dedupe while preserving order. Always merge dev defaults so tests
    # and local nginx still work in any deployment shape.
    _trusted_hosts = list(dict.fromkeys(_derived + _default_hosts))

from starlette.middleware.gzip import GZipMiddleware
# Order is bottom-up: the LAST add_middleware call is the OUTERMOST
# layer, so RequestIDMiddleware here runs first on every request and
# can stamp `request.state.request_id` before anything else touches it.
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(SPASEOMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(UploadSizeLimitMiddleware)
app.add_middleware(RequestTimeoutMiddleware)
app.add_middleware(AccessLogMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Request-ID",
        "X-Original-Size",
        "X-Compressed-Size",
        "X-Stripped-Items",
    ],
)
# TrustedHostMiddleware: rejects requests whose Host header isn't in the
# allow-list. Added AFTER CORS so it sits OUTSIDE the CORS layer in the
# request stack — bad Host headers fail fast with a 400 without burning
# any CORS-preflight cycles. We also include the explicit hostnames the
# uvicorn listener binds to so the systemd health probe (curl /healthz
# against 127.0.0.1) doesn't get rejected.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=_trusted_hosts)
app.add_middleware(RequestIDMiddleware)



# Include all routers
app.include_router(merge.router, prefix="/api")
app.include_router(split.router, prefix="/api")
app.include_router(compress.router, prefix="/api")
app.include_router(pdf_to_image.router, prefix="/api")
app.include_router(image_to_pdf.router, prefix="/api")
app.include_router(rotate.router, prefix="/api")
app.include_router(protect.router, prefix="/api")
app.include_router(unlock.router, prefix="/api")
app.include_router(watermark.router, prefix="/api")
app.include_router(pdf_to_word.router, prefix="/api")
app.include_router(page_numbers.router, prefix="/api")
app.include_router(ocr.router, prefix="/api")
app.include_router(office_to_pdf.router, prefix="/api")
app.include_router(metadata.router, prefix="/api")
app.include_router(extract_pages.router, prefix="/api")
app.include_router(delete_pages.router, prefix="/api")
app.include_router(pdf_to_text.router, prefix="/api")
app.include_router(pdf_to_excel.router, prefix="/api")
app.include_router(pdf_to_pptx.router, prefix="/api")
app.include_router(strip_metadata.router, prefix="/api")
app.include_router(delete_annotations.router, prefix="/api")
app.include_router(repair.router, prefix="/api")
app.include_router(crop.router, prefix="/api")
app.include_router(resize.router, prefix="/api")
app.include_router(flatten.router, prefix="/api")
app.include_router(header_footer.router, prefix="/api")
app.include_router(bates_numbering.router, prefix="/api")
app.include_router(grayscale.router, prefix="/api")
app.include_router(bookmarks.router, prefix="/api")
app.include_router(pdf_to_pdfa.router, prefix="/api")
app.include_router(extract_images.router, prefix="/api")
app.include_router(organize_pages.router, prefix="/api")
app.include_router(alternate_mix.router, prefix="/api")
app.include_router(split_bookmarks.router, prefix="/api")
app.include_router(split_by_size.router, prefix="/api")
app.include_router(nup.router, prefix="/api")
app.include_router(overlay.router, prefix="/api")
app.include_router(fill_form.router, prefix="/api")
app.include_router(compare.router, prefix="/api")
app.include_router(deskew.router, prefix="/api")
app.include_router(sign.router, prefix="/api")
app.include_router(redact.router, prefix="/api")
app.include_router(html_to_pdf.router, prefix="/api")
app.include_router(edit_pdf.router, prefix="/api")
app.include_router(qr_code.router, prefix="/api")

# New PDF tool routes
app.include_router(remove_blank_pages.router, prefix="/api")
app.include_router(auto_crop.router, prefix="/api")
app.include_router(invert_colors.router, prefix="/api")
app.include_router(pdf_security.router, prefix="/api")
app.include_router(pdf_extra.router, prefix="/api")

# Non-PDF tool routes
app.include_router(non_pdf_tools.router, prefix="/api")
app.include_router(image_ocr.router, prefix="/api")

# Phase 1 new tools
app.include_router(phase1_tools.router, prefix="/api")
app.include_router(phase2_tools.router, prefix="/api")
app.include_router(phase3_tools.router, prefix="/api")
app.include_router(phase4_tools.router, prefix="/api")
app.include_router(phase5_tools.router, prefix="/api")
app.include_router(phase6_tools.router, prefix="/api")
app.include_router(reverse_pdf.router, prefix="/api")
app.include_router(booklet.router, prefix="/api")
app.include_router(new_tools.router, prefix="/api")
app.include_router(phase7_tools.router, prefix="/api")
app.include_router(v12_tools.router, prefix="/api")
app.include_router(transparency.router, prefix="/api")
app.include_router(developer.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")

# Sitemap + OG image
app.include_router(sitemap.router)
app.include_router(og_image.router)


@app.get("/api/health")
async def health():
    """Backwards-compatible health endpoint — kept for the frontend
    `BackendStatusBanner` that probes `/api/health` on startup."""
    return JSONResponse(_health_payload())


@app.get("/healthz")
async def healthz():
    """Liveness probe — returns 200 as long as the process is up.

    Kubernetes-style convention. Cheap, no dependency checks, no
    side-effects. Use this for "is the process running" monitoring
    (uptime checks, load-balancer health pings).
    """
    return JSONResponse(_health_payload())


@app.get("/readyz")
async def readyz():
    """Readiness probe — verifies dependencies and temp dir are usable.

    Used by the load-balancer / orchestrator to decide whether to send
    traffic. Returns 503 with a per-check breakdown when any required
    dependency is missing so the on-call engineer can see at a glance
    which one regressed.

    Checks (see :mod:`app.utils.health`): pikepdf / fitz / PIL importable,
    tessdata directory present, ghostscript binary in PATH. Also
    re-verifies the temp dir is writable (same check the original
    readyz did).
    """
    fs_ok = True
    fs_reason: str | None = None
    try:
        ensure_temp_dir()
        # Touch a probe file — proves the FS is writable, not just present.
        probe = Path(os.environ.get("TEMP_DIR", "temp")) / ".readyz_probe"
        probe.write_bytes(b"ok")
        probe.unlink(missing_ok=True)
    except OSError as exc:
        fs_ok = False
        # Log error class only, never the path that failed (could
        # reveal disk layout to an attacker probing /readyz).
        logger.error(
            "readyz: temp dir not writable",
            extra={"error_class": type(exc).__name__},
        )
        fs_reason = "temp dir not writable"

    deps_ok, checks = run_readiness_checks()
    checks["temp_dir"] = fs_ok

    if deps_ok and fs_ok:
        return JSONResponse({"status": "ready", "checks": checks})

    body: dict = {"status": "degraded", "checks": checks}
    if fs_reason:
        body["reason"] = fs_reason
    return JSONResponse(body, status_code=503)


# Mount frontend static files with SPA catch-all
def _resolve_frontend_path() -> Path:
    if "FRONTEND_PATH" in os.environ:
        return Path(os.environ["FRONTEND_PATH"])
    # Built frontend output
    cwd_dist = Path.cwd() / "frontend" / "dist"
    if cwd_dist.exists():
        return cwd_dist
    rel_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"
    if rel_dist.exists():
        return rel_dist
    # Fallback to frontend root
    cwd_path = Path.cwd() / "frontend"
    if cwd_path.exists():
        return cwd_path
    return Path(__file__).parent.parent.parent / "frontend"

_frontend_path = _resolve_frontend_path()
if _frontend_path.exists():
    # SPA catch-all: serve static files when they exist on disk,
    # otherwise serve index.html so React Router handles routing.
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str, request: Request):
        # API paths must NEVER fall through to the SPA index. If a request
        # reaches this handler with an `/api/` prefix, it means no router
        # matched it — i.e. the endpoint genuinely doesn't exist. Return a
        # JSON 404 so the frontend's fetch wrapper can distinguish "tool
        # broken" (HTML body, would otherwise parse-error) from "no such
        # endpoint" (proper JSON detail).
        if full_path.startswith("api/"):
            return JSONResponse(
                {"detail": "Not found", "path": str(request.url)},
                status_code=404,
            )
        # Prevent path traversal
        if ".." in full_path:
            return JSONResponse({"detail": "Not found"}, status_code=404)
        file_path = (_frontend_path / full_path).resolve()
        # Ensure the resolved path is within the frontend directory
        if not str(file_path).startswith(str(_frontend_path.resolve())):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        if file_path.is_file() and file_path.suffix.lower() == ".html":
            html = _inject_csp_nonce(
                file_path.read_text("utf-8"),
                getattr(request.state, "csp_nonce", None),
            )
            resp = HTMLResponse(content=html)
            resp.headers["Cache-Control"] = "no-cache"
            return resp
        if file_path.is_file():
            resp = FileResponse(file_path)
            # Immutable cache for hashed assets (e.g. /assets/index-TSOEbfYo.js)
            if full_path.startswith("assets/"):
                resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            # Cache icons, manifest, robots, llms.txt for 1 day
            elif full_path.endswith((".png", ".ico", ".webmanifest", ".txt", ".xml", ".svg")):
                resp.headers["Cache-Control"] = "public, max-age=86400"
            # Don't cache index.html or other HTML (SPA routing)
            else:
                resp.headers["Cache-Control"] = "no-cache"
            return resp
        # Fall back to index.html for SPA routing
        index = _frontend_path / "index.html"
        if index.is_file():
            html = _inject_csp_nonce(
                index.read_text("utf-8"),
                getattr(request.state, "csp_nonce", None),
            )
            resp = HTMLResponse(content=html)
            resp.headers["Cache-Control"] = "no-cache"
            return resp
        return JSONResponse({"detail": "Not found"}, status_code=404)
