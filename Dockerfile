# Stage 1: Build frontend
# Pinned by digest so a rebuild of an old tag reproduces byte-for-byte and a
# hijacked tag cannot silently change the base. Dependabot's docker ecosystem
# updates these digests — do not unpin to get updates, let it bump them.
FROM node:26-slim@sha256:65f816afd401c1c4de3293acc46dce115398152af4bdcd73c103b096988922d7 AS frontend-build
WORKDIR /app/frontend
RUN apt-get update && apt-get install -y --no-install-recommends brotli \
    && rm -rf /var/lib/apt/lists/*
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .

# Clerk's publishable key, baked at build time because Vite inlines VITE_* into
# the bundle — it cannot be supplied at runtime like the backend's variables.
#
# Public by design: it names the instance's Frontend API host and nothing more,
# and it is visible in the bundle of every Clerk site. The *secret* key is a
# runtime variable and must never appear here.
#
# Without a key, tools remain available and account controls explain that
# sign-in is not configured. Native accounts require an explicit build choice.
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_AUTH_PROVIDER="clerk"
ARG VITE_CLERK_SOCIAL_PROVIDERS="google,github"
ARG VITE_CLERK_USERNAME_ENABLED="true"
ARG VITE_CLERK_PASSKEYS_ENABLED="true"
ENV VITE_AUTH_PROVIDER=$VITE_AUTH_PROVIDER \
    VITE_CLERK_SOCIAL_PROVIDERS=$VITE_CLERK_SOCIAL_PROVIDERS \
    VITE_CLERK_USERNAME_ENABLED=$VITE_CLERK_USERNAME_ENABLED \
    VITE_CLERK_PASSKEYS_ENABLED=$VITE_CLERK_PASSKEYS_ENABLED


RUN npm run build \
    && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.html' \) -exec brotli -q 11 -k {} \;

# Stage 2: Production
FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f

# Install system dependencies and explicitly upgrade affected base packages.
# Trixie binary-version floors for the nine CVEs recorded in the v2.3.0 scan:
# SQLite, OpenSSL, gzip, util-linux and PCRE2. Keep bsdutils/login's epochs and
# login's compatibility prefix: source-package versions are not valid floors
# for those binaries. See https://packages.debian.org/trixie/<package>.
# Updating this list invalidates the apt layer; stale mirrors fail the checks.
RUN set -eu; \
    security_minimums='bsdutils=1:2.41.5-0+deb13u1 \
        gzip=1.13-1+deb13u1 \
        libblkid1=2.41.5-0+deb13u1 \
        liblastlog2-2=2.41.5-0+deb13u1 \
        libmount1=2.41.5-0+deb13u1 \
        libpcre2-8-0=10.46-1~deb13u2 \
        libsmartcols1=2.41.5-0+deb13u1 \
        libsqlite3-0=3.46.1-7+deb13u2 \
        libssl3t64=3.5.7-1~deb13u2 \
        libuuid1=2.41.5-0+deb13u1 \
        login=1:4.16.0-2+really2.41.5-0+deb13u1 \
        mount=2.41.5-0+deb13u1 \
        openssl=3.5.7-1~deb13u2 \
        openssl-provider-legacy=3.5.7-1~deb13u2 \
        util-linux=2.41.5-0+deb13u1'; \
    set --; \
    for specification in $security_minimums; do \
        set -- "$@" "${specification%%=*}"; \
    done; \
    apt-get -o APT::Update::Error-Mode=any update; \
    apt-get install -y --no-install-recommends "$@" \
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
    qpdf; \
    for specification in $security_minimums; do \
        package=${specification%%=*}; \
        minimum=${specification#*=}; \
        installed=$(dpkg-query -W -f='${Version}' "$package"); \
        if ! dpkg --compare-versions "$installed" ge "$minimum"; then \
            printf '%s version %s is older than required %s\n' "$package" "$installed" "$minimum" >&2; \
            exit 1; \
        fi; \
    done; \
    rm -rf /var/lib/apt/lists/*

# Fail the image build if the distro changes FFmpeg capabilities. A process
# existing is insufficient: subtitle burn-in needs libass; MP4 exports need
# the H.264 and AAC encoders. Consume the full output (no grep -q/SIGPIPE).
RUN ffmpeg -hide_banner -filters 2>/dev/null | grep -E '^[ .A-Z|]+ subtitles[[:space:]]' \
    && ffmpeg -hide_banner -encoders 2>/dev/null | grep -E '^[ .A-Z]+ libx264[[:space:]]' \
    && ffmpeg -hide_banner -encoders 2>/dev/null | grep -E '^[ .A-Z]+ aac[[:space:]]'

WORKDIR /app

# Install Python dependencies from the fully-pinned, hashed lockfile.
# --require-hashes verifies every wheel/sdist against requirements.txt, so a
# compromised index or a typosquat can't slip a bad artifact into the image
# (research DEP1/DEP4). The lock is universal (both arm64 + amd64 hashes) and is
# compiled from requirements.in by the command in its header.
COPY requirements.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.txt \
    && python -c "import fitz; print('PyMuPDF OK:', fitz.version)"

# The frontend build stages and SHA-256 verifies U²-Net-P. The backend uses
# that SAME file through a read-only symlink below; no duplicate model download
# or weight copy in the image. Keep runtime caches outside the masked /tmp.
RUN mkdir -p /app/cache/u2net /app/cache/xdg

# Copy backend
COPY backend/ backend/

# Copy built frontend from stage 1
COPY --from=frontend-build /app/frontend/dist frontend/dist/

# Verify rembg can load the exact browser-shipped model without a network fetch.
RUN ln -s /app/frontend/dist/models/u2netp.onnx /app/cache/u2net/u2netp.onnx \
 && NUMBA_DISABLE_JIT=1 U2NET_HOME=/app/cache/u2net XDG_CACHE_HOME=/app/cache/xdg \
    python -c "from rembg import new_session; new_session('u2netp'); print('rembg u2netp shared model loaded')"

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
# The launcher execs the same Uvicorn command unless optional API jobs are
# enabled; then one job supervisor shares this container's existing limits.
CMD ["python", "-m", "backend.app.launcher"]
