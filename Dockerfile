# Stage 1: Build frontend
# Pinned by digest so a rebuild of an old tag reproduces byte-for-byte and a
# hijacked tag cannot silently change the base. Dependabot's docker ecosystem
# updates these digests — do not unpin to get updates, let it bump them.
FROM node:26-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS frontend-build
WORKDIR /app/frontend
RUN apt-get update && apt-get install -y --no-install-recommends brotli \
    && rm -rf /var/lib/apt/lists/*
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build \
    && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.html' \) -exec brotli -q 11 -k {} \;

# Stage 2: Production
FROM python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a

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

# Install Python dependencies from the fully-pinned, hashed lockfile.
# --require-hashes verifies every wheel/sdist against requirements.lock, so a
# compromised index or a typosquat can't slip a bad artifact into the image
# (research DEP1/DEP4). The lock is universal (both arm64 + amd64 hashes) and was
# dry-run validated under --require-hashes for both arches; regenerate with
#   uv pip compile requirements.txt --generate-hashes --universal --python-version 3.12 -o requirements.lock
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock \
    && python -c "import fitz; print('PyMuPDF OK:', fitz.version)"

# Pre-download the rembg u2netp model into the runtime cache directory so the
# first /api/remove-background request never has to wait on a GitHub release.
# Numba JIT is disabled here so the import path doesn't trip on the slim
# image's locator quirk (matches the runtime ENV NUMBA_DISABLE_JIT=1).
#
# Baked under /app/cache, deliberately NOT /tmp: the container runs with
# read_only: true and LibreOffice needs a writable /tmp for its IPC pipe, so a
# tmpfs is mounted there — which would mask anything baked underneath. It did:
# with a tmpfs on /tmp the model vanished and rembg silently re-downloaded it
# from a GitHub release on the first request, turning a self-contained image
# into one with a runtime network dependency. /app/cache is in the read-only
# layer, which is all these need — they are read, never written.
RUN mkdir -p /app/cache/u2net /app/cache/xdg \
 && NUMBA_DISABLE_JIT=1 U2NET_HOME=/app/cache/u2net XDG_CACHE_HOME=/app/cache/xdg \
    python -c "from rembg import new_session; new_session('u2netp'); print('rembg u2netp model cached at /app/cache/u2net')"

# Copy backend
COPY backend/ backend/

# Copy built frontend from stage 1
COPY --from=frontend-build /app/frontend/dist frontend/dist/

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

# Create the temp and data directories with proper ownership.
#
# /app/data must exist IN THE IMAGE, not just be created at runtime. Compose
# mounts the app-data named volume there, and Docker seeds a fresh volume from
# whatever the image has at that path — including its ownership. With no such
# directory in the image, Docker creates the mountpoint root:root, appuser
# cannot write, and the first signup dies on
# `sqlite3.OperationalError: unable to open database file`. store.py's
# `DATA_DIR.mkdir(exist_ok=True)` does not save it: the directory already
# exists, it just isn't writable. Under read_only: true there is no fallback.
RUN mkdir -p temp data && chown -R appuser:appuser temp data
# The appuser must be able to read the pre-baked rembg model. onnxruntime
# reports a bare "system error number 13" when it cannot — an EACCES that names
# neither the file nor the permission, so get the ownership right here.
RUN chown -R appuser:appuser /app/cache

ENV ENVIRONMENT=production
ENV ALLOWED_ORIGINS=https://privatools.me
# numba (used by pymatting → rembg) tries to register a cache locator at
# import time and fails with "no locator available" inside our slim image.
# The cleanest workaround is to disable JIT entirely — pymatting's numpy
# fallback is only marginally slower for the small u2netp model, and
# disabling avoids hanging workers at FastAPI startup.
ENV NUMBA_DISABLE_JIT=1
# Left on /tmp (a tmpfs under read_only) rather than /app/cache, because this
# is the one cache that may be written at runtime. JIT is disabled above so
# nothing should write it; if that ever changes, a tmpfs absorbs it instead of
# failing on the read-only root.
ENV NUMBA_CACHE_DIR=/tmp/numba-cache
# rembg / pooch look for the u2netp model under $U2NET_HOME (default ~/.u2net,
# which resolves to /app/.u2net for the appuser). Point both at the baked
# read-only cache above — present at build time, so nothing is downloaded.
ENV U2NET_HOME=/app/cache/u2net
ENV XDG_CACHE_HOME=/app/cache/xdg

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
# cache dirs above live in /app/cache on purpose (build-baked, not user data).
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
