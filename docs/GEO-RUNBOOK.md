# GEO / AI-Search Runbook

Concrete steps to raise PrivaTools' visibility in AI answers (ChatGPT, Claude,
Perplexity, Gemini, AI Overviews). The **in-repo** citability work is already
shipped (citable homepage facts block, knowledge-graph–anchored `knowsAbout`,
SSR ≥800-word tool pages, JSON-LD, llms.txt). The items below need an external
account, so they're handed off here rather than done in code.

## 1. Activate Cloudflare (free tier) — perf + makes the CDN claim true

Today the live `cf-cache-status`/`server` headers come straight from nginx; the
"edge CDN / Brotli at the edge" framing is aspirational until this is done.

**Done:** the `privatools.me` zone is added in Cloudflare (free) and the domain's
nameservers are pointed to Cloudflare (`oaklyn`/`rudy.ns.cloudflare.com`). DNS
records are imported **grey-clouded** (DNS-only) — so the site/email work
unchanged while the proxy is enabled deliberately.

> **Do NOT just orange-cloud the apex.** Cloudflare's free/pro plans cap a
> **proxied** request body at **100 MB**, but PrivaTools accepts **500 MB**, so
> proxying the apex as-is silently 413s every large `/api` upload. The fix is the
> **api-subdomain split**: the SPA's `/api` traffic moves to a grey-clouded
> `api.privatools.me` (direct to the VM, uncapped, off Cloudflare), while the
> apex/`www` are proxied for static. The code is shipped and flag-gated on
> `PUBLIC_API_BASE_URL`. Follow **[deploy/api-subdomain-split.md](../deploy/api-subdomain-split.md)**
> for the exact ordered activation (add grey `api` record → cert → nginx vhost →
> flip the backend flag → orange-cloud apex/`www`).

Remaining Cloudflare-dashboard toggles (after the split is live):

- **SSL/TLS** mode → **Full (strict)** (the VM has a real Let's Encrypt cert).
- **Speed** → enable **Brotli**; leave **Auto Minify** off (Vite pre-minifies); **Early Hints** on.
- **Caching** → Cache Level Standard; Cache Rule: cache `*/assets/*` and `*.woff2`
  (the app already sends 1-year immutable headers on hashed assets), **bypass
  cache for `/api/*`**.
- Verify: `curl -sI https://privatools.me/assets/<hashed>.js | grep -i cf-cache-status` returns `HIT` after a warm-up.

Outcome: real edge caching + Brotli for static assets, lower global LCP, the
perf/CDN claims become accurate — and large uploads keep working via the direct
api host.

## 2. Mint a Wikidata Q-number — entity disambiguation for AI

AI engines resolve "PrivaTools" against the knowledge graph. A Wikidata item
makes the entity unambiguous and citable.

1. Create a Wikidata account, then **Create a new Item** at wikidata.org.
2. Label: `PrivaTools`. Description: `free, open-source, privacy-first online file-tools suite`.
3. Statements: `instance of (P31)` → *web service* + *free software*; `official website (P856)` → `https://privatools.me`; `source code repository (P1324)` → the GitHub URL; `license (P275)` → *MIT License*; `programmed in (P277)` → *Python*, *TypeScript*.
4. Copy the resulting `Q…` id.
5. In `backend/app/seo_meta.py`, add `"https://www.wikidata.org/wiki/Q…"` to the Organization `sameAs` array (the comment there marks the spot).

## 3. OpenSSF Best Practices badge — trust/authority signal

PrivaTools now **meets** most passing criteria, so submission is mostly a form:
automated test suite in CI (`.github/workflows/test.yml`), public VCS, `LICENSE`
(MIT), `CONTRIBUTING.md`, `SECURITY.md` + `/.well-known/security.txt`, signed
releases (cosign in `release.yml`), SBOM + dependency scanning (`security.yml`).

1. Sign in at <https://www.bestpractices.dev> with GitHub.
2. Add the project (the GitHub repo URL); answer the criteria — most map directly to the files above.
3. Add the earned badge markdown to `README.md` (next to the existing Scorecard/SBOM badges).

## Do NOT add fake `aggregateRating`

Tempting for stars in search, but `aggregateRating` without a **real, verifiable
review corpus** violates Google's structured-data guidelines and risks a manual
action. Only add it once there's a genuine review source (e.g. a real ratings
widget or an external review aggregator) to back it.

## Quick wins already shipped (for reference)

- Citable "PrivaTools at a glance" facts block on the homepage SSR (statistic-dense, self-contained — optimal for AI extraction).
- `knowsAbout` topics upgraded to knowledge-graph `Thing` entities with Wikipedia `sameAs`.
- Per-tool SSR ≥800 words with TL;DR, HowTo + FAQ JSON-LD, and a "Last reviewed" date.
- `llms.txt` + `llms-full.txt` regenerated from the registry on every build.
