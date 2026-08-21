# API Foundation (`/api/v1`) — Design

*Date: 2026-08-21 · Sub-project 0 of 4 · Status: approved, ready for implementation planning*

---

## 1. Context

PrivaTools is a server-side file-tools suite: ~235 frontend slugs onto 133 POST endpoints, FastAPI, 2 uvicorn workers in one Docker container (1.8 CPU / 4 GB) on a 2-core / 24 GB Oracle VM behind host nginx + Cloudflare. It has **no database, no auth, no session store, and no stateful service of any kind**. The container is destroyed and recreated on every release.

The goal is to open a **public, free-tier developer API**. That is too large for one spec, so it is decomposed into four sub-projects:

| # | Sub-project | Delivers | Depends on |
|---|---|---|---|
| **0** | **API foundation** — *this spec* | Redis, `/api/v1` surface, quotas, async jobs, OpenAPI, abuse hardening | — |
| 1 | Developer identity | GitHub OAuth, `/developers` dashboard, key issue/rotate/revoke | 0 |
| 2 | Quota + abuse enforcement UI | Usage views, alerts, per-key overrides | 0, 1 |
| 3 | Developer DX | Docs site, samples, playground, clients | 1, 2 |

### Goal

Ship a versioned, quota-enforced, documented API surface that works today with statically-configured keys, and that sub-project 1 can put self-serve accounts behind **additively** — no rewrite.

### Non-goals

- **No accounts, signup, login, OAuth, email, or password storage.** That is sub-project 1.
- **No billing, plans, or paid tiers.**
- **No change to the public tool site.** It stays 100% account-free. The `ComparePage` claim *"No account required: Yes"* remains true and must not be edited.
- No video/audio endpoints in v1 — different audience, deferred to v2.
- No migration of the existing 133 `/api/*` routes. They stay, unversioned and explicitly documented as unstable.

### Constraint that shapes everything

The moment free keys are issued, the worst case stops being "someone DoSes us" and becomes "someone runs a free compute farm on our VM." Quotas and the abuse fixes in §8 are therefore **in scope for this sub-project**, not deferred.

---

## 2. Architecture

```
                    ┌─────────────────────────────────────────┐
  api.privatools.me │  nginx (grey-clouded, no CF 100MB cap)  │
  (already exists,  │  limit_req 10r/s · limit_conn 24        │
   flag-gated)      └──────────────────┬──────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────┐
                    │  FastAPI  (2 uvicorn workers)           │
                    │                                         │
                    │  /api/v1/*   ← NEW: thin, uniform       │
                    │  /api/*      ← unchanged, unstable      │
                    └────────┬───────────────────┬────────────┘
                             │                   │
              ┌──────────────▼─────┐   ┌─────────▼──────────┐
              │ Redis (sidecar)    │   │ app-temp volume    │
              │ quotas · job state │   │ uploads · results  │
              │ slowapi storage    │   │ jobs/ subdir       │
              └────────────────────┘   └────────────────────┘
```

### Key architectural decision

**v1 handlers are new thin handlers that call the same service functions — not aliases of the existing route functions.**

The existing ~130 handlers each hand-roll validate → temp → offload → respond → cleanup → error-map. That copy-paste is the documented root cause of every divergence bug in this codebase (the `/tmp` split, leaked exception strings, missed `to_thread` offloads). Aliasing those handlers would bake their inconsistency into a contract that can never be changed.

Instead, every v1 handler routes through one shared lifecycle built on the existing `app/utils/upload_helper.process_pdf_upload`. The contract is uniform by construction and a cross-cutting fix lands in one place.

Side effect: the new package is grouped **by domain**, not by ship date. This delivers the P2 "regroup routes by domain" roadmap item on the new surface at zero extra cost, and gives the eventual bulk migration of the old handlers a target to migrate *toward*.

### New/changed files

| Path | Purpose |
|---|---|
| `backend/app/api_v1/__init__.py` | Router assembly, `/api/v1` prefix |
| `backend/app/api_v1/manipulate.py` | merge, split, compress, rotate, crop, resize, nup, pages |
| `backend/app/api_v1/convert.py` | office/word/excel/pptx/image/text/html/url/ocr |
| `backend/app/api_v1/secure.py` | protect, unlock, strip-metadata, redact, sanitize |
| `backend/app/api_v1/stamp.py` | watermark, page-numbers, header-footer, bates |
| `backend/app/api_v1/utility.py` | page-count, metadata, flatten, repair |
| `backend/app/api_v1/pipeline.py` | chained execution |
| `backend/app/api_v1/jobs.py` | `GET /jobs/{id}`, `GET /jobs/{id}/result` |
| `backend/app/api_v1/deps.py` | key resolution + quota dependency |
| `backend/app/api_v1/errors.py` | v1 error envelope |
| `backend/app/utils/store.py` | Redis client, `quota_consume`, optional-degrade |
| `backend/app/utils/jobs.py` | job lifecycle (create/update/get/purge) |
| `backend/app/utils/cleanup.py` | **modified** — `jobs/` subdir sweep (§6.3) |
| `backend/app/middleware/error_handlers.py` | **modified** — sanitize `ToolError` 5xx (§7.3) |
| `backend/app/rate_limit.py` | **modified** — Redis `storage_uri` (§5.4) |
| `docker-compose.yml` | **modified** — redis service, explicit env |

---

## 3. The v1 surface (35 endpoints)

Every name here becomes a permanent stability commitment.

**Classification rule:** an endpoint is **async** iff it shells out to a subprocess, rasterizes every page, or chains. Everything else is **sync**. This rule is mechanical — apply it to decide any future endpoint.

| Group | Endpoint | Mode |
|---|---|---|
| **manipulate** | `merge` `split` `compress` `rotate` `crop` `resize` `nup` `extract-pages` `delete-pages` `organize-pages` `reverse` | sync ×11 |
| **convert** | `image-to-pdf` | sync ×1 |
| | `office-to-pdf` `pdf-to-word` `pdf-to-excel` `pdf-to-pptx` `pdf-to-image` `pdf-to-text` `html-to-pdf` `url-to-pdf` `ocr` | async ×9 |
| **secure** | `protect` `unlock` `strip-metadata` `redact` `sanitize` | sync ×5 |
| **stamp** | `watermark` `page-numbers` `header-footer` `bates` | sync ×4 |
| **utility** | `page-count` `metadata` `flatten` `repair` | sync ×4 |
| **chain** | `pipeline` | async ×1 |

**Totals: 25 sync + 10 async = 35.**

Two calls worth recording: `pdf-to-text` is fast on digital PDFs but rasterizes on scanned input, so it is async for *predictability* — a client should never have one endpoint behave two ways. `image-to-pdf` sits in the convert group for discoverability but does no subprocess work, so it is sync.

### Classification is fixed and documented

No `Prefer: respond-async` negotiation in v1. A client always knows which mode an endpoint uses from the docs. (Deliberate YAGNI — revisit only if a real consumer asks.)

---

## 4. Request/response contracts

### Sync

```http
POST /api/v1/compress HTTP/1.1
Host: api.privatools.me
X-API-Key: pk_live_…
Content-Type: multipart/form-data

file=@doc.pdf&level=balanced
```
```http
HTTP/1.1 200 OK
Content-Type: application/pdf
X-Request-ID: 58e338bd4972
X-RateLimit-Limit: 500
X-RateLimit-Remaining: 494
X-RateLimit-Reset: 1755820800
Cache-Control: no-store, max-age=0
```

The input temp file and the output file are both purged by the existing `BackgroundTask(remove_files, …)`. **Nothing is retained.**

### Async

```http
POST /api/v1/office-to-pdf     →  202 Accepted
{ "job_id": "job_9f2c…", "status": "queued", "poll_after_ms": 1000,
  "expires_at": "2026-08-21T07:38:42Z" }

GET  /api/v1/jobs/job_9f2c…    →  200 OK
{ "job_id": "job_9f2c…", "status": "running", "endpoint": "office-to-pdf",
  "created_at": "…", "expires_at": "…" }
                                →  200 OK  (terminal)
{ "job_id": "…", "status": "done", "result_url": "/api/v1/jobs/job_9f2c…/result",
  "result_bytes": 184223, "expires_at": "…" }
                                →  200 OK  (failed)
{ "job_id": "…", "status": "error",
  "error": { "code": "external_tool_failed", "message": "Conversion failed." } }

GET  /api/v1/jobs/job_9f2c…/result  →  200 + application/pdf, then purged
```

`status` ∈ `queued | running | done | error | expired | consumed`.

Fetching a result **purges the file and marks the job `consumed`** — one-shot download. A second fetch returns `410 Gone` with code `result_consumed`. This keeps retention as short as physically possible.

### Job execution model

Jobs run as `asyncio.create_task` on the accepting worker, with the actual work inside `run_bounded` (so the admission gate governs them exactly like sync work).

**Known limitation, accepted for sub-project 0:** a job is bound to the worker that accepted it. If that worker restarts mid-job, the job is orphaned and its Redis state times out to `expired`. With 2 workers and a deploy that drains, this is rare and the failure mode is a clean `expired` status, not a hang. A real queue (worker pool consuming from Redis) is the sub-project 2 upgrade if job volume justifies it. **Poll requests already work across workers** because job state lives in Redis — only execution is worker-local.

---

## 5. Quota model

### Keys

Sub-project 0 reads keys from `PRIVATOOLS_API_KEYS` (comma-separated) via the existing `app/auth/api_key.py`. Two required changes:

1. **`require_api_key` must fail closed on the v1 surface.** Today it returns `"anonymous-dev"` when no keys are configured, and `PRIVATOOLS_API_KEYS` is unset in `docker-compose.yml` — so the developer routes are currently public. v1 uses a separate `require_v1_key` dependency that **401s when no keys are configured**. The lenient helper stays as-is for the legacy `/api/developer/*` routes.
2. **Raw keys are never logged or stored.** The quota identity is `key_id = sha256(key).hexdigest()[:16]`. Only `key_id` appears in Redis, logs, and metrics.

Sub-project 1 replaces the env lookup with a DB lookup behind the same `resolve_key(raw) -> KeyRecord` interface. Nothing downstream changes.

### Cost weights

| Cost | Applies to |
|---|---|
| 1 | Sync PDF ops (manipulate, secure, stamp, utility) |
| 5 | Subprocess conversions, rasterizing ops, network-egress ops (`office-to-pdf`, `pdf-to-*`, `ocr`, `html-to-pdf`, `url-to-pdf`) |
| Σ steps | `pipeline` — sum of its constituent step costs |

### Free-tier limits (env-tunable)

| Limit | Default | Env var |
|---|---|---|
| Cost units / day | 500 | `API_V1_DAILY_UNITS` |
| Upload bytes / day | 250 MB | `API_V1_DAILY_BYTES` |
| Concurrent async jobs / key | 3 | `API_V1_MAX_JOBS_PER_KEY` |

Quota is consumed **before** work starts. Bytes are counted from `Content-Length`, then reconciled against actual streamed bytes (a chunked upload without `Content-Length` is charged its real size after streaming; if that pushes the key over, the *next* request is refused rather than this one being torn down mid-flight).

Over quota → `429` with `Retry-After` (seconds to UTC midnight) and `X-RateLimit-*`.

### Redis schema

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `q:u:{key_id}:{YYYYMMDD}` | counter | 48h | daily cost units |
| `q:b:{key_id}:{YYYYMMDD}` | counter | 48h | daily upload bytes |
| `q:j:{key_id}` | counter | — | in-flight async jobs (INCR on accept, DECR in `finally`) |
| `job:{job_id}` | hash | 3600s | status, endpoint, key_id, timestamps, result_path, error |
| slowapi (db 1) | — | — | per-IP limiter storage |

### SC3 fixed as a side effect

`app/rate_limit.py` gains `storage_uri=REDIS_URL`. The existing per-IP limits stop being per-worker — today a "5/minute" cap is really ~10/minute and nondeterministic across 2 workers. **This benefits the anonymous public site, not just the API.**

### Redis is optional

If `REDIS_URL` is unset, the app starts with in-process fallbacks, `/api/v1` is disabled, and async jobs are unavailable. This keeps `docker compose up` working standalone for self-hosters — the README's self-host promise stays true without forcing a second service on them.

---

## 6. Storage and retention

### 6.1 What is retained

| Data | Where | Retention |
|---|---|---|
| Sync input/output | `app-temp` volume | Purged by `BackgroundTask` on response completion |
| Async input | `app-temp` volume | Purged when the job reaches a terminal state |
| Async result | `app-temp/jobs/` | Until fetched, or 1h, whichever comes first |
| Job metadata | Redis | 1h TTL (`job_id`, `key_id`, endpoint, timestamps — **no filenames, no content**) |
| Quota counters | Redis | 48h TTL (`key_id` + integers only) |

### 6.2 Privacy-policy impact — required, not optional

[`frontend/src/pages/PrivacyPage.tsx:348`](../../../frontend/src/pages/PrivacyPage.tsx) currently states:

> *"No retention: We do not retain copies, backups, thumbnails, or metadata from your files. Once deleted, they are unrecoverable."*

Async job results **are retained for up to one hour**. This claim must gain an API-scoped carve-out before v1 ships publicly. Proposed wording:

> *"Files processed through the website are never retained. Files submitted to the `/api/v1` developer API using an asynchronous endpoint are held only until you download the result, and in no case longer than one hour, after which they are deleted automatically."*

**Ship-blocking.** Shipping async endpoints while the policy says otherwise is a false statement in a published privacy policy.

Note: [`PrivacyPage.tsx:457`](../../../frontend/src/pages/PrivacyPage.tsx) (*"Since we collect no personal data and require no accounts…"*) stays **true** in sub-project 0 — no accounts here. It becomes a sub-project 1 problem.

### 6.3 The janitor must learn about job results

`app/utils/cleanup.py` sweeps `TEMP_DIR` for entries older than `TEMP_MAX_AGE_SECONDS` (600s). A job result with a 1h TTL would be **deleted out from under the client at the 10-minute mark** — surfacing as intermittent, hard-to-reproduce `404`s.

Fix: job results are written to `TEMP_DIR/jobs/`. `cleanup_old_files` special-cases that directory — it is never rmtree'd as a unit; its *contents* are swept against `JOB_RESULT_MAX_AGE_SECONDS` (default 3900 = 65 min, deliberately just over the 1h TTL so Redis expiry always wins the race).

This is a small change that is easy to miss and produces confusing flakiness if missed. It has a dedicated test.

---

## 7. Error contract

### 7.1 Envelope

```json
{ "error": { "code": "file_too_large",
             "message": "File exceeds the 500 MB limit.",
             "request_id": "58e338bd4972" } }
```

Today the API returns `{"detail": "<human string>"}`. Developers branch on machine-readable codes, not prose. The `code` is stable; `message` is not.

### 7.2 Code table

| HTTP | `code` | Source |
|---|---|---|
| 400 | `invalid_input` | `ValidationError` |
| 400 | `pdf_corrupt` | `PdfCorruptError` |
| 400 | `pdf_encrypted` | `PdfEncryptedError` |
| 400 | `page_out_of_range` | `PageRangeError` |
| 400 | `unsupported_file_type` | `UnsupportedFileError` |
| 400 | `file_not_provided` | `FileNotProvidedError` |
| 401 | `invalid_api_key` | `require_v1_key` |
| 410 | `result_consumed` | job result already fetched |
| 410 | `job_expired` | job TTL elapsed |
| 413 | `file_too_large` | `FileTooLargeError`, upload middleware |
| 422 | `invalid_parameter` | `RequestValidationError` |
| 429 | `quota_exceeded` | daily units/bytes |
| 429 | `rate_limited` | per-IP slowapi |
| 429 | `too_many_jobs` | concurrent-job cap |
| 500 | `processing_failed` | `ProcessingError` |
| 502 | `external_tool_failed` | `ExternalToolError` |
| 503 | `dependency_unavailable` | `DependencyError` |
| 504 | `timeout` | `ToolTimeoutError`, request timeout |

### 7.3 Bug fix folded in: `ToolError` 5xx leak

`http_exception_handler` sanitizes 5xx detail (research finding S6). **`tool_error_handler` does not.** Verified empirically: `ProcessingError("…")` returns its raw detail verbatim in a 500 body, and `ExternalToolError` in a 502.

Two live leaks today:
- [`services/url_to_pdf_service.py:47`](../../../backend/app/services/url_to_pdf_service.py) — `ProcessingError(f"Could not fetch or render '{url}': {exc}")` leaks the target URL plus the full WeasyPrint exception.
- [`services/web_optimize_service.py:58`](../../../backend/app/services/web_optimize_service.py) — `ExternalToolError(f"qpdf linearize failed: {err[:200]}")` leaks up to 200 chars of qpdf stderr.

Fix `tool_error_handler` to apply the same ≥500 sanitization, and fix both call sites to stop interpolating. Regression test asserts no 5xx body ever contains a filesystem path.

### 7.4 Security headers on error responses

`RequestTimeoutMiddleware` and `UploadSizeLimitMiddleware` are added *after* `SecurityHeadersMiddleware`, so they sit outside it and their short-circuit responses (413, 504, 400-bad-Content-Length) carry **no CSP, no `nosniff`, no `X-Frame-Options`** — confirmed by test. Reorder so security headers wrap the short-circuiting layers, and add an assertion that every response, including 413/504, carries `X-Content-Type-Options: nosniff`.

---

## 8. Abuse hardening (in scope — blocking)

Free keys invert the abuse economics. These land in this sub-project.

| # | Issue | Fix |
|---|---|---|
| 1 | `MAX_CONCURRENT_HEAVY` unset → `cpu_count×4` = 8/worker × 2 = **16 heavy threads on 1.8 CPUs**. The gate exists but is tuned ~9× above saturation. | Set explicitly in compose. Start at **4**, tune with load. |
| 2 | `/api/extract-archive`: no rate limit; 500 MB in → **2 GB** extracted → then re-zipped on the same volume. `/readyz` trips under 250 MB free. Two concurrent calls take every tool down. | `@limiter.limit(EXPENSIVE_RATE_LIMIT)`; lower `MAX_EXTRACTED_BYTES` to 512 MB and make it env-tunable; free-disk pre-check before extraction. |
| 3 | `/api/compare`: no rate limit, no `run_bounded`, holds up to 50 rendered page-images (~150–300 MB) then holds them all again for `save_all`. ~13 concurrent → worker OOM. | Rate limit; route through `run_bounded`; lower the 50-page `HARD_CAP` and stream pages to the output instead of accumulating. |
| 4 | `check_render_page_count` is wired into `ocr_service` only. `pdf_to_image_service`'s multi-page TIFF branch — the exact site the research named — accumulates every page as a PIL image with no cap. | Wire `check_render_page_count` into `pdf_to_image_service` (both the TIFF branch and the `page_pdfs` accumulation). |
| 5 | **83** `asyncio.to_thread` calls remain in routes vs 57 `run_bounded`. Un-migrated heavy work bypasses admission control entirely — including `/api/pipeline`, which chains up to 12 ops per request. | Migrate the heavy ones. `/api/pipeline`, `/compare`, and every route touching fitz rendering are mandatory; the rest is best-effort. |

Why `/extract-archive` and `/compare` were missed by the original research: SC2 measured "heavy" as *subprocess* usage. Both are heavy on **disk and RAM** with no subprocess, so they fell through the classifier.

---

## 9. OpenAPI and discoverability

`main.py` sets `openapi_url=None` in production (research S5 — don't publish 133 unstable routes to scrapers). That stays.

v1 gets its **own** schema, mounted as a separate `FastAPI` sub-application on the api host:

- `GET https://api.privatools.me/api/v1/openapi.json` — v1 routes only
- `GET https://api.privatools.me/api/v1/docs` — Swagger for v1 only

The unversioned `/api/*` surface remains undocumented and unpublished in prod. S5's intent is preserved: only the surface you have committed to is advertised.

---

## 10. Deployment

### docker-compose changes

```yaml
services:
  privatools:
    environment:
      - REDIS_URL=redis://redis:6379/0
      - API_V1_ENABLED=true
      - MAX_CONCURRENT_HEAVY=4
      - TEMP_DIR=/app/temp          # currently implicit-relative; make it explicit
      - PRIVATOOLS_API_KEYS=${PRIVATOOLS_API_KEYS:-}
    depends_on:
      redis: { condition: service_healthy }

  redis:
    image: redis:7-alpine
    command: redis-server --save "" --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
    restart: unless-stopped
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }
    security_opt: [ "no-new-privileges:true" ]
    cap_drop: [ ALL ]
```

**Redis runs without persistence** (`--save "" --appendonly no`). Quota counters and job state are intentionally ephemeral: a Redis restart resets today's quota (acceptable — fails open in the user's favour, and the per-IP limits still apply) and expires in-flight jobs (clients see `expired` and retry). **No volume, no backup story, no restore drill.** This is the single biggest ops simplification available and the reason Redis beats Postgres for sub-project 0. Sub-project 1's durable account data is a separate decision.

### `/readyz`

Add a `redis` check to `app/utils/health.py`. It is **required only when `API_V1_ENABLED`** — a self-hosted deploy without Redis must still report ready. Follows the existing optional-check pattern in that module.

### Auto-deploy interaction

`deploy/oracle-vm/auto-deploy.sh` runs `docker compose up -d --no-build`, which brings up both services. The rollback path only overrides `PRIVATOOLS_IMAGE`, so **Redis is untouched by a rollback** — verify explicitly, since a rollback that restarted Redis would reset quotas.

### Rollout

`API_V1_ENABLED=false` by default. Enable on the VM after a smoke test. The flag gates only the v1 router; the Redis-backed slowapi storage (SC3 fix) is independent and can ship first on its own.

---

## 11. Testing

| Area | Test |
|---|---|
| Contract | Every declared v1 slug resolves to a registered route — extends the existing `backend/tests/test_route_coverage.py` pattern |
| Quota | Consume → 429 at the boundary; `Retry-After` present; bytes and units tracked independently; concurrent-job cap; all against `fakeredis` |
| Job lifecycle | create → queued → running → done → fetch → `consumed` → second fetch `410` |
| Job expiry | TTL elapsed → `expired`; result file gone |
| Janitor | A file in `jobs/` survives past `TEMP_MAX_AGE_SECONDS` and is swept after `JOB_RESULT_MAX_AGE_SECONDS` (§6.3 regression) |
| Errors | Golden-file envelope per code; **no 5xx body contains a filesystem path** (§7.3 regression) |
| Headers | 200, 413, and 504 all carry `nosniff` + CSP (§7.4 regression) |
| Key auth | v1 401s when `PRIVATOOLS_API_KEYS` is unset; raw key never appears in logs |
| Degraded | `REDIS_URL` unset → app boots, v1 disabled, `/readyz` still ready |

### Pre-existing test debt to fix here

`backend/tests/test_api.py` — **40 tests that run nowhere.** They self-skip when nothing is listening on `localhost:8000`, and `.github/workflows/test.yml` starts no server. Locally: 555 passed, 40 skipped; in CI the same 40 skip. Either start the app in CI or convert them to `TestClient`. Building an API contract on a suite with a silent 40-test hole is not defensible.

Also delete the untracked `.github/workflows/ci.yml` sitting in the main checkout — it would add a **non-gating** pytest job (`continue-on-error: true`) on Python 3.11 against unhashed `requirements.txt`, duplicating and undermining `test.yml`.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Redis becomes a new SPOF for the whole app | v1 degrades to disabled without it; the anonymous site keeps working. Only the SC3 limiter upgrade makes Redis load-bearing for the public site — ship that behind its own flag and verify fallback. |
| Async jobs orphaned by a worker restart | Bounded: state expires to `expired`, client retries. Documented. A real queue is the sub-project 2 upgrade. |
| Job results extend retention → privacy claim goes stale | §6.2 policy update is ship-blocking. |
| v1 names become permanent mistakes | 35 endpoints, reviewed before merge. Anything uncertain stays on the unversioned surface. |
| Quota tuning wrong on first contact | All limits env-tunable; no redeploy to adjust. |
| Free keys → compute farming | §8 lands in this sub-project, not later. |
| Scope creep toward accounts | Explicit non-goal. `resolve_key()` is the seam sub-project 1 swaps behind. |

---

## 13. Decisions deferred to sub-project 1

- Identity provider (GitHub OAuth recommended: no password storage, no SMTP dependency, pre-verified email, idiomatic for a developer audience).
- Durable datastore for accounts and keys (SQLite-on-volume vs Postgres) — **not** decided here; Redis in this spec is deliberately non-durable.
- The `PrivacyPage.tsx:457` "requires no accounts" claim and the `ComparePage` differentiator row.
- Whether the public tool site ever gets accounts. Current answer: **no.**

---

## 14. Out-of-scope findings worth their own tickets

Surfaced during review; real, but not this spec's job.

- **`python:3.10` EOLs Oct 2026** — roughly two months out. Touches the whole native-wheel matrix. Needs scheduling now.
- **Deploy config drift is repo-side and unfixed.** `deploy/nginx.conf` names domain `privatools.com` (it is `.me`), carries 120s timeouts, and describes a systemd/venv model that no longer exists. `deploy/deploy.sh` and `deploy/privatool-backend.service` likewise. No DEPRECATED banner. An operator following these during an incident breaks production.
- **DEP2/DEP3 open** — base images pinned by mutable tag, no `docker` ecosystem in dependabot; `build-essential`/`swig`/`libffi-dev` still in the runtime image. With a fully hashed wheel lock the toolchain may now be removable — worth testing.
- **D3/D4/D5/C5 open** — timeout-orphaned temps, `html_to_pdf` logging the target hostname, no machine-readable egress disclosure at `/api/transparency/*`, no `CPU_BUDGET` for the nested pools.
- **The Pipeline page never calls the Pipeline API.** `PipelinePage.tsx` orchestrates client-side, re-uploading the whole file per step (50 MB × 5 steps = 250 MB up). Once `/api/v1/pipeline` exists, pointing the SPA at it is a large UX win and closes the round-trip gap against ihatepdf.cv's client-side workflow.
- **15 open dependabot PRs**, several touching the freshly hashed lockfile (uvicorn 0.27→0.49, pikepdf 8→10, pypdf, aiofiles, pytest). Unreviewed — this was Phase 3 of the review and was not completed.
