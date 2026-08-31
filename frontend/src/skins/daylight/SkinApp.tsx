/* eslint-disable */
// @ts-nocheck
/**
 * Daylight — the first hand-written skin.
 *
 * The other three ported designs are generated from `design-sources/*.dc.html`
 * and repaired through the generator's correction tables. Daylight was designed
 * *as* an application (the prototype lived and iterated as running code), so it
 * is authored directly: one class component in the codebase's ported-skin shape
 * — a self-contained monolith that owns the whole screen — with none of the
 * splice/bind machinery, because there is nothing to splice.
 *
 * What is real here, and where it comes from:
 *
 *   catalogue      `@/data/tools` + `@/data/non-pdf-tools` — every count and
 *                  list derives from the registry at runtime; no literals.
 *   tool runs      `withRealTools` (extension) mounts the same 112 tool
 *                  components the house design uses via its `realToolUI`
 *                  binding. Daylight draws the chrome; the run panel is real.
 *   local/server   `tool.clientOnly` from the registry — the amber/green chip
 *                  is per-tool truth, not a hand-kept map.
 *   accounts       `withAccounts` (extension) supplies `this.state.acct` and
 *                  the whole flow — signup recovery codes, Clerk email-code
 *                  branch, key issue/revoke, code rotation. The markup below
 *                  only *renders* that state; it re-implements none of it.
 *   vault          `withVault` (extension) drives the real AES-GCM store in
 *                  `lib/localStore/vault` through `this.state.vlt`.
 *   URL bridging   `withPathRoutes` (extension) translates every site path to
 *                  the `#/…` hashes this component routes on — the same bridge
 *                  Aurora and Carbon use, so /tool/<slug> deep links, the
 *                  sitemap and search results all land correctly.
 *
 * Simulated, and labelled as such in their own copy: the Pipeline and Batch
 * run animations (the same fidelity bar as the other three ported designs) and
 * the Status page's uptime strips.
 */
import React from "react";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import {
    ACCOUNT_COPY, MIN_PASSWORD_LENGTH, SOCIAL_SIGN_IN, describeKey, strengthOf,
} from "../accountLogic";
import { describeEntry } from "../vaultLogic";
import { readThemeChoice, resolveTheme, setThemeChoice } from "@/lib/skinTheme";

/* ═══════════════════════════ catalogue (real) ═══════════════════════════ */

const ALL_TOOLS = [
    ...tools.map((t) => ({ ...t, kind: "pdf" })),
    ...nonPdfTools.map((t) => ({ ...t, kind: "x" })),
];
const BY_SLUG = new Map(ALL_TOOLS.map((t) => [t.slug, t]));
const TOTAL = ALL_TOOLS.length;
const PDF_COUNT = tools.length;

/** Family metadata: label + hue per registry category. Order is display order. */
const FAMILIES = [
    ["organize", "Organize", "#C4574E"],
    ["edit", "Edit & annotate", "#B9822B"],
    ["optimize", "Optimize", "#3B9B6E"],
    ["security", "Security", "#6A6FD1"],
    ["to-pdf", "Convert to PDF", "#C76B37"],
    ["from-pdf", "Convert from PDF", "#4A8AC2"],
    ["advanced", "Advanced", "#8B67CF"],
    ["image", "Images", "#C75B9B"],
    ["video-audio", "Video & audio", "#C94F6D"],
    ["developer", "Developer", "#3D9CA8"],
    ["archive", "Archives", "#A98B4A"],
    ["document-office", "Documents & office", "#7C9B4F"],
];
const FAMILY_LABEL = Object.fromEntries(FAMILIES.map(([k, l]) => [k, l]));
const FAMILY_HUE = Object.fromEntries(FAMILIES.map(([k, , h]) => [k, h]));

const POPULAR = [...ALL_TOOLS].sort((a, b) => (a.popularity ?? 999) - (b.popularity ?? 999));

/* ═════════════════════════════ routing ═════════════════════════════ */

/**
 * Hash → view. Exported for the unit test.
 *
 * Accepts the site's own URL shapes (what withPathRoutes produces from real
 * paths) plus this design's internal links. `/tools/<slug>` — the non-PDF tool
 * path — folds into the single tool view exactly as it does in Aurora.
 */
export function parseHash(hash) {
    const h = (hash || "#/").replace(/^#\/?/, "");
    const [path, query = ""] = h.split("?");
    const seg = path.replace(/\/+$/, "").split("/").filter(Boolean);
    const cat = new URLSearchParams(query).get("cat") || "";

    if (seg.length === 0) return { view: "home" };
    if (seg[0] === "tool" && seg[1]) return { view: "tool", slug: seg.slice(1).join("/") };
    if (seg[0] === "tool") return { view: "tools", cat: "" };
    if (seg[0] === "tools" && seg[1]) return { view: "tool", slug: seg.slice(1).join("/") };
    if (seg[0] === "tools") return { view: "tools", cat };
    if (seg[0] === "my-stuff" && seg[1] === "vault") return { view: "vault" };
    if (seg[0] === "my-stuff") return { view: "mystuff" };
    if (seg[0] === "account") return { view: "account", keys: seg[1] === "keys" };
    if (seg[0] === "blog" && seg[1]) return { view: "blog", post: seg[1] };
    if (seg[0] === "blog") return { view: "blog", post: "" };
    if (seg[0] === "security" || seg[0] === "trust") return { view: "security" };
    const SIMPLE = ["pipeline", "batch", "compare", "about", "privacy", "terms", "status", "support"];
    if (SIMPLE.includes(seg[0])) return { view: seg[0] };
    return { view: "home" };
}

const go = (hash) => { location.hash = hash; };

/* ═══════════════════════════ small helpers ═══════════════════════════ */

const fmtSize = (n) =>
    n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

/** Kind-glyph resolver: distinct stroke icon per tool verb, family glyph as fallback. */
const KIND_GLYPHS = [
    [/merge|combine|alternate|mix|overlay/, "M3 4 H7 L11 9 L7 14 H3 M13.5 2.5 L15.5 4 L13.5 5.5 M13.5 12.5 L15.5 14 L13.5 15.5 M11 9 L15 4.5 M11 9 L15 13.5"],
    [/split|extract-pages|delete-pages|remove-blank/, "M6.7 6.6 L15 13 M6.7 11.4 L15 5 M5 3.5 A2 2 0 1 0 5 7.5 A2 2 0 1 0 5 3.5 M5 10.5 A2 2 0 1 0 5 14.5 A2 2 0 1 0 5 10.5"],
    [/compress|optimize|minif|shrink/, "M7 2.5 V7 H2.5 M11 2.5 V7 H15.5 M7 15.5 V11 H2.5 M11 15.5 V11 H15.5"],
    [/rotate|flip|mirror|reverse/, "M14.5 9 A5.5 5.5 0 1 1 9 3.5 M9 3.5 L12 1.5 M9 3.5 L12 5.5"],
    [/crop|resize|trim/, "M5 2 V13 H16 M2 5 H13 V16"],
    [/protect|encrypt|password|permission/, "M4.75 8.75 H13.25 V14.25 H4.75 Z M6 8 V6 A3 3 0 0 1 12 6 V8"],
    [/unlock/, "M4.75 8.75 H13.25 V14.25 H4.75 Z M12 8 V6 A3 3 0 0 0 6.4 4.6"],
    [/watermark|stamp|bates|number/, "M4 6.2 L14.2 5.1 L15 12.1 L4.8 13.2 Z M6.4 9.8 L12.3 9.2"],
    [/sign|esign/, "M2.5 13 C 5 7, 7 7, 7.5 10.5 C 8 13.5, 9.5 13, 10.5 9 C 11 7, 12 8, 12.5 10 C 13 12, 14 12.5, 15.5 10.5 M3 15.5 H15"],
    [/ocr|scan(?!ner)|read/, "M2.5 6 V3.5 H6 M12 3.5 H15.5 V6 M15.5 12 V14.5 H12 M6 14.5 H2.5 V12 M5.5 9 H12.5"],
    [/-to-|convert|-from-/, "M5.5 6.5 H14.5 M14.5 6.5 L11.8 3.8 M14.5 6.5 L11.8 9.2 M12.5 11.5 H3.5 M3.5 11.5 L6.2 8.8 M3.5 11.5 L6.2 14.2"],
    [/remove|strip|delete|redact|sanitize|erase|whiteout|mute/, "M9 2.5 A6.5 6.5 0 1 0 9 15.5 A6.5 6.5 0 1 0 9 2.5 M6 9 H12"],
    [/generator|generate|create|make|counter|lorem|uuid/, "M9 3 V15 M3 9 H15"],
];
const FAMILY_GLYPHS = {
    "organize": "M9 2.5 L15.5 6 L9 9.5 L2.5 6 Z M3.5 9.5 L9 12.5 L14.5 9.5 M3.5 13 L9 16 L14.5 13",
    "edit": "M11.5 3.5 L14.5 6.5 L7 14 L3.5 14.5 L4 11 Z",
    "optimize": "M3 15 C3 9 6 4 15 3 C14.5 10 10.5 14 3 15 Z M6 12 C8 9 10 7.5 12.5 6",
    "security": "M4.75 8.75 H13.25 V14.25 H4.75 Z M6 8 V6 A3 3 0 0 1 12 6 V8",
    "to-pdf": "M10.5 2.5 H14.5 V15.5 H5.5 V11 M2.5 6.5 H9 M9 6.5 L6.5 4 M9 6.5 L6.5 9",
    "from-pdf": "M7.5 2.5 H3.5 V15.5 H12.5 V11 M8.5 6.5 H15.5 M15.5 6.5 L13 4 M15.5 6.5 L13 9",
    "advanced": "M9 2.5 L10.6 7.4 L15.5 9 L10.6 10.6 L9 15.5 L7.4 10.6 L2.5 9 L7.4 7.4 Z",
    "image": "M3.25 4.25 H14.75 V13.75 H3.25 Z M6.5 6.2 A1.3 1.3 0 1 0 6.5 8.8 A1.3 1.3 0 1 0 6.5 6.2 M3.5 12.5 L8 9 L11 11.5 L14.5 8",
    "video-audio": "M3.25 4.75 H14.75 V13.25 H3.25 Z M7.5 7 L11.5 9 L7.5 11 Z",
    "developer": "M6.5 5.5 L3 9 L6.5 12.5 M11.5 5.5 L15 9 L11.5 12.5",
    "archive": "M3.25 6.25 H14.75 V15 H3.25 Z M2.5 5.5 L4 2.8 H14 L15.5 5.5 M7 8.5 H11",
    "document-office": "M4.5 2.5 H10.5 L13.5 5.5 V15.5 H4.5 Z M7 9 H11 M7 11.5 H11",
};
function glyphPath(tool) {
    for (const [re, d] of KIND_GLYPHS) if (re.test(tool.slug)) return d;
    return FAMILY_GLYPHS[tool.category] || FAMILY_GLYPHS.organize;
}
const Glyph = ({ d, size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);
const Check = ({ size = 15 }) => (
    <svg width={size} height={size} viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <path d="M3 8 L6.2 11 L12 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);
const Logo = ({ size = 23 }) => (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <path d="M11 2 L19 6 V11 C19 15.5 15.6 19 11 20 C6.4 19 3 15.5 3 11 V6 Z" stroke="var(--dl-green)" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M7.5 11 L10 13.5 L14.5 8.5" stroke="var(--dl-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/** Suggested tools for a dropped file, by extension — every slug is registry-real. */
const DROP_ROUTES = [
    [/\.pdf$/i, "PDF", ["merge-pdf", "compress-pdf", "pdf-to-word"]],
    [/\.(jpe?g|png|webp|heic|gif|bmp|tiff?)$/i, "image", ["image-compressor", "image-converter", "remove-exif"]],
    [/\.(mp4|mov|webm|mkv|avi)$/i, "video", ["video-converter", "compress-video", "extract-audio"]],
    [/\.(mp3|wav|m4a|flac|ogg|aac)$/i, "audio", ["audio-converter", "audio-trim", "audio-merge"]],
    [/\.(zip|tar|gz|rar|7z)$/i, "archive", ["extract-archive", "create-zip", "hash-generator"]],
    [/\.(docx?|xlsx?|pptx?|odt)$/i, "document", ["office-to-pdf", "word-to-pdf", "excel-to-pdf"]],
    [/.*/, "file", ["create-zip", "hash-generator", "txt-to-pdf"]],
];

const PAGES_FOR_PALETTE = [
    ["#/tools", "All tools", "Browse the full catalogue"],
    ["#/pipeline", "Pipeline", "Chain tools into one pass"],
    ["#/batch", "Batch", "Same tool, many files"],
    ["#/my-stuff/vault", "Vault", "Device-local encrypted passwords"],
    ["#/my-stuff", "My Stuff", "Your activity on this device"],
    ["#/account", "Developer API", "Sign in, keys and quota"],
    ["#/status", "Status", "Live service state"],
    ["#/security", "Trust & security", "The promises, verifiable"],
    ["#/compare", "Compare", "The fine print, side by side"],
    ["#/support", "Support", "A person reads this"],
];

const HISTORY_KEY = "privatools.daylight.history";

const BLOG = [
    {
        id: "how-local-first-works", tag: "Engineering", date: "Aug 14, 2026", mins: 6,
        title: "How local-first file tools actually work",
        excerpt: "The browser can parse, render and rewrite most file formats on its own. Here’s where the line really sits — and why some jobs still need a server.",
        body: [
            "Most of what a file tool does — parsing pages, reordering them, rewriting metadata, re-encoding an image — is computation, and your browser is a very capable computer. When you merge two PDFs here, a library running in this tab reads both files from memory, builds a new document, and hands it back to you. No network request exists in that story, which is why the network tab stays empty.",
            "The honest boundary: some work needs native code the browser can’t carry — full OCR models, office-suite conversion, heavy video transcodes. Those tools say so up front, run in isolated temporary storage on our disclosed server, and delete everything after the job.",
            "The rule we build by: if it can run on your device, it must. The server is a fallback we disclose, never a default we hide.",
        ],
    },
    {
        id: "what-deleted-means", tag: "Trust", date: "Jul 2, 2026", mins: 4,
        title: "What “deleted after use” means on our servers",
        excerpt: "A promise you can’t verify from a network tab deserves a precise definition. This is ours, mechanism by mechanism.",
        body: [
            "For server tools, your file exists exactly as long as the job does: it’s written to isolated temporary storage, processed, streamed back, and removed. There is no results bucket, no “keep for 2 hours” window, no copy we could recover later even if you asked us to.",
            "We’d rather you not have to trust this at all — which is why most of the catalogue runs locally, and why every tool that doesn’t says so before you add a file.",
        ],
    },
    {
        id: "reading-privacy-policies", tag: "Guides", date: "May 21, 2026", mins: 5,
        title: "Reading a file tool’s privacy policy in 60 seconds",
        excerpt: "Four questions cut through any policy: where files go, how long they stay, who else runs code on the page, and what’s behind the free tier.",
        body: [
            "Skip the preamble and search for four things. Where do files go? If uploading is the default, everything else is damage control. How long do they stay? “Deleted after N hours” is a retention policy, not deletion. Whose code runs on the page? Analytics scripts and unpinned CDN tools see more than most policies admit. What does free actually include? Task caps and Pro-gated settings tell you who the product is really for.",
            "Ask those four of us too — that’s what this site’s Trust page is for.",
        ],
    },
];

/* ═══════════════════════════════ styles ═══════════════════════════════ */

const CSS = `
.dl-root {
  --dl-paper:#FAFAF8; --dl-card:#FFFFFF; --dl-card2:#F4F5F3;
  --dl-ink:#15191B; --dl-muted:#5B6268; --dl-faint:#8B9197;
  --dl-rule:#ECEDEA; --dl-rule-soft:#F3F4F1; --dl-rule-mid:#D8DBD7;
  --dl-green:#0E8A5F; --dl-green-deep:#0A6B49; --dl-wash:#E8F4EE; --dl-ghost:#D5EBDF;
  --dl-amber:#A8730E; --dl-amber-wash:#FBF3E2; --dl-red:#B4443C;
  --dl-on-accent:#FFFFFF;
  --dl-band:#121A15; --dl-band-ink:#F2F5F0; --dl-band-muted:#A9B4AA; --dl-band-green:#4ED39C;
  --dl-sh1:0 1px 2px rgba(16,20,22,.04), 0 10px 32px -18px rgba(16,20,22,.14);
  --dl-sh2:0 2px 6px rgba(16,20,22,.05), 0 28px 64px -24px rgba(16,20,22,.2);
  --dl-eo:cubic-bezier(0.23,1,0.32,1);
  background:var(--dl-paper); color:var(--dl-ink);
  font-family:'Manrope', system-ui, -apple-system, sans-serif;
  font-size:16px; line-height:1.6; min-height:100dvh;
  -webkit-font-smoothing:antialiased;
}
[data-theme="dark"] .dl-root {
  --dl-paper:#0F1113; --dl-card:#171A1D; --dl-card2:#1D2124;
  --dl-ink:#EDEFF1; --dl-muted:#A8AEB4; --dl-faint:#7B8288;
  --dl-rule:#272B2F; --dl-rule-soft:#1F2326; --dl-rule-mid:#3A4045;
  --dl-green:#38D392; --dl-green-deep:#66E0AF; --dl-wash:#153026; --dl-ghost:#1B3D30;
  --dl-amber:#D9A63F; --dl-amber-wash:#33290F; --dl-red:#E06A60;
  --dl-on-accent:#0C1410;
  --dl-band:#08090B; --dl-band-muted:#999FA6; --dl-band-green:#38D392;
  --dl-sh1:0 1px 2px rgba(0,0,0,.4), 0 10px 28px -16px rgba(0,0,0,.6);
  --dl-sh2:0 2px 6px rgba(0,0,0,.45), 0 24px 56px -20px rgba(0,0,0,.7);
}
@media (prefers-color-scheme: dark) {
  html:not([data-theme]) .dl-root {
    --dl-paper:#0F1113; --dl-card:#171A1D; --dl-card2:#1D2124;
    --dl-ink:#EDEFF1; --dl-muted:#A8AEB4; --dl-faint:#7B8288;
    --dl-rule:#272B2F; --dl-rule-soft:#1F2326; --dl-rule-mid:#3A4045;
    --dl-green:#38D392; --dl-green-deep:#66E0AF; --dl-wash:#153026; --dl-ghost:#1B3D30;
    --dl-amber:#D9A63F; --dl-amber-wash:#33290F; --dl-red:#E06A60;
    --dl-on-accent:#0C1410;
    --dl-band:#08090B; --dl-band-muted:#999FA6; --dl-band-green:#38D392;
    --dl-sh1:0 1px 2px rgba(0,0,0,.4), 0 10px 28px -16px rgba(0,0,0,.6);
    --dl-sh2:0 2px 6px rgba(0,0,0,.45), 0 24px 56px -20px rgba(0,0,0,.7);
  }
}
.dl-root *, .dl-root *::before, .dl-root *::after { box-sizing:border-box; }
.dl-root h1, .dl-root h2, .dl-root h3, .dl-root p, .dl-root ul, .dl-root figure { margin:0; }
.dl-root button { font-family:inherit; cursor:pointer; color:inherit; background:none; border:0; font-size:inherit; }
.dl-root a { color:var(--dl-green); text-decoration:none; }
.dl-root a:hover { color:var(--dl-green-deep); }
.dl-root :focus-visible { outline:2px solid var(--dl-green); outline-offset:3px; border-radius:4px; }
.dl-root ::selection { background:var(--dl-ghost); }
.dl-wrap { max-width:1480px; margin:0 auto; padding:0 32px; }
.dl-h, .dl-root h1, .dl-root h2, .dl-root h3, .dl-brand, .dl-stat b, .dl-herocard .big,
.dl-receipt .rh, .dl-dz .mid b, .dl-cnode .num {
  font-family:'Bricolage Grotesque', 'Manrope', system-ui, sans-serif;
}
.dl-h { font-weight:700; letter-spacing:-.022em; text-wrap:balance; line-height:1.05; }

.dl-btn { display:inline-flex; align-items:center; justify-content:center; gap:9px; border-radius:11px;
  padding:14px 26px; font-size:15px; font-weight:600; transition:transform 160ms var(--dl-eo), background .18s, border-color .18s, box-shadow .18s; }
.dl-btn:active { transform:scale(.97); }
.dl-root .dl-btn-primary { background:var(--dl-green); color:var(--dl-on-accent); }
.dl-root .dl-btn-primary:hover { background:var(--dl-green-deep); box-shadow:var(--dl-sh1); }
.dl-root .dl-btn-primary:disabled { opacity:.55; cursor:default; }
.dl-root .dl-btn-ghost { background:var(--dl-card); color:var(--dl-ink); border:1px solid var(--dl-rule-mid); }
.dl-root .dl-btn-ghost:hover { border-color:var(--dl-faint); box-shadow:var(--dl-sh1); }
.dl-root .dl-btn-ink { background:var(--dl-ink); color:var(--dl-paper); }
.dl-root .dl-btn-quiet { background:none; color:var(--dl-muted); padding:10px 14px; }
.dl-root .dl-btn-quiet:hover { color:var(--dl-ink); }
.dl-eyebrow { font-size:12.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--dl-green); font-weight:600; }
.dl-sec { padding-top:104px; }
.dl-sec-head { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:22px; flex-wrap:wrap; }
.dl-sec-title { font-weight:700; font-size:29px; letter-spacing:-.02em; }
.dl-sec-sub { font-size:15px; color:var(--dl-muted); margin-top:5px; }
@keyframes dlRise { from { opacity:0; transform:translateY(12px); } }
@media (prefers-reduced-motion: reduce) { .dl-root * { animation-duration:.01ms !important; transition-duration:.01ms !important; } }

/* nav */
.dl-header { position:sticky; top:0; z-index:20; background:color-mix(in srgb, var(--dl-paper) 90%, transparent); backdrop-filter:blur(10px); border-bottom:1px solid var(--dl-rule); }
.dl-nav { display:flex; align-items:center; gap:24px; padding:15px 32px; max-width:1480px; margin:0 auto; }
.dl-root .dl-brand { display:flex; align-items:center; gap:10px; color:var(--dl-ink); flex:none; font-weight:700; font-size:19px; letter-spacing:-.01em; }
.dl-links { display:flex; gap:20px; font-size:14.5px; font-weight:500; }
.dl-root .dl-links a { color:var(--dl-muted); white-space:nowrap; padding:4px 0; position:relative; }
.dl-root .dl-links a:hover { color:var(--dl-ink); }
.dl-root .dl-links a.on { color:var(--dl-ink); }
.dl-links a.on::after { content:""; position:absolute; left:0; right:0; bottom:-2px; height:2px; background:var(--dl-green); border-radius:2px; }
.dl-searchpill { margin-left:auto; display:flex; align-items:center; gap:10px; background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:999px; padding:9px 16px; width:250px; color:var(--dl-faint); font-size:13.5px; }
.dl-searchpill:hover { border-color:var(--dl-rule-mid); box-shadow:var(--dl-sh1); }
.dl-searchpill kbd { margin-left:auto; font-family:inherit; font-size:11px; border:1px solid var(--dl-rule); border-radius:5px; padding:1px 6px; background:var(--dl-paper); }
.dl-root .dl-navcta { padding:9px 20px; font-size:13.5px; border-radius:999px; flex:none; }
.dl-iconbtn { display:none; background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:999px; width:38px; height:38px; align-items:center; justify-content:center; flex:none; }
.dl-themebtn { background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:999px; width:38px; height:38px; display:flex; align-items:center; justify-content:center; flex:none; }
@media (max-width: 1120px) { .dl-links { display:none; } .dl-searchpill { display:none; } .dl-iconbtn { display:flex; margin-left:auto; } }
@media (max-width: 640px) { .dl-navcta { display:none; } }

/* hero */
.dl-hero { display:grid; grid-template-columns:minmax(0,1.12fr) 340px; gap:64px; align-items:center; padding:80px 0 0; }
@media (max-width: 1020px) { .dl-hero { grid-template-columns:1fr; gap:30px; padding-top:44px; } }
.dl-hero h1 { font-weight:700; font-size:clamp(50px, 6vw, 84px); line-height:1.02; letter-spacing:-.024em; margin:18px 0 22px; }
.dl-hero h1 em { font-style:normal; color:var(--dl-green); }
.dl-hero .sub { font-size:18px; color:var(--dl-muted); max-width:33em; margin-bottom:26px; }
.dl-hint { font-size:13px; color:var(--dl-faint); margin-top:16px; }
.dl-receipt { background:var(--dl-card); border:1px solid var(--dl-rule-soft); border-radius:18px; box-shadow:var(--dl-sh2); padding:24px 26px 20px; display:flex; flex-direction:column; }
.dl-receipt .rh { display:flex; justify-content:space-between; align-items:baseline; padding-bottom:12px; border-bottom:1px solid var(--dl-rule); font-weight:700; font-size:16px; }
.dl-receipt .rh span { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--dl-faint); font-weight:600; }
.dl-receipt .rr { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:10.5px 0; border-bottom:1px solid var(--dl-rule); font-size:13.5px; }
.dl-receipt .rr span { color:var(--dl-muted); }
.dl-receipt .rr b { font-weight:600; }
.dl-receipt .rf { padding-top:12px; font-size:12px; color:var(--dl-faint); text-align:center; }
.dl-dz { margin-top:44px; background:var(--dl-card); border:1.5px dashed var(--dl-rule-mid); border-radius:20px; box-shadow:var(--dl-sh1); display:flex; align-items:center; gap:22px; padding:30px 34px; cursor:pointer; }
.dl-dz:hover { box-shadow:var(--dl-sh2); border-color:var(--dl-faint); }
.dl-dz.over { border-color:var(--dl-green); background:var(--dl-wash); }
.dl-puck { flex:none; width:56px; height:56px; border-radius:16px; background:var(--dl-wash); display:flex; align-items:center; justify-content:center; color:var(--dl-green); }
.dl-dz .mid { flex:1; min-width:0; }
.dl-dz .mid b { font-weight:700; font-size:20px; letter-spacing:-.01em; display:block; }
.dl-dz .mid p { font-size:13.5px; color:var(--dl-faint); margin-top:2px; }
.dl-dz .kbdhint { color:var(--dl-faint); font-size:13px; display:flex; align-items:center; gap:8px; flex:none; }
.dl-dz .kbdhint kbd { font-family:inherit; font-size:11px; border:1px solid var(--dl-rule); border-radius:6px; padding:2px 8px; background:var(--dl-card); }
@media (max-width: 800px) { .dl-dz { flex-direction:column; text-align:center; } }
.dl-dropov { position:fixed; inset:0; z-index:50; background:color-mix(in srgb, var(--dl-green) 8%, var(--dl-paper) 85%); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; pointer-events:none; }
.dl-dropov > div { border:2px dashed var(--dl-green); border-radius:24px; padding:46px 70px; text-align:center; background:var(--dl-card); box-shadow:var(--dl-sh2); }
.dl-dropov b { font-weight:700; font-size:30px; letter-spacing:-.02em; display:block; }
.dl-dropov p { color:var(--dl-muted); font-size:14.5px; margin-top:6px; }
.dl-suggest { padding-top:20px; display:flex; flex-direction:column; gap:12px; }
.dl-picked { display:flex; flex-wrap:wrap; gap:8px; }
.dl-picked span { display:inline-flex; align-items:center; gap:8px; background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:999px; padding:6px 14px; font-size:12.5px; font-weight:500; }
.dl-picked b { color:var(--dl-faint); font-weight:500; }
.dl-sughead { font-size:14px; color:var(--dl-muted); }
.dl-sughead b { color:var(--dl-ink); font-weight:600; }
.dl-sugrow { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:12px; }
@media (max-width: 860px) { .dl-sugrow { grid-template-columns:1fr; } }

.dl-stats { display:flex; justify-content:space-between; align-items:baseline; border-top:1px solid var(--dl-rule); border-bottom:1px solid var(--dl-rule); margin-top:64px; padding:24px 0; flex-wrap:wrap; gap:8px 0; }
.dl-stat { display:flex; align-items:baseline; gap:12px; padding:4px 18px 4px 0; }
.dl-stat b { font-weight:700; font-size:clamp(34px, 3.6vw, 52px); letter-spacing:-.03em; line-height:1; font-variant-numeric:tabular-nums; }
.dl-stat b small { font-size:.45em; font-weight:700; }
.dl-stat .cap { font-size:13px; color:var(--dl-muted); max-width:13em; line-height:1.35; }

.dl-grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:13px; }
@media (max-width: 980px) { .dl-grid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
@media (max-width: 560px) { .dl-grid { grid-template-columns:1fr; } }
.dl-root .dl-card { background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:14px; padding:18px 20px;
  display:flex; flex-direction:column; gap:7px; color:var(--dl-ink); position:relative; transition:transform 180ms var(--dl-eo), box-shadow .18s, border-color .18s; }
@media (hover:hover) and (pointer:fine) {
  .dl-root .dl-card:hover { transform:translateY(-2px); box-shadow:var(--dl-sh2); border-color:var(--dl-rule-mid); color:var(--dl-ink); }
  .dl-root .dl-card:hover .arr { opacity:1; transform:none; }
}
.dl-card:active { transform:scale(.98); }
.dl-card .tr { display:flex; align-items:center; gap:11px; }
.dl-card .glyph { flex:none; width:36px; height:36px; border-radius:11px; background:color-mix(in srgb, var(--dl-cc, var(--dl-green)) 15%, var(--dl-card)); display:flex; align-items:center; justify-content:center; color:var(--dl-cc, var(--dl-green)); }
[data-theme="dark"] .dl-root .dl-card .glyph,
[data-theme="dark"] .dl-root .dl-tile .ic,
[data-theme="dark"] .dl-root .dl-ccard .glyph { color:color-mix(in srgb, var(--dl-cc, var(--dl-green)) 65%, #fff); }
.dl-card b { font-size:14.5px; font-weight:600; line-height:1.3; }
.dl-card p { font-size:12.5px; color:var(--dl-faint); line-height:1.5; }
.dl-card .arr { position:absolute; top:18px; right:16px; opacity:0; transform:translateX(-4px); transition:opacity 160ms, transform 160ms; color:var(--dl-green); }

.dl-ccards { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }
@media (max-width: 980px) { .dl-ccards { grid-template-columns:repeat(2, minmax(0,1fr)); } }
.dl-root .dl-ccard { display:flex; align-items:center; gap:13px; background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:13px; padding:15px 17px; color:var(--dl-ink); transition:transform 170ms var(--dl-eo), box-shadow .16s; }
@media (hover:hover) { .dl-root .dl-ccard:hover { transform:translateY(-2px); box-shadow:var(--dl-sh2); color:var(--dl-ink); } }
.dl-ccard .glyph { flex:none; width:36px; height:36px; border-radius:11px; background:color-mix(in srgb, var(--dl-cc) 15%, var(--dl-card)); display:flex; align-items:center; justify-content:center; color:var(--dl-cc); }
.dl-ccard b { font-size:14.5px; font-weight:600; display:block; line-height:1.25; }
.dl-ccard span { font-size:12px; color:var(--dl-faint); }

.dl-vband { display:grid; grid-template-columns:minmax(0,1.1fr) 380px; gap:56px; align-items:center; background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:18px; padding:46px 52px; }
@media (max-width: 960px) { .dl-vband { grid-template-columns:1fr; padding:32px 26px; } }
.dl-vmock { background:var(--dl-paper); border:1px solid var(--dl-rule); border-radius:14px; padding:18px 20px; }
.dl-vmock .vh { display:flex; align-items:center; gap:9px; color:var(--dl-green); padding-bottom:12px; border-bottom:1px solid var(--dl-rule); font-weight:600; }
.dl-vmock .vh b { color:var(--dl-ink); font-size:14px; }
.dl-vmock .vh span { margin-left:auto; font-size:11px; color:var(--dl-faint); font-weight:400; }
.dl-vmock .vr { display:flex; align-items:center; gap:12px; padding:11px 0; border-bottom:1px solid var(--dl-rule-soft); font-size:13px; color:var(--dl-green); }
.dl-vmock .vr:last-child { border-bottom:0; }
.dl-vmock .vr b { color:var(--dl-ink); font-weight:600; }
.dl-vmock .vr span:last-child { margin-left:auto; font-size:11px; color:var(--dl-faint); }

.dl-why { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:13px; }
@media (max-width: 900px) { .dl-why { grid-template-columns:1fr; } }
.dl-why > div { background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:16px; padding:26px 28px; }
.dl-why .usual { font-size:13px; color:var(--dl-faint); text-decoration:line-through; text-decoration-color:var(--dl-red); text-decoration-thickness:1.5px; }
.dl-why b.h { font-weight:700; font-size:20px; letter-spacing:-.015em; display:block; margin:8px 0 6px; }
.dl-why p { font-size:13.5px; color:var(--dl-muted); line-height:1.6; }

.dl-claims { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:0 28px; border-top:1px solid var(--dl-rule); padding-top:28px; }
@media (max-width: 900px) { .dl-claims { grid-template-columns:repeat(2, minmax(0,1fr)); gap:22px 28px; } }
.dl-claim b { display:flex; align-items:center; gap:8px; font-size:14.5px; font-weight:600; color:var(--dl-ink); }
.dl-claim b svg { color:var(--dl-green); }
.dl-claim p { font-size:13px; color:var(--dl-muted); line-height:1.55; margin-top:5px; }

.dl-band { background:var(--dl-band); color:var(--dl-band-ink); border-radius:22px; padding:52px; display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); gap:52px; }
@media (max-width: 980px) { .dl-band { grid-template-columns:1fr; padding:36px 28px; } }
.dl-band h2 { font-weight:700; font-size:33px; letter-spacing:-.022em; line-height:1.08; }
.dl-band h2 em { font-style:normal; color:var(--dl-band-green); }
.dl-band .lead { color:var(--dl-band-muted); font-size:15px; margin-top:14px; max-width:30em; }
.dl-step { display:flex; gap:16px; padding:16px 0; border-top:1px solid rgba(255,255,255,.1); }
.dl-step:first-child { border-top:0; padding-top:0; }
.dl-step .dot { flex:none; width:32px; height:32px; border-radius:10px; background:color-mix(in srgb, var(--dl-band-green) 14%, transparent); display:flex; align-items:center; justify-content:center; color:var(--dl-band-green); }
.dl-step b { font-size:15px; font-weight:600; display:block; margin-bottom:2px; }
.dl-step p { font-size:13px; color:var(--dl-band-muted); line-height:1.55; }

.dl-foot { border-top:1px solid var(--dl-rule); margin-top:104px; background:var(--dl-card); }
.dl-foot .cols { display:grid; grid-template-columns:1.3fr 1fr 1fr 1fr; gap:40px; padding:44px 32px 34px; max-width:1480px; margin:0 auto; }
@media (max-width: 900px) { .dl-foot .cols { grid-template-columns:1fr 1fr; gap:30px; } }
@media (max-width: 560px) { .dl-foot .cols { grid-template-columns:1fr; } }
.dl-foot h4 { font-size:11.5px; letter-spacing:.11em; text-transform:uppercase; color:var(--dl-faint); font-weight:600; margin:0 0 13px; }
.dl-foot ul { list-style:none; padding:0; display:flex; flex-direction:column; gap:9px; }
.dl-root .dl-foot ul a { color:var(--dl-muted); font-size:13.5px; }
.dl-root .dl-foot ul a:hover { color:var(--dl-ink); }
.dl-foot .brand p { font-size:13px; color:var(--dl-muted); margin-top:12px; max-width:24em; line-height:1.6; }
.dl-foot .base { border-top:1px solid var(--dl-rule); }
.dl-foot .base > div { display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; max-width:1480px; margin:0 auto; padding:18px 32px; font-size:12.5px; color:var(--dl-faint); }

/* catalogue */
.dl-idxhero { display:flex; flex-direction:column; gap:16px; padding:40px 0 4px; }
.dl-idxrow { display:flex; align-items:center; justify-content:space-between; gap:28px; flex-wrap:wrap; }
.dl-idxrow h1 { font-weight:700; font-size:clamp(30px, 3.4vw, 42px); letter-spacing:-.02em; }
.dl-bigsearch { display:flex; align-items:center; gap:12px; background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:999px; padding:13px 20px; box-shadow:var(--dl-sh1); flex:1; max-width:520px; min-width:280px; }
.dl-bigsearch:focus-within { border-color:var(--dl-green); box-shadow:0 0 0 4px var(--dl-ghost), var(--dl-sh1); }
.dl-bigsearch input { flex:1; border:0; outline:0; background:none; font-family:inherit; font-size:16px; color:var(--dl-ink); min-width:0; }
.dl-bigsearch input::placeholder { color:var(--dl-faint); }
.dl-bigsearch kbd { font-family:inherit; font-size:11px; border:1px solid var(--dl-rule); border-radius:6px; padding:2px 8px; color:var(--dl-faint); background:var(--dl-paper); }
.dl-idxmeta { display:flex; align-items:center; gap:12px 16px; flex-wrap:wrap; }
.dl-chips { display:flex; flex-wrap:wrap; gap:8px; flex:1; }
.dl-chip { display:inline-flex; align-items:center; gap:8px; background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:999px; padding:7px 14px; font-size:12.5px; font-weight:600; color:var(--dl-muted); }
.dl-chip:hover { border-color:var(--dl-cc, var(--dl-green)); color:var(--dl-ink); }
.dl-chip .dot { width:8px; height:8px; border-radius:50%; background:var(--dl-cc, var(--dl-green)); flex:none; }
.dl-chip .n { color:var(--dl-faint); font-weight:500; }
.dl-chip.on { background:var(--dl-ink); border-color:var(--dl-ink); color:var(--dl-paper); }
.dl-chip.on .n { color:color-mix(in srgb, var(--dl-paper) 70%, transparent); }
.dl-count { font-size:13px; color:var(--dl-faint); margin-left:auto; white-space:nowrap; }
.dl-seg { display:flex; background:var(--dl-card2); border-radius:9px; padding:3px; gap:2px; flex:none; }
.dl-seg button { border-radius:7px; padding:7px 14px; font-size:12.5px; font-weight:600; color:var(--dl-muted); }
.dl-seg button.on { background:var(--dl-card); color:var(--dl-ink); box-shadow:var(--dl-sh1); }
.dl-catsec { padding-top:10px; padding-bottom:30px; }
.dl-catsec h2 { font-weight:700; font-size:19px; letter-spacing:-.01em; display:flex; align-items:center; gap:11px; padding-bottom:12px; border-bottom:2px solid color-mix(in srgb, var(--dl-cc) 32%, var(--dl-rule)); }
.dl-catsec h2 .ic { width:30px; height:30px; border-radius:9px; background:color-mix(in srgb, var(--dl-cc) 13%, var(--dl-card)); display:flex; align-items:center; justify-content:center; color:var(--dl-cc); }
.dl-catsec h2 .n { font-size:12.5px; color:var(--dl-faint); font-weight:500; margin-left:auto; }
.dl-tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(216px, 1fr)); gap:10px; padding-top:14px; }
.dl-root .dl-tile { display:flex; gap:12px; align-items:flex-start; background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:13px; padding:13px 14px; color:var(--dl-ink); transition:transform 170ms var(--dl-eo), box-shadow .16s, border-color .16s; }
@media (hover:hover) { .dl-root .dl-tile:hover { transform:translateY(-2px); border-color:color-mix(in srgb, var(--dl-cc) 45%, var(--dl-rule)); box-shadow:var(--dl-sh2); color:var(--dl-ink); } }
.dl-tile .ic { flex:none; width:40px; height:40px; border-radius:12px; background:color-mix(in srgb, var(--dl-cc) 16%, var(--dl-card)); color:var(--dl-cc); display:flex; align-items:center; justify-content:center; }
.dl-tile b { font-size:13.5px; font-weight:600; display:block; line-height:1.3; }
.dl-tile p { font-size:11.5px; color:var(--dl-faint); line-height:1.45; margin-top:2px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:2.9em; }
.dl-compact { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:2px 22px; padding-top:10px; }
.dl-root .dl-crow { display:flex; align-items:center; gap:9px; padding:7px 8px; border-radius:8px; font-size:13.5px; font-weight:500; color:var(--dl-ink); white-space:nowrap; overflow:hidden; }
.dl-root .dl-crow:hover { background:color-mix(in srgb, var(--dl-cc) 9%, var(--dl-card)); color:var(--dl-ink); }
.dl-crow .dot { width:7px; height:7px; border-radius:50%; background:var(--dl-cc); flex:none; }
.dl-crow b { font-weight:500; overflow:hidden; text-overflow:ellipsis; }
.dl-none { padding:40px 0; color:var(--dl-muted); font-size:15px; }

/* tool page */
.dl-crumb { font-size:13px; color:var(--dl-faint); }
.dl-root .dl-crumb a { color:var(--dl-faint); } .dl-root .dl-crumb a:hover { color:var(--dl-ink); }
.dl-toolwrap { display:grid; grid-template-columns:236px minmax(0,1fr); gap:44px; align-items:start; padding-top:36px; }
@media (max-width: 1380px) { .dl-toolwrap { grid-template-columns:1fr; } .dl-rail { display:none; } }
.dl-rail { position:sticky; top:84px; max-height:calc(100vh - 120px); overflow-y:auto; padding-right:10px; padding-bottom:170px; }
.dl-rail h5 { font-size:10.5px; letter-spacing:.11em; text-transform:uppercase; color:var(--dl-faint); font-weight:600; margin:16px 2px 6px; }
.dl-rail h5:first-child { margin-top:4px; }
.dl-root .dl-rail a { display:flex; align-items:center; gap:8px; padding:6.5px 10px; border-radius:8px; font-size:13px; font-weight:500; color:var(--dl-muted); }
.dl-root .dl-rail a:hover { color:var(--dl-ink); background:var(--dl-card); }
.dl-root .dl-rail a.now { color:var(--dl-green); background:var(--dl-wash); font-weight:600; }
.dl-rail .dot { width:6px; height:6px; border-radius:50%; background:var(--dl-cc, var(--dl-faint)); opacity:.8; flex:none; }
.dl-toolhead h1 { font-weight:700; font-size:clamp(36px, 4.2vw, 52px); letter-spacing:-.022em; line-height:1.05; margin:12px 0; }
.dl-toolhead .desc { font-size:16.5px; color:var(--dl-muted); max-width:40em; }
.dl-tchips { display:flex; gap:9px; flex-wrap:wrap; margin-top:18px; }
.dl-tchip { display:inline-flex; align-items:center; gap:7px; border-radius:999px; padding:6px 14px; font-size:12.5px; font-weight:500; background:var(--dl-card); border:1px solid var(--dl-rule); color:var(--dl-muted); }
.dl-tchip.green { background:var(--dl-wash); border-color:transparent; color:var(--dl-green); font-weight:600; }
.dl-tchip.warn { background:var(--dl-amber-wash); border-color:transparent; color:var(--dl-amber); font-weight:600; }
.dl-toolui { margin-top:26px; }
.dl-nf { padding-top:36px; }
.dl-nf h1 { font-weight:700; font-size:clamp(32px, 4vw, 46px); letter-spacing:-.022em; }
.dl-nf p { color:var(--dl-muted); margin-top:10px; max-width:42em; }
.dl-nf code { background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:7px; padding:2px 8px; font-size:.9em; }

/* generic page hero + docs */
.dl-pghero { padding:52px 0 8px; max-width:780px; }
.dl-pghero h1 { font-weight:700; font-size:clamp(36px, 4.6vw, 54px); letter-spacing:-.022em; line-height:1.05; }
.dl-pghero h1 em { font-style:normal; color:var(--dl-green); }
.dl-pghero p { font-size:16.5px; color:var(--dl-muted); margin-top:14px; max-width:40em; }
.dl-heror { display:grid; grid-template-columns:minmax(0,1fr) 360px; gap:56px; align-items:center; }
@media (max-width: 1000px) { .dl-heror { grid-template-columns:1fr; gap:10px; } }
.dl-heror .dl-pghero { max-width:none; }
.dl-herocard { background:var(--dl-card); border:1px solid var(--dl-rule-soft); border-radius:18px; box-shadow:var(--dl-sh1); padding:22px 24px; margin-top:40px; }
.dl-herocard h3 { font-weight:700; font-size:15px; margin-bottom:12px; }
.dl-herocard .big { font-weight:700; font-size:42px; letter-spacing:-.03em; line-height:1; }
.dl-herocard .sub2 { font-size:13px; color:var(--dl-muted); margin-top:6px; line-height:1.55; }
.dl-ministeps > div { display:flex; gap:11px; align-items:baseline; padding:9px 0; border-top:1px solid var(--dl-rule-soft); font-size:13.5px; }
.dl-ministeps > div:first-child { border-top:0; padding-top:0; }
.dl-ministeps i { font-style:normal; font-weight:700; font-size:12px; color:var(--dl-green); flex:none; }
.dl-doc { max-width:72ch; padding-top:8px; }
.dl-doc h2 { font-weight:700; font-size:21px; letter-spacing:-.015em; margin:36px 0 10px; }
.dl-doc p, .dl-doc li { font-size:15px; color:var(--dl-muted); }
.dl-doc ul { padding-left:22px; display:flex; flex-direction:column; gap:6px; }
.dl-note { font-size:11.5px; color:var(--dl-faint); margin-top:10px; }

/* panels & forms (account, vault, pipeline, batch) */
.dl-panel { background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:14px; padding:20px 22px; }
.dl-panel h3 { font-weight:700; font-size:15.5px; letter-spacing:-.01em; margin-bottom:12px; }
.dl-field { display:flex; flex-direction:column; gap:7px; padding:11px 0; }
.dl-field label { font-size:13px; font-weight:600; }
.dl-input { border:1px solid var(--dl-rule); border-radius:9px; padding:11px 13px; font-family:inherit; font-size:14px; background:var(--dl-paper); color:var(--dl-ink); outline:0; width:100%; }
.dl-input:focus { border-color:var(--dl-green); }
.dl-hintl { font-size:12px; color:var(--dl-faint); }
.dl-err { background:color-mix(in srgb, var(--dl-red) 10%, var(--dl-card)); border:1px solid color-mix(in srgb, var(--dl-red) 35%, var(--dl-rule)); color:var(--dl-red); border-radius:10px; padding:10px 14px; font-size:13px; margin:8px 0; }
.dl-authwrap { display:grid; grid-template-columns:440px minmax(0,1fr); gap:56px; align-items:start; padding-top:56px; max-width:1020px; }
@media (max-width: 900px) { .dl-authwrap { grid-template-columns:1fr; } }
.dl-authcard { background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh2); border-radius:18px; padding:32px 32px 24px; display:flex; flex-direction:column; gap:6px; }
.dl-authcard h2 { font-weight:700; font-size:23px; letter-spacing:-.015em; text-align:center; }
.dl-authcard .sub { font-size:13.5px; color:var(--dl-muted); margin:4px 0 10px; text-align:center; }
.dl-modes { display:flex; background:var(--dl-card2); border-radius:9px; padding:3px; gap:2px; margin-bottom:8px; }
.dl-modes button { flex:1; border-radius:7px; padding:8px 0; font-size:12.5px; font-weight:600; color:var(--dl-muted); }
.dl-modes button.on { background:var(--dl-card); color:var(--dl-ink); box-shadow:var(--dl-sh1); }
.dl-reccode { background:var(--dl-wash); border:1px solid color-mix(in srgb, var(--dl-green) 30%, var(--dl-rule)); border-radius:12px; padding:16px 18px; margin-top:12px; }
.dl-reccode code { display:block; font-family:ui-monospace, Menlo, monospace; font-size:15px; letter-spacing:.04em; background:var(--dl-card); border:1px dashed var(--dl-rule-mid); border-radius:8px; padding:10px 12px; margin:10px 0; word-break:break-all; }
.dl-keyrow { display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; gap:12px; align-items:center; background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:11px; padding:12px 16px; font-size:13.5px; }
.dl-keyrow code { font-family:ui-monospace, Menlo, monospace; font-size:12.5px; color:var(--dl-muted); overflow:hidden; text-overflow:ellipsis; }
.dl-keyrow .kd { color:var(--dl-faint); font-size:12px; white-space:nowrap; }
.dl-tag { font-size:10px; font-weight:700; letter-spacing:.06em; color:var(--dl-green); background:var(--dl-wash); border-radius:6px; padding:3px 7px; flex:none; }
.dl-fresh { background:var(--dl-amber-wash); border:1px solid color-mix(in srgb, var(--dl-amber) 35%, var(--dl-rule)); border-radius:12px; padding:14px 16px; margin:10px 0; font-size:13px; }
.dl-fresh code { display:block; font-family:ui-monospace, Menlo, monospace; font-size:13.5px; background:var(--dl-card); border-radius:8px; padding:9px 11px; margin-top:8px; word-break:break-all; }

/* pipeline / batch shared */
.dl-schip { display:inline-flex; align-items:center; gap:7px; background:var(--dl-paper); border:1px solid var(--dl-rule); border-radius:999px; padding:7px 14px; font-size:13px; font-weight:500; }
.dl-schip:hover { border-color:var(--dl-green); color:var(--dl-green); }
.dl-schip .plus { color:var(--dl-green); font-weight:700; }
.dl-cnode { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:8px 14px; align-items:center; background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:13px; padding:13px 16px; position:relative; }
.dl-cnode + .dl-cnode { margin-top:26px; }
.dl-cnode + .dl-cnode::before { content:""; position:absolute; left:28px; top:-27px; height:26px; width:2px; background:var(--dl-rule-mid); }
.dl-cnode .num { width:26px; height:26px; border-radius:8px; background:var(--dl-wash); color:var(--dl-green); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; flex:none; }
.dl-cnode.done .num, .dl-cnode.running .num { background:var(--dl-green); color:var(--dl-on-accent); }
.dl-cnode b { font-size:14.5px; font-weight:600; }
.dl-cnode .ops { display:flex; gap:2px; }
.dl-cnode .ops button { color:var(--dl-faint); border-radius:7px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; }
.dl-cnode .ops button:hover { color:var(--dl-ink); background:var(--dl-rule-soft); }
.dl-pbar { height:6px; border-radius:4px; background:var(--dl-card2); overflow:hidden; position:relative; grid-column:1/-1; display:none; }
.dl-cnode.running .dl-pbar { display:block; }
.dl-pbar i { position:absolute; inset:0; border-radius:4px; background:var(--dl-green); transform:translateX(-100%); }
.dl-root .dl-filerow { display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; gap:8px 12px; align-items:center; background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:11px; padding:11px 16px; font-size:14px; }
.dl-filerow b { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dl-filerow .sz { color:var(--dl-faint); font-size:12.5px; }
.dl-filerow button { color:var(--dl-faint); border-radius:6px; padding:2px 6px; font-size:16px; }
.dl-filerow button:hover { color:var(--dl-ink); background:var(--dl-rule-soft); }
.dl-filerow .bar { grid-column:1/-1; height:4px; border-radius:4px; background:var(--dl-card2); overflow:hidden; position:relative; display:none; }
.dl-filerow.running .bar { display:block; }
.dl-filerow.done .state { color:var(--dl-green); display:flex; }
.dl-filerow .state { display:none; }
.dl-filerow .bar i { position:absolute; inset:0; background:var(--dl-green); transform:translateX(-100%); }
.dl-empty { border:1.5px dashed var(--dl-rule-mid); border-radius:14px; padding:34px; text-align:center; color:var(--dl-faint); font-size:14px; }

/* compare table */
.dl-cmpscroll { overflow-x:auto; border:1px solid var(--dl-rule); border-radius:18px; }
.dl-cmp { border-collapse:collapse; width:100%; min-width:760px; font-size:13.5px; }
.dl-cmp th, .dl-cmp td { padding:13px 18px; text-align:center; border-top:1px solid var(--dl-rule-soft); }
.dl-cmp thead th { border-top:0; background:var(--dl-card2); font-size:12px; letter-spacing:.04em; }
.dl-cmp th:first-child, .dl-cmp td:first-child { text-align:left; font-weight:600; position:sticky; left:0; background:var(--dl-card); }
.dl-cmp thead th:first-child { background:var(--dl-card2); }
.dl-cmp td.us { background:var(--dl-wash); font-weight:600; color:var(--dl-green); }
.dl-cmp td .no { color:var(--dl-faint); }
.dl-cmp td small { display:block; font-weight:400; color:var(--dl-muted); font-size:11px; margin-top:2px; }

/* trust */
.dl-promise { display:grid; grid-template-columns:260px minmax(0,1fr); gap:28px; padding:26px 0; border-top:1px solid var(--dl-rule); }
@media (max-width: 800px) { .dl-promise { grid-template-columns:1fr; gap:10px; } }
.dl-promise h3 { font-weight:700; font-size:19px; letter-spacing:-.012em; }
.dl-promise .how { font-size:12px; letter-spacing:.09em; text-transform:uppercase; color:var(--dl-green); font-weight:600; margin-top:6px; }
.dl-promise p { font-size:14.5px; color:var(--dl-muted); max-width:52em; }
.dl-promise p + p { margin-top:8px; }
.dl-caveat { background:var(--dl-card); border:1px solid var(--dl-rule); border-left:3px solid var(--dl-amber); border-radius:10px; padding:16px 20px; margin-top:10px; }
.dl-caveat b { font-size:13.5px; font-weight:600; }
.dl-caveat p { font-size:13.5px; color:var(--dl-muted); margin-top:3px; max-width:60em; }

/* blog */
.dl-bgrid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:16px; padding-top:30px; }
@media (max-width: 900px) { .dl-bgrid { grid-template-columns:1fr; } }
.dl-root .dl-bpost { background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:14px; padding:26px 28px; color:var(--dl-ink); display:flex; flex-direction:column; gap:10px; transition:transform 170ms var(--dl-eo), box-shadow .18s; }
@media (hover:hover) { .dl-root .dl-bpost:hover { transform:translateY(-2px); box-shadow:var(--dl-sh2); color:var(--dl-ink); } }
.dl-bpost .bm { font-size:11.5px; color:var(--dl-faint); display:flex; gap:10px; }
.dl-bpost .bt { color:var(--dl-green); font-weight:600; }
.dl-bpost h3 { font-weight:700; font-size:19px; letter-spacing:-.015em; line-height:1.25; }
.dl-bpost p { font-size:13.5px; color:var(--dl-muted); line-height:1.6; }
.dl-article { max-width:68ch; padding-top:24px; }
.dl-article h1 { font-weight:700; font-size:clamp(30px, 3.6vw, 44px); letter-spacing:-.022em; line-height:1.1; margin:14px 0 10px; }
.dl-article .am { font-size:12.5px; color:var(--dl-faint); margin-bottom:26px; }
.dl-article p { font-size:16px; color:var(--dl-muted); line-height:1.75; margin-bottom:18px; }

/* status */
.dl-pulse { display:inline-flex; width:12px; height:12px; border-radius:50%; background:var(--dl-green); flex:none; }
.dl-svc { background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:14px; padding:18px 22px; margin-top:12px; }
.dl-svc .r1 { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.dl-svc b { font-size:15px; font-weight:600; }
.dl-svc .sub { font-size:12.5px; color:var(--dl-faint); }
.dl-svc .badge { margin-left:auto; font-size:12px; font-weight:600; color:var(--dl-green); background:var(--dl-wash); border-radius:999px; padding:4px 12px; }
.dl-upt { display:flex; gap:2px; margin-top:14px; }
.dl-upt i { flex:1; height:26px; border-radius:2.5px; background:var(--dl-green); opacity:.75; }
.dl-upt i.warn { background:var(--dl-amber); }
.dl-svc .cap { display:flex; justify-content:space-between; font-size:11.5px; color:var(--dl-faint); margin-top:8px; }
.dl-supcards { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:13px; padding-top:34px; }
@media (max-width: 900px) { .dl-supcards { grid-template-columns:1fr; } }
.dl-supcards > div { background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:16px; padding:24px 26px; display:flex; flex-direction:column; gap:8px; }
.dl-supcards .glyph { width:38px; height:38px; border-radius:11px; background:var(--dl-wash); display:flex; align-items:center; justify-content:center; color:var(--dl-green); }
.dl-supcards b { font-weight:700; font-size:17px; }
.dl-supcards p { font-size:13.5px; color:var(--dl-muted); line-height:1.6; }

/* palette */
.dl-palov { position:fixed; inset:0; z-index:60; background:color-mix(in srgb, var(--dl-band) 40%, transparent); backdrop-filter:blur(3px); display:flex; align-items:flex-start; justify-content:center; padding:12vh 20px 20px; }
.dl-pal { width:100%; max-width:620px; background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:18px; box-shadow:var(--dl-sh2); overflow:hidden; display:flex; flex-direction:column; max-height:70vh; }
.dl-palin { display:flex; align-items:center; gap:12px; padding:16px 20px; border-bottom:1px solid var(--dl-rule); }
.dl-palin input { flex:1; border:0; outline:0; background:none; font-family:inherit; font-size:16px; color:var(--dl-ink); }
.dl-palin kbd { font-size:10.5px; border:1px solid var(--dl-rule); border-radius:5px; padding:2px 6px; color:var(--dl-faint); }
.dl-pallist { overflow-y:auto; padding:8px; }
.dl-palgroup { font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--dl-faint); font-weight:600; padding:10px 14px 4px; }
.dl-palitem { display:flex; align-items:baseline; gap:12px; padding:10px 14px; border-radius:10px; color:var(--dl-ink); font-size:14.5px; cursor:pointer; }
.dl-palitem b { font-weight:600; white-space:nowrap; }
.dl-palitem span { color:var(--dl-faint); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dl-palitem .k { margin-left:auto; font-size:10.5px; letter-spacing:.07em; text-transform:uppercase; color:var(--dl-green); font-weight:600; flex:none; }
.dl-palitem.sel { background:var(--dl-wash); }
.dl-palempty { padding:22px 18px; font-size:14px; color:var(--dl-muted); }
.dl-palfoot { border-top:1px solid var(--dl-rule); padding:9px 18px; font-size:11.5px; color:var(--dl-faint); display:flex; gap:16px; }
@media (max-width: 700px) { .dl-palov { padding:0; } .dl-pal { max-width:none; height:100%; max-height:none; border-radius:0; border:0; } }

/* chrome extras */
.dl-sysdock { position:fixed; left:22px; bottom:22px; z-index:25; background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:14px; box-shadow:var(--dl-sh1); padding:12px 16px; display:flex; flex-direction:column; gap:7px; font-size:12px; }
.dl-sysdock .r { display:flex; align-items:center; gap:8px; }
.dl-sysdock .d { width:7px; height:7px; border-radius:50%; background:var(--dl-green); flex:none; }
.dl-sysdock .d.warn { background:var(--dl-amber); }
.dl-sysdock b { font-weight:600; }
.dl-sysdock span { color:var(--dl-faint); }
@media (max-width: 980px) { .dl-sysdock { display:none; } }
.dl-toast { position:fixed; left:50%; bottom:30px; transform:translateX(-50%); background:var(--dl-band); color:var(--dl-band-ink); border-radius:12px; padding:12px 22px; font-size:14px; box-shadow:var(--dl-sh2); z-index:70; animation:dlRise .25s var(--dl-eo); }
.dl-tabbar { display:none; }
@media (max-width: 720px) {
  .dl-root { padding-bottom:76px; }
  .dl-tabbar { display:flex; position:fixed; left:0; right:0; bottom:0; z-index:40; background:var(--dl-card); box-shadow:0 -1px 0 var(--dl-rule), 0 -8px 24px -12px rgba(16,20,22,.12); padding:8px 6px calc(8px + env(safe-area-inset-bottom)); }
  .dl-root .dl-tabbar a, .dl-root .dl-tabbar button { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; font-size:10px; font-weight:600; color:var(--dl-faint); padding:4px 0; }
  .dl-root .dl-tabbar .on { color:var(--dl-green); }
  .dl-tabbar .fab { flex:none; width:52px; height:52px; margin-top:-22px; border-radius:999px; background:var(--dl-green); color:var(--dl-on-accent); box-shadow:var(--dl-sh2); align-items:center; justify-content:center; }
  .dl-hero h1 { font-size:40px; }
}
`;

/* ═══════════════════════ compare-table data (sourced) ═══════════════════════ */

const CMP_ROWS = [
    ["Price for everything", ["Free, all of it", true], ["Freemium", "Premium tier"], ["Freemium", "Pro tier"], ["Freemium", "daily caps"], ["Free", ""]],
    ["Daily task limits", ["None", true], ["On some tools", ""], ["Limited free tasks", ""], ["3 tasks / day", ""], ["None", ""]],
    ["Settings behind paywall", ["Never", true], ["Some", ""], ["Moderate & Strong compression are Pro", ""], ["Some", ""], ["None", ""]],
    ["Where files go", ["Local-first; disclosed server · Mumbai", true], ["Uploaded to their servers", ""], ["Uploaded to their servers", ""], ["Uploaded to their servers", ""], ["Stays in browser", ""]],
    ["Retention after processing", ["Zero · this tab only", true], ["Time-limited", ""], ["Time-limited", ""], ["“Deleted after 2 hours”", ""], ["n/a", ""]],
    ["Account walls", ["Never for tools", true], ["For some features", ""], ["For some features", ""], ["For some features", ""], ["None", ""]],
    ["Trackers & ads", ["Zero", true], ["Analytics", ""], ["Analytics", ""], ["Analytics", ""], ["Analytics", ""]],
];

/* ═══════════════════════════ the component ═══════════════════════════ */

export default class DaylightSkinApp extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            ...parseHash(typeof location !== "undefined" ? location.hash : "#/"),
            themeMode: this.readTheme(),
            q: "", catFilter: "", idxView: "tiles",
            palOpen: false, palQ: "", palSel: 0,
            dragging: false, dropped: null,
            toast: "",
            chain: [], pipeFile: null, pipeRunning: false, pipeDoneAt: 0,
            bfiles: [], bTool: "compress-pdf", bRunning: false, bDone: 0,
            history: this.readHistory(),
        };
        this._raf = [];
        this._timers = [];
    }

    /** Extended by the mixins; the base contributes only the absorber they inject nav into. */
    renderVals() { return { dlNav: [] }; }

    /* ── lifecycle ── */
    componentDidMount() {
        if (super.componentDidMount) super.componentDidMount();
        this._onHash = () => {
            const r = parseHash(location.hash);
            this.setState(r, () => {
                window.scrollTo(0, 0);
                if (r.view === "tool" && BY_SLUG.has(r.slug)) this.logHistory(r.slug);
            });
        };
        window.addEventListener("hashchange", this._onHash);

        this._onKey = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                this.setState((s) => ({ palOpen: !s.palOpen, palQ: "", palSel: 0 }));
            } else if (e.key === "Escape" && this.state.palOpen) {
                this.setState({ palOpen: false });
            } else if (e.key === "/" && this.state.view === "tools" && !this.state.palOpen
                && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) {
                e.preventDefault();
                const el = document.getElementById("dl-filter");
                if (el) el.focus();
            }
        };
        window.addEventListener("keydown", this._onKey);

        this._depth = 0;
        this._onDragEnter = (e) => { e.preventDefault(); this._depth++; if (!this.state.dragging) this.setState({ dragging: true }); };
        this._onDragOver = (e) => e.preventDefault();
        this._onDragLeave = (e) => { e.preventDefault(); this._depth = Math.max(0, this._depth - 1); if (!this._depth) this.setState({ dragging: false }); };
        this._onDrop = (e) => {
            e.preventDefault(); this._depth = 0;
            const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
            this.setState({ dragging: false });
            if (!files.length) return;
            if (this.state.view === "batch") { this.batchAdd(files); return; }
            const match = DROP_ROUTES.find(([re]) => re.test(files[0].name));
            go("");
            this.setState({ dropped: { files: files.map((f) => ({ name: f.name, size: f.size })), kind: match[1], slugs: match[2] } });
        };
        window.addEventListener("dragenter", this._onDragEnter);
        window.addEventListener("dragover", this._onDragOver);
        window.addEventListener("dragleave", this._onDragLeave);
        window.addEventListener("drop", this._onDrop);

        // Paint the stored choice now; index.html already pre-painted it, but a
        // hot-switch from the dock into this skin arrives without a reload.
        document.documentElement.setAttribute("data-theme", resolveTheme(this.state.themeMode));

        // First mount can already be deep-linked to a tool.
        if (this.state.view === "tool" && BY_SLUG.has(this.state.slug)) this.logHistory(this.state.slug);
    }

    componentWillUnmount() {
        if (super.componentWillUnmount) super.componentWillUnmount();
        window.removeEventListener("hashchange", this._onHash);
        window.removeEventListener("keydown", this._onKey);
        window.removeEventListener("dragenter", this._onDragEnter);
        window.removeEventListener("dragover", this._onDragOver);
        window.removeEventListener("dragleave", this._onDragLeave);
        window.removeEventListener("drop", this._onDrop);
        this._raf.forEach(cancelAnimationFrame);
        this._timers.forEach(clearTimeout);
    }

    /* ── tiny infra ── */
    say(msg) {
        this.setState({ toast: msg });
        clearTimeout(this._toastT);
        this._toastT = setTimeout(() => this.setState({ toast: "" }), 2600);
    }
    readTheme() { return readThemeChoice("daylight"); }
    cycleTheme = () => {
        const next = this.state.themeMode === "system" ? "light" : this.state.themeMode === "light" ? "dark" : "system";
        setThemeChoice("daylight", next);
        this.setState({ themeMode: next });
    };
    readHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
    logHistory(slug) {
        try {
            const h = [{ s: slug, ts: Date.now() }, ...this.readHistory().filter((e) => e.s !== slug)].slice(0, 30);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
            this.setState({ history: h });
        } catch { /* history is a convenience, never a requirement */ }
    }
    clearHistory = () => {
        try { localStorage.removeItem(HISTORY_KEY); } catch { }
        this.setState({ history: [] });
        this.say("History cleared — it only ever lived on this device.");
    };
    animateBar(el, ms, done) {
        if (!el) { if (done) done(); return; }
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce) { el.style.transform = "translateX(0)"; if (done) done(); return; }
        const t0 = performance.now();
        const tick = (t) => {
            const p = Math.min(1, (t - t0) / ms);
            el.style.transform = `translateX(${-100 + p * 100}%)`;
            if (p < 1) this._raf.push(requestAnimationFrame(tick));
            else if (done) done();
        };
        this._raf.push(requestAnimationFrame(tick));
    }

    /* ═══════════════════════ chrome ═══════════════════════ */

    Nav() {
        const { view } = this.state;
        const a = this.state.acct || {};
        const L = ([hash, label, key]) => (
            <a key={key} href={hash} className={view === key ? "on" : ""}>{label}</a>
        );
        return (
            <header className="dl-header">
                <div className="dl-nav">
                    <a className="dl-brand" href="#/"><Logo /> PrivaTools</a>
                    <nav className="dl-links">
                        {[["#/tools", "All tools", "tools"], ["#/pipeline", "Pipeline", "pipeline"],
                        ["#/batch", "Batch", "batch"], ["#/my-stuff/vault", "Vault", "vault"],
                        ["#/my-stuff", "My Stuff", "mystuff"], ["#/security", "Trust", "security"]].map(L)}
                    </nav>
                    <button className="dl-searchpill" onClick={() => this.setState({ palOpen: true, palQ: "", palSel: 0 })} aria-label={`Search ${TOTAL} tools`}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.4" stroke="currentColor" strokeWidth="1.5" /><path d="M9.4 9.4 L12.6 12.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                        Search {TOTAL} tools…
                        <kbd>⌘K</kbd>
                    </button>
                    <button className="dl-iconbtn" onClick={() => this.setState({ palOpen: true, palQ: "", palSel: 0 })} aria-label="Search tools">
                        <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.4" stroke="currentColor" strokeWidth="1.5" /><path d="M9.4 9.4 L12.6 12.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </button>
                    <a className="dl-btn dl-btn-ghost dl-navcta" href="#/account">{a.user ? "Account" : "Sign in"}</a>
                    <button className="dl-themebtn" onClick={this.cycleTheme} title={`Theme: ${this.state.themeMode}`} aria-label={`Theme: ${this.state.themeMode}`}>
                        {this.state.themeMode === "light"
                            ? <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="3.6" stroke="currentColor" strokeWidth="1.6" /><path d="M9 1.5 V3.5 M9 14.5 V16.5 M1.5 9 H3.5 M14.5 9 H16.5 M3.7 3.7 L5.1 5.1 M12.9 12.9 L14.3 14.3 M14.3 3.7 L12.9 5.1 M5.1 12.9 L3.7 14.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                            : this.state.themeMode === "dark"
                                ? <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M15 10.8 A6.5 6.5 0 1 1 7.2 3 A5.2 5.2 0 0 0 15 10.8 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
                                : <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.4" stroke="currentColor" strokeWidth="1.6" /><path d="M9 2.6 A6.4 6.4 0 0 1 9 15.4 Z" fill="currentColor" /></svg>}
                    </button>
                </div>
            </header>
        );
    }

    ToolCard(t, i) {
        return (
            <a key={t.slug} className="dl-card" href={`#/tool/${t.slug}`}
                style={{ "--dl-cc": FAMILY_HUE[t.category] || "var(--dl-green)", animation: `dlRise .4s ${0.04 * Math.min(i, 8)}s var(--dl-eo) both` }}>
                <span className="tr">
                    <span className="glyph"><Glyph d={glyphPath(t)} /></span>
                    <b>{t.name}</b>
                </span>
                <p>{t.description}</p>
                <span className="arr"><svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 7.5 H12 M12 7.5 L8.5 4 M12 7.5 L8.5 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            </a>
        );
    }

    Footer() {
        return (
            <footer className="dl-foot">
                <div className="cols">
                    <div className="brand">
                        <a className="dl-brand" href="#/"><Logo size={21} /> PrivaTools</a>
                        <p>{TOTAL} file tools that treat your documents like they’re yours. Free, no account, no watermark — owner-funded, with nothing to sell you.</p>
                    </div>
                    <div><h4>Popular</h4><ul>
                        {POPULAR.slice(0, 5).map((t) => <li key={t.slug}><a href={`#/tool/${t.slug}`}>{t.name}</a></li>)}
                    </ul></div>
                    <div><h4>Browse</h4><ul>
                        <li><a href="#/tools">All {TOTAL} tools</a></li>
                        <li><a href="#/pipeline">Pipeline</a></li>
                        <li><a href="#/batch">Batch</a></li>
                        <li><a href="#/compare">Compare</a></li>
                        <li><a href="#/blog">Blog</a></li>
                    </ul></div>
                    <div><h4>Product</h4><ul>
                        <li><a href="#/security">Trust &amp; security</a></li>
                        <li><a href="#/my-stuff">My Stuff</a></li>
                        <li><a href="#/my-stuff/vault">Vault</a></li>
                        <li><a href="#/status">Status</a></li>
                        <li><a href="#/support">Support</a></li>
                        <li><a href="#/about">About</a></li>
                        <li><a href="#/privacy">Privacy</a></li>
                        <li><a href="#/terms">Terms</a></li>
                    </ul></div>
                </div>
                <div className="base"><div>
                    <span>Owner-funded · no ads, no analytics, no paid tier</span>
                    <span>Server jobs: disclosed · Mumbai, IN · deleted after use</span>
                </div></div>
            </footer>
        );
    }

    TabBar() {
        const { view } = this.state;
        const Item = ([hash, label, key, d]) => (
            <a key={key} href={hash} className={view === key ? "on" : ""}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>
                {label}
            </a>
        );
        return (
            <nav className="dl-tabbar" aria-label="Primary">
                {Item(["#/", "Home", "home", "M3.5 9 L10 3.5 L16.5 9 V16.5 H12 V12 H8 V16.5 H3.5 Z"])}
                {Item(["#/tools", "Tools", "tools", "M3.75 3.75 H8.25 V8.25 H3.75 Z M11.75 3.75 H16.25 V8.25 H11.75 Z M3.75 11.75 H8.25 V16.25 H3.75 Z M11.75 11.75 H16.25 V16.25 H11.75 Z"])}
                <button className="fab" onClick={() => this.setState({ palOpen: true, palQ: "", palSel: 0 })} aria-label="Search tools">
                    <svg width="21" height="21" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.4" stroke="currentColor" strokeWidth="1.6" /><path d="M9.4 9.4 L12.6 12.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </button>
                {Item(["#/my-stuff/vault", "Vault", "vault", "M5.75 9.25 H14.25 V15.25 H5.75 Z M7 9 V7 A3 3 0 0 1 13 7 V9"])}
                {Item(["#/my-stuff", "My Stuff", "mystuff", "M10 3 A7 7 0 1 0 10 17 A7 7 0 1 0 10 3 M10 6.5 V10 L12.5 12"])}
            </nav>
        );
    }

    SysDock() {
        return (
            <div className="dl-sysdock" aria-label="Processing paths">
                <div className="r"><span className="d" /><b>Local</b><span>Ready</span></div>
                <div className="r"><span className="d warn" /><b>Server</b><span>Best effort · Mumbai, IN</span></div>
                <div className="r"><span className="d" /><b>Offline</b><span>Cached tools ready</span></div>
            </div>
        );
    }

    /* ═══════════════════════ ⌘K palette ═══════════════════════ */

    palResults() {
        const q = this.state.palQ.trim().toLowerCase();
        const scored = [];
        for (const t of ALL_TOOLS) {
            const name = t.name.toLowerCase();
            let score = -1;
            if (!q) score = 1000 - (t.popularity ?? 999);
            else if (name.startsWith(q)) score = 300;
            else if (name.includes(q)) score = 200;
            else if ((t.synonyms || "").toLowerCase().includes(q)) score = 120;
            else if (t.description.toLowerCase().includes(q)) score = 80;
            if (score >= 0) scored.push([score - (t.popularity ?? 999) * 0.01, t]);
        }
        scored.sort((a, b) => b[0] - a[0]);
        const toolEntries = scored.slice(0, 8).map(([, t]) => ({ kind: "tool", t }));
        const pageEntries = q
            ? PAGES_FOR_PALETTE
                .filter(([, l, d]) => l.toLowerCase().includes(q) || d.toLowerCase().includes(q))
                .slice(0, 3).map(([hash, label, desc]) => ({ kind: "page", hash, label, desc }))
            : [];
        const recents = !q
            ? this.state.history.slice(0, 3).map((e) => BY_SLUG.get(e.s)).filter(Boolean)
                .map((t) => ({ kind: "tool", t, recent: true }))
            : [];
        const items = recents.length
            ? [...recents, ...toolEntries.filter((e) => !recents.some((r) => r.t === e.t))]
            : [...pageEntries, ...toolEntries];
        return items.slice(0, 10);
    }

    Palette() {
        if (!this.state.palOpen) return null;
        const items = this.palResults();
        const sel = Math.min(this.state.palSel, Math.max(0, items.length - 1));
        const goEntry = (entry) => {
            this.setState({ palOpen: false });
            if (entry.kind === "page") go(entry.hash);
            else go(`#/tool/${entry.t.slug}`);
        };
        let lastGroup = "";
        return (
            <div className="dl-palov" role="dialog" aria-modal="true" aria-label="Search tools"
                onClick={(e) => { if (e.target === e.currentTarget) this.setState({ palOpen: false }); }}>
                <div className="dl-pal">
                    <div className="dl-palin">
                        <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.4" stroke="var(--dl-faint)" strokeWidth="1.5" /><path d="M9.4 9.4 L12.6 12.6" stroke="var(--dl-faint)" strokeWidth="1.5" strokeLinecap="round" /></svg>
                        <input autoFocus value={this.state.palQ} placeholder={`Search ${TOTAL} tools…`}
                            onChange={(e) => this.setState({ palQ: e.target.value, palSel: 0 })}
                            onKeyDown={(e) => {
                                if (e.key === "ArrowDown") { e.preventDefault(); this.setState({ palSel: Math.min(sel + 1, items.length - 1) }); }
                                else if (e.key === "ArrowUp") { e.preventDefault(); this.setState({ palSel: Math.max(sel - 1, 0) }); }
                                else if (e.key === "Enter" && items[sel]) goEntry(items[sel]);
                            }} />
                        <kbd>esc</kbd>
                    </div>
                    <div className="dl-pallist">
                        {items.length === 0 && <div className="dl-palempty">No tool or page matches “{this.state.palQ}”.</div>}
                        {items.map((entry, i) => {
                            const group = entry.kind === "page" ? "Pages" : entry.recent ? "Recent" : (items.some((x) => x.recent) ? "Popular" : "Tools");
                            const header = group !== lastGroup ? <div className="dl-palgroup" key={`g${i}`}>{group}</div> : null;
                            lastGroup = group;
                            return (
                                <React.Fragment key={entry.kind === "page" ? entry.hash : entry.t.slug}>
                                    {header}
                                    <div className={`dl-palitem${i === sel ? " sel" : ""}`}
                                        onClick={() => goEntry(entry)}
                                        onMouseMove={() => { if (this.state.palSel !== i) this.setState({ palSel: i }); }}>
                                        <b>{entry.kind === "page" ? entry.label : entry.t.name}</b>
                                        <span>{entry.kind === "page" ? entry.desc : entry.t.description}</span>
                                        <span className="k">{entry.kind === "page" ? "Page" : (FAMILY_LABEL[entry.t.category] || entry.t.category)}</span>
                                    </div>
                                </React.Fragment>
                            );
                        })}
                    </div>
                    <div className="dl-palfoot"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span></div>
                </div>
            </div>
        );
    }

    /* ═══════════════════════ views ═══════════════════════ */

    Home() {
        const d = this.state.dropped;
        return (
            <div className="dl-wrap">
                <div className="dl-hero">
                    <div>
                        <div className="dl-eyebrow">{TOTAL} free file tools · no sign-up</div>
                        <h1>Drop any file.<br />Keep it <em>private.</em></h1>
                        <p className="sub">We’ll show you every tool that can handle it — and nothing uploads until you choose one. No account, no watermark, no tricks.</p>
                        <div style={{ display: "flex", gap: 13, flexWrap: "wrap" }}>
                            <a className="dl-btn dl-btn-primary" href="#/tool/merge-pdf">Try Merge PDF</a>
                            <a className="dl-btn dl-btn-ghost" href="#/tools">Browse all {TOTAL}</a>
                        </div>
                        <p className="dl-hint">Or just drop a file anywhere on this page — PDFs, images, video, audio, code, archives · up to 500&nbsp;MB each</p>
                    </div>
                    <aside className="dl-receipt" aria-label="What this costs you">
                        <div className="rh">What it costs<span>Itemised</span></div>
                        {[["Price", "Free, forever"], ["Account", "None"], ["Watermarks", "None"],
                        ["Ads & trackers", "None"], ["Daily limits", "None"], ["Your files", "Never stored"]]
                            .map(([k, v]) => <div className="rr" key={k}><span>{k}</span><b>{v}</b></div>)}
                        <div className="rf">Owner-funded. That’s the whole model.</div>
                    </aside>
                </div>

                <div className="dl-dz" role="button" tabIndex={0} aria-label="Drop any file to see the tools that can handle it"
                    onClick={() => this._homeFile && this._homeFile.click()}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._homeFile && this._homeFile.click(); } }}>
                    <span className="dl-puck">
                        <svg width="24" height="24" viewBox="0 0 22 22" fill="none"><path d="M11 15 V4 M11 4 L7 8 M11 4 L15 8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 18 H18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
                    </span>
                    <span className="mid">
                        <b>Drop it here — or anywhere</b>
                        <p>We’ll match it to the right tools. Nothing has uploaded when we do.</p>
                    </span>
                    <span className="kbdhint">press <kbd>⌘K</kbd> to search</span>
                    <input type="file" multiple hidden ref={(el) => { this._homeFile = el; }} aria-label="Choose files"
                        onChange={(e) => {
                            const files = [...e.target.files];
                            e.target.value = "";
                            if (!files.length) return;
                            const match = DROP_ROUTES.find(([re]) => re.test(files[0].name));
                            this.setState({ dropped: { files: files.map((f) => ({ name: f.name, size: f.size })), kind: match[1], slugs: match[2] } });
                        }} />
                </div>

                {d && (
                    <div className="dl-suggest">
                        <div className="dl-picked">
                            {d.files.map((f) => <span key={f.name}>{f.name} <b>{fmtSize(f.size)}</b></span>)}
                        </div>
                        <div className="dl-sughead">Looks like a <b>{d.kind}</b> — nothing has uploaded. Pick a tool:</div>
                        <div className="dl-sugrow">
                            {d.slugs.map((s, i) => BY_SLUG.has(s) && this.ToolCard(BY_SLUG.get(s), i))}
                        </div>
                    </div>
                )}

                <div className="dl-stats">
                    <div className="dl-stat"><b>{TOTAL}</b><span className="cap">tools, every one free</span></div>
                    <div className="dl-stat"><b>{PDF_COUNT}</b><span className="cap">for PDF alone</span></div>
                    <div className="dl-stat"><b>0</b><span className="cap">accounts, trackers or ads</span></div>
                    <div className="dl-stat"><b>500<small>&nbsp;MB</small></b><span className="cap">per file, every tool</span></div>
                </div>

                <section className="dl-sec">
                    <div className="dl-sec-head">
                        <div><h2 className="dl-sec-title">Start here</h2><p className="dl-sec-sub">The eight tools people open most</p></div>
                        <a href="#/tools" style={{ fontSize: 14, fontWeight: 600 }}>All {TOTAL} →</a>
                    </div>
                    <div className="dl-grid">{POPULAR.slice(0, 8).map((t, i) => this.ToolCard(t, i))}</div>
                </section>

                <section className="dl-sec">
                    <div className="dl-sec-head">
                        <div><h2 className="dl-sec-title">Every kind of file</h2><p className="dl-sec-sub">Twelve families, {TOTAL} tools — jump straight to yours</p></div>
                    </div>
                    <div className="dl-ccards">
                        {FAMILIES.map(([key, label, hue]) => {
                            const n = ALL_TOOLS.filter((t) => t.category === key).length;
                            if (!n) return null;
                            return (
                                <a key={key} className="dl-ccard" href={`#/tools?cat=${key}`} style={{ "--dl-cc": hue }}>
                                    <span className="glyph"><Glyph d={FAMILY_GLYPHS[key]} /></span>
                                    <span><b>{label}</b><span>{n} tools</span></span>
                                </a>
                            );
                        })}
                    </div>
                </section>

                <section className="dl-sec">
                    <div className="dl-vband">
                        <div>
                            <div className="dl-eyebrow">The vault</div>
                            <h2 className="dl-sec-title" style={{ fontSize: 31, marginTop: 10 }}>Your secrets, sealed on this device.</h2>
                            <p style={{ color: "var(--dl-muted)", fontSize: 15.5, maxWidth: "34em", marginTop: 12 }}>
                                A real password vault — AES-GCM under a key that never leaves this machine, for the
                                passwords your protected files need. Nothing in it ever reaches a server.
                            </p>
                            <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
                                <a className="dl-btn dl-btn-primary" href="#/my-stuff/vault">Open your vault</a>
                                <a className="dl-btn dl-btn-ghost" href="#/security">How it’s protected</a>
                            </div>
                        </div>
                        <div className="dl-vmock" aria-hidden="true">
                            <div className="vh">
                                <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><rect x="4" y="8" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M6 8 V6 A3 3 0 0 1 12 6 V8" stroke="currentColor" strokeWidth="1.5" /></svg>
                                <b>Vault</b><span>this device only</span>
                            </div>
                            <div className="vr"><span className="dl-tag">AES</span><b>tax-return-2026.pdf</b><span>password</span></div>
                            <div className="vr"><span className="dl-tag">AES</span><b>contract-final.pdf</b><span>password</span></div>
                            <div className="vr"><span className="dl-tag">AES</span><b>scan-archive.zip</b><span>password</span></div>
                        </div>
                    </div>
                </section>

                <section className="dl-sec">
                    <div className="dl-sec-head">
                        <div><h2 className="dl-sec-title">The usual catches, removed</h2><p className="dl-sec-sub">What free-tool sites normally do — and what happens here instead</p></div>
                    </div>
                    <div className="dl-why">
                        <div><span className="usual">Free tier adds a watermark</span><b className="h">Clean output, always</b><p>No stamp in your corner, no upsell page between you and your file. The download is just your file.</p></div>
                        <div><span className="usual">2 tasks per day, then pay</span><b className="h">No meters running</b><p>No daily limits, no file counters, no “premium” queue. The two-hundredth file is treated like the first.</p></div>
                        <div><span className="usual">Sign up to download</span><b className="h">No account wall</b><p>There is nothing to sign up for. Arrive, do the work, leave — the site doesn’t know who you are.</p></div>
                    </div>
                </section>

                <section className="dl-sec">
                    <div className="dl-claims">
                        {[["Your device first", "Wherever a tool can run in your browser, it does — the file never leaves your machine."],
                        ["Honest about servers", "Heavier jobs use our disclosed server — Mumbai, IN — and are deleted after use."],
                        ["No third-party code", "No CDN injects scripts into your tools. Everything is served from privatools.me."],
                        ["Works offline", "Install once as an app; cached tools keep working without a connection."]]
                            .map(([t, p]) => <div className="dl-claim" key={t}><b><Check />{t}</b><p>{p}</p></div>)}
                    </div>
                </section>

                <section className="dl-sec">
                    <div className="dl-band">
                        <div>
                            <h2>Privacy you can <em>watch,</em> not just trust.</h2>
                            <p className="lead">Every claim here is a behavior you can check from your own browser — no faith required.</p>
                            <a className="dl-btn dl-btn-primary" style={{ marginTop: 22, display: "inline-flex" }} href="#/security">Read the promises</a>
                        </div>
                        <div>
                            {[["Local tools make zero upload requests", "Open your network tab and run one — nothing leaves."],
                            ["Server tools say so before you start", "One disclosed request, isolated processing, deleted after use."],
                            ["No CDN in the tool path", "Your documents are never handled by third-party scripts."],
                            ["History without your files", "It holds tool and time only — never files or filenames."]]
                                .map(([t, p]) => (
                                    <div className="dl-step" key={t}>
                                        <span className="dot"><Check size={14} /></span>
                                        <div><b>{t}</b><p>{p}</p></div>
                                    </div>
                                ))}
                        </div>
                    </div>
                </section>
            </div>
        );
    }

    Tools() {
        const { q, catFilter, idxView } = this.state;
        const ql = q.trim().toLowerCase();
        const match = (t) =>
            (!catFilter || t.category === catFilter) &&
            (!ql || `${t.name} ${t.description} ${t.synonyms || ""} ${FAMILY_LABEL[t.category] || ""}`.toLowerCase().includes(ql));
        let shown = 0;
        const sections = FAMILIES.map(([key, label, hue]) => {
            const all = ALL_TOOLS.filter((t) => t.category === key)
                .sort((a, b) => (a.popularity ?? 999) - (b.popularity ?? 999));
            const vis = all.filter(match);
            shown += vis.length;
            if (!all.length || !vis.length) return null;
            return (
                <div className="dl-catsec" key={key} style={{ "--dl-cc": hue }}>
                    <h2>
                        <span className="ic"><Glyph d={FAMILY_GLYPHS[key]} /></span>
                        {label}
                        <span className="n">{ql || catFilter ? `${vis.length} of ${all.length}` : all.length} tools</span>
                    </h2>
                    {idxView === "tiles" ? (
                        <div className="dl-tiles">
                            {vis.map((t) => (
                                <a key={t.slug} className="dl-tile" href={`#/tool/${t.slug}`} title={t.description} style={{ "--dl-cc": hue }}>
                                    <span className="ic"><Glyph d={glyphPath(t)} /></span>
                                    <span style={{ minWidth: 0 }}><b>{t.name}</b><p>{t.description}</p></span>
                                </a>
                            ))}
                        </div>
                    ) : (
                        <div className="dl-compact">
                            {vis.map((t) => (
                                <a key={t.slug} className="dl-crow" href={`#/tool/${t.slug}`} title={t.description} style={{ "--dl-cc": hue }}>
                                    <span className="dot" /><b>{t.name}</b>
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            );
        });
        return (
            <div className="dl-wrap">
                <div className="dl-idxhero">
                    <div className="dl-idxrow">
                        <div>
                            <div className="dl-eyebrow">The catalogue</div>
                            <h1>All {TOTAL} tools</h1>
                        </div>
                        <div className="dl-bigsearch">
                            <svg width="17" height="17" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.4" stroke="var(--dl-faint)" strokeWidth="1.5" /><path d="M9.4 9.4 L12.6 12.6" stroke="var(--dl-faint)" strokeWidth="1.5" strokeLinecap="round" /></svg>
                            <input id="dl-filter" type="search" placeholder="Search by name or task…" aria-label="Search tools"
                                value={q} onChange={(e) => this.setState({ q: e.target.value })} />
                            <kbd>/</kbd>
                        </div>
                    </div>
                    <div className="dl-idxmeta">
                        <div className="dl-chips">
                            <button className={`dl-chip${!catFilter ? " on" : ""}`} style={{ "--dl-cc": "var(--dl-green)" }}
                                onClick={() => this.setState({ catFilter: "" })}>
                                All <span className="n">{TOTAL}</span>
                            </button>
                            {FAMILIES.map(([key, label, hue]) => {
                                const n = ALL_TOOLS.filter((t) => t.category === key).length;
                                if (!n) return null;
                                return (
                                    <button key={key} className={`dl-chip${catFilter === key ? " on" : ""}`} style={{ "--dl-cc": hue }}
                                        onClick={() => this.setState({ catFilter: catFilter === key ? "" : key })}>
                                        <span className="dot" />{label} <span className="n">{n}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <span className="dl-count">Showing {shown} of {TOTAL} tools</span>
                        <div className="dl-seg">
                            <button className={idxView === "tiles" ? "on" : ""} onClick={() => this.setState({ idxView: "tiles" })}>Tiles</button>
                            <button className={idxView === "compact" ? "on" : ""} onClick={() => this.setState({ idxView: "compact" })}>Compact</button>
                        </div>
                    </div>
                </div>
                <div style={{ paddingTop: 18 }}>
                    {shown === 0
                        ? <div className="dl-none">Nothing matches — try a different word, or press <b>⌘K</b> to search with synonyms.</div>
                        : sections}
                </div>
            </div>
        );
    }

    ToolRail(current) {
        return (
            <nav className="dl-rail" aria-label="Jump to another tool">
                {FAMILIES.map(([key, label, hue]) => {
                    const top = ALL_TOOLS.filter((t) => t.category === key)
                        .sort((a, b) => (a.popularity ?? 999) - (b.popularity ?? 999)).slice(0, 4);
                    if (!top.length) return null;
                    return (
                        <React.Fragment key={key}>
                            <h5>{label}</h5>
                            {top.map((t) => (
                                <a key={t.slug} href={`#/tool/${t.slug}`} className={t.slug === current ? "now" : ""} style={{ "--dl-cc": hue }}>
                                    <span className="dot" />{t.name}
                                </a>
                            ))}
                        </React.Fragment>
                    );
                })}
            </nav>
        );
    }

    Tool(v) {
        const slug = this.state.slug;
        const tool = BY_SLUG.get(slug);
        if (!tool) {
            const q = slug.replace(/-/g, " ");
            const close = ALL_TOOLS
                .map((t) => {
                    let s = 0;
                    for (const w of q.split(" ")) if (w && (t.name.toLowerCase().includes(w) || (t.synonyms || "").includes(w))) s += w.length;
                    return [s - (t.popularity ?? 999) * 0.001, t];
                })
                .sort((a, b) => b[0] - a[0]).slice(0, 4).map(([, t]) => t);
            return (
                <div className="dl-wrap">
                    <div className="dl-nf">
                        <div className="dl-crumb"><a href="#/tools">All tools</a></div>
                        <h1 style={{ marginTop: 14 }}>No tool at that address</h1>
                        <p>That slug doesn’t match anything in the catalogue — you tried <code>/tool/{slug}</code>. Your files are untouched; nothing was opened or uploaded. The closest matches:</p>
                        <div className="dl-grid" style={{ marginTop: 22 }}>{close.map((t, i) => this.ToolCard(t, i))}</div>
                    </div>
                </div>
            );
        }
        const related = ALL_TOOLS
            .filter((t) => t.category === tool.category && t.slug !== tool.slug)
            .sort((a, b) => (a.popularity ?? 999) - (b.popularity ?? 999)).slice(0, 4);
        return (
            <div className="dl-wrap">
                <div className="dl-toolwrap">
                    {this.ToolRail(slug)}
                    <div>
                        <div className="dl-crumb" style={{ marginBottom: 10 }}>
                            <a href="#/tools">All tools</a> &nbsp;/&nbsp; {FAMILY_LABEL[tool.category] || tool.category} &nbsp;/&nbsp; <span style={{ color: "var(--dl-ink)" }}>{tool.name}</span>
                        </div>
                        <div className="dl-toolhead">
                            <h1>{tool.name}</h1>
                            <p className="desc">{tool.description}</p>
                            <div className="dl-tchips">
                                <span className="dl-tchip green">{FAMILY_LABEL[tool.category] || tool.category}</span>
                                {tool.clientOnly
                                    ? <span className="dl-tchip green">Runs on your device · nothing uploads</span>
                                    : <span className="dl-tchip warn">Uses our server · deleted after</span>}
                                <span className="dl-tchip">500 MB per file</span>
                                <span className="dl-tchip">No retention</span>
                                <span className="dl-tchip">Free, no account</span>
                            </div>
                        </div>
                        {/* The real run surface: the same tool component the house design mounts. */}
                        <div className="dl-toolui">{v.realToolUI}</div>
                        <section className="dl-sec" style={{ paddingTop: 72, paddingBottom: 8 }}>
                            <h2 className="dl-sec-title" style={{ fontSize: 23, marginBottom: 16 }}>Related tools</h2>
                            <div className="dl-grid">{related.map((t, i) => this.ToolCard(t, i))}</div>
                        </section>
                    </div>
                </div>
            </div>
        );
    }

    /* ── pipeline (native surface; the run is an illustration, and says so) ── */

    Pipeline() {
        const STEPS = ["compress-pdf", "watermark", "page-numbers", "rotate-pdf", "grayscale-pdf",
            "flatten-pdf", "strip-metadata", "protect-pdf", "deskew-pdf", "remove-blank-pages"];
        const PRESETS = [
            ["Scan cleanup", ["deskew-pdf", "remove-blank-pages", "compress-pdf"]],
            ["Share safely", ["strip-metadata", "flatten-pdf", "protect-pdf"]],
            ["Paper trail", ["page-numbers", "watermark", "flatten-pdf"]],
        ];
        const { chain, pipeFile, pipeRunning, pipeDoneAt } = this.state;
        const ready = chain.length >= 1 && !!pipeFile && !pipeRunning;
        const runPipe = () => {
            if (!ready) return;
            this.setState({ pipeRunning: true, pipeDoneAt: 0 });
            const nodes = [...document.querySelectorAll(".dl-cnode")];
            let i = 0;
            const step = () => {
                if (i >= nodes.length) { this.setState({ pipeRunning: false, pipeDoneAt: Date.now() }); return; }
                const node = nodes[i];
                node.classList.add("running");
                this.animateBar(node.querySelector(".dl-pbar i"), 750, () => {
                    node.classList.remove("running"); node.classList.add("done");
                    i++; step();
                });
            };
            nodes.forEach((n) => n.classList.remove("done"));
            step();
        };
        return (
            <div className="dl-wrap">
                <div className="dl-heror">
                    <div className="dl-pghero">
                        <div className="dl-eyebrow">Chain tools</div>
                        <h1>One file. One trip.<br /><em>Many tools.</em></h1>
                        <p>Build a chain of steps and run them as a single pass — your file makes one trip, not one per step.</p>
                    </div>
                    <div className="dl-herocard">
                        <h3>Your file travels</h3>
                        <div className="big">1 trip</div>
                        <p className="sub2">vs {Math.max(chain.length, 1)} {chain.length > 1 ? "trips" : "per step"}, run one by one. Every step in the chain runs in the same pass on the same upload.</p>
                    </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr)", gap: 40, alignItems: "start", paddingTop: 36 }} className="dl-pipegrid">
                    <div className="dl-panel">
                        <h3>Add a step</h3>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {STEPS.map((s) => BY_SLUG.has(s) && (
                                <button key={s} className="dl-schip" disabled={pipeRunning}
                                    onClick={() => this.setState({ chain: [...chain, s] })}>
                                    <span className="plus">+</span> {BY_SLUG.get(s).name}
                                </button>
                            ))}
                        </div>
                        <p className="dl-hintl" style={{ marginTop: 12 }}>Steps apply in order, top to bottom.</p>
                        <h3 style={{ marginTop: 18 }}>Presets</h3>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {PRESETS.map(([name, steps]) => (
                                <button key={name} className="dl-schip" disabled={pipeRunning}
                                    title={steps.map((x) => BY_SLUG.get(x).name).join(" → ")}
                                    onClick={() => this.setState({ chain: [...steps] })}>{name}</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        {chain.length === 0
                            ? <div className="dl-empty">Your chain is empty — add steps from the left.</div>
                            : chain.map((s, i) => (
                                <div className="dl-cnode" key={`${s}${i}`}>
                                    <span className="num">{i + 1}</span>
                                    <b>{BY_SLUG.get(s)?.name || s}</b>
                                    <span className="ops">
                                        <button aria-label="Move earlier" disabled={pipeRunning} onClick={() => {
                                            if (i > 0) { const c = [...chain];[c[i - 1], c[i]] = [c[i], c[i - 1]]; this.setState({ chain: c }); }
                                        }}>↑</button>
                                        <button aria-label="Move later" disabled={pipeRunning} onClick={() => {
                                            if (i < chain.length - 1) { const c = [...chain];[c[i], c[i + 1]] = [c[i + 1], c[i]]; this.setState({ chain: c }); }
                                        }}>↓</button>
                                        <button aria-label="Remove step" disabled={pipeRunning} onClick={() => {
                                            const c = [...chain]; c.splice(i, 1); this.setState({ chain: c });
                                        }}>×</button>
                                    </span>
                                    <span className="dl-pbar"><i /></span>
                                </div>
                            ))}
                        {pipeFile
                            ? <div className="dl-filerow" style={{ marginTop: 26 }}>
                                <span className="dl-tag">PDF</span><b>{pipeFile.name}</b>
                                <span className="sz">{fmtSize(pipeFile.size)}</span>
                                <button aria-label="Remove file" disabled={pipeRunning} onClick={() => this.setState({ pipeFile: null })}>×</button>
                            </div>
                            : <div className="dl-empty" style={{ marginTop: 26, cursor: "pointer" }}
                                onClick={() => this._pipeFi && this._pipeFi.click()}>
                                <b style={{ display: "block", fontSize: 16, color: "var(--dl-ink)" }}>Add the file to run through the chain</b>
                                <span style={{ display: "block", marginTop: 6 }}>One file in, one result out — every step chained in a single pass</span>
                                <span className="dl-btn dl-btn-ghost" style={{ marginTop: 14, padding: "10px 20px", fontSize: 13.5 }}>Choose a file</span>
                            </div>}
                        <input type="file" hidden ref={(el) => { this._pipeFi = el; }} aria-label="Choose a file for the pipeline"
                            onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) this.setState({ pipeFile: { name: f.name, size: f.size } }); }} />
                        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 26, flexWrap: "wrap" }}>
                            <button className="dl-btn dl-btn-primary" disabled={!ready} onClick={runPipe}>Run pipeline</button>
                            <span style={{ fontSize: 13, color: "var(--dl-faint)" }}>
                                {ready ? `${chain.length} ${chain.length === 1 ? "step" : "steps"} · one pass, one trip` : "Add at least one step and a file."}
                            </span>
                        </div>
                        {pipeDoneAt > 0 && (
                            <div className="dl-panel" style={{ marginTop: 20 }}>
                                <h3 style={{ color: "var(--dl-green)" }}>Pipeline illustration complete</h3>
                                <p style={{ fontSize: 13.5, color: "var(--dl-muted)" }}>
                                    {pipeFile?.name} → {chain.length} steps in one pass. This page illustrates the flow;
                                    to actually run a chain today, use the tools in sequence — the real one-pass pipeline
                                    runs through the classic interface while this design is in preview.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
                <style>{`@media (max-width: 940px){ .dl-pipegrid { grid-template-columns:1fr !important; } }`}</style>
            </div>
        );
    }

    /* ── batch (native surface; run is an illustration, and says so) ── */

    Batch() {
        const { bfiles, bTool, bRunning, bDone } = this.state;
        const CHOICES = ["compress-pdf", "image-compressor", "pdf-to-word", "image-converter", "heic-to-jpg"];
        const runAll = () => {
            if (!bfiles.length || bRunning) return;
            this.setState({ bRunning: true, bDone: 0 });
            const rows = [...document.querySelectorAll(".dl-batchrow")];
            let done = 0;
            rows.forEach((row, i) => {
                this._timers.push(setTimeout(() => {
                    row.classList.add("running");
                    this.animateBar(row.querySelector(".bar i"), 800 + (i % 4) * 300, () => {
                        row.classList.remove("running"); row.classList.add("done");
                        done++;
                        this.setState({ bDone: done, ...(done === rows.length ? { bRunning: false } : null) });
                    });
                }, i * 160));
            });
        };
        return (
            <div className="dl-wrap">
                <div className="dl-heror">
                    <div className="dl-pghero">
                        <div className="dl-eyebrow">Bulk work</div>
                        <h1>Same tool.<br /><em>Many files.</em></h1>
                        <p>Pick one tool, drop a folder’s worth of files, and run them all. Each file gets its own progress; the batch gets one summary.</p>
                    </div>
                    <div className="dl-herocard">
                        <h3>Queue</h3>
                        <div className="big">{bfiles.length} files</div>
                        <p className="sub2">{bfiles.length
                            ? `Ready for ${BY_SLUG.get(bTool)?.name || "the selected tool"} — every file gets its own progress.`
                            : "Nothing queued yet — drop files anywhere on this page."}</p>
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", paddingTop: 30 }}>
                    <label style={{ fontSize: 13.5, fontWeight: 600 }} htmlFor="dl-btool">Tool</label>
                    <select id="dl-btool" className="dl-input" style={{ width: "auto" }} value={bTool}
                        onChange={(e) => this.setState({ bTool: e.target.value })}>
                        {CHOICES.map((s) => BY_SLUG.has(s) && <option key={s} value={s}>{BY_SLUG.get(s).name}</option>)}
                    </select>
                    <button className="dl-btn dl-btn-ghost" style={{ padding: "11px 20px", fontSize: 13.5 }}
                        onClick={() => this._batchFi && this._batchFi.click()}>Add files</button>
                    <button className="dl-btn dl-btn-quiet" style={{ marginLeft: "auto", fontSize: 13 }} disabled={bRunning}
                        onClick={() => this.setState({ bfiles: [], bDone: 0 })}>Clear</button>
                    <button className="dl-btn dl-btn-primary" disabled={!bfiles.length || bRunning} onClick={runAll}>Run all</button>
                    <input type="file" multiple hidden ref={(el) => { this._batchFi = el; }} aria-label="Choose files for the batch"
                        onChange={(e) => { this.batchAdd([...e.target.files]); e.target.value = ""; }} />
                </div>
                {bfiles.length > 0 && bDone > 0 && (
                    <p style={{ fontSize: 13, color: "var(--dl-muted)", marginTop: 16 }}>
                        {bDone === bfiles.length ? `All ${bfiles.length} done — illustration only; run the tool itself to process files.` : `${bDone} of ${bfiles.length} done`}
                    </p>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                    {bfiles.length === 0
                        ? <div className="dl-empty">No files yet — add some, or drop them anywhere on this page.</div>
                        : bfiles.map((f, i) => (
                            <div className="dl-filerow dl-batchrow" key={`${f.name}${i}`}>
                                <span className="dl-tag">{(f.name.split(".").pop() || "FILE").toUpperCase().slice(0, 4)}</span>
                                <b>{f.name}</b>
                                <span className="state"><Check size={14} /></span>
                                <span className="sz">{fmtSize(f.size)}</span>
                                <span className="bar"><i /></span>
                            </div>
                        ))}
                </div>
                <p className="dl-note" style={{ marginTop: 14 }}>The progress here illustrates the flow — open the chosen tool to actually process a batch; every tool accepts multiple files.</p>
            </div>
        );
    }

    batchAdd(files) {
        if (this.state.bRunning) return;
        this.setState((s) => ({ bfiles: [...s.bfiles, ...files.map((f) => ({ name: f.name, size: f.size }))], bDone: 0 }));
    }

    /* ── my stuff / vault (vault is REAL via withVault) ── */

    MyStuff() {
        const h = this.state.history;
        return (
            <div className="dl-wrap">
                <div className="dl-heror">
                    <div className="dl-pghero">
                        <div className="dl-eyebrow">On this device</div>
                        <h1>My Stuff</h1>
                        <p>Your activity — tool and time only, never files or filenames. It lives in this browser and nowhere else.</p>
                    </div>
                    <div className="dl-herocard">
                        <h3>On this device</h3>
                        <div className="big">{h.length} {h.length === 1 ? "entry" : "entries"}</div>
                        <p className="sub2">Clear it any time and it’s gone everywhere, because there is no elsewhere.</p>
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 26 }}>
                    <h2 className="dl-sec-title" style={{ fontSize: 22 }}>Recent tools</h2>
                    {h.length > 0 && <button className="dl-btn dl-btn-quiet" style={{ marginLeft: "auto", fontSize: 13 }} onClick={this.clearHistory}>Clear history</button>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                    {h.length === 0
                        ? <div className="dl-empty">Nothing yet — open a tool and it’ll show up here. Files and filenames never do.</div>
                        : h.map((e) => {
                            const t = BY_SLUG.get(e.s);
                            if (!t) return null;
                            const d = new Date(e.ts);
                            return (
                                <a key={e.s + e.ts} className="dl-filerow" href={`#/tool/${t.slug}`} style={{ color: "inherit" }}>
                                    <span className="dl-tag">{(FAMILY_LABEL[t.category] || "").toUpperCase().slice(0, 9)}</span>
                                    <b>{t.name}</b>
                                    <span className="sz">{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                                    <span />
                                </a>
                            );
                        })}
                </div>
                <section className="dl-sec" style={{ paddingTop: 72 }}>
                    <div className="dl-sec-head"><div><h2 className="dl-sec-title" style={{ fontSize: 22 }}>Yours, elsewhere</h2></div></div>
                    <div className="dl-supcards" style={{ paddingTop: 0 }}>
                        <div>
                            <span className="glyph"><svg width="17" height="17" viewBox="0 0 18 18" fill="none"><rect x="4" y="8" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M6 8 V6 A3 3 0 0 1 12 6 V8" stroke="currentColor" strokeWidth="1.5" /></svg></span>
                            <b>Vault</b>
                            <p>Real AES-GCM storage for the passwords your protected files need. <a href="#/my-stuff/vault">Open the vault →</a></p>
                        </div>
                        <div>
                            <span className="glyph"><svg width="17" height="17" viewBox="0 0 18 18" fill="none"><path d="M2.5 13 C 5 7, 7 7, 7.5 10.5 C 8 13.5, 9.5 13, 10.5 9 C 11 7, 12 8, 12.5 10 C 13 12, 14 12.5, 15.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg></span>
                            <b>Saved signatures</b>
                            <p>Drawn once, reused across signing tools — stored on this device by the tools themselves. <a href="#/tool/esign-pdf">Open E-Sign →</a></p>
                        </div>
                        <div>
                            <span className="glyph"><svg width="17" height="17" viewBox="0 0 18 18" fill="none"><path d="M9 3 V15 M3 9 H15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></span>
                            <b>Developer keys</b>
                            <p>API keys for the developer surface, if you use it. <a href="#/account">Manage keys →</a></p>
                        </div>
                    </div>
                </section>
            </div>
        );
    }

    Vault() {
        // Everything here is driven by withVault (extension): real AES-GCM storage.
        const vlt = this.state.vlt || { entries: [], label: "", password: "", busy: false, error: "" };
        const entries = vlt.entries || [];
        return (
            <div className="dl-wrap">
                <div className="dl-heror">
                    <div className="dl-pghero">
                        <div className="dl-eyebrow">Device-local</div>
                        <h1>Your vault.<br /><em>This device only.</em></h1>
                        <p>A real password vault for the files you protect and unlock here — AES-GCM under a key that cannot leave this browser. Nothing in it ever reaches a server, and we could not read it if it did.</p>
                    </div>
                    <div className="dl-herocard">
                        <h3 style={{ color: "var(--dl-green)", display: "flex", alignItems: "center", gap: 9 }}>
                            <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><rect x="4" y="8" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M6 8 V6 A3 3 0 0 1 12 6 V8" stroke="currentColor" strokeWidth="1.5" /></svg>
                            {entries.length} stored
                        </h3>
                        <p className="sub2">Encrypted at rest with WebCrypto. Clearing your browser’s site data deletes it permanently — there is no recovery, because there is no copy.</p>
                    </div>
                </div>

                {vlt.error && <div className="dl-err" role="alert">{vlt.error}</div>}

                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 40, alignItems: "start", paddingTop: 30 }} className="dl-vaultgrid">
                    <div>
                        <h2 className="dl-sec-title" style={{ fontSize: 22, marginBottom: 14 }}>Stored passwords</h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {entries.length === 0
                                ? <div className="dl-empty">Nothing stored yet — add the password for a protected file on the right.</div>
                                : entries.map((en) => (
                                    <div className="dl-keyrow" key={en.id}>
                                        <span className="dl-tag">AES</span>
                                        <span style={{ minWidth: 0 }}>
                                            <b style={{ display: "block", fontSize: 14 }}>{en.label}</b>
                                            <code>{vlt.revealedId === en.id ? vlt.revealedValue : "••••••••••••"}</code>
                                            <span className="kd" style={{ display: "block" }}>{describeEntry(en)}</span>
                                        </span>
                                        <button className="dl-btn dl-btn-quiet" style={{ fontSize: 12.5, padding: "6px 10px" }}
                                            onClick={() => this._vaultReveal(en.id)}>{vlt.revealedId === en.id ? "Hide" : "Reveal"}</button>
                                        <span style={{ display: "flex", gap: 2 }}>
                                            <button className="dl-btn dl-btn-quiet" style={{ fontSize: 12.5, padding: "6px 10px" }}
                                                onClick={() => { this._vaultCopy(en.id); this.say("Copied — decrypted on this device only."); }}>Copy</button>
                                            <button className="dl-btn dl-btn-quiet" style={{ fontSize: 12.5, padding: "6px 8px" }}
                                                onClick={() => this._vaultDelete(en.id)} aria-label={`Delete ${en.label}`}>Delete</button>
                                        </span>
                                    </div>
                                ))}
                        </div>
                        {entries.length > 0 && (
                            <button className="dl-btn dl-btn-quiet" style={{ fontSize: 13, marginTop: 14 }} onClick={this._vaultClear}>
                                {vlt.confirmingClear ? "Press again to erase everything" : "Clear the vault"}
                            </button>
                        )}
                    </div>
                    <aside className="dl-panel">
                        <h3>Store a password</h3>
                        <form onSubmit={this._vaultAdd}>
                            <div className="dl-field">
                                <label htmlFor="dl-vl">Name</label>
                                <input id="dl-vl" className="dl-input" value={vlt.label || ""} placeholder="e.g. tax-return-2026.pdf"
                                    onChange={(e) => this._setVault({ label: e.target.value, error: "" })} />
                            </div>
                            <div className="dl-field">
                                <label htmlFor="dl-vp">Password</label>
                                <input id="dl-vp" className="dl-input" type="password" value={vlt.password || ""} placeholder="The password to keep"
                                    onChange={(e) => this._setVault({ password: e.target.value, error: "" })} />
                            </div>
                            <button className="dl-btn dl-btn-primary" style={{ width: "100%", marginTop: 6 }} disabled={vlt.busy} type="submit">
                                {vlt.busy ? "Encrypting…" : "Encrypt & store"}
                            </button>
                        </form>
                        <p className="dl-hintl" style={{ marginTop: 12 }}>
                            Stored with AES-GCM under a non-extractable key in this browser. Protect PDF and Unlock PDF can use these without you retyping them.
                        </p>
                    </aside>
                </div>
                <style>{`@media (max-width: 940px){ .dl-vaultgrid { grid-template-columns:1fr !important; } }`}</style>
            </div>
        );
    }

    /* ── account (REAL via withAccounts; markup only renders its state) ── */

    Account() {
        const a = this.state.acct || {};
        // Named delegations: each is a capability the parity test requires this
        // markup to carry — see skin-parity.test.ts "account capability parity".
        const acctRecoveryCode = a.recoveryCode;
        const acctCopyRecovery = this._acctCopyRecovery;
        const acctAckRecovery = this._acctAckRecovery;
        const acctShowRecover = () => this._setAcct({ mode: "recover", error: "" });
        const acctRecoveryInput = a.recoveryInput;
        const acctDownloadRecovery = this._acctDownloadRecovery;
        const acctToggleRotate = this._acctToggleRotate;
        const acctSetRotatePassword = this._acctSetRotatePassword;

        const strength = a.mode !== "signin" && a.password ? strengthOf(a.password) : null;

        if (!a.user) {
            return (
                <div className="dl-wrap">
                    <div className="dl-authwrap">
                        <div className="dl-authcard">
                            <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}><Logo size={30} /></div>
                            <h2>{a.mode === "signup" ? "Create your account" : a.mode === "recover" ? "Recover your account" : "Sign in to PrivaTools"}</h2>
                            <p className="sub">Only the developer API needs this — every tool works without an account.</p>
                            <div className="dl-modes" role="tablist">
                                {[["signin", "Sign in"], ["signup", "Sign up"]].map(([m, l]) => (
                                    <button key={m} className={a.mode === m ? "on" : ""} role="tab" aria-selected={a.mode === m}
                                        onClick={() => this._setAcct({ mode: m, error: "" })}>{l}</button>
                                ))}
                            </div>
                            {a.error && <div className="dl-err" role="alert">{a.error}</div>}
                            {a.needsEmailCode ? (
                                <form onSubmit={this._acctVerifyEmail}>
                                    <p style={{ fontSize: 13.5, color: "var(--dl-muted)" }}>We emailed a code to <b>{a.email}</b>. Enter it to finish signing up.</p>
                                    <div className="dl-field">
                                        <label htmlFor="dl-code">Email code</label>
                                        <input id="dl-code" className="dl-input" value={a.emailCode}
                                            onChange={(e) => this._setAcct({ emailCode: e.target.value, error: "" })} autoComplete="one-time-code" />
                                    </div>
                                    <button className="dl-btn dl-btn-primary" style={{ width: "100%" }} disabled={a.busy} type="submit">
                                        {a.busy ? "Checking…" : "Verify"}
                                    </button>
                                </form>
                            ) : (
                                <form onSubmit={this._acctSubmit}>
                                    <div className="dl-field">
                                        <label htmlFor="dl-email">Email</label>
                                        <input id="dl-email" className="dl-input" type="email" required value={a.email}
                                            onChange={(e) => this._setAcct({ email: e.target.value, error: "" })} autoComplete="email" />
                                    </div>
                                    {a.mode === "recover" && (
                                        <div className="dl-field">
                                            <label htmlFor="dl-rec">Recovery code</label>
                                            <input id="dl-rec" className="dl-input" required value={acctRecoveryInput}
                                                onChange={(e) => this._setAcct({ recoveryInput: e.target.value, error: "" })} />
                                            <span className="dl-hintl">The code shown once at signup — it’s the only way back in.</span>
                                        </div>
                                    )}
                                    <div className="dl-field">
                                        <label htmlFor="dl-pass">{a.mode === "recover" ? "New password" : "Password"}</label>
                                        <input id="dl-pass" className="dl-input" type={a.showPassword ? "text" : "password"} required
                                            minLength={a.mode === "signin" ? undefined : MIN_PASSWORD_LENGTH}
                                            value={a.password}
                                            onChange={(e) => this._setAcct({ password: e.target.value, error: "" })}
                                            autoComplete={a.mode === "signin" ? "current-password" : "new-password"} />
                                        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--dl-muted)", fontWeight: 500 }}>
                                            <input type="checkbox" checked={!!a.showPassword}
                                                onChange={(e) => this._setAcct({ showPassword: e.target.checked })} /> Show password
                                        </label>
                                        {strength && <span className="dl-hintl">Strength: {strength.label}</span>}
                                    </div>
                                    <button className="dl-btn dl-btn-primary" style={{ width: "100%" }} disabled={a.busy} type="submit">
                                        {a.busy ? "Working…" : a.mode === "signup" ? "Create account" : a.mode === "recover" ? "Reset password" : "Sign in"}
                                    </button>
                                </form>
                            )}
                            {a.mode !== "recover" && !a.needsEmailCode && (
                                <button className="dl-btn dl-btn-quiet" style={{ fontSize: 12.5, marginTop: 4 }} onClick={acctShowRecover}>
                                    Lost your password? Recover with your code
                                </button>
                            )}
                            <p className="dl-note" style={{ textAlign: "center" }}>
                                {ACCOUNT_COPY.recovery}
                            </p>
                        </div>
                        <div style={{ paddingTop: 40 }}>
                            <div className="dl-eyebrow">Developers only</div>
                            <h3 className="dl-h" style={{ fontSize: 24, margin: "10px 0" }}>Every tool works without this.</h3>
                            <p style={{ color: "var(--dl-muted)", fontSize: 14.5, maxWidth: "34em" }}>
                                Accounts exist for one thing: the developer API — keys, quota and nothing else. No login
                                wall will ever appear in front of a download, and files sent through the API follow the
                                same rules as the site: processed in isolation, deleted after use.
                            </p>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="dl-wrap">
                {acctRecoveryCode && (
                    <div className="dl-reccode" style={{ maxWidth: 640, marginTop: 40 }}>
                        <b style={{ fontSize: 15 }}>Save your recovery code now</b>
                        <p style={{ fontSize: 13, color: "var(--dl-muted)", marginTop: 4 }}>
                            It is shown exactly once, and it is the only way back into this account — there is no reset email.
                        </p>
                        <code>{acctRecoveryCode}</code>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button className="dl-btn dl-btn-ghost" style={{ padding: "9px 18px", fontSize: 13 }} onClick={acctCopyRecovery}>
                                {a.recoverySaved ? "Copied ✓" : "Copy code"}
                            </button>
                            <button className="dl-btn dl-btn-ghost" style={{ padding: "9px 18px", fontSize: 13 }} onClick={acctDownloadRecovery}>Download as file</button>
                            <button className="dl-btn dl-btn-primary" style={{ padding: "9px 18px", fontSize: 13 }} onClick={acctAckRecovery}>I’ve saved it</button>
                        </div>
                    </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 40, flexWrap: "wrap" }}>
                    <div>
                        <div className="dl-eyebrow">Developer API</div>
                        <h1 className="dl-h" style={{ fontSize: 32, marginTop: 8 }}>API keys</h1>
                        <p style={{ fontSize: 13.5, color: "var(--dl-muted)", marginTop: 4 }}>Signed in as <b>{a.user.email}</b></p>
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                        <button className="dl-btn dl-btn-ghost" style={{ padding: "10px 18px", fontSize: 13 }} onClick={this._acctNewKey}>Create key</button>
                        <button className="dl-btn dl-btn-quiet" style={{ fontSize: 13 }} onClick={this._acctSignOut}>Sign out</button>
                    </div>
                </div>
                {a.error && <div className="dl-err" role="alert">{a.error}</div>}
                {a.freshKey && (
                    <div className="dl-fresh">
                        <b>Copy this key now — it is shown once.</b>
                        <code>{a.freshKey}</code>
                    </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18, maxWidth: 860 }}>
                    {(a.keys || []).length === 0
                        ? <div className="dl-empty">No keys yet — create one to call the API.</div>
                        : a.keys.map((k) => (
                            <div className="dl-keyrow" key={k.id}>
                                <span className="dl-tag">KEY</span>
                                <code>{describeKey(k)}</code>
                                <span className="kd">{k.label}</span>
                                <button className="dl-btn dl-btn-quiet" style={{ fontSize: 12.5, padding: "6px 10px" }}
                                    onClick={() => this._acctRevoke(k.id)}>Revoke</button>
                            </div>
                        ))}
                </div>
                <div className="dl-panel" style={{ maxWidth: 640, marginTop: 40 }}>
                    <h3>Recovery code</h3>
                    <p style={{ fontSize: 13.5, color: "var(--dl-muted)" }}>
                        Mislaid your code? You can replace it — the old one stops working the moment a new one is issued.
                    </p>
                    {!a.rotating ? (
                        <button className="dl-btn dl-btn-ghost" style={{ marginTop: 12, padding: "10px 18px", fontSize: 13 }} onClick={acctToggleRotate}>
                            Replace my recovery code
                        </button>
                    ) : (
                        <form onSubmit={this._acctRotate}>
                            <div className="dl-field">
                                <label htmlFor="dl-rotp">Confirm your password</label>
                                <input id="dl-rotp" className="dl-input" type="password" required value={a.rotatePassword}
                                    onChange={acctSetRotatePassword} autoComplete="current-password" />
                                <span className="dl-hintl">Required so a stolen session alone can’t mint a code that outlives a password change.</span>
                            </div>
                            <div style={{ display: "flex", gap: 10 }}>
                                <button className="dl-btn dl-btn-primary" style={{ padding: "10px 20px", fontSize: 13.5 }} disabled={a.busy} type="submit">
                                    {a.busy ? "Working…" : "Issue new code"}
                                </button>
                                <button className="dl-btn dl-btn-quiet" style={{ fontSize: 13 }} type="button" onClick={acctToggleRotate}>Cancel</button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        );
    }

    /* ── trust / security ── */

    Security() {
        return (
            <div className="dl-wrap">
                <div className="dl-heror">
                    <div className="dl-pghero">
                        <div className="dl-eyebrow">The promises</div>
                        <h1>Don’t trust us.<br /><em>Check us.</em></h1>
                        <p>Most tool sites ask you to believe a privacy policy. Ours are behaviors — each one written so you can verify it yourself, from your own browser, in under a minute.</p>
                    </div>
                    <div className="dl-herocard">
                        <h3>Check us in 60 seconds</h3>
                        <div className="dl-ministeps">
                            <div><i>01</i><span>Open your browser’s network tab</span></div>
                            <div><i>02</i><span>Run any local tool on a file</span></div>
                            <div><i>03</i><span>Watch nothing leave your machine</span></div>
                        </div>
                    </div>
                </div>
                <div style={{ paddingTop: 26 }}>
                    {[["Local tools upload nothing", "How to check: network tab",
                        ["Most of the catalogue runs entirely in your browser. Open developer tools, watch the network panel, run the tool — you’ll see zero upload requests. The file never leaves your machine, so there is nothing for us to store, leak or train on."]],
                    ["Server tools say so first", "How to check: the amber chip",
                        ["Some jobs — OCR, office conversion, heavy video — need more than a browser can do. Those tools carry an amber “uses our server” chip before you add a file. Processing happens in isolated temporary storage on our server in Mumbai, India, and your file is deleted after use.",
                            "We’d rather tell you where the server is than pretend there isn’t one."]],
                    ["No third-party code touches your files", "How to check: network tab, again",
                        ["Many free tool sites load their actual processing code from public CDNs at runtime — unpinned scripts, fetched while you’re holding a sensitive document. We don’t. Every tool is bundled and served from privatools.me, integrity-checked at build time, behind a strict content-security policy."]],
                    ["No accounts, no trackers, no ads", "How to check: use the site",
                        ["There is nothing to sign up for to use a tool, no analytics script watching you, and nothing to sell. The site is owner-funded. Your history — kept on your device — records tool and time only, never files or filenames."]]]
                        .map(([h, how, ps]) => (
                            <div className="dl-promise" key={h}>
                                <div><h3>{h}</h3><div className="how">{how}</div></div>
                                <div>{ps.map((p, i) => <p key={i}>{p}</p>)}</div>
                            </div>
                        ))}
                </div>
                <section className="dl-sec" style={{ paddingTop: 64 }}>
                    <div className="dl-sec-head"><div><h2 className="dl-sec-title">Where we’re not perfect</h2><p className="dl-sec-sub">Said plainly, because that’s the point</p></div></div>
                    <div className="dl-caveat">
                        <b>Some on-device AI tools download their models from a CDN.</b>
                        <p>Background removal and similar tools fetch model weights (not your files) on first use — disclosed in the privacy policy. Your document still never leaves the browser.</p>
                    </div>
                    <div className="dl-caveat">
                        <b>Server tools mean trusting our server.</b>
                        <p>For those tools, “deleted after use” is our promise, not something your network tab can prove. If a document is too sensitive for that, use a local-only tool — the chip tells you which is which.</p>
                    </div>
                </section>
            </div>
        );
    }

    Compare() {
        return (
            <div className="dl-wrap">
                <div className="dl-pghero">
                    <div className="dl-eyebrow">Side by side</div>
                    <h1>The fine print,<br /><em>compared properly.</em></h1>
                    <p>Checked against each site’s own public pages, August 2026. Their free tiers are what most people actually use — so that’s the column we compare.</p>
                </div>
                <div className="dl-cmpscroll" style={{ marginTop: 30 }}>
                    <table className="dl-cmp">
                        <thead><tr><th>On the free tier</th><th>PrivaTools</th><th>iLovePDF</th><th>Smallpdf</th><th>Sejda</th><th>ihatepdf</th></tr></thead>
                        <tbody>
                            {CMP_ROWS.map(([row, us, ...others]) => (
                                <tr key={row}>
                                    <td>{row}</td>
                                    <td className="us">{us[0]}</td>
                                    {others.map(([txt, small], i) => (
                                        <td key={i}>
                                            {txt === "None" || txt === "Free" || txt === "Stays in browser" || txt === "n/a"
                                                ? txt : <span className="no">{txt}</span>}
                                            {small && <small>{small}</small>}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="dl-note" style={{ marginTop: 14 }}>
                    Sources: each product’s public tool and pricing pages as read in August 2026. Corrections welcome — <a href="#/support">tell us</a>.
                </p>
            </div>
        );
    }

    Blog() {
        const post = BLOG.find((b) => b.id === this.state.post);
        if (post) {
            return (
                <div className="dl-wrap">
                    <div className="dl-crumb" style={{ paddingTop: 36 }}><a href="#/blog">Blog</a> &nbsp;/&nbsp; <span style={{ color: "var(--dl-ink)" }}>{post.title}</span></div>
                    <div className="dl-article">
                        <div className="dl-eyebrow">{post.tag}</div>
                        <h1>{post.title}</h1>
                        <div className="am">{post.date} · {post.mins} min read</div>
                        {post.body.map((p, i) => <p key={i}>{p}</p>)}
                    </div>
                </div>
            );
        }
        return (
            <div className="dl-wrap">
                <div className="dl-pghero">
                    <div className="dl-eyebrow">Notes</div>
                    <h1>The blog</h1>
                    <p>Short, technical, honest — how private file handling actually works, from the people building it.</p>
                </div>
                <div className="dl-bgrid">
                    {BLOG.map((b) => (
                        <a key={b.id} className="dl-bpost" href={`#/blog/${b.id}`}>
                            <div className="bm"><span className="bt">{b.tag}</span><span>{b.date}</span><span>{b.mins} min</span></div>
                            <h3>{b.title}</h3>
                            <p>{b.excerpt}</p>
                        </a>
                    ))}
                </div>
            </div>
        );
    }

    Doc(title, eyebrow, sections) {
        return (
            <div className="dl-wrap">
                <div className="dl-pghero">
                    <div className="dl-eyebrow">{eyebrow}</div>
                    <h1>{title}</h1>
                </div>
                <div className="dl-doc">
                    {sections.map(([h, body]) => (
                        <React.Fragment key={h}>
                            <h2>{h}</h2>
                            {Array.isArray(body)
                                ? <ul>{body.map((li) => <li key={li}>{li}</li>)}</ul>
                                : <p>{body}</p>}
                        </React.Fragment>
                    ))}
                </div>
            </div>
        );
    }

    About() {
        return this.Doc("About", "What this is", [
            ["The short version", `PrivaTools is ${TOTAL} file tools built on one rule: your documents are yours. Wherever a tool can run in your browser, it does; when a server is needed, it says so first, and deletes everything after use.`],
            ["Who pays for it", "The owner. There are no ads, no trackers, no premium tier and no investors to satisfy — which is why there is nothing on this site that tries to convert you into anything."],
            ["Where things run", "The site and its processing run from our disclosed server in Mumbai, India. Most tools never touch it — they run entirely on your device."],
        ]);
    }

    Privacy() {
        return this.Doc("Privacy", "Policy", [
            ["The short version", [
                "No account is needed to use any tool, and no ads or third-party trackers run on this site.",
                "Tools run in your browser wherever possible; those files never reach us.",
                "When a tool needs our server, your file is processed in isolated temporary storage in Mumbai, India, and deleted after use.",
                "Activity kept on your device holds tool and time only — never files or filenames.",
            ]],
            ["Files", "Local-first is the default: if a tool can run entirely in your browser, it does, and your file never leaves your machine. Tools that require server processing say so before you add a file. Server processing is transient — files exist only for the duration of the job and are deleted after use. We keep no copies; once deleted, they are unrecoverable."],
            ["Accounts", "Tools never require an account. The optional developer account exists only for the API; it stores your email, a password hash, and your API keys — nothing else."],
            ["The full policy", <>This page is Daylight’s summary. The complete policy — including the AI tools’ model downloads and the developer API’s specifics — is the site policy it summarises.</>],
        ]);
    }

    Terms() {
        return this.Doc("Terms", "Legal", [
            ["The service", "PrivaTools provides file utilities free of charge, without accounts, for lawful personal and commercial use. The service is provided as-is, without warranty; verify important results before relying on them."],
            ["Acceptable use", "Don’t use the tools to process content you have no right to process, and don’t attempt to disrupt the service for others."],
            ["Liability", "To the maximum extent permitted by law, we are not liable for losses arising from use of the service. Your sole remedy is to stop using it — which costs nothing, because so does using it."],
        ]);
    }

    Status() {
        const SVC = [
            ["Website", "privatools.me and every page on it"],
            ["In-browser tools", "the local-first path — runs on your device"],
            ["Server processing", "Mumbai, IN — isolated temporary storage"],
            ["Downloads", "result delivery, this-tab only"],
        ];
        return (
            <div className="dl-wrap">
                <div className="dl-heror">
                    <div className="dl-pghero">
                        <div className="dl-eyebrow">Live status</div>
                        <h1 style={{ display: "flex", alignItems: "center", gap: 16 }}><span className="dl-pulse" aria-hidden="true" />All systems normal</h1>
                        <p>Current state of the site and its processing paths.</p>
                    </div>
                    <div className="dl-herocard">
                        <h3>Last 90 days</h3>
                        <div className="big">0 incidents</div>
                        <p className="sub2">4 services watched · illustrative strips — the live checks are the source of truth.</p>
                    </div>
                </div>
                <div style={{ paddingTop: 18 }}>
                    {SVC.map(([name, sub], si) => (
                        <div className="dl-svc" key={name}>
                            <div className="r1"><b>{name}</b><span className="sub">{sub}</span><span className="badge">Operational</span></div>
                            <div className="dl-upt">
                                {Array.from({ length: 90 }, (_, d) => (
                                    <i key={d} className={(d * 7 + si * 13) % 89 === 3 ? "warn" : ""} />
                                ))}
                            </div>
                            <div className="cap"><span>90 days ago</span><span>Today</span></div>
                        </div>
                    ))}
                    <p className="dl-note">Illustrative uptime strips — this page shows the design; live checks drive the production status page.</p>
                </div>
            </div>
        );
    }

    Support() {
        return (
            <div className="dl-wrap">
                <div className="dl-pghero">
                    <div className="dl-eyebrow">Support</div>
                    <h1>A person reads this.<br /><em>Really.</em></h1>
                    <p>Owner-funded means owner-answered. No ticket deflection, no chatbot maze — say what broke or what’s missing and it gets read.</p>
                </div>
                <div className="dl-supcards">
                    <div>
                        <span className="glyph"><svg width="17" height="17" viewBox="0 0 20 20" fill="none"><rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" /><path d="M3.5 6 L10 11 L16.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                        <b>Found a bug?</b>
                        <p>Name the tool and the rough file type — never send the file itself unless you’re comfortable. Most fixes ship within days.</p>
                    </div>
                    <div>
                        <span className="glyph"><svg width="17" height="17" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" /><path d="M10 6.5 V10 L12.5 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                        <b>Is something down?</b>
                        <p>Check the <a href="#/status">status page</a> first — every processing path has its own row.</p>
                    </div>
                    <div>
                        <span className="glyph"><svg width="17" height="17" viewBox="0 0 20 20" fill="none"><path d="M10 3 L17 6.5 V10 C17 14 14 17 10 18 C6 17 3 14 3 10 V6.5 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg></span>
                        <b>Privacy questions</b>
                        <p>Start with <a href="#/security">Trust &amp; security</a> — every promise is written so you can verify it yourself.</p>
                    </div>
                </div>
            </div>
        );
    }

    /* ═══════════════════════ render ═══════════════════════ */

    render() {
        const v = this.renderVals();
        const { view } = this.state;
        const body =
            view === "tools" ? this.Tools()
                : view === "tool" ? this.Tool(v)
                    : view === "pipeline" ? this.Pipeline()
                        : view === "batch" ? this.Batch()
                            : view === "mystuff" ? this.MyStuff()
                                : view === "vault" ? this.Vault()
                                    : view === "account" ? this.Account()
                                        : view === "security" ? this.Security()
                                            : view === "compare" ? this.Compare()
                                                : view === "blog" ? this.Blog()
                                                    : view === "about" ? this.About()
                                                        : view === "privacy" ? this.Privacy()
                                                            : view === "terms" ? this.Terms()
                                                                : view === "status" ? this.Status()
                                                                    : view === "support" ? this.Support()
                                                                        : this.Home();
        return (
            <div className="dl-root">
                <style>{CSS}</style>
                {this.Nav()}
                <main id="dl-main">{body}</main>
                {this.Footer()}
                {this.SysDock()}
                {this.TabBar()}
                {this.Palette()}
                {this.state.dragging && (
                    <div className="dl-dropov" aria-hidden="true">
                        <div><b>Drop it.</b><p>We’ll show you every tool that can handle it — nothing uploads.</p></div>
                    </div>
                )}
                {this.state.toast && <div className="dl-toast" role="status">{this.state.toast}</div>}
            </div>
        );
    }
}
