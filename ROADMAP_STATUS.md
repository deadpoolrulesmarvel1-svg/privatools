# PrivaTools Autonomous Roadmap Status

Last updated: 2026-06-18

## Phase 0 - Fix-First `[P0-fix]`

- [x] Repository path verified: `/Users/lakshya/projects/priva-tool/.claude/worktrees/focused-shaw-fd415a`
- [x] GitHub identity collision corrected locally: `taiyeba-dg` replaced with `deadpoolrulesmarvel1-svg` across frontend/backend references.
- [x] GitHub identity verification passed: Phase 0 grep returns no `taiyeba-dg` refs; `DynamicHead.tsx` Organization and Person `sameAs` point to `https://github.com/deadpoolrulesmarvel1-svg/privatools`.
- [x] OG image verified live at 1200x630: production PNG header printed `(1200, 630)`.
- [x] Favorite/pin loop completed locally: tool-page H1 star, non-PDF tool-page H1 star, ToolCard star affordance, same-tab favorites event, Sidebar/Index consumption.
- [x] EditPdfUI migrated to Pointer Events with pointer capture, `touch-action: none`, pointer release, and 24px coarse-pointer resize handles.
- [x] SignUI signature canvas migrated to Pointer Events with pointer capture and `touch-action: none`.
- [x] Frontend type-check passed: `npx tsc --noEmit -p tsconfig.app.json`.
- [x] Frontend build passed: `npm run build`.
- [x] Backend compile passed: `python3.10 -m compileall app/ -q`.
- [x] Backend tests passed for current suite: `197 passed, 40 skipped`.
- [x] Phase 0 committed locally: `0be6a12`.
- [x] Phase 0 pushed to branch: `origin/claude/focused-shaw-fd415a`.
- [x] Draft PR opened: https://github.com/deadpoolrulesmarvel1-svg/privatools/pull/1
- [ ] Phase 0 pushed to `main`. Direct default-branch push was blocked by safety review pending explicit approval.

## Later Phases

- [ ] Phase 1 - Performance & Speed `[P1-perf]`
  - [x] Code-ready locally: Docker frontend build installs `brotli` and emits `.br` files for JS/CSS/SVG/HTML.
  - [x] Code-ready locally: `deploy/nginx.conf` enables `brotli on;` and `brotli_static on;` with module install note.
  - [x] Code-ready locally: Docker uvicorn command tuned to 2 workers, 30s keepalive, concurrency 50, graceful shutdown 30s.
  - [x] Code-ready locally: Privacy page discloses Cloudflare edge CDN and no-store API behavior.
  - [x] Code-ready locally: unused Radix Toast stack removed, `@radix-ui/react-toast` removed, CommandPalette lazy-mounted, `tool-catalog` Vite chunk added, bundle-size check script added.
  - [ ] Live infra remains open: install `libnginx-mod-brotli` on the VM, reload nginx, configure Cloudflare, and verify `content-encoding: br` after deploy.
  - [x] Verified locally: `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`, and `npm run check:bundle`.
  - [x] Bundle check result: largest JS chunks are `transformers.web` 222.8 KiB gzip, `pdf` 126.8 KiB gzip, and app `index` 68.6 KiB gzip.
  - [x] First-paint critical JS path trimmed below DoD target: generated HTML preloads 159.5 KiB gzip of JS (`index`, `vendor-react`, `vendor-icons`, `tool-catalog`) and no longer preloads `vendor-radix`.
- [ ] Phase 2 - Missing Tools `[P2-*]`
  - [x] Tool-count gate cleared locally: DoD command now reports 215 `slug:` lines across `frontend/src/data/tools.ts` and `frontend/src/data/non-pdf-tools.ts`.
  - [x] P2 developer micro-tools slice added locally: `cron-parser`, `sql-formatter`, `graphql-formatter`, `yaml-toml-converter`, `gitignore-generator`, `semver-bumper`, `env-validator`, and `json-to-csv-schema`; all are browser-only and registered in UI, HowTo/FAQ content, SEO metadata, and sitemap coverage.
  - [x] P2 conversion-alias slice added locally: 26 image/audio/video format pages reuse existing image converter, audio converter, video converter, and video-to-GIF backends; registered in UI, endpoint overrides, HowTo/FAQ content, SEO metadata, review dates, sitemap, and generated `llms.txt` artifacts.
  - [x] Verified locally after integration: `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`, `npm run check:bundle`, `python3.10 -m compileall app/ -q`, and backend suite `401 passed, 40 skipped`.
  - [ ] Remaining P2 heavyweight tools are open: Chat with PDF, PDF Translator, quiz generation, voice-to-text, scan-to-PDF, Pipeline/workflows, multi-signer eSign, PDF text find/replace, multi-tool workspace, AI image tools, AVIF/JXL/JXL, object removal, Real-ESRGAN, HTML-to-image, receipt OCR, AV1 output, denoise audio, PDF audiobook, and video upload splitting.
- [ ] Phase 3 - Existing Tool Quality Upgrades `[P3-*]`
- [ ] Phase 4 - UI/UX Polish `[P4-ux]`
- [ ] Phase 5 - Trust + Privacy Verification `[P5-trust]`
  - [x] Narrow trust slice added locally: RFC 9116 `frontend/public/.well-known/security.txt`, root `SECURITY.md`, and `/security` page.
  - [x] `/security` registered in the frontend router and linked from the privacy related-docs row plus the persistent status/footer bar.
  - [x] Backend SPA/SEO skip list includes `/.well-known/` so `security.txt` can serve as a static file instead of the SPA shell.
  - [x] DNT/GPC/GA opt-out added locally: GA loader respects browser privacy signals and `pt-analytics-opt-out=1`; Privacy page exposes a local opt-out switch.
  - [x] Public cleanup transparency added locally: `/api/transparency/janitor` returns aggregate janitor sweep counts without filenames, paths, IPs, or content metadata.
  - [x] GitHub trust automation added locally: security workflow with npm audit, pip-audit, CodeQL, Scorecard, Trivy SARIF, Trivy CycloneDX SBOM; release workflow builds/signs GHCR images with cosign; Dependabot covers npm, pip, and GitHub Actions.
  - [x] Nonce-based script CSP added locally: every served SPA HTML shell gets per-request script nonces; `script-src` no longer allows `unsafe-inline` or regular `unsafe-eval`; `wasm-unsafe-eval` is limited to browser-AI tool routes.
  - [ ] Phase 5 deferred items remain open: PGP key, per-tool never-uploaded badge, HSTS preload/COOP/COEP/CORP, SRI, self-hosted fonts/GA proxy, OpenSSF badge submission follow-through, and live workflow/README badge verification after default-branch deploy.
- [ ] Phase 6 - SEO / GEO / AI Visibility `[P6-seo]`
  - [x] Narrow SEO slice added locally: visible `Last reviewed <time>` badge on PDF and non-PDF tool pages using a frontend helper mirroring backend curated review dates.
- [ ] Phase 7 - Power Features `[P7-power]`

## Definition of Done

- [x] Phase 0 live bugs closed locally.
- [x] Backend tests >= 250 passing. Current suite has 401 passing and 40 skipped after adding P2 catalog/SEO regression coverage.
- [x] Frontend `tsc --noEmit` and `npm run build` clean.
- [ ] Lighthouse thresholds met on `/`, `/tool/compress-pdf`, and `/blog/compress-pdf-without-losing-quality`.
- [x] Bundle size first-paint critical path < 170 KB gz. Latest local HTML-preload measurement: 159.5 KiB gzip JS, 180.9 KiB gzip including CSS.
- [x] Tool count >= 200. Latest local verification reports 215 via `slug:` count and 213 actual parsed tool entries in generated `llms.txt`.
- [ ] Brotli + Cloudflare active.
  - [ ] Code/config is present locally; live activation still requires deploy, VM nginx module install/reload, and Cloudflare account configuration.
- [ ] Top 50 tool pages have required schema/content/review badges.
  - [ ] Visible review badges are present locally; broader top-50 content/schema requirements remain open.
- [ ] GEO citability score >= 80.
- [ ] Trust deliverables live.
  - [ ] Trust slices are verified locally but not yet verified live: `/.well-known/security.txt`, `/security`, `SECURITY.md`, `/api/transparency/janitor`, analytics opt-out, GitHub Actions workflows, release signing workflow, Dependabot, and README badges.
- [x] CSP nonce-based with no script-src `unsafe-inline`. Local backend tests assert matching CSP/body nonces, no `unsafe-inline`, no regular `unsafe-eval`, and `wasm-unsafe-eval` only on browser-AI routes.
- [x] GitHub org identity unified locally.
- [ ] Wikidata Q-number minted and linked.
- [x] OG image validates at 1200x630 by live PNG header.
- [ ] Pipeline + API + CLI + Extension functional.
- [ ] Mobile editor/nav/touch target requirements met.
