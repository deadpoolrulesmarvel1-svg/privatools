import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from .seo_meta import inject_seo

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
)
from .utils.cleanup import cleanup_old_files, ensure_temp_dir


async def _cleanup_task():
    """Remove temp files older than 10 minutes, runs every 5 minutes."""
    while True:
        await asyncio.sleep(300)
        cleanup_old_files(600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_temp_dir()
    # Skip rembg pre-warm — it can hang on the numba import path under the
    # slim image. The first remove-background request will warm the model
    # lazily; subsequent ones are fast.
    try:
        import fitz  # PyMuPDF
        logger.info("PyMuPDF loaded: %s", fitz.version)
    except Exception:
        pass
    task = asyncio.create_task(_cleanup_task())
    yield
    task.cancel()


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
_rate_limit = os.environ.get("RATE_LIMIT", "30/minute")
limiter = Limiter(key_func=get_remote_address, default_limits=[_rate_limit])

# ---------------------------------------------------------------------------
# Security headers middleware
# ---------------------------------------------------------------------------
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.url.scheme == "https" or os.environ.get("FORCE_HSTS"):
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://www.googletagmanager.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.bunny.net; "
            "font-src 'self' https://fonts.gstatic.com https://fonts.bunny.net; "
            "img-src 'self' data: blob: https://www.googletagmanager.com https://www.google-analytics.com; "
            # connect-src allows HF transformers to fetch the local-AI models
            # (Summarize PDF, Smart Redact). Models are downloaded once and cached
            # in the browser; the request never carries user file content.
            # Also allows GA4 collect endpoint (page-view telemetry only).
            "connect-src 'self' https://huggingface.co https://cdn.jsdelivr.net https://www.google-analytics.com https://*.analytics.google.com https://www.google.com; "
            "worker-src 'self' blob:; "
            "frame-ancestors 'none';"
        )
        return response

# ---------------------------------------------------------------------------
# SPA SEO middleware — inject per-route meta tags into index.html responses
# ---------------------------------------------------------------------------
_SKIP_SEO_PREFIXES = (
    "/api/", "/sitemap", "/robots", "/manifest", "/sw.js",
    "/icons", "/assets", "/favicon", "/og-image", "/llms",
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
def _get_seo_html(path: str, _mtime_ns: int) -> str:
    """Cache SEO-injected HTML — keyed by path + index.html mtime so that
    re-deploys (which rewrite index.html) automatically invalidate the cache
    without needing a worker restart."""
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

        # SPA route — serve index.html directly with injected meta tags.
        # Do NOT call call_next: StaticFiles would return a JSON 404 for any
        # path that doesn't correspond to a file on disk.
        if _INDEX_HTML.exists():
            try:
                from .seo_meta import path_is_known
                html = _get_seo_html(path, _index_mtime_ns())
                # Unknown paths (e.g. /tool/nonexistent-slug, /not-found, /404,
                # /tool/, /blog/) return HTTP 404 — prevents Google's Soft 404
                # detection from flagging the SEO-injected shell as an error.
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
MAX_UPLOAD_BYTES = _env_positive_int("MAX_UPLOAD_MB", 500) * 1024 * 1024

class UploadSizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            content_length = request.headers.get("content-length")
            if content_length and int(content_length) > MAX_UPLOAD_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"File too large. Maximum upload size is {MAX_UPLOAD_BYTES // (1024*1024)} MB."},
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
# Request logging middleware — structured request/response logging
# ---------------------------------------------------------------------------
import time as _time

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip logging for static assets
        if any(request.url.path.startswith(p) for p in ("/assets", "/icons", "/favicon")):
            return await call_next(request)
        start = _time.monotonic()
        response = await call_next(request)
        duration_ms = round((_time.monotonic() - start) * 1000)
        logger.info(
            "%s %s → %d (%dms)",
            request.method, request.url.path, response.status_code, duration_ms,
        )
        return response


app = FastAPI(
    title="PDF Studio API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
)

# Wire rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:8000,http://localhost:8080").split(",")

from starlette.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(SPASEOMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(UploadSizeLimitMiddleware)
app.add_middleware(RequestTimeoutMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)



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

# Sitemap + OG image
app.include_router(sitemap.router)
app.include_router(og_image.router)


@app.get("/api/health")
async def health():
    return JSONResponse({"status": "ok"})


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
    async def spa_fallback(full_path: str):
        # Prevent path traversal
        if ".." in full_path:
            return JSONResponse({"detail": "Not found"}, status_code=404)
        file_path = (_frontend_path / full_path).resolve()
        # Ensure the resolved path is within the frontend directory
        if not str(file_path).startswith(str(_frontend_path.resolve())):
            return JSONResponse({"detail": "Not found"}, status_code=404)
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
            resp = FileResponse(index)
            resp.headers["Cache-Control"] = "no-cache"
            return resp
        return JSONResponse({"detail": "Not found"}, status_code=404)
