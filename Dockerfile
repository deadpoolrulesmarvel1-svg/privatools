# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
RUN apt-get update && apt-get install -y --no-install-recommends brotli \
    && rm -rf /var/lib/apt/lists/*
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build \
    && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.html' \) -exec brotli -q 11 -k {} \;

# Stage 2: Production
FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-fra \
    tesseract-ocr-deu \
    tesseract-ocr-spa \
    tesseract-ocr-ita \
    tesseract-ocr-por \
    tesseract-ocr-nld \
    tesseract-ocr-rus \
    tesseract-ocr-pol \
    tesseract-ocr-tur \
    tesseract-ocr-jpn \
    tesseract-ocr-kor \
    tesseract-ocr-chi-sim \
    tesseract-ocr-chi-tra \
    tesseract-ocr-ara \
    tesseract-ocr-hin \
    tesseract-ocr-vie \
    libglib2.0-0t64 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libcairo2 \
    libffi-dev \
    build-essential \
    swig \
    poppler-utils \
    colord \
    ffmpeg \
    libzbar0 \
    libreoffice-writer-nogui \
    libreoffice-calc-nogui \
    libreoffice-impress-nogui \
    qpdf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "import fitz; print('PyMuPDF OK:', fitz.version)"

# Pre-download the rembg u2netp model into the runtime cache directory so the
# first /api/remove-background request never has to wait on a GitHub release.
# Numba JIT is disabled here so the import path doesn't trip on the slim
# image's locator quirk (matches the runtime ENV NUMBA_DISABLE_JIT=1).
RUN mkdir -p /tmp/u2net /tmp/cache /tmp/numba-cache \
 && NUMBA_DISABLE_JIT=1 U2NET_HOME=/tmp/u2net XDG_CACHE_HOME=/tmp/cache \
    python -c "from rembg import new_session; new_session('u2netp'); print('rembg u2netp model cached at /tmp/u2net')"

# Copy backend
COPY backend/ backend/

# Copy built frontend from stage 1
COPY --from=frontend-build /app/frontend/dist frontend/dist/

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

# Create temp directory with proper ownership
RUN mkdir -p temp && chown -R appuser:appuser temp
# Pre-create the numba cache dir + ensure the appuser can read the pre-baked
# rembg model + write to its own cache dirs.
RUN mkdir -p /tmp/numba-cache \
 && chown -R appuser:appuser /tmp/numba-cache /tmp/u2net /tmp/cache

ENV ENVIRONMENT=production
ENV ALLOWED_ORIGINS=https://privatools.me
# numba (used by pymatting → rembg) tries to register a cache locator at
# import time and fails with "no locator available" inside our slim image.
# The cleanest workaround is to disable JIT entirely — pymatting's numpy
# fallback is only marginally slower for the small u2netp model, and
# disabling avoids hanging workers at FastAPI startup.
ENV NUMBA_DISABLE_JIT=1
ENV NUMBA_CACHE_DIR=/tmp/numba-cache
# rembg / pooch cache the u2netp model in $U2NET_HOME (default ~/.u2net which
# resolves to /app/.u2net for the appuser — read-only). Send it to /tmp so
# the runtime user can write the model on first download.
ENV U2NET_HOME=/tmp/u2net
ENV XDG_CACHE_HOME=/tmp/cache

# Cap native math/ML thread pools. numpy/scipy and onnxruntime (via rembg) each
# spin up an OpenMP/BLAS pool sized to the host core count; on the 2-core VM,
# several concurrent heavy ops would oversubscribe (BLAS pool × in-flight jobs)
# and thrash the scheduler. One thread per pool keeps each op single-threaded
# and lets the run_bounded admission gate govern parallelism instead. These are
# read at library-import time, so they must live in the environment, not code.
ENV OMP_NUM_THREADS=1
ENV OPENBLAS_NUM_THREADS=1
ENV MKL_NUM_THREADS=1

# Point Python's tempfile (mkstemp/mkdtemp) at the managed temp volume instead
# of system /tmp. The media/archive/extract tools use raw tempfile.*; on /tmp
# the janitor never swept them, so they leaked on every timeout/OOM/crash exit
# path. /app/temp IS swept (utils.cleanup janitor, which recurses subdirs). The
# cache dirs above stay on /tmp on purpose (build-baked, not user data).
ENV TMPDIR=/app/temp

# Switch to non-root user
USER appuser

EXPOSE 8000

# NB: we intentionally do NOT pass --proxy-headers --forwarded-allow-ips '*'.
# With '*', uvicorn would rewrite request.client.host from the LEFTMOST (and
# therefore client-controllable) X-Forwarded-For entry, which made the
# rate-limit key spoofable. The rate limiter instead derives the client IP
# from the RIGHTMOST XFF entry (the one nginx appends) via rate_limit._client_ip,
# which is spoof-resistant and needs no uvicorn proxy trust.
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--timeout-keep-alive", "30", "--limit-concurrency", "50", "--timeout-graceful-shutdown", "30"]
