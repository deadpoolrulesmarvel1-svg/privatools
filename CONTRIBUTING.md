# Contributing to PrivaTools

Thanks for your interest in improving PrivaTools — a suite of free,
open-source, privacy-first file tools. This guide covers how to get set up,
test your changes, and open a pull request.

## Ground rules

- **Privacy first.** The product promise is that files are processed
  privately (in isolated temporary storage, deleted on response) and never
  sent to third parties. Don't add third-party uploads, trackers, or
  client-side calls to external services without an explicit, disclosed
  reason. In-tool copy must match what the code actually does.
- **MIT licensed.** By contributing you agree your contribution is licensed
  under the [MIT License](LICENSE).
- **Be respectful.** Assume good faith; keep discussion technical and kind.

## Getting set up

### Run the whole app (Docker — easiest)

```bash
git clone https://github.com/deadpoolrulesmarvel1-svg/privatools.git
cd privatools
docker compose up --build
# open http://localhost:8080
```

### Frontend (Vite + React)

```bash
cd frontend
npm ci
npm run dev      # dev server
npm run build    # production build (also regenerates llms.txt + sitemap)
```

### Backend (FastAPI)

The backend shells out to native binaries and links native libraries, so the
test suite needs more than `pip install`. On Debian/Ubuntu (what production
uses), install:

```bash
sudo apt-get install -y \
  tesseract-ocr tesseract-ocr-eng poppler-utils ffmpeg qpdf libzbar0 \
  libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 \
  libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui

python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
```

(On macOS, the equivalents come from Homebrew: `brew install qpdf pango cairo
gdk-pixbuf zbar poppler tesseract ffmpeg`.)

## Testing — required before a PR

Both suites run automatically on every PR (see `.github/workflows/test.yml`).
Run them locally first:

```bash
# Backend (run from the repo root)
PYTHONPATH=. python -m pytest backend/tests -q

# Frontend
cd frontend && npm run test && npx tsc --noEmit -p tsconfig.app.json
```

- Every new feature or bug fix needs a test. New tools need a backend test
  under `backend/tests/` and must be registered in the frontend tool registry
  (`frontend/src/data/`), the endpoint map (`frontend/src/lib/tool-endpoints.ts`),
  and the backend SEO metadata (`backend/app/seo_meta.py` + the sitemap list in
  `backend/app/routes/sitemap.py`). The suite enforces these consistency rules.
- Heavy/CPU work in a route handler must be offloaded with
  `await asyncio.to_thread(...)` (or `asyncio.create_subprocess_exec`) so it
  doesn't block the event loop.

## Security

Found a vulnerability? **Do not open a public issue.** Follow
[SECURITY.md](SECURITY.md) — email `hello@privatools.me` with the `[Security]`
subject prefix. We aim to acknowledge within 72 hours.

For changes that touch the file-processing surface, keep the existing
defenses intact: SSRF validation on server-side URL fetches, argv-list
subprocess calls (never `shell=True`), archive-extraction byte caps, and
guaranteed temp-file cleanup on every code path.

## Pull requests

1. Branch off `main`.
2. Keep PRs focused; write a clear description of *what* and *why*.
3. Make sure the test suites and type-check pass.
4. A maintainer reviews and merges.

## Releases & deploys

Production auto-deploys via a release-tag gate (see `deploy/README.md`): once a
`v*` tag exists, only tagged commits ship. Merging to `main` does not deploy on
its own — a maintainer cuts a release tag when a set of changes is ready.
