# GEO Analysis — privatools.me (pre-release build)

*Produced by executing the installed `seo-geo` skill (claude-seo v2.2.5) against the
SSR surface at the local backend — the exact HTML AI crawlers receive, since they
do not execute JavaScript. Date: 2026-09-01. Re-run after the next `v*` deploy.*

## GEO Readiness Score: 82/100

| Criterion (weight) | Score | Evidence |
|---|---|---|
| Citability (25%) | 21/25 | Every post front-loads a 60–90-word self-contained TL;DR (SSR-rendered, `speakable`-selected); comparison tables with dated sourcing; "X is…" definitions in the four vs-posts. Loses points: statistics are mostly product facts, little original research data. |
| Structural readability (20%) | 17/20 | Clean single-H1 pages; question-form H2s added to the comparison posts; short paragraphs; tables for comparative data. |
| Multi-modal (15%) | 10/15 | Per-page OG image (now crawlable — robots un-blocked `/api/og-image`); tables throughout; no video/interactive embeds in posts (the tools themselves are the interactive assets, but live outside articles). |
| Authority & brand (20%) | 15/20 | Named byline (Lakshya Lodha) as Person schema with GitHub `sameAs`; publish + updated dates now flow to `dateModified`; honest sourcing lines. Weak: no Wikipedia/Reddit/YouTube entity presence — the strongest AI-citation signal (r≈0.74 for YouTube) and entirely off-site work. |
| Technical accessibility (20%) | 19/20 | Full SSR body injection for blog/tools/compare (verified by curl: titles, TL;DR blocks, article bodies, JSON-LD in raw HTML); all major AI crawlers allowed (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended); Bytespider deliberately blocked; IndexNow pings on deploy; llms.txt + llms-full.txt maintained (correctly treated as non-Google surface). |

## Platform breakdown
- **Google AI Overviews:** strong — SSR + ranking fundamentals + speakable TL;DRs. Gated mainly by classic rankings (young domain).
- **Google AI Mode:** good — freshness signals now real (`updatedAt` on comparisons); entity authority is the gap.
- **ChatGPT search:** structurally ready (OAI bots allowed, SSR); citation likelihood limited by absent Wikipedia/Reddit presence.
- **Perplexity:** same — Reddit-mention driven; nothing on-site left blocking.
- **Bing Copilot:** IndexNow wired into the deploy script; sitemap valid (262 URLs).

## Verified this audit (raw-HTML curls)
- `/blog/privatools-vs-sejda` → correct title, `post-tldr` present, "3 tasks per hour" in body, BlogPosting JSON-LD, byline.
- `/blog/privatools-vs-ihatepdf` → real title (the soft-404 class is dead).
- `/compare/ihatepdf` → Review with `itemReviewed` + `reviewRating`.
- `/` → derived "219 free" description; `/robots.txt` → 25 groups allow `/api/og-image`; `/llms.txt` → honest, spec-shaped.

## Top 5 highest-impact next moves (in order)
1. **Off-site entity presence** — the single biggest lever and the only one not in this repo: genuine Reddit participation, a YouTube walkthrough or two, and eventually a Wikipedia-grade citation trail. Brand mentions out-predict backlinks ~3× for AI citations.
2. **Original data** — publish one piece of primary research (e.g. "we measured the free-tier limits of 8 PDF suites, monthly"); unique numbers are what LLMs quote.
3. **Refresh cadence** — comparisons re-verified (and `updatedAt` bumped) at least quarterly; sub-3-month content is ~3× likelier to be cited.
4. **Deploy + request indexing** — none of this reaches crawlers until a `v*` tag ships; then verify in GSC/Bing and let IndexNow do its job.
5. **Author entity** — a public author page/LinkedIn linked via `sameAs` to strengthen the Person node.

## Explicitly not recommended
Per Google's AI-optimization guidance baked into the skill: no llms.txt-as-ranking-lever claims, no AI-specific rewriting, no mention-farming. GEO here is SEO fundamentals applied to AI surfaces — which is what this codebase now does.

---

# Technical Audit Addendum (`seo-technical` skill)

**Technical Score: 90/100**

| Category | Status | Notes |
|---|---|---|
| Crawlability | pass | robots.txt valid, AI crawlers deliberately allowed (Bytespider blocked), 262-URL sitemap referenced; SPA content fully SSR'd so nothing critical needs JS |
| Indexability | pass | Self-referencing canonicals in raw HTML (curl-verified); unknown URLs return real 404 meta; no parameterized duplicates |
| Security | pass | Nonce-based CSP, X-Frame-Options DENY, nosniff, referrer-policy from the app itself; HSTS terminates at prod nginx |
| URL structure | pass | Clean hyphenated paths, ≤3 clicks to any tool via /tools |
| Mobile | pass | Responsive throughout, mobile tab bar, no horizontal overflow (measured), content parity — same SSR for all agents |
| Core Web Vitals | warn (no field data) | Lab: entry 62 KiB gzip, fonts preloaded, reveals are transform/opacity-only. CrUX will exist only post-launch traffic; re-check via `claude-seo run pagespeed_check.py` once deployed |
| Structured data | pass | BlogPosting w/ named Person author + dateModified, Review w/ ratings, Breadcrumb, Organization inlined (validated by direct builder calls) |
| JS rendering | pass | The defining strength: full body SSR injection; JSON-LD, canonical, robots meta all in initial HTML |
| IndexNow | pass | Key file served from root; deploy script pings on every release |

**Agent-UX (accessibility-tree heuristic, run in-DOM since the toolkit's scanner
correctly refuses localhost):** 274 interactive elements on the catalogue page —
0 unnamed, 0 unlabeled inputs, 0 pointer-cursor fake buttons. One finding fixed
in the same commit: the ⌘K palette now exposes a proper combobox/listbox/option
ARIA relationship with `aria-activedescendant`.

**To run post-deploy (public URL required by the toolkit's SSRF guard):**
`claude-seo run agent_ux_check.py https://privatools.me --json` and
`claude-seo run pagespeed_check.py https://privatools.me --json`.
