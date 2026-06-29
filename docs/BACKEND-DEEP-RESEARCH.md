I'll write the report directly. This is a synthesis task — the deliverable is the markdown report itself, returned as my final response.

# PrivaTools Backend — Principal-Engineer Research Report

*Deep backend architecture, security, scalability, and reliability review. Synthesizes 13 specialist deep-dives and 26 adversarially-confirmed findings. Scoped to the backend as deployed: single Docker container, 2 uvicorn workers, ~1.8 CPU / 4 GB container on a 2-core/24 GB Oracle ARM VM, behind host nginx + Cloudflare.*

---

## 1. Executive Summary

The blunt version, in priority order:

1. **There is one real data-leak bug, and it's a one-liner.** `merge_service.py:70` writes every merge to a fixed path `temp/merged.pdf` with no UUID — the single exception in the entire `services/` tree. Under concurrent `/merge` requests over the shared temp dir, user A can download user B's merged PDF, and A's cleanup task can delete the file mid-stream of B. This directly violates the "files never sent to third parties" promise. **Fix it first.** (Confirmed severity: **high**.)

2. **The app has no admission control for CPU/RAM-bound work, and this is the dominant structural weakness.** No global semaphore exists anywhere (grep returns nothing). 126 `asyncio.to_thread` dispatches share one ~6-thread default executor per worker, and *several services nest their own 4-worker pools inside that already-offloaded thread*. On 1.8 CPUs this oversubscribes by ~10x under modest load. The failure mode is a cliff (correlated 504 storms), not a slope. This single missing primitive is the root cause behind roughly half the confirmed findings.

3. **A tiny crafted-but-valid PDF can OOM-kill a worker.** PDF page MediaBox is attacker-controlled (up to 14400×14400 pt) and is *never* capped before `fitz.get_pixmap()`. At dpi=600 (route-allowed) that's tens of GB for one page; the multipage-TIFF/OCR paths additionally hold every rendered page in RAM. Pillow's 150 MP bomb cap does **not** cover fitz pixmaps. No auth, ~1 MB payload, repeatable → clean DoS. (Confirmed **high**.)

4. **The rate-limit story is mostly theater on the cheap routes and absent on the expensive ones.** `default_limits=["30/minute"]` is *dead config* — `SlowAPIMiddleware` is deliberately not installed, so only ~18 explicitly-decorated endpoints of ~138 are throttled. The **heaviest** routes — `office-to-pdf` (LibreOffice), every ffmpeg route, `compress`, `remove-background` — carry **no** decorator, violating the codebase's own self-documented rule (`rate_limit.py:49-51`). A self-contradicting comment even claims "concurrency caps" that don't exist.

5. **The supply-chain posture is "signed but unverified, and unscanned."** The 14 highest-risk native parsers (`pymupdf`, `weasyprint`, `onnxruntime`, `cairosvg`, `pyzbar`, etc.) are **unpinned** — builds aren't reproducible. The release pipeline cosign-*signs* the image but `auto-deploy.sh` never runs `cosign verify` — trust rests on an unauthenticated `org.opencontainers.image.revision` label. And the signed image is **never vulnerability-scanned** (scans are `scan-type: fs` on the repo, not the built artifact).

6. **Two latent ops time-bombs on a single VM with no horizontal-scale path.** No Docker log rotation (unbounded json-file stdout can fill the disk → readyz 503 → docker wedge), and media/archive tools write to system `/tmp` which the janitor never sweeps (slow leak on every crash/timeout exit path). Both are silent until they take down *all* tools at once.

7. **Credit where due: the security fundamentals that are present are genuinely above-average.** SSRF defense is deep and correct, decompression bombs are bounded, header-injection is closed, constant-time auth, no `shell=True` anywhere, strong container hardening. The gaps are concentrated in *resource exhaustion* and *deploy/ops*, not in classic injection/authz.

**Already handled — do not redo:** the v1.6.4–6 work and the 3 tracked tasks. Loopback-only port binding, the chunked-upload size-cap bypass, the heavy-work-off-the-event-loop offload PRs, EPUB zip-bomb hardening, the per-conversion LibreOffice profile dir, and the `--proxy-headers` footgun avoidance are all done. The 3 tracked tasks already cover (a) consolidating the 3 drifted SSRF validators, (b) the request-timeout-can't-kill-a-thread limitation, and (c) the duplicate temp-helper cleanup. **Findings tagged `isNew: false` below (the weak phase3 SSRF validator, the IPv4-mapped/rebind edge) fold into tracked task (a) — don't open new work for them.**

---

## 2. Architecture Overview (how it actually works, end to end)

**Shape.** A single FastAPI app (`backend/app/main.py`) registering ~69 routers under `/api`, fanning **~214 frontend tool slugs onto ~138 endpoints** (the extra slugs are SEO landing-page aliases multiplexed onto shared handlers via a `target_format`/`format` param — a real DRY win). Runs as **2 uvicorn worker processes**, each an asyncio event loop, `--limit-concurrency 50`, behind host nginx (TLS) and Cloudflare.

**Request lifecycle (the canonical tool path):**

```
Client → Cloudflare (apex, orange) OR direct (api.privatools.me, grey)
       → host nginx (TLS, limit_req 10r/s, 110MB body cap, proxy_read_timeout 120s)
       → uvicorn (127.0.0.1:8000) → middleware stack → router
```

**Middleware stack** (added bottom-up; outermost→innermost): RequestID → TrustedHost → CORS → AccessLog → RequestTimeout(300s) → UploadSizeLimit(500MB) → GZip → Brotli → SecurityHeaders(CSP nonce) → SPASEO → route. The ordering is *deliberate and documented* and mostly correct (RequestID first so the ID exists for all later layers; TrustedHost outside CORS; size/timeout outside compression). Four layers are `BaseHTTPMiddleware` subclasses, which wrap every response body through anyio memory streams — a tax on the large-file download hot path.

**Per-route handler pattern (copy-pasted ~130×):**
`validate filename → read_upload (full body into RAM) → validate_pdf_content (magic bytes only) → get_temp_path + write temp file (UUID name) → await asyncio.to_thread(service_fn) → FileResponse(background=BackgroundTask(remove_files, ...))`, with three near-identical `except` clauses.

**Layering.** `routes/*` are thin HTTP adapters; `services/*` (~87 modules) wrap one engine each (PyMuPDF/fitz, pikepdf, Pillow, WeasyPrint, ffmpeg, LibreOffice, tesseract, rembg). `utils/*` centralizes the genuinely shared, security-sensitive primitives. The route files are grouped **by ship-date** (`phase1-7_tools.py`, `new_tools.py`, `pdf_extra.py`) rather than by domain — the central maintainability tax.

**Concurrency model.** CPU work is correctly pushed off the loop via `to_thread`, but onto the *default* executor (`min(32, cpu+4)` ≈ 6 threads/worker). Several services then **nest** their own `ThreadPoolExecutor(max_workers≤4)` inside that thread for per-page parallelism. There is **no global concurrency gate** and **no `set_default_executor`** anywhere.

**Temp lifecycle.** Two disjoint namespaces: the **managed** one (`TEMP_DIR` → `/app/temp` volume, swept by a per-worker lifespan janitor every 300s for files >600s old) and an **unmanaged** one (raw `tempfile.mkstemp/mkdtemp` → system `/tmp`, **never swept**).

**Egress.** Exactly two server-side egress paths exist: the GA4 analytics proxy (pageview metadata only, no file content) and the HTML→PDF URL fetcher (SSRF-guarded). Everything else is a pure local transform; the AI tools (Summarize, Smart-Redact) run transformers.js entirely in the browser.

**Deploy.** A 60s systemd timer runs `auto-deploy.sh`: resolve latest `v*` tag → pull GHCR image → check revision label == tag SHA → `docker compose up -d --no-build` → gate on `/api/health` echoing the build SHA. Idempotent and self-healing on the happy path.

---

## 3. What's Genuinely Strong (credit where due)

This is not a weak codebase. For a free, no-account, public file-processing tool, the *defensive* engineering is above the bar:

| Area | What's done right |
|---|---|
| **SSRF** | `_validate_url` resolves DNS up front and rejects if *any* A/AAAA is private; re-validates *every redirect hop* and the final landing URL; `_PRIVATE_NETWORKS` is unusually complete (NAT64, IPv4-mapped, CGNAT, all TEST-NETs). Decimal/octal/hex IP and `nip.io` rebind names empirically caught. |
| **Decompression bombs** | Pillow `MAX_IMAGE_PIXELS=150M` set process-wide at import (a side-effect no service can forget); EPUB ingest caps per-entry/total/count on the *actual read length*, not the lying header. |
| **Header injection** | `safe_header_filename` strips CR/LF/control chars before `Content-Disposition` — systematic, not per-route. |
| **Upload cap** | Content-Length pre-check **plus** stream re-enforcement, explicitly defeating the chunked-Transfer-Encoding bypass. |
| **Auth** | Constant-time `secrets.compare_digest` over explicit UTF-8 bytes, TypeError-safe. |
| **Subprocess hygiene** | Every ffmpeg/LibreOffice/ghostscript call is argv-list (no `shell=True`), with wall-clock timeouts and SIGKILL-on-timeout reaping. |
| **Container blast radius** | `cap_drop ALL`, `no-new-privileges`, non-root, `pids:512`, mem 4G — an RCE in a native parser lands unprivileged with zero capabilities. |
| **Privacy-by-construction logging** | JSON formatter uses a strict `_EXTRA_FIELDS` allowlist; access log records only method/path-template/status/duration — never query strings, bodies, or filenames. Zero `print()` in `app/`. |
| **Request correlation** | RequestID minted at the outermost layer, bound to a contextvar (so service-layer logs in worker threads auto-correlate), echoed in headers *and* error bodies. |
| **Redaction** | `redact_service` uses `apply_redactions()` for true content removal, not opaque boxes. |
| **Supply-chain tooling** | cosign signing, SBOM + SLSA provenance, CodeQL, Scorecard, all Actions pinned by SHA, frontend fully locked. (The gaps are in *application*, not absence.) |
| **Deploy idempotency** | The wait-for-image guard correctly refuses to local-build-fallback on a tagged release; the health-SHA gate catches "container silently died." |

---

## 4. Deep Findings by Theme

Severities below are the **adversarially-confirmed** verdicts (which downgraded several originally-"high" findings to medium). Where the original analysis and the verdict diverge, I use the verdict.

### 4.1 Security & Threat Model

| # | Finding | Sev | Evidence |
|---|---|---|---|
| S1 | **No `cosign verify` at deploy.** Image trust rests on an unauthenticated OCI `revision` label, not the signature CI produces. "Signed" is conflated with "verified." | **High** | `auto-deploy.sh:142-154`; `grep -rn cosign` → only the signing step + comments. |
| S2 | **Released image never vulnerability-scanned.** The one artifact that gets the signature is the one never CVE-checked; existing Trivy scans are `scan-type: fs` on the repo, not the built image. | **High** | `release.yml:37-49`; `security.yml:99-132`. |
| S3 | **Cloudflare real-IP not restored in nginx.** On an orange-clouded apex, both the nginx `limit_req` zone and slowapi's rightmost-XFF key collapse to the CF edge IP. | **Med** | `nginx-privatools.conf:23`; `rate_limit.py:37-42`; no `set_real_ip_from` anywhere. **Currently latent** — apex not yet orange-clouded (`ROADMAP_STATUS.md:90`); SPA's expensive traffic flows through the grey api host which sees the true client IP. Wire the fix *before* orange-clouding. |
| S4 | **SVG→PNG fitz fallback bypasses the cairosvg SSRF/LFI guard.** The cairosvg path uses `block_external_refs`; the `fitz.open(filetype='svg')` fallback has no equivalent. Dormant today (cairo installed) but a libcairo regression silently switches to the unguarded backend. | **Med** | `svg_to_png_service.py:35-50`. Durable fix: sanitize SVG XML on ingress for *all* SVG consumers. |
| S5 | **Public OpenAPI/Swagger in prod** (`docs_url='/api-docs'`, `/openapi.json` unauthenticated) publishes the full attack surface to scrapers/fuzzers. | Low | `main.py:398-400`. Set `docs_url=None, openapi_url=None` when `_is_prod`. |
| S6 | **Route-level handlers leak `str(exc)` to clients** (`detail=f"Processing failed: {exc}"`) across ~40 routes, exposing temp paths and library internals — and *pre-empting* the global handler that deliberately returns generic 500s. | Med | `merge.py:142`, `developer.py:204`, +~35. |
| — | Weak phase3 `_validate_public_url`; IPv4-mapped/DNS-rebind TOCTOU. | n/a | **Already tracked** (SSRF consolidation task). Don't reopen. |

**Threat-model read:** the classic injection/authz/SSRF surfaces are well-defended. The live security exposure is (1) the supply-chain trust gap (S1/S2 — a malicious image carrying the right label runs as prod), and (2) info-disclosure via leaked exception strings (S6). S3 is a real correctness/trust-boundary bug but its *security* impact is blunted by the grey-host routing.

### 4.2 Concurrency / Performance / Event-loop

This is the densest cluster, and it's all one root cause: **no admission control + nested pools + whole-file RAM buffering.** Multiple specialists independently flagged it (hence the apparent duplication in the findings list — they are facets of the same defect).

| # | Finding | Sev | Evidence |
|---|---|---|---|
| C1 | **No global concurrency cap; nested `ThreadPoolExecutor`s inside `to_thread`.** ~6 default-executor threads × up to 4 nested × 2 workers ≈ 30-50 runnable CPU threads on 1.8 cores → context-thrash, super-linear p95. | **Med** | `ocr_service.py:146`, `pdf_to_image_service.py:140`, `pdf_to_word_service.py:153`, `invert_colors.py:65`, `phase6_tools.py:24`. No `Semaphore`/`set_default_executor` anywhere. |
| C2 | **`batch_compress_pdf` drains a `concurrent.futures` pool synchronously inside an async handler** — `for future in as_completed(futures)` blocks the *event loop*, stalling every concurrent request on that worker for the whole 50-file batch. | **Med** | `phase6_tools.py:74`. |
| C3 | **All uploads buffered fully in RAM; `stream_upload_to_disk` is dead code** (zero call sites). With 500MB cap × 50 concurrency/worker on a 4G container, concurrent large uploads are the single most likely OOM trigger. | **High** | `route_helpers.py:130` (unused); 103 `read_upload` + 51 bare `await file.read()` sites. |
| C4 | **Unbounded page count → all pages in RAM.** TIFF branch accumulates `pages_pil: list[Image]`; OCR builds `page_pdfs=[...]` for the whole doc before fanning out. A tiny high-page-count PDF is an OOM bomb. | **High** | `pdf_to_image_service.py:78-92`; `ocr_service.py:142`. No `MAX_PAGES` anywhere (sibling routes *do* cap at 200 — generalize it). |
| C5 | **`os.cpu_count()`-derived pool sizing is fragile** — returns host cores under a CFS quota, so resizing the VM multiplies oversubscription. | Low/Med | All nested-pool sites. Size from a single `CPU_BUDGET` env. |
| C6 | **No native-thread caps** (`OMP_NUM_THREADS`, onnxruntime intra-op, `cv2.setNumThreads`) — BLAS/ONNX each spawn all-core pools *on top of* the Python fan-out. | Med | Dockerfile (none set); `bg_remover_service.py`. |
| C7 | **`html_to_pdf` keep-alive `_conn_cache` is shared across threads with no lock** — `http.client` is not thread-safe; concurrent same-host fetches can cross-wire responses (a data-mix bug on a privacy product). | Med | `html_to_pdf_service.py:416`. |

> **The thread/RAM math, made concrete:** capacity here is bounded by **RAM-per-in-flight-request**, not the 24 GB VM or the 2 cores — the 4 GB container cap is the real ceiling, and `read_upload`'s whole-file buffering means a handful of concurrent 300-500 MB uploads OOMs before CPU even saturates. The `--limit-concurrency 50` knob is set ~10× above the box's actual saturation point.

### 4.3 Scalability & Failure Modes

| # | Finding | Sev | Evidence |
|---|---|---|---|
| SC1 | **`default_limits` is dead; ~120 of 138 endpoints have no per-IP throttle.** Includes every cheap-but-not-free PDF/image op. | **Med** | `rate_limit.py:45-60`, `main.py:147-152`. |
| SC2 | **The *heaviest* subprocess routes carry no app-layer limit** — `office-to-pdf` (LibreOffice), all 8 ffmpeg routes, `compress` (pikepdf), `pdf-to-pdfa`, `remove-background` (rembg). Violates the code's own contract comment. `office-to-pdf` also uses bare `file.read()` with no post-read validation. | **High** | `office_to_pdf.py:17`, `new_tools.py:264-546`, `phase2_tools.py:116`, `compress.py:28`. |
| SC3 | **Per-worker in-memory rate-limit state** — with 2 workers the effective per-IP cap is ~2× and nondeterministic; forecloses horizontal scale (no shared store). | Med | `rate_limit.py:60` (no `storage_uri`). |
| SC4 | **nginx 120s `proxy_read_timeout` vs app 300s.** Client gets 504 at 120s while the uncancellable worker thread keeps burning a core to 300s → cascading-timeout collapse, amplified by client/CDN retries. | Med | `nginx.conf:189`; `RequestTimeoutMiddleware` (300s). |
| SC5 | **No nginx `limit_req`/`limit_conn`; grey-clouded `api.privatools.me` bypasses Cloudflare.** The heaviest traffic (large uploads → expensive conversions) hits the path with the *least* protection. | Med | `nginx.conf` (no limit zones on api vhost). |
| SC6 | **Single container / VM / janitor = whole-box SPOFs**, brief downtime per deploy, no automated rollback (self-heal re-pulls the *same* bad tag every 60s). | Med | `docker-compose.yml`; `auto-deploy.sh:154-174`. |

**Failure shape:** degradation is **cliff-edge, not graceful**. The box runs fine until concurrent heavy jobs cross the CPU/RAM threshold, then OOM-kills or correlated 504 storms take down both workers at once. There is no 503-Retry-After backpressure path today.

### 4.4 Data & Privacy

| # | Finding | Sev | Evidence |
|---|---|---|---|
| **D1** | **`merge_service` fixed output filename → cross-user PDF leak** under concurrency. The one genuine data-leak bug. | **High** | `merge_service.py:70`. |
| D2 | **`office_to_pdf` leaves a second full copy** of the user's document in `TEMP_DIR` (`shutil.copy2` to an untracked path) until the janitor sweeps it (~10 min) — for exactly the file type most likely to hold sensitive business data. | Med | `office_to_pdf_service.py:58-61,119-124`. |
| D3 | **Timeout 504 / OOM / disconnect orphans temp files** — the BackgroundTask cleanup never attaches, so retention degrades from "prompt" to janitor-cadence precisely for the slow/large files. | Low | `main.py:373-382`. |
| D4 | **HTML→PDF logs the user-supplied target hostname**, contradicting the "never log filenames/PII" contract. | Low | `html_to_pdf_service.py:531`. |
| D5 | **GA4 egress is env-gated with no machine-readable disclosure** in the transparency endpoint — *some* user data (stable `client_id` + path) leaves to a third party; the privacy claim depends entirely on frontend copy not in this repo. | Low | `analytics.py:56-118`. |
| D6 | **CSV/formula injection** in `table_extractor` — cells starting `=`/`+`/`-`/`@` are written unescaped; the downloaded CSV attacks the user's own spreadsheet app. | Med | `table_extractor_service.py:64`. |

### 4.5 Reliability / Ops & Observability

| # | Finding | Sev | Evidence |
|---|---|---|---|
| **O1** | **No Docker log rotation.** Default json-file driver, no `max-size`. A 5xx storm or a forgotten `DEBUG` session fills the disk → temp writes fail → `/readyz` 503 → docker wedges. | **Med** | `docker-compose.yml` (no `logging:` block). |
| **O2** | **Media/archive tools leak into system `/tmp`**, which the janitor never sweeps. Leaks on every non-BackgroundTask exit path (timeout, OOM, disconnect, SIGKILL). The janitor docstring *falsely* claims it covers these. | **Med** | `non_pdf_tools.py:129,138,704`; `video_tools_service.py:83`; `cleanup.py:114`. **One-line fix:** `ENV TMPDIR=/app/temp`. |
| O3 | **uvicorn launched without log-config override** — its plain-text worker/crash lines (SIGKILL, OOM restart, bind failure) bypass the JSON formatter and break the jq-over-stdout dashboard *exactly during incidents*. The author knew (`logging.py:191-192`) but never wired it. | Med | `Dockerfile:110`. Fix: set the 3 uvicorn loggers `propagate=True`. |
| O4 | **Docker healthcheck probes `/api/health` (liveness), not `/readyz`.** A container with broken deps (e.g. fitz import failure, which the Dockerfile *tolerates*) reports healthy, passes the deploy gate, and serves mass 500s. | Med | `docker-compose.yml:55-59`. |
| O5 | **Hung worker thread is invisible** — no in-flight gauge, no thread/memory metric, no request-start log, no rate/error aggregation. The most likely real incident (a file wedging a thread) shows a 504 then nothing. | Med | `main.py:373-382`; `access_log.py:73-109`. |
| O6 | **DEPLOY_PING_URL covers deploy success only** — no runtime liveness heartbeat, so a post-deploy degradation goes unnoticed until a user reports it. | Med | `auto-deploy.sh:37-44`. |
| O7 | **No disk-space monitoring**; `/readyz` doesn't check free space. On a single VM with 500 MB uploads, disk-fill is a realistic self-DoS. | Med | `cleanup.py:95-137`. |

### 4.6 Dependencies & Supply Chain

| # | Finding | Sev | Evidence |
|---|---|---|---|
| **DEP1** | **14 of 26 prod Python deps unpinned** — every heavy native parser (`pymupdf`, `weasyprint`, `onnxruntime`, `rembg`, `cairosvg`, `pyzbar`, …). No lockfile, no hashes. `pymupdf` alone is fed raw bytes by ~40 files. Non-reproducible builds + silent malicious-release vector. | **High** | `requirements.txt:12-26`; `Dockerfile:57`. |
| DEP2 | **Base images pinned by mutable tag, not digest**; no `docker` ecosystem in dependabot. | Med | `Dockerfile:2,13`. |
| DEP3 | **Full C toolchain (`build-essential`, `swig`, `libffi-dev`) shipped in the runtime image** — raises post-exploitation capability for the exact RCE-blast-radius surface (native parsers). | Med | `Dockerfile:40-42`. |
| DEP4 | **Transitive tree unconstrained** (starlette/anyio/numpy float freely) — starlette has had multipart/form-parsing CVEs directly relevant to an upload service. | Med | Lockfile remedy covers it. |
| DEP5 | **`python:3.10` EOL Oct 2026** with no forcing function; the migration touches the entire native-wheel matrix. | Forward risk | — |

---

## 5. Prioritized Roadmap

Effort is rough: **S** = <½ day, **M** = 1-3 days, **L** = ~1 week+.

### P0 — Do now (correctness, data-leak, trivial-DoS)

| Item | Why | Effort |
|---|---|---|
| **Fix `merge_service.py:70` to a UUID path** (`temp_output("merged","pdf")`). | Cross-user PDF leak + corrupt downloads. One line. Highest payoff/effort ratio in the report. | **S** |
| **Cap fitz pixmap pixels before every `get_pixmap`** (shared helper: reject/downscale above ~50-150 MP) **and add a `MAX_PAGES` cap** (generalize the existing `long_image_service` 200-page cap). Apply to pdf-to-image (5 sites), ocr, deskew, long_image, invert_colors. | Tiny crafted PDF OOM-kills a worker (= 50% capacity). Closes C4 + the two fitz-bomb findings at once. | **M** |
| **Introduce one process-wide `asyncio.Semaphore(~cpu_count)`** acquired around every heavy `to_thread`, returning 503/Retry-After when full; **and stop nesting per-request pools** (render serially or draw from the global budget). | The single highest-leverage structural fix — converts cliff-edge collapse into bounded queueing and closes C1, C5, and the botnet-bypass that per-IP limits can't. | **M** |
| **Stamp `@limiter.limit(EXPENSIVE_RATE_LIMIT)` on the heavy unthrottled routes** — office-to-pdf, all 8 ffmpeg, compress, pdf-to-pdfa, deskew, auto_crop, redact, remove-background, pdf-to-image. Add `read_upload` validation to office-to-pdf. | Cheap, unauthenticated, low-skill DoS on the most expensive operations. Honors the code's own contract. | **S** |
| **Add `ENV TMPDIR=/app/temp`** to the Dockerfile (closes O2 with no code rewrite — the janitor already recurses subdirs) and fix the false janitor docstring. | Stops the slow `/tmp` disk leak that takes down all tools at once. | **S** |
| **Add Docker log rotation** (`logging: {driver: json-file, options: {max-size: 50m, max-file: 5}}`). | Stops the unbounded-stdout disk-fill outage. | **S** |
| **Fix `batch_compress_pdf` event-loop block** — wrap the submit+drain in a single `to_thread` or use `asyncio.gather`. | Freezes 50% of capacity for a full 50-file batch. | **S** |
| **Add `cosign verify` (fail-closed) before `compose up`**, pin by digest; keep the label check as secondary. | The deploy trust anchor is currently a forgeable label. | **M** |

### P1 — Next (hardening, observability, supply-chain integrity)

| Item | Why | Effort |
|---|---|---|
| **Migrate large-file routes to `stream_upload_to_disk`** + add a Content-Length-weighted concurrent-upload byte budget; replace the 51 bare `file.read()` sites. | The most likely production OOM trigger (C3). | **M** |
| **Generate a hashed lockfile** (`uv pip compile --generate-hashes`), install `--require-hashes`, point pip-audit/Trivy at it. | Reproducible builds + integrity for the 14 floating native parsers (DEP1/DEP4). | **M** |
| **Add a `scan-type: image` Trivy/Grype gate in `release.yml`** before signing; generate the SBOM from the built image. | Stop shipping signed-but-unscanned artifacts (S2). | **S** |
| **Point the Docker healthcheck + deploy gate at `/readyz`**; add a free-space check to `/readyz`. | A broken-deps container currently deploys "successfully" (O4) and disk-fill is undetected (O7). | **S** |
| **Make uvicorn loggers propagate through the JSON handler** + add an in-flight gauge / janitor heartbeat with `ru_maxrss` + a runtime `/readyz` liveness ping to DEPLOY_PING_URL. | Restores incident visibility (O3, O5, O6). | **M** |
| **Set native-thread caps** (`OMP_NUM_THREADS=1/2`, onnxruntime intra-op, `cv2.setNumThreads`) and a `threading.Lock` on `_conn_cache`. | Stops BLAS/ONNX over-subscription (C6) and the cross-request data-mix bug (C7). | **S** |
| **Return generic 500 detail** from route handlers; let the global handler classify. Sanitize CSV cells. | Closes info-disclosure (S6) and CSV injection (D6). | **S** |
| **Add nginx `limit_req`/`limit_conn`** on `/api/` and the grey api vhost as a coarse pre-filter; restore Cloudflare real-IP **before** orange-clouding the apex. | First line of defense the app currently lacks (SC5, S3). | **S** |
| **Disable prod OpenAPI/Swagger** (`docs_url=None, openapi_url=None`). | Stop advertising the unthrottled surface (S5). | **S** |
| **Align timeouts** (app/subprocess < nginx 120s) and disable edge retry-on-504 for tool endpoints. | Stops cascading-timeout collapse (SC4). | **S** |
| **Clean up office-to-pdf intermediate copy** in a `finally`; track timeout-orphaned temp paths on `request.state`. | Tightens the "deleted promptly" promise (D2, D3). | **S** |

### P2 — Later (maintainability, scale-out, structural)

| Item | Why | Effort |
|---|---|---|
| **Extract a `process_upload_tool` helper/decorator** encapsulating validate→temp→offload→respond→cleanup→error-map; migrate the ~130 hand-rolled handlers onto it. | The copy-paste lifecycle is how every divergence bug (the `/tmp` split, the leaked exception strings, the missed `to_thread` offloads) is born. Makes future cross-cutting fixes one-line. | **L** |
| **Regroup routes by domain** (`video.py`, `audio.py`, `image_ops.py`) and retire the phase-naming. | Finding all ffmpeg/image handlers currently means reading 4-5 files. | **M** |
| **Single machine-readable tool catalog**; generate the backend `_PDF_TOOLS`/`_NONPDF_TOOLS`, endpoints, and HowTo/FAQ from it. Add a CI contract test asserting every FE slug resolves to a registered route. | The catalog is triplicated across 2 languages; a backend-only slug typo turns a real tool into a crawler soft-404. | **M** |
| **Move slowapi to a shared store (Redis)** + externalize temp I/O / shared file store. | Prerequisites for any horizontal scale; also fixes the 2× per-worker limit today (SC3). | **L** |
| **Reconcile deploy config drift** — delete/archive the systemd-native model, set `TEMP_DIR` explicitly in compose, fix stale `.env.example`/domain. | Three contradictory deploy definitions; an incident operator may follow the wrong runbook. (Confirmed **low** — the canonical compose deploy is internally consistent; this is ops-clarity, not a data bug.) | **S** |
| **Multi-stage build** to drop the runtime toolchain (DEP3); digest-pin bases (DEP2); schedule the py3.12 migration (DEP5). | Shrinks RCE blast radius and CVE surface. | **M** |
| **Automated rollback** in `auto-deploy.sh` (track last-good image; revert on health-loop failure). | Bad release currently stays broken until a human intervenes. | **M** |

---

## 6. Forward Risks as the System Scales

1. **The cliff gets closer, not farther.** Every new tool tends to add another native parser (the riskiest dep class) and another copy-pasted unthrottled handler. Without the global concurrency gate (P0) and the lifecycle helper (P2), DoS resistance *degrades* with the tool count, and the failure mode stays cliff-edge.

2. **Capacity is RAM-bound, and the ceiling is mis-advertised.** The 24 GB VM is mostly idle behind a 4 GB container cap; whole-file buffering means the true ceiling is low-tens of concurrent heavy jobs. The grey-clouded `api.privatools.me` exists specifically to allow >100 MB uploads — i.e. the feature most likely to trigger OOM is being actively promoted, on the path with the *least* edge protection.

3. **Horizontal scale is foreclosed by three coupled assumptions** — in-process rate-limit state, local-disk temp files, no shared object store. Adding a second instance is a project, not a config change, and "move to a bigger VM" *worsens* thread oversubscription (the `os.cpu_count()` trap) until the pools are re-budgeted.

4. **Observability scales worse than the workload.** "Tail the logs with jq" works at 2 workers on one VM; at 4-8 workers or a second box, the absence of any aggregation point, in-flight gauge, or memory metric means you're blind exactly when load makes incidents frequent — and the unrotated, mixed-format log stream degrades precisely as worker restarts increase.

5. **The supply chain ages poorly.** Unpinned native parsers mean CVE exposure drifts silently upward on every rebuild; the cosign provenance gives false confidence until `verify` + image scanning land. A future fitz/ffmpeg/LibreOffice CVE ships to prod before anyone notices, in the one signed artifact nothing checks.

6. **The privacy promise weakens under load, not over time.** "Files deleted promptly" is janitor-bounded, not request-bounded, on every failure path (timeout, OOM, the office_to_pdf copy). As crash frequency rises under attack/load, the steady-state count of orphaned full-document copies between sweeps grows with it — a privacy blast radius that expands exactly when the system is most stressed.

---

*Bottom line: the security fundamentals are solid and the deploy automation is thoughtful. The work that matters is almost entirely **resource governance** (one semaphore, page/pixel caps, real rate-limit coverage) and **ops hygiene** (log rotation, TMPDIR, cosign verify, image scanning). The P0 list is ~2-3 days of focused work and closes every high-severity exposure. Do `merge_service` first — it's a one-liner standing between the product and its core privacy claim.*