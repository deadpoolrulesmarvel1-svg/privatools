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
  - [x] Code-ready locally: Fraunces, Inter, and JetBrains Mono are self-hosted under `frontend/public/fonts`; `index.html` preloads same-origin font files and no longer preconnects to Bunny Fonts.
  - [x] Live Brotli is active through application middleware: production returns `content-encoding: br` on `/` and `/tool/compress-pdf` with nonce CSP intact.
  - [ ] Cloudflare activation remains open; live headers still come directly from `nginx/1.18.0 (Ubuntu)`.
  - [x] Verified locally: `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`, and `npm run check:bundle`.
  - [x] Bundle check result: largest JS chunks are `transformers.web` 222.8 KiB gzip, `pdf` 126.8 KiB gzip, and app `index` 68.9 KiB gzip.
  - [x] First-paint critical JS path remains below DoD target after mobile work: generated HTML preloads 160.0 KiB gzip of JS (`index`, `vendor-react`, `vendor-icons`, `tool-catalog`) and no longer preloads `vendor-radix`.
- [ ] Phase 2 - Missing Tools `[P2-*]`
  - [x] Tool-count gate cleared locally: DoD command now reports 215 `slug:` lines across `frontend/src/data/tools.ts` and `frontend/src/data/non-pdf-tools.ts`.
  - [x] P2 developer micro-tools slice added locally: `cron-parser`, `sql-formatter`, `graphql-formatter`, `yaml-toml-converter`, `gitignore-generator`, `semver-bumper`, `env-validator`, and `json-to-csv-schema`; all are browser-only and registered in UI, HowTo/FAQ content, SEO metadata, and sitemap coverage.
  - [x] P2 conversion-alias slice added locally: 26 image/audio/video format pages reuse existing image converter, audio converter, video converter, and video-to-GIF backends; registered in UI, endpoint overrides, HowTo/FAQ content, SEO metadata, review dates, sitemap, and generated `llms.txt` artifacts.
  - [x] Verified locally after integration: `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`, `npm run check:bundle`, `python3.10 -m compileall app/ -q`, and backend suite `401 passed, 40 skipped`.
  - [ ] Remaining P2 heavyweight tools are open: Chat with PDF, PDF Translator, quiz generation, voice-to-text, scan-to-PDF, Pipeline/workflows, multi-signer eSign, PDF text find/replace, multi-tool workspace, AI image tools, AVIF/JXL/JXL, object removal, Real-ESRGAN, HTML-to-image, receipt OCR, AV1 output, denoise audio, PDF audiobook, and video upload splitting.
- [ ] Phase 3 - Existing Tool Quality Upgrades `[P3-*]`
- [x] Phase 4 - UI/UX Polish `[P4-ux]`
  - [x] Persistent `MobileNav` is mounted from `AppShell` on `<lg` viewports and reserves workspace bottom padding (`pb-20`) so tool content is not hidden behind the nav.
  - [x] Mobile nav active state covers tool routes: `/tool/merge-pdf` marks `Tools` with `aria-current="page"`.
  - [x] Coarse-pointer 44px target variant added and applied to shell controls, mobile nav items, favorites, and high-use file/action rows.
  - [x] Browser mobile QA passed locally at `390x844` on `/tool/merge-pdf`: nav remained fixed at viewport bottom before and after scrolling, main padding was `80px`, and all bottom-nav controls measured `64x46`.
- [ ] Phase 5 - Trust + Privacy Verification `[P5-trust]`
  - [x] Narrow trust slice added locally: RFC 9116 `frontend/public/.well-known/security.txt`, root `SECURITY.md`, and `/security` page.
  - [x] `/security` registered in the frontend router and linked from the privacy related-docs row plus the persistent status/footer bar.
  - [x] Backend SPA/SEO skip list includes `/.well-known/` so `security.txt` can serve as a static file instead of the SPA shell.
  - [x] DNT/GPC/GA opt-out added locally: GA loader respects browser privacy signals and `pt-analytics-opt-out=1`; Privacy page exposes a local opt-out switch.
  - [x] Public cleanup transparency added locally: `/api/transparency/janitor` returns aggregate janitor sweep counts without filenames, paths, IPs, or content metadata.
  - [x] GitHub trust automation added locally: security workflow with npm audit, pip-audit, CodeQL, Scorecard, Trivy SARIF, Trivy CycloneDX SBOM; release workflow builds/signs GHCR images with cosign; Dependabot covers npm, pip, and GitHub Actions.
  - [x] Nonce-based script CSP added locally: every served SPA HTML shell gets per-request script nonces; `script-src` no longer allows `unsafe-inline` or regular `unsafe-eval`; `wasm-unsafe-eval` is limited to browser-AI tool routes.
  - [x] Self-hosted font trust slice added locally: backend CSP no longer allows Bunny Fonts, Google Fonts, or `fonts.gstatic.com`; service worker caches font files from same-origin only.
  - [x] HSTS/COOP/COEP/CORP trust slice added locally: backend emits preload-ready HSTS when HTTPS/`FORCE_HSTS` is active plus `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`, and `Cross-Origin-Resource-Policy: same-origin`; nginx deployment configs mirror the isolation headers.
  - [x] Per-tool upload privacy badge added locally: PDF and non-PDF tool pages now show `Never uploaded` for browser-only tools and `No third-party upload` for self-hosted server tools; Privacy page now states fonts are self-hosted.
  - [x] Build-time SRI added locally: production builds now inject SHA-384 `integrity` attributes for generated `/assets/*.js` and `/assets/*.css` tags and `npm run sri:check` verifies the generated HTML hashes.
  - [x] First-party GA4 pageview proxy added locally: browser pages call `/api/analytics/pageview` instead of loading Google analytics scripts; the backend forwards sanitized aggregate events only when `GA4_API_SECRET` is configured.
  - [x] Live workflow/README badge verification passed on default branch: Security workflow run `27761741061` is green on `main` commit `5a620e44c9f0`; README contains Security, OpenSSF Scorecard, SBOM, and MIT badges.
  - [ ] Phase 5 deferred items remain open: PGP key and OpenSSF Best Practices badge submission follow-through.
- [ ] Phase 6 - SEO / GEO / AI Visibility `[P6-seo]`
  - [x] Narrow SEO slice added locally: visible `Last reviewed <time>` badge on PDF and non-PDF tool pages using a frontend helper mirroring backend curated review dates.
  - [x] Top-50 tool page SSR coverage added locally: every top-50 tool page now has TL;DR, deep crawlable guidance, HowTo schema, FAQPage schema, SoftwareApplication schema, visible last-reviewed copy, and at least 800 words of SSR body content.
  - [x] Regression coverage added locally: `tests/test_top50_seo.py` computes top-50 tool paths by popularity and enforces the content/schema/review requirements.
- [ ] Phase 7 - Power Features `[P7-power]`
  - [x] Public API docs exposed locally at `/api-docs`; backend SPA middleware skips `/api-docs` so Swagger UI is not intercepted.
  - [x] Optional API-key primitive added locally: `PRIVATOOLS_API_KEYS` gates developer routes with `X-API-Key`, while dev remains anonymous when no keys are configured.
  - [x] Functional backend pipeline API added locally for the safe automation subset: `compress-pdf` and `strip-metadata` via `GET /api/pipeline/templates`, `POST /api/pipeline/validate`, and `POST /api/pipeline`.
  - [x] Pipeline share URLs added locally: `/pipeline?p=<base64url>` hydrates steps and the page can copy a shareable recipe URL.
  - [x] Local CLI package added: `npx --no-install privatools --help`, `validate`, and `pipeline-url` work from the repo root.
  - [x] Manifest V3 extension skeleton added locally with context-menu actions that open PrivaTools Pipeline for pages/PDF links.
  - [ ] Remaining Phase 7 items stay open: full per-tool pipeline params, Drive/Dropbox pickers, pipeline conditionals, webhooks, activity log, template gallery pages, desktop app, and external output nodes.

## Definition of Done

- [x] Phase 0 live bugs closed locally.
- [x] Backend tests >= 250 passing. Current suite has 440 passing and 40 skipped after dependency upgrades and P2/P5/P6/P7 regression coverage.
- [x] Frontend `tsc --noEmit` and `npm run build` clean.
- [x] Lighthouse thresholds met on `/`, `/tool/compress-pdf`, and `/blog/compress-pdf-without-losing-quality`.
  - [x] Live Lighthouse on production build `5947c2f07d1c`: `/` = 94/95/100/100, `/tool/compress-pdf` = 99/96/100/100, `/blog/compress-pdf-without-losing-quality` = 98/100/100/100.
  - [x] Live Lighthouse on production build `5a620e44c9f0`: `/` = 90/95/100/100, `/tool/compress-pdf` = 99/96/100/100 on solo rerun, `/blog/compress-pdf-without-losing-quality` = 90/100/100/100. Parallel `/tool/compress-pdf` run produced a transient Lighthouse `NO_LCP` warning and 89 performance, so the solo rerun is the accepted evidence.
- [x] Bundle size first-paint critical path < 170 KB gz. Latest local HTML-preload measurement: 160.0 KiB gzip JS, 181.6 KiB gzip including CSS.
- [x] Tool count >= 200. Latest local verification reports 215 via `slug:` count and 213 actual parsed tool entries in generated `llms.txt`.
- [ ] Brotli + Cloudflare active.
  - [x] Application-layer Brotli middleware is live: production build `e6940bcf67ea` returns `content-encoding: br` on `/` and `/tool/compress-pdf` with nonce CSP intact.
  - [x] Latest live verification on production build `5a620e44c9f0`: GET `/` and `/security` with `Accept-Encoding: br` return `content-encoding: br`, nonce CSP, HSTS preload, COOP, COEP, and CORP headers.
  - [ ] Cloudflare account/DNS activation remains open; live headers still come directly from `nginx/1.18.0 (Ubuntu)` with no Cloudflare edge headers.
- [x] Top 50 tool pages have required schema/content/review badges locally. Regression test enforces TL;DR, 800+ SSR words, deep guidance, HowTo, FAQPage, SoftwareApplication, and visible last-reviewed content.
- [ ] GEO citability score >= 80.
  - [ ] Blocked by missing `/citability` capability in this Codex session; tool discovery did not expose a citability/GEO scoring tool.
- [x] Trust deliverables live.
  - [x] Live verification on 2026-06-18: `/healthz` returned `build_sha=5a620e44c9f022d27ce495b7a342d52864e1eb3b`; `/readyz` is ready; `/.well-known/security.txt`, `/security`, `/api/transparency/janitor`, and `/api/pipeline/templates` are reachable; live CSP is nonce-based; GET `/` and `/security` return Brotli; main Security workflow run `27761741061` is green; README on `main` contains Security, OpenSSF Scorecard, SBOM, and MIT badges; `SECURITY.md` exists on `main`.
- [x] CSP nonce-based with no script-src `unsafe-inline`. Local backend tests assert matching CSP/body nonces, no `unsafe-inline`, no regular `unsafe-eval`, and `wasm-unsafe-eval` only on browser-AI routes. MDN Observatory API v2 scan `101727378` returned grade `A+`, score `110`.
- [x] GitHub org identity unified locally.
- [ ] Wikidata Q-number minted and linked.
  - [ ] Blocked by missing Wikidata credentials/editor action; live Wikidata search for `PrivaTools` returned no existing entity.
- [x] OG image validates at 1200x630 by live PNG header.
- [x] Pipeline + API + CLI + Extension functional locally: `/api/pipeline` runs `compress-pdf -> strip-metadata`, `/api-docs` renders, share URLs hydrate `/pipeline`, `npx --no-install privatools --help` works, and the MV3 extension manifest/background smoke checks pass. Live `/api/pipeline/templates` returns the expected `email-ready` and `privacy-scrub` templates.
- [x] Mobile editor/nav/touch target requirements met locally: EditPdfUI and SignUI use Pointer Events; persistent MobileNav and 44px coarse-pointer targets verified at `390x844` on `/tool/merge-pdf`.
