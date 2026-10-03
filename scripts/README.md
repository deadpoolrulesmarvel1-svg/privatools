# Repository scripts

Run these commands from the repository root. Application code lives in
`backend/` and `frontend/`; these scripts support development and verification.

| Folder | Purpose |
| --- | --- |
| `api/starters/` | Build downloadable API examples and test them against synthetic responses. |
| `api/` | Measure API capacity inside an isolated candidate container. |
| `analytics/` | Inspect public Google tag configuration without executing it. |
| `ci/` | Boot a built Docker image as production does and probe what it serves. |
| `dev/` | Start the backend with the pinned local virtual environment. |
| `seo/` | `check-manifest-http.py` checks generated public assets against a local HTTP server; `export-tool-guides.py` exports per-tool guide JSON from the Python content module; `merge-tool-copy.py` is a one-shot script that inserts `seoTitle`/`metaDescription` into the registries from JSON copy files — not idempotent, so only run it on a clean checkout of the registries. |

## API starter downloads

The source examples are in `examples/api/`. After editing them, rebuild the
downloads in `frontend/public/api-starters/`, then run both test suites:

```sh
python3 scripts/api/starters/build.py
python3 scripts/api/starters/build.py --check
python3 scripts/api/starters/test.py
node --test scripts/api/starters/artifacts.test.mjs
```

The Python tests start a temporary loopback HTTP server and use synthetic data.
They do not call the production API. `api/capacity.py` is an opt-in benchmark for
an isolated candidate container with its own database. Use `--help` for its
requirements; do not run it against production or a shared account database.

## Image probe

The `image` job in `.github/workflows/test.yml` builds the image, loads it and
runs:

```sh
python3 scripts/ci/probe-image.py IMAGE
```

It starts IMAGE from `docker-compose.yml` under its own compose project, with
the deploy's `up --no-build --pull never` and async jobs enabled, as production
runs them. It checks that the job supervisor takes the queue (a release whose
supervisor crashes on taking it must fail here, before any tag), then `/readyz`,
a 404, the homepage's tool count, two server-rendered tool pages and the
sitemap. Expected values come from the manifest inside the container. Last, it
converts a `.docx` holding one Word equation through `/api/office-to-pdf` and
requires the equation's text in the PDF: an image without LibreOffice's Math
module converts it with a blank where the equation was. On failure it prints the
container's logs; the container and its volumes are always removed. It needs
the compose file's port, 8000. Where that is taken, add a file with a
`ports: !override` entry through `COMPOSE_FILE`.

The deploy runs the page checks against a container that is already running,
before it gets any traffic, and starts or removes nothing. It never converts
the equation: the rollout also probes containers of older releases with this
newer file, and a release from before the Math module would fail.

```sh
python3 scripts/ci/probe-image.py --running CONTAINER --url http://127.0.0.1:8001 --sha BUILD_SHA
```

That is `deploy/oracle-vm/rollout.sh`'s real-page probe: a release whose
`/readyz` is ready but which cannot serve those pages is removed instead of
switched to (`deploy/README.md`, Zero-downtime deploys). The rollout sets
`PRIVATOOLS_PROBE_HOST=privatools.me`, so every request carries the Host
header nginx forwards and a release that rejects the public name fails here.
Without it, as in CI, requests go to `127.0.0.1`.

## Local development

```sh
npm run setup:backend
npm start
```

`npm start` builds the frontend and invokes `dev/local-backend.py`. For separate
development servers, use `npm run backend:dev` and `npm run frontend` in two
terminals. Local account data is stored in `data/local/` and processing files in
`temp/local/` unless explicitly overridden.

## Read-only checks

```sh
python3 scripts/analytics/check-public-google-tag.py --help
python3 scripts/seo/check-manifest-http.py --help
```

The analytics check can inspect a saved public script with `--from-file PATH`;
without that option it makes one public Google script request. It does not send
analytics events or change settings. The SEO check requires a built frontend and
a running loopback backend; choose a report path with `--output PATH`.

## Tool guide export

```sh
.venv/bin/python scripts/seo/export-tool-guides.py
.venv/bin/python scripts/seo/export-tool-guides.py --check
```

`export-tool-guides.py` writes `frontend/src/data/tool-guide/*.json` from
`backend/app/tool_content.py`; run it after editing steps or FAQ, and
`--check` in CI-style verification.

## Tool review dates

This one lives with the frontend content scripts, so run it from `frontend/`:

```sh
npm run check:review-dates            # against origin/main
npm run check:review-dates -- HEAD    # only what is not committed yet
```

`frontend/scripts/check-review-dates.mjs` compares both tool registries in the
working tree with the commit where the branch left its base. It fails when a
tool's `seoTitle`, `metaDescription`, `longDescription` or `description`
changed while its `lastReviewed` stayed at a date from before the change, and
when more than 25 existing dates moved in one change.

An unchanged date is already inside the change when it falls on or after the
day before the change began, that one day allowing for time zones. The change
begins on the author date of the oldest commit in the branch (`base..HEAD`)
that touches either registry file; uncommitted edits, with no such commit yet,
begin today. So copy corrected twice in one day, or opened the day another copy
change merged, passes with the date it already has, which could not move
anyway. Author dates survive a rebase, and a re-run on a later day reads the
same commits rather than the clock, so it gives the same answer. The summary
line counts these tools as "already dated inside the change". The limit: a
long-lived branch can pass with a date a few days old, because everything back
to the day before its first registry commit counts as inside it.

A new tool's first date is not a move. A genuine bulk
review passes with `[bulk-review]` on its own line: the first non-space text of
the PR title or of any line in a commit message on the branch, with or without
more text after it. CI reads the title when a run starts, so push after
editing it.

A mention anywhere else — mid-sentence, or quoted in backticks — does not
count, so a commit message can explain the flag without switching it on. (While
any mention counted, this check's own first commit message did exactly that.)
When hard-wrapping such prose, keep the marker from landing at the start of a
line. Documentation files are never read, only commit messages and the PR
title.

It needs the base branch and real history: `git fetch origin` locally,
`fetch-depth: 0` in a workflow. With neither it fails instead of skipping, so
it runs as its own `pull_request`-only step in `test.yml` rather than inside
`npm run test:content` (which also runs on pushes and on the release gate).
On a pull request the base is the branch the PR targets, read from
`GITHUB_BASE_REF`. `test:content` still runs the script's own unit tests.

A base older than the commit that introduced `lastReviewed` has none, and a
tool's first date is not a move, so the check passes against old bases and on
the base branch itself.

Production deployment scripts and service definitions remain in `deploy/`.

Generated local reports belong in `temp/verification/<area>/`, which is excluded
from Git. The SEO checker uses `temp/verification/seo/` by default.
