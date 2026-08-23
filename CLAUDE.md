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
- **The full backend suite segfaults on macOS** around 55% — a native-library
  interaction across modules, not a regression. Every file passes alone. Loop
  per-file to get a clean signal; CI on Linux runs it whole.
- **CI does not run on a plain branch.** `test.yml` and `security.yml` trigger
  on pull requests and pushes to `main`. To verify a branch without a PR:
  `gh workflow run test.yml --ref <branch>`.
- **OpenSSF Scorecard always fails off `main`** — "Only the default branch main
  is supported". Not a code problem.

## Generated files — never hand-edit

`frontend/src/skins/{aurora,carbon,structured}/SkinApp.tsx`,
`styles/skin-native.css` and `styles/skin-interactions.css` are **build
artefacts**. Edits are lost on the next generator run.

Sources are `design-sources/*.dc.html`; generators are
`frontend/scripts/build-skin-app.mjs` and `extract-native-css.mjs`.

Those generators carry **correction tables**, not just conversion — contrast
fixes, theme-precedence fixes, attribute maps. Fix a class of defect there, not
in the output. `dc-convert.mjs` is the converter the build uses;
`dc-to-jsx.mjs` is a CLI variant that imports from it.

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
from `app-temp`, which a janitor sweeps by age.
