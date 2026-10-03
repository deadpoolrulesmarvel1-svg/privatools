# Contributing to PrivaTools

Thanks for your interest in improving PrivaTools — a suite of free,
open-source, privacy-first file tools. This guide covers how to get set up,
test your changes, and open a pull request.

## Ground rules

- **Privacy first.** The product promise is that files are processed
  privately and never sent to third parties: server tools keep uploads in
  temporary files that response cleanup deletes, with a background sweep for
  leftovers, and many tools never upload at all. Don't add third-party
  uploads, trackers, or client-side calls to external services without an
  explicit, disclosed reason. In-tool copy must match what the code actually
  does.
- **MIT licensed.** By contributing you agree your contribution is licensed
  under the [MIT License](LICENSE).
- **Be respectful.** Assume good faith; keep discussion technical and kind.

## Getting set up

### Run the whole app (Docker — easiest)

```bash
git clone https://github.com/ethereaglehq/privatools.git
cd privatools
docker compose up --build
# open http://localhost:8000
```

### Frontend (Vite + React)

```bash
cd frontend
npm ci
npm run dev       # dev server
npm run gen:llms  # regenerate the committed content files
npm run build     # production build (also runs gen:llms)
```

`gen:llms` writes the crawler indexes (`llms.txt`, `llms-full.txt`), sitemap,
feed and content JSON in `frontend/public/`, plus
`frontend/src/data/tool-blog-links.json`, from `frontend/src/data/`, and
those files are committed. After changing a registry or other content there,
run it and commit what it changes: CI regenerates the files and fails the PR
when the committed copies differ.

### Backend (FastAPI)

The backend shells out to native binaries and links native libraries, so the
test suite needs more than `pip install`. On Debian/Ubuntu (what production
uses), install:

```bash
sudo apt-get install -y \
  tesseract-ocr tesseract-ocr-eng poppler-utils ffmpeg qpdf libzbar0 \
  libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 \
  libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-math-nogui

# From the repo root: Python 3.12 virtual environment from the hashed lock
# (needs uv). CI installs the same lock with
# `pip install --require-hashes -r requirements-dev.txt`.
npm run setup:backend
```

(On macOS, the equivalents come from Homebrew: `brew install qpdf pango cairo
gdk-pixbuf zbar poppler tesseract ffmpeg`.)

## Testing — required before a PR

CI runs these on every pull request (`.github/workflows/test.yml`). Run them
locally first:

```bash
# Backend (run from the repo root). Build the frontend first, as CI does:
# some tests read frontend/dist and skip or fail without it.
npm --prefix frontend run build
.venv/bin/python -m pytest backend/tests -q

# Frontend (run from frontend/)
npm run gen:llms          # then commit anything it changed
npx tsc --noEmit -p tsconfig.app.json
npm run lint -- --max-warnings 0
npm run test:content
npm test
git fetch origin && npm run check:review-dates
```

- Every new feature or bug fix needs a test. New tools need a backend test
  under `backend/tests/` and must be registered in the frontend tool registry
  (`frontend/src/data/`) with a `seoTitle` (40–60 characters), a
  `metaDescription` (120–160 characters) and a `lastReviewed` date, which
  `frontend/src/test/tool-registry.test.ts` checks. They also need the
  endpoint map (`frontend/src/lib/tool-endpoints.ts`) and steps and FAQ in
  `backend/app/tool_content.py`; after editing that file, run
  `.venv/bin/python scripts/seo/export-tool-guides.py` and commit
  `frontend/src/data/tool-guide/`. Then run `npm run gen:llms` in
  `frontend/`: the backend's SEO metadata and sitemap read the tool manifest
  it writes, so neither needs a per-tool entry. A page that runs an AI model
  or a bring-your-own-key provider also needs its path in the CSP sets in
  `backend/app/main.py`. The full list of places a new slug touches is kept
  in [CLAUDE.md](CLAUDE.md) under "Registering a tool slug". The suite
  enforces these consistency rules.
- Heavy work in a route handler (rendering, OCR, ffmpeg, LibreOffice, rembg,
  compression) goes through `run_bounded` from
  `backend/app/utils/concurrency.py`, which caps concurrent heavy jobs and
  runs them in their own thread pool. Offload light blocking I/O with
  `await asyncio.to_thread(...)`, and run external programs with
  `asyncio.create_subprocess_exec`, so nothing blocks the event loop.

## Security

Found a vulnerability? **Do not open a public issue.** Follow
[SECURITY.md](SECURITY.md) — email `hello@privatools.me` with the `[Security]`
subject prefix, or use GitHub's private vulnerability reporting. We aim to
acknowledge within 72 hours.

For changes that touch the file-processing surface, keep the existing
defenses intact: SSRF validation on server-side URL fetches, argv-list
subprocess calls (never `shell=True`), archive-extraction byte caps, and
guaranteed temp-file cleanup on every code path.

## Pull requests

1. Branch off `main`.
2. Keep PRs focused; write a clear description of *what* and *why*.
3. Make sure the test suites and type-check pass.
4. A maintainer reviews and merges.

Branch protection on `main` requires five checks:

| Check | Workflow | What it runs |
| --- | --- | --- |
| Backend tests (pytest) | `test.yml` | The backend suite, plus the API starter build and tests |
| Frontend tests (vitest) | `test.yml` | Generated-content check, type-check, lint, content tests, Vitest, review-date check |
| Frontend audit and build | `security.yml` | `npm audit --audit-level=high`, type-check, production build, bundle budget |
| Python dependency audit | `security.yml` | `pip-audit` on the hashed runtime lock, `requirements.txt` |
| Image builds and serves (docker) | `test.yml` | Builds the image and boots it with `scripts/ci/probe-image.py` |

Two steps inside "Frontend tests (vitest)" fail it on their own:

- **Check generated content is current** reruns `npm run gen:llms` and fails
  when the committed output differs.
- **Check tool review dates** (pull requests only) runs
  `npm run check:review-dates`. It fails when a tool's `seoTitle`,
  `metaDescription`, `longDescription` or `description` changed without its
  `lastReviewed` moving, or when more than 25 dates move unless the PR title
  or a commit message line starts with `[bulk-review]`.
  [scripts/README.md](scripts/README.md#tool-review-dates) explains the rules.

CodeQL, dependency review, the Trivy scans, OpenSSF Scorecard and the
`Frontend quality` job (`ci.yml`) also run on pull requests but are not
required. Separately, `monitor.yml` probes privatools.me every 30 minutes and,
when a check fails, opens a tracking issue or comments on the open one.

## Releases & deploys

Production deploys only signed `v*` release tags (see `deploy/README.md`).
Pushing a tag runs `release.yml`: the whole `test.yml` suite, then an arm64
image that is pushed to GHCR, scanned and signed with cosign, and finally a
GitHub Release. Merging to `main` does not deploy on
its own — a maintainer cuts a release tag when a set of changes is ready.
Deploys start the new release beside the running one, so for about a minute
both share the accounts database. Keep schema migrations additive, quick and
compatible with the previous release; `backend/app/store.py` has the details.
