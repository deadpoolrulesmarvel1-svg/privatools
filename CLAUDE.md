# PrivaTools — notes for agents

Facts about this repo that are expensive to rediscover. Everything here was
learned by getting it wrong first.

## Verification

- **Type-check with `npx tsc --noEmit -p tsconfig.app.json`.** A bare
  `npx tsc --noEmit` resolves `tsconfig.json`, which has `files: []` and
  compiles *nothing* — it passes while real errors sit in the tree. The `-p`
  form is what CI runs.
- **Run the whole backend suite, not the files you touched.** A route-coverage
  test asserts every backend POST is either a registered tool or a named
  account endpoint, so adding an endpoint fails a file you never opened.
- **The backend suite segfaults on macOS.** Loop per-file to get a clean
  signal; CI on Linux runs it whole and passes. Two separate crashes:
  a native-library interaction across modules that kills a whole-suite run
  around 55%, and `tests/test_phased_routes.py`, which dies **even run alone**
  in `pyzbar.decode` (`qr_reader_service.read_qr`) on a pool thread — Homebrew
  zbar under Python 3.13. So a per-file loop reports one failing file with zero
  failing tests; that is the expected local result, not a regression. Confirm a
  change to that path in CI rather than locally.
- **CI does not run on a plain branch.** `test.yml` and `security.yml` trigger
  on pull requests and pushes to `main`. To verify a branch without a PR:
  `gh workflow run test.yml --ref <branch>`.
- **OpenSSF Scorecard always fails off `main`** — "Only the default branch main
  is supported". Not a code problem.

## Skins: there is only Daylight

The aurora, carbon and structured skins are **gone**, removed when Daylight
replaced the UI, along with `design-sources/` and the `.dc.html` generator
pipeline. `SKIN_IDS` in `src/lib/skins.ts` lists one id and the switcher UI
that offered a choice was deleted with the rest of the dead shell (2026-09-02).
Anything you read elsewhere about hand-editing generated `SkinApp.tsx` files or
about correction tables in `dc-convert.mjs` describes a system that no longer
exists.

`frontend/src/skins/daylight/SkinApp.tsx` is now **hand-written and
authoritative** — edit it directly. It carries `@ts-nocheck`, so tsc will not
catch a typo in it: grep that the bindings you reference actually exist, and
run the page before believing it works.

Still generated, still do not hand-edit: `src/styles/skins.css`, produced by
`scripts/skin-palettes.mjs` (driven by `build-skins.mjs`) and imported by
`main.tsx`. Those two scripts are kept for exactly that reason.

Check reproducibility before touching a generator: run it and `diff` the output
against what is checked in.

## Counts come from the registry

The tool total is `tools.length + nonPdfTools.length`. Never write it as a
literal — the site once advertised 221 when it had 219. A test fails on a
three-digit count appearing in rendered text in any shell component.

## Accounts

- There is **no email path**. No reset links, no verification. The recovery
  code issued at signup is the only way back into an account, so anything that
  drops it silently locks people out.
- Password hashing is `hashlib.scrypt` via `auth/hashing_pool.py`, which
  offloads to a thread pool — never call it on the event loop.
- Per-account lockout lives beside the per-IP limiter. Any endpoint that
  verifies a secret needs **both**.

## Deploy

Production is docker-compose on a single Oracle VM (2 cores, 12 GB, aarch64),
behind the host's nginx. The container binds `127.0.0.1:8000` only. Images are
built and cosign-signed in CI and pulled by tag — the VM does not build.

`app-data` holds accounts and API keys and is deliberately a separate volume
from `app-temp`, which a janitor sweeps by age. **It does not exist on the VM
yet** — prod runs v1.8.1, which predates accounts, and `/api/auth/signup` 404s
there. Nothing to lose today; the day a release ships accounts it holds the
only copy of every account and recovery code, and with no email path there is
no way to reissue one. No backup tooling is installed on the host.

**Merging to `main` does not deploy.** `auto-deploy.sh` defaults to
`DEPLOY_MODE=auto`, which deploys the newest `v*` tag reachable from `main` and
falls back to branch HEAD *only until the first tag exists*. 17 tags exist, so
the gate is on: prod sits on the last tag while `main` runs ahead. Cutting a
`v*` tag is what ships. The VM sets no `DEPLOY_MODE`, so the default applies.

Signature verification is fail-closed in prod — cosign is installed there, and
the script only warns-and-proceeds on a host without it.

## Read-only container

`read_only: true` is on. Only LibreOffice needs to write outside the volumes:
it puts its IPC pipe in `/tmp` and fails with "no valid pipe path found"
otherwise, and it **ignores `TMPDIR`** for that (TMPDIR is already
`/app/temp`), so the tmpfs is the only fix. weasyprint, rembg and the image
tools all pass with no writable `/tmp` at all.

The baked caches live in `/app/cache`, not `/tmp`, because the tmpfs masks
whatever is under it — when they were on `/tmp`, rembg silently re-downloaded
u2netp from a GitHub release on the first request and the failure looked like
latency. If you move them back, that returns.

onnxruntime reports an unreadable model as a bare `system error number 13`,
naming neither the file nor the permission, so the `chown` of `/app/cache` is
load-bearing.

## AI stack (added 2026-09-01)

- **Two AI paths, one dialog.** On-device models (transformers.js → browser
  Cache API "transformers-cache") and BYOK (`lib/byok/*`). The top-bar AI hub
  (`AiHubDialog`) manages both; `lib/localModels.ts` is the model registry and
  does honest cache introspection — never invent an "installed" state.
- **BYOK client is two functions** (`complete`, `transcribe`) in
  `lib/byok/client.ts` — the only network calls in the package, on purpose.
  Message content accepts image parts; `buildRequest` maps them per provider
  shape. Tasks (`tasks.ts`) fence document text per call — keep that.
- **CSP is per-path and guarded by tests.** `_BYOK_PATHS` must equal the pages
  whose components can transitively import `lib/byok` — `test_byok_csp.py`
  WALKS both ToolPage and NonPdfToolPage to verify. `_WASM_EVAL_PATHS` covers
  every page running onnx/tesseract wasm; `_TESSERACT_PATHS` additionally
  extends script-src to cdn.jsdelivr.net (blob workers inherit page CSP).
  A new AI page that misses these ships broken ONLY in prod — dev has no CSP.
- **Non-PDF tools live at `/tools/<slug>`** (NonPdfToolPage), PDF at
  `/tool/<slug>`. The Daylight skin mounts the right switch via
  `withRealTools` — both, since 2026-09-01; it once only knew ToolPage and
  every non-PDF tool rendered wrong in the skin.
- **`useMultiFileProcessor` reads state through a ref mirror** (`mutate()`).
  Never read state by capturing values inside a `setState` updater — React
  defers updaters and the hook silently processed zero files for months.
- **npm lockfile rule:** regenerate only with `npx -y npm@11.19.0` (CI's npm).
  Local npm 11.6 prunes `@emnapi/*` platform entries and breaks CI's `npm ci`.
- **Registering a tool slug touches ~14 places** — registries, ToolPage or
  NonPdfToolPage, ToolIllustration, review dates, palette synonyms, FAQ via
  `tool_content.py` (then regenerate `tool-faq.json` from it — Python is
  authoritative, `test_tool_faq_export`), `seo_meta.py`, `sitemap.py`, CSP
  sets, `gen-llms.mjs` run, and the public count literals
  (manifest/opensearch/samples + blog copy). The count tests enforce most of
  it; the CSP walker and FAQ export tests catch the rest.
