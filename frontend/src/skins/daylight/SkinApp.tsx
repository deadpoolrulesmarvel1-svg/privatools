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
import { blogPosts } from "@/data/blog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast as sonnerToast } from "sonner";
import { cn } from "@/lib/utils";

/*
 * The four surfaces below mount the house design's real pages whole — the same
 * pattern withRealTools uses for the 112 tool components. Pipeline's chain
 * runner (server-side chaining with a per-step fallback), Batch's per-file
 * engine with resume, Status's live health checks and My Stuff's localStore
 * management all keep working exactly as built; Daylight draws the chrome and
 * the tokens (palette, type, radius) make them render native.
 */
const HousePipeline = React.lazy(() => import("@/pages/PipelinePage"));
const HouseBatch = React.lazy(() => import("@/pages/BatchPage"));
const HouseMyStuff = React.lazy(() => import("@/pages/MyStuffPage"));
const HouseStatus = React.lazy(() => import("@/pages/StatusPage"));

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
    return { view: "notfound" };
}

const go = (hash) => { location.hash = hash; };

const fmtDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]} ${d}, ${y}`;
};
const POSTS_NEWEST = [...blogPosts].sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));

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
.dl-root button { font-family:inherit; cursor:pointer; }
/* Bare buttons (no classes / dl-only classes) keep the quiet reset; anything
   carrying utility classes styles itself. */
.dl-root button:not([class*="bg-"]):not([class*="border"]) { color:inherit; background:none; border:0; font-size:inherit; }
.dl-root input[type="checkbox"] { accent-color: var(--dl-green); width:15px; height:15px; }
.dl-root a { color:inherit; text-decoration:none; }
/* Prose links stay green; component anchors (buttons, cards, chips) inherit,
   so Tailwind utility colors on them are never fought by a broad rule. */
.dl-root p a, .dl-root li a, .dl-root .dl-note a, .dl-root .dl-hintl a { color:var(--dl-green); font-weight:600; }
.dl-root a:hover { color:var(--dl-green-deep); }
.dl-root :focus-visible { outline:2px solid var(--dl-green); outline-offset:3px; border-radius:4px; }
.dl-root ::selection { background:var(--dl-ghost); }
.dl-wrap { max-width:1480px; margin:0 auto; padding:0 32px; }
.dl-h, .dl-root h1, .dl-root h2, .dl-root h3, .dl-brand, .dl-stat b, .dl-herocard .big,
.dl-receipt .rh, .dl-dz .mid b, .dl-cnode .num {
  font-family:'Bricolage Grotesque', 'Manrope', system-ui, sans-serif;
}
.dl-h { font-weight:700; letter-spacing:-.022em; text-wrap:balance; line-height:1.05; }

.dl-eyebrow { font-size:12.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--dl-green); font-weight:600; }
.dl-sec { padding-top:104px; }
.dl-sec-head { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:22px; flex-wrap:wrap; }
.dl-sec-title { font-weight:700; font-size:29px; letter-spacing:-.02em; }
.dl-sec-sub { font-size:15px; color:var(--dl-muted); margin-top:5px; }
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

.dl-band { background:var(--dl-band); color:var(--dl-band-ink); border-radius:22px; padding:52px; display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); gap:52px; position:relative; overflow:hidden; }
.dl-band::after { content:""; position:absolute; top:-40%; right:-12%; width:60%; height:120%; background:radial-gradient(closest-side, color-mix(in srgb, var(--dl-band-green) 13%, transparent), transparent 70%); pointer-events:none; }
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
@media (max-width: 900px) {
  .dl-foot .cols { grid-template-columns:1fr 1fr; gap:34px 24px; }
  .dl-foot .brand { grid-column:1 / -1; }
  .dl-foot .cols > div:last-child { grid-column:1 / -1; }
  .dl-foot .cols > div:last-child ul { display:grid; grid-template-columns:1fr 1fr; gap:9px 24px; }
}
.dl-foot .brand .finstall { margin-top:16px; padding:9px 16px; font-size:13px; gap:8px; }
.dl-foot h4 { font-size:11.5px; letter-spacing:.11em; text-transform:uppercase; color:var(--dl-faint); font-weight:600; margin:0 0 13px; }
.dl-foot ul { list-style:none; padding:0; display:flex; flex-direction:column; gap:9px; }
.dl-root .dl-foot ul a { color:var(--dl-muted); font-size:13.5px; }
.dl-root .dl-foot ul a:hover { color:var(--dl-ink); }
.dl-foot .brand p { font-size:13px; color:var(--dl-muted); margin-top:12px; max-width:24em; line-height:1.6; }
.dl-foot .base { border-top:1px solid var(--dl-rule); }
.dl-foot .base > div { display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; max-width:1480px; margin:0 auto; padding:18px 32px; font-size:12.5px; color:var(--dl-faint); }
@media (min-width: 981px) { .dl-foot .base > div { padding-left:96px; } } /* clears the status pill */

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
.dl-toolui { margin-top:26px; }
.dl-toolfine { margin:14px 2px 0; max-width:760px; font-size:12.5px; line-height:1.6; color:var(--dl-mut); }
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
.dl-prosegrid { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:64px; align-items:start; padding-bottom:20px; }
@media (max-width: 980px) { .dl-prosegrid { grid-template-columns:1fr; gap:10px; } }
.dl-proserail { position:sticky; top:92px; display:flex; flex-direction:column; gap:16px; }
@media (max-width: 980px) { .dl-proserail { position:static; } }
.dl-facts h3 { margin-bottom:4px; }
.dl-factr { display:flex; justify-content:space-between; gap:14px; padding:9px 0; border-bottom:1px solid var(--dl-rule-soft); font-size:13px; color:var(--dl-muted); }
.dl-factr:last-child { border-bottom:none; }
.dl-claimlink { background:none; border:none; padding:0; margin-top:8px; font-size:13px; font-weight:600; color:var(--dl-green); cursor:pointer; }
.dl-claimlink:hover { text-decoration:underline; }
.dl-factr b { color:var(--dl-ink); font-weight:600; text-align:right; }
.dl-facts .fine { font-size:12.5px; color:var(--dl-muted); margin:2px 0 10px; }
.dl-facts .dl-doclist { margin:0 0 8px; padding-left:2px; list-style:none; }
.dl-doclist li { position:relative; padding:3px 0 3px 22px; color:var(--dl-muted); font-size:14.5px; line-height:1.65; }
.dl-doclist li::before { content:""; position:absolute; left:2px; top:13px; width:7px; height:7px; border-radius:50%; background:var(--dl-green); opacity:.75; }
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
.dl-reccode { background:var(--dl-wash); border:1px solid color-mix(in srgb, var(--dl-green) 30%, var(--dl-rule)); border-radius:12px; padding:16px 18px; margin-top:12px; }
.dl-reccode code { display:block; font-family:ui-monospace, Menlo, monospace; font-size:15px; letter-spacing:.04em; background:var(--dl-card); border:1px dashed var(--dl-rule-mid); border-radius:8px; padding:10px 12px; margin:10px 0; word-break:break-all; }
.dl-keyrow { display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; gap:12px; align-items:center; background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:11px; padding:12px 16px; font-size:13.5px; }
.dl-keyrow code { font-family:ui-monospace, Menlo, monospace; font-size:12.5px; color:var(--dl-muted); overflow:hidden; text-overflow:ellipsis; }
.dl-keyrow b { overflow-wrap:anywhere; }
@media (max-width: 620px) {
  .dl-keyrow { grid-template-columns:auto minmax(0,1fr) auto; }
  .dl-keyrow > *:nth-child(4) { grid-column:2 / -1; justify-self:start; }
}
.dl-keyrow .kd { color:var(--dl-faint); font-size:12px; white-space:nowrap; }
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
/* ── blog: featured card, tag chips, article typography ── */
/* ── the product pages' furniture ── */
.dl-acc { max-width:820px; }
.dl-acc button { font-size:15px; color:var(--dl-ink); font-family:inherit; }
.dl-acc div[class*="pb-4"] { font-size:14px; color:var(--dl-muted); line-height:1.65; max-width:68ch; }
.dl-reprow { display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap; margin-top:28px; background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:14px; padding:18px 22px; }
.dl-reprow b { font-size:14.5px; }
.dl-reprow p { font-size:13px; color:var(--dl-muted); margin-top:3px; }
.dl-root .dl-reprow p a { color:var(--dl-green); font-weight:600; }
.dl-reprow .dl-supcta { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-top:24px; }
.dl-supcta span { font-size:13px; color:var(--dl-muted); max-width:32ch; }
.dl-vsteps { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:14px; margin-top:30px; }
@media (max-width: 860px) { .dl-vsteps { grid-template-columns:1fr; } }
.dl-vsteps > div { background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:14px; padding:18px 20px; }
.dl-vsteps i { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:9px; background:var(--dl-wash); color:var(--dl-green); font-style:normal; font-weight:700; font-size:12.5px; margin-bottom:10px; }
.dl-vsteps b { display:block; font-size:14.5px; margin-bottom:4px; }
.dl-vsteps p { font-size:13px; color:var(--dl-muted); line-height:1.6; }
.dl-doc h2 { position:relative; padding-top:18px; }
.dl-doc h2::before { content:""; position:absolute; top:0; left:0; width:26px; height:3px; border-radius:2px; background:var(--dl-green); opacity:.55; }

/* ── scroll reveals — one-way content entrances; grids stagger children ── */
.rv { opacity:0; transform:translateY(14px); transition:opacity 460ms var(--dl-eo), transform 460ms var(--dl-eo); }
.rv.in { opacity:1; transform:none; }
.rv-p { transform:translateY(8px); transition-duration:300ms; }
.rv-p[data-d="1"] { transition-delay:60ms; } .rv-p[data-d="2"] { transition-delay:120ms; } .rv-p[data-d="3"] { transition-delay:180ms; }
.dl-ccards.rv > *, .dl-claims.rv > * { opacity:0; transform:translateY(10px); transition:opacity 420ms var(--dl-eo), transform 420ms var(--dl-eo); }
.dl-ccards.rv.in > *, .dl-claims.rv.in > * { opacity:1; transform:none; }
.dl-ccards.rv.in > *:nth-child(2), .dl-claims.rv.in > *:nth-child(2) { transition-delay:50ms; }
.dl-ccards.rv.in > *:nth-child(3), .dl-claims.rv.in > *:nth-child(3) { transition-delay:100ms; }
.dl-ccards.rv.in > *:nth-child(4), .dl-claims.rv.in > *:nth-child(4) { transition-delay:150ms; }
@media (prefers-reduced-motion: reduce) {
  .rv, .dl-ccards.rv > *, .dl-claims.rv > * { opacity:1; transform:none; transition:none; }
}
.dl-btags { display:flex; flex-wrap:wrap; gap:8px; margin:6px 0 26px; }
.dl-chip { border:1px solid var(--dl-rule); background:var(--dl-card); color:var(--dl-muted); border-radius:999px; padding:7px 14px; font-size:12.5px; font-weight:600; cursor:pointer; transition:transform 160ms var(--dl-eo), border-color 150ms ease, color 150ms ease; }
.dl-chip:hover { border-color:var(--dl-rule-mid); color:var(--dl-ink); }
.dl-chip:active { transform:scale(.97); }
.dl-chip.on { background:var(--dl-ink); border-color:var(--dl-ink); color:var(--dl-paper); }
.dl-root .dl-bfeat { display:block; background:var(--dl-card); border:1px solid var(--dl-rule-soft); border-radius:16px; box-shadow:var(--dl-sh1); padding:30px 32px; margin-bottom:22px; color:var(--dl-ink); transition:transform 200ms var(--dl-eo), box-shadow 200ms var(--dl-eo); }
@media (hover:hover) { .dl-root .dl-bfeat:hover { transform:translateY(-2px); box-shadow:var(--dl-sh2); } }
.dl-bfeat h2 { font-size:27px; letter-spacing:-.02em; margin:10px 0 8px; }
.dl-bfeat p { color:var(--dl-muted); font-size:15px; max-width:70ch; }
.dl-bfeat .bm { display:flex; gap:12px; font-size:12.5px; color:var(--dl-faint); align-items:center; }
.dl-bfeat .bt { color:var(--dl-green); font-weight:700; }
.dl-bfeat .more { display:inline-block; margin-top:14px; font-size:13.5px; font-weight:700; color:var(--dl-green); }
.dl-artgrid { display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:64px; align-items:start; padding-bottom:30px; }
@media (max-width: 980px) { .dl-artgrid { grid-template-columns:1fr; gap:14px; } }
.dl-tldr { background:var(--dl-wash); border:1px solid var(--dl-ghost); border-radius:12px; padding:16px 18px; margin:20px 0 4px; font-size:14px; line-height:1.65; }
.dl-tldr b { display:block; font-size:11.5px; letter-spacing:.08em; color:var(--dl-green); margin-bottom:5px; }
.dl-tldr p { color:var(--dl-ink); margin:0; }
.dl-artbody { font-size:15.5px; line-height:1.75; color:var(--dl-muted); }
.dl-artbody p { margin:14px 0; }
.dl-artbody h2 { font-size:22px; color:var(--dl-ink); letter-spacing:-.015em; margin:34px 0 10px; }
.dl-artbody h3 { font-size:17px; color:var(--dl-ink); margin:24px 0 8px; }
.dl-artbody strong { color:var(--dl-ink); font-weight:700; }
.dl-artbody a { color:var(--dl-green); font-weight:600; text-decoration:underline; text-decoration-color:color-mix(in srgb, var(--dl-green) 35%, transparent); text-underline-offset:3px; }
.dl-artbody a:hover { text-decoration-color:var(--dl-green); }
.dl-artbody ul, .dl-artbody ol { margin:14px 0; padding-left:24px; }
.dl-artbody li { margin:7px 0; }
.dl-artbody code { font-family:ui-monospace, Menlo, monospace; font-size:.88em; background:var(--dl-card2); border:1px solid var(--dl-rule-soft); border-radius:6px; padding:1px 6px; color:var(--dl-ink); }
.dl-artbody table { width:100%; border-collapse:collapse; margin:18px 0; font-size:13.5px; display:block; overflow-x:auto; }
.dl-artbody th, .dl-artbody td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--dl-rule); white-space:nowrap; }
.dl-artbody th { color:var(--dl-ink); font-size:12px; letter-spacing:.05em; text-transform:uppercase; }
.dl-artbody td:first-child, .dl-artbody th:first-child { white-space:normal; min-width:130px; }
.dl-artbody td:nth-child(2) { color:var(--dl-green); font-weight:600; }
.dl-artfoot { display:flex; gap:18px; flex-wrap:wrap; margin-top:36px; padding-top:18px; border-top:1px solid var(--dl-rule); font-size:13.5px; font-weight:600; }
.dl-root .dl-artfoot a { color:var(--dl-green); }
.dl-artfoot .nx { margin-left:auto; }
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
.dl-sysdock { position:fixed; left:22px; bottom:22px; z-index:25; background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:999px; box-shadow:var(--dl-sh1); padding:9px 13px; font-size:12px; cursor:default; transition:border-radius 150ms cubic-bezier(0.23,1,0.32,1); }
.dl-sysdock .dots { display:flex; gap:6px; }
.dl-sysdock .rows { display:none; flex-direction:column; gap:7px; }
.dl-sysdock:hover, .dl-sysdock:focus-visible { border-radius:14px; padding:12px 16px; }
.dl-sysdock:hover .dots, .dl-sysdock:focus-visible .dots { display:none; }
.dl-sysdock:hover .rows, .dl-sysdock:focus-visible .rows { display:flex; }
.dl-sysdock .r { display:flex; align-items:center; gap:8px; }
.dl-sysdock .d { width:7px; height:7px; border-radius:50%; background:var(--dl-green); flex:none; }
.dl-sysdock .d.warn { background:var(--dl-amber); }
.dl-sysdock b { font-weight:600; }
.dl-sysdock span { color:var(--dl-faint); }
@media (max-width: 980px) { .dl-sysdock { display:none; } }
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
    ["Task limits", ["None", true], ["On some tools", ""], ["Limited free tasks", ""], ["3 tasks / hour", ""], ["None", ""]],
    ["Settings behind paywall", ["Never", true], ["Some", ""], ["Moderate & Strong compression are Pro", ""], ["Some", ""], ["None", ""]],
    ["Where files go", ["Local-first; disclosed server · Mumbai", true], ["Uploaded to their servers", ""], ["Uploaded to their servers", ""], ["Uploaded to their servers", ""], ["Stays in browser", ""]],
    ["Retention after processing", ["Zero · this tab only", true], ["Time-limited", ""], ["Time-limited", ""], ["“Deleted after 2 hours”", ""], ["n/a", ""]],
    ["Account walls", ["Never for tools", true], ["For some features", ""], ["For some features", ""], ["For some features", ""], ["None", ""]],
    ["Ads & third-party scripts", ["None", true], ["Analytics", ""], ["Analytics", ""], ["Analytics", ""], ["Analytics", ""]],
];

/* ═══════════════════════════ the component ═══════════════════════════ */

export default class DaylightSkinApp extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            ...parseHash(typeof location !== "undefined" ? location.hash : "#/"),
            themeMode: this.readTheme(),
            q: "", catFilter: "", idxView: "tiles", blogTag: "",
            palOpen: false, palQ: "", palSel: 0,
            dragging: false, dropped: null,
            toast: "",
            history: this.readHistory(),
            canInstall: false,
            isApp: typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches,
        };
        this._raf = [];
        this._timers = [];
    }

    /**
     * The document title for a route. First loads get theirs from the server's
     * SSR head injection; this is what keeps the tab honest across in-app
     * navigation. Tool pages mirror the server's pattern exactly so a client
     * nav lands on the same title a fresh load would have.
     */
    titleFor(r) {
        if (r.view === "tool") {
            const t = BY_SLUG.get(r.slug);
            if (t) return `${t.name} Online Free — No Sign Up | PrivaTools`;
            return "Tool not found · PrivaTools";
        }
        if (r.view === "blog" && r.post) {
            const post = blogPosts.find((b) => b.slug === r.post);
            if (post) return `${post.title} · PrivaTools`;
        }
        const NAMES = {
            tools: "All tools", pipeline: "Pipeline", batch: "Batch",
            mystuff: "My Stuff", vault: "Vault",
            account: r.keys ? "API keys" : "Account",
            compare: "Compare", blog: "Blog", about: "About",
            privacy: "Privacy", security: "Security & trust", terms: "Terms",
            status: "Status", support: "Support", notfound: "Page not found",
        };
        const name = NAMES[r.view];
        return name ? `${name} · PrivaTools` : "PrivaTools — Free, Open-Source Privacy-First File Tools";
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
                document.title = this.titleFor(this.state);
                this._timers.push(setTimeout(this._armReveals, 60));
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

        // PWA install. Chromium fires beforeinstallprompt when the app is
        // installable; stash it so "Install the app" can open the real prompt.
        // Safari (both platforms) never fires it — the handler falls back to
        // per-platform instructions instead of a dead button.
        this._onBip = (e) => { e.preventDefault(); this._bip = e; this.setState({ canInstall: true }); };
        this._onInstalled = () => { this._bip = null; this.setState({ canInstall: false, isApp: true }); this.say("Installed — PrivaTools now opens as its own app."); };
        window.addEventListener("beforeinstallprompt", this._onBip);
        window.addEventListener("appinstalled", this._onInstalled);

        // Scroll reveals + stat count-ups. One observer, re-armed after route
        // changes because the tree under it is replaced wholesale. Under
        // prefers-reduced-motion everything is simply visible.
        this._revealIn = (el) => {
            el.classList.add("in");
            this._io && this._io.unobserve(el);
            el.querySelectorAll("[data-count]").forEach((c) => this._countUp(c));
        };
        // Deterministic catch-up: anything at or above the fold reveals now.
        // An IntersectionObserver alone can strand content invisible — an
        // instant jump (End key, anchor, find-in-page) moves elements past
        // the viewport between frames, so no intersection ever fires.
        this._revealCatchup = () => {
            const vh = window.innerHeight;
            document.querySelectorAll(".rv:not(.in)").forEach((el) => {
                if (el.getBoundingClientRect().top < vh * 0.92) this._revealIn(el);
            });
        };
        this._armReveals = () => {
            if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
                document.querySelectorAll(".rv:not(.in)").forEach((el) => el.classList.add("in"));
                return;
            }
            if (!this._io) {
                this._io = new IntersectionObserver((entries) => {
                    for (const e of entries) if (e.isIntersecting) this._revealIn(e.target);
                }, { rootMargin: "0px 0px -6% 0px", threshold: 0.1 });
            }
            document.querySelectorAll(".rv:not(.in)").forEach((el) => this._io.observe(el));
            this._revealCatchup();
        };
        // Unthrottled on purpose: a handful of rects per page is nothing, and
        // an rAF-throttled handler starves in a hidden tab.
        this._onScrollReveal = () => this._revealCatchup();
        window.addEventListener("scroll", this._onScrollReveal, { passive: true });
        this._armReveals();

        this._depth = 0;
        // Views whose content owns drops — the real tool components, the
        // mounted house pages, the vault and account forms — handle files
        // themselves. Hijacking there would steal a drop aimed straight at a
        // dropzone; the drop-anywhere hero belongs to the browsing surfaces.
        this._dropHijackable = () => !["tool", "batch", "pipeline", "mystuff", "vault", "account"].includes(this.state.view);
        this._onDragEnter = (e) => { if (!this._dropHijackable()) return; e.preventDefault(); this._depth++; if (!this.state.dragging) this.setState({ dragging: true }); };
        this._onDragOver = (e) => e.preventDefault();
        this._onDragLeave = (e) => { if (!this._dropHijackable()) return; e.preventDefault(); this._depth = Math.max(0, this._depth - 1); if (!this._depth) this.setState({ dragging: false }); };
        this._onDrop = (e) => {
            this._depth = 0;
            if (!this._dropHijackable()) {
                if (this.state.dragging) this.setState({ dragging: false });
                // A drop the content did not claim must still never navigate
                // the tab away to the raw file.
                if (!e.defaultPrevented) e.preventDefault();
                return;
            }
            e.preventDefault();
            const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
            this.setState({ dragging: false });
            if (!files.length) return;
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

        // A path the bridge could not translate (and no hash to rescue it) is
        // a dead URL — show the 404 view instead of the homepage wearing the
        // wrong address. Deferred a tick so withPathRoutes has synced first.
        this._timers.push(setTimeout(() => {
            const path = location.pathname.replace(/\/+$/, "");
            if (!location.hash && path && this.state.view === "home") {
                this.setState({ view: "notfound" }, () => { document.title = this.titleFor(this.state); });
            }
        }, 0));

        // First mount can already be deep-linked to a tool.
        document.title = this.titleFor(this.state);
        if (this.state.view === "tool" && BY_SLUG.has(this.state.slug)) this.logHistory(this.state.slug);
    }

    componentWillUnmount() {
        if (super.componentWillUnmount) super.componentWillUnmount();
        window.removeEventListener("hashchange", this._onHash);
        window.removeEventListener("keydown", this._onKey);
        window.removeEventListener("beforeinstallprompt", this._onBip);
        window.removeEventListener("appinstalled", this._onInstalled);
        window.removeEventListener("dragenter", this._onDragEnter);
        window.removeEventListener("dragover", this._onDragOver);
        window.removeEventListener("dragleave", this._onDragLeave);
        window.removeEventListener("drop", this._onDrop);
        window.removeEventListener("scroll", this._onScrollReveal);
        this._io && this._io.disconnect();
        this._raf.forEach(cancelAnimationFrame);
        this._timers.forEach(clearTimeout);
    }

    /* ── tiny infra ── */
    say(msg) {
        // One toast system for the whole app — the same Sonner the tool UIs use.
        sonnerToast(msg);
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
                    <Tooltip><TooltipTrigger asChild><button className="dl-iconbtn" onClick={() => this.setState({ palOpen: true, palQ: "", palSel: 0 })} aria-label="Search tools">
                        <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.4" stroke="currentColor" strokeWidth="1.5" /><path d="M9.4 9.4 L12.6 12.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </button></TooltipTrigger><TooltipContent>Search — ⌘K</TooltipContent></Tooltip>
                    <a className={cn(buttonVariants({ variant: "outline" }), "dl-navcta")} href="#/account">{a.user ? "Account" : "Sign in"}</a>
                    <Tooltip><TooltipTrigger asChild><button className="dl-themebtn" onClick={this.cycleTheme} aria-label={`Theme: ${this.state.themeMode}`}>
                        {this.state.themeMode === "light"
                            ? <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="3.6" stroke="currentColor" strokeWidth="1.6" /><path d="M9 1.5 V3.5 M9 14.5 V16.5 M1.5 9 H3.5 M14.5 9 H16.5 M3.7 3.7 L5.1 5.1 M12.9 12.9 L14.3 14.3 M14.3 3.7 L12.9 5.1 M5.1 12.9 L3.7 14.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                            : this.state.themeMode === "dark"
                                ? <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M15 10.8 A6.5 6.5 0 1 1 7.2 3 A5.2 5.2 0 0 0 15 10.8 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
                                : <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.4" stroke="currentColor" strokeWidth="1.6" /><path d="M9 2.6 A6.4 6.4 0 0 1 9 15.4 Z" fill="currentColor" /></svg>}
                    </button></TooltipTrigger><TooltipContent>Theme: {this.state.themeMode} — click to cycle</TooltipContent></Tooltip>
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
                        <button type="button" className={cn(buttonVariants({ variant: "outline" }), "finstall")} onClick={this._installApp}>
                            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.5 V9 M4 6.5 L7 9.5 L10 6.5 M2 12.5 H12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Install the app
                        </button>
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
                    <span>© 2026 PrivaTools · owner-funded · no ads, no third-party scripts, no paid tier</span>
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

    /** Tick a revealed stat from 0 to its real value. The markup already
     *  holds the final number, so no-JS and reduced-motion read it as-is. */
    _countUp = (el) => {
        if (el.dataset.done) return;
        el.dataset.done = "1";
        const n = parseInt(el.dataset.count, 10);
        if (!Number.isFinite(n) || n <= 0) return;
        const t0 = performance.now();
        const tick = (t) => {
            const p = Math.min(1, (t - t0) / 700);
            const e = 1 - Math.pow(1 - p, 3);
            el.textContent = String(Math.round(n * e));
            if (p < 1) this._raf.push(requestAnimationFrame(tick));
        };
        this._raf.push(requestAnimationFrame(tick));
    };

    /** The mixins guard destructive calls with a press-twice latch; the
     *  AlertDialogs below ARE the confirmation, so arm the latch and fire. */
    _acctDeleteNow = () => { this._setAcct({ confirmingDelete: true }); this._timers.push(setTimeout(() => this._acctDelete(), 30)); };
    _vaultClearNow = () => { this._setVault({ confirmingClear: true }); this._timers.push(setTimeout(() => this._vaultClear(), 30)); };

    _installApp = async () => {
        if (this.state.isApp) { this.say("You’re already in the installed app."); return; }
        if (this._bip) {
            const prompt = this._bip;
            this._bip = null;
            this.setState({ canInstall: false });
            prompt.prompt();
            try {
                const { outcome } = await prompt.userChoice;
                if (outcome !== "accepted") { this._bip = prompt; this.setState({ canInstall: true }); }
            } catch { /* dismissed */ }
            return;
        }
        const ua = navigator.userAgent;
        if (/iPad|iPhone|iPod/.test(ua)) this.say("In Safari: tap Share, then “Add to Home Screen”.");
        else if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) this.say("In Safari: File → Add to Dock.");
        else this.say("In your browser’s menu, choose “Install PrivaTools”.");
    };

    SysDock() {
        // Collapsed to a three-dot pill so it never sits on top of content;
        // hover or keyboard focus expands the detail card in place.
        return (
            <div className="dl-sysdock" tabIndex={0}
                aria-label="Processing paths: local ready · server best effort, Mumbai · offline cached">
                <div className="dots" aria-hidden="true"><span className="d" /><span className="d warn" /><span className="d" /></div>
                <div className="rows" aria-hidden="true">
                    <div className="r"><span className="d" /><b>Local</b><span>Ready</span></div>
                    <div className="r"><span className="d warn" /><b>Server</b><span>Best effort · Mumbai, IN</span></div>
                    <div className="r"><span className="d" /><b>Offline</b><span>Cached tools ready</span></div>
                </div>
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
                            role="combobox" aria-expanded="true" aria-controls="dl-pallist" aria-activedescendant={items[sel] ? `dl-palopt-${sel}` : undefined}
                            onChange={(e) => this.setState({ palQ: e.target.value, palSel: 0 })}
                            onKeyDown={(e) => {
                                if (e.key === "ArrowDown") { e.preventDefault(); this.setState({ palSel: Math.min(sel + 1, items.length - 1) }); }
                                else if (e.key === "ArrowUp") { e.preventDefault(); this.setState({ palSel: Math.max(sel - 1, 0) }); }
                                else if (e.key === "Enter" && items[sel]) goEntry(items[sel]);
                            }} />
                        <kbd>esc</kbd>
                    </div>
                    <div className="dl-pallist" role="listbox" id="dl-pallist" aria-label="Results">
                        {items.length === 0 && <div className="dl-palempty">No tool or page matches “{this.state.palQ}”.</div>}
                        {items.map((entry, i) => {
                            const group = entry.kind === "page" ? "Pages" : entry.recent ? "Recent" : (items.some((x) => x.recent) ? "Popular" : "Tools");
                            const header = group !== lastGroup ? <div className="dl-palgroup" key={`g${i}`}>{group}</div> : null;
                            lastGroup = group;
                            return (
                                <React.Fragment key={entry.kind === "page" ? entry.hash : entry.t.slug}>
                                    {header}
                                    <div className={`dl-palitem${i === sel ? " sel" : ""}`}
                                        role="option" id={`dl-palopt-${i}`} aria-selected={i === sel}
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
                            <a className={buttonVariants()} href="#/tool/merge-pdf">Try Merge PDF</a>
                            <a className={buttonVariants({ variant: "outline" })} href="#/tools">Browse all {TOTAL}</a>
                        </div>
                        <p className="dl-hint">Or just drop a file anywhere on this page — PDFs, images, video, audio, code, archives · up to 500&nbsp;MB each</p>
                    </div>
                    <aside className="dl-receipt" aria-label="What this costs you">
                        <div className="rh">What it costs<span>Itemised</span></div>
                        {[["Price", "Free, forever"], ["Account", "None"], ["Watermarks", "None"],
                        ["Ads & 3rd-party trackers", "None"], ["Daily limits", "None"], ["Your files", "Never stored"]]
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

                <div className="dl-stats rv">
                    <div className="dl-stat"><b><span data-count={TOTAL}>{TOTAL}</span></b><span className="cap">tools, every one free</span></div>
                    <div className="dl-stat"><b><span data-count={PDF_COUNT}>{PDF_COUNT}</span></b><span className="cap">for PDF alone</span></div>
                    <div className="dl-stat"><b>0</b><span className="cap">accounts, trackers or ads</span></div>
                    <div className="dl-stat"><b><span data-count="500">500</span><small>&nbsp;MB</small></b><span className="cap">per file, every tool</span></div>
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
                    <div className="dl-ccards rv">
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
                    <div className="dl-vband rv">
                        <div>
                            <div className="dl-eyebrow">The vault</div>
                            <h2 className="dl-sec-title" style={{ fontSize: 31, marginTop: 10 }}>Your secrets, sealed on this device.</h2>
                            <p style={{ color: "var(--dl-muted)", fontSize: 15.5, maxWidth: "34em", marginTop: 12 }}>
                                A real password vault — AES-GCM under a key that never leaves this machine, for the
                                passwords your protected files need. Nothing in it ever reaches a server.
                            </p>
                            <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
                                <a className={buttonVariants()} href="#/my-stuff/vault">Open your vault</a>
                                <a className={buttonVariants({ variant: "outline" })} href="#/security">How it’s protected</a>
                            </div>
                        </div>
                        <div className="dl-vmock" aria-hidden="true">
                            <div className="vh">
                                <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><rect x="4" y="8" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M6 8 V6 A3 3 0 0 1 12 6 V8" stroke="currentColor" strokeWidth="1.5" /></svg>
                                <b>Vault</b><span>this device only</span>
                            </div>
                            <div className="vr"><Badge variant="wash">AES</Badge><b>tax-return-2026.pdf</b><span>password</span></div>
                            <div className="vr"><Badge variant="wash">AES</Badge><b>contract-final.pdf</b><span>password</span></div>
                            <div className="vr"><Badge variant="wash">AES</Badge><b>scan-archive.zip</b><span>password</span></div>
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
                    <div className="dl-claims rv">
                        {[["Your device first", "Wherever a tool can run in your browser, it does — the file never leaves your machine."],
                        ["Honest about servers", "Heavier jobs use our disclosed server — Mumbai, IN — and are deleted after use."],
                        ["No third-party code", "No CDN injects scripts into your tools. Everything is served from privatools.me."],
                        ["Works offline", "Install once as an app; cached tools keep working without a connection.", true]]
                            .map(([t, p, install]) => (
                                <div className="dl-claim" key={t}>
                                    <b><Check />{t}</b><p>{p}</p>
                                    {install && <button type="button" className="dl-claimlink" onClick={this._installApp}>Install the app →</button>}
                                </div>
                            ))}
                    </div>
                </section>

                <section className="dl-sec">
                    <div className="dl-band rv">
                        <div>
                            <h2>Privacy you can <em>watch,</em> not just trust.</h2>
                            <p className="lead">Every claim here is a behavior you can check from your own browser — no faith required.</p>
                            <a className={buttonVariants()} style={{ marginTop: 22, display: "inline-flex" }} href="#/security">Read the promises</a>
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
                        <Tabs value={idxView} onValueChange={(v) => this.setState({ idxView: v })}>
                            <TabsList className="h-9">
                                <TabsTrigger value="tiles">Tiles</TabsTrigger>
                                <TabsTrigger value="compact">Compact</TabsTrigger>
                            </TabsList>
                        </Tabs>
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
                        <Breadcrumb style={{ marginBottom: 10 }}>
                            <BreadcrumbList>
                                <BreadcrumbItem><BreadcrumbLink href="#/tools">All tools</BreadcrumbLink></BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem><BreadcrumbLink href={`#/tools?cat=${tool.category}`}>{FAMILY_LABEL[tool.category] || tool.category}</BreadcrumbLink></BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem><BreadcrumbPage>{tool.name}</BreadcrumbPage></BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                        <div className="dl-toolhead">
                            <h1>{tool.name}</h1>
                            <p className="desc">{tool.description}</p>
                            <div className="dl-tchips">
                                <Badge variant="wash" className="dl-tchip">{FAMILY_LABEL[tool.category] || tool.category}</Badge>
                                {tool.clientOnly
                                    ? <Badge variant="wash" className="dl-tchip">Runs on your device · nothing uploads</Badge>
                                    : <Badge variant="warn" className="dl-tchip">Uses our server · deleted after</Badge>}
                                <Badge variant="outline" className="dl-tchip">500 MB per file</Badge>
                                <Badge variant="outline" className="dl-tchip">No retention</Badge>
                                <Badge variant="outline" className="dl-tchip">Free, no account</Badge>
                            </div>
                        </div>
                        {/* The real run surface: the same tool component the house design mounts. */}
                        <div className="dl-toolui">{v.realToolUI}</div>
                        <p className="dl-toolfine">
                            {tool.clientOnly
                                ? "Runs entirely in your browser — this file never leaves your machine, so there is nothing for us to store."
                                : "Processed in isolated temporary storage on our disclosed server (Mumbai, IN) and deleted after the job — never on third-party clouds. The whole stack is also self-hostable on your own infrastructure."}
                        </p>
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

    HousePage(Comp, label) {
        return (
            <div className="dl-wrap dl-house">
                <React.Suspense fallback={
                    <div style={{ marginTop: 48, display: "grid", gap: 14 }} aria-label={`Loading ${label}`}>
                        <Skeleton className="h-10 w-64" />
                        <Skeleton className="h-4 w-96 max-w-full" />
                        <Skeleton className="h-40 w-full rounded-[14px]" />
                        <Skeleton className="h-40 w-full rounded-[14px]" />
                    </div>
                }>
                    <Comp />
                </React.Suspense>
            </div>
        );
    }

    NotFound() {
        return (
            <div className="dl-wrap">
                <div className="dl-pghero" style={{ paddingTop: 90, paddingBottom: 50 }}>
                    <div className="dl-eyebrow">404</div>
                    <h1>Nothing at this address.<br /><em>The tools are, though.</em></h1>
                    <p>The link may be old or mistyped. Everything the site offers is one search away — press ⌘K anywhere, or start below.</p>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
                        <a className={buttonVariants()} href="#/">Back to home</a>
                        <a className={buttonVariants({ variant: "outline" })} href="#/tools">Browse all {TOTAL} tools</a>
                    </div>
                </div>
            </div>
        );
    }

    Pipeline() { return this.HousePage(HousePipeline, "Pipeline"); }

    Batch() { return this.HousePage(HouseBatch, "Batch"); }

    MyStuff() { return this.HousePage(HouseMyStuff, "My Stuff"); }

    Vault() {
        // Everything here is driven by withVault (extension): real AES-GCM storage.
        const vlt = this.state.vlt || { entries: [], label: "", password: "", busy: false, error: "" };
        const entries = vlt.entries || [];
        return (
            <div className="dl-wrap">
                <div className="dl-heror rv rv-p">
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
                        <div className="dl-vsteps rv">
                            {[["1", "Store it once", "The password is encrypted on this device with a key that cannot be exported."],
                            ["2", "Use it without retyping", "Protect PDF and Unlock PDF can read entries directly — decrypted here, never sent."],
                            ["3", "Gone means gone", "Delete an entry, or clear your browser data, and there is no copy anywhere to recover."]]
                                .map(([n, t, d]) => (
                                    <div key={n}><i>{n}</i><b>{t}</b><p>{d}</p></div>
                                ))}
                        </div>
                        <h2 className="dl-sec-title" style={{ fontSize: 22, marginBottom: 14 }}>Stored passwords</h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {entries.length === 0
                                ? <div className="dl-empty">Nothing stored yet — add the password for a protected file on the right.</div>
                                : entries.map((en) => (
                                    <div className="dl-keyrow" key={en.id}>
                                        <Badge variant="wash">AES</Badge>
                                        <span style={{ minWidth: 0 }}>
                                            <b style={{ display: "block", fontSize: 14 }}>{en.label}</b>
                                            <code>{vlt.revealedId === en.id ? vlt.revealedValue : "••••••••••••"}</code>
                                            <span className="kd" style={{ display: "block" }}>{describeEntry(en)}</span>
                                        </span>
                                        <button className={buttonVariants({ variant: "ghost", size: "sm" })}
                                            onClick={() => this._vaultReveal(en.id)}>{vlt.revealedId === en.id ? "Hide" : "Reveal"}</button>
                                        <span style={{ display: "flex", gap: 2 }}>
                                            <button className={buttonVariants({ variant: "ghost", size: "sm" })}
                                                onClick={() => { this._vaultCopy(en.id); this.say("Copied — decrypted on this device only."); }}>Copy</button>
                                            <AlertDialog>
                                                <AlertDialogTrigger className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Delete ${en.label}`}>Delete</AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Delete “{en.label}”?</AlertDialogTitle>
                                                        <AlertDialogDescription>This entry is removed from the vault on this device. There is no copy to restore it from.</AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => this._vaultDelete(en.id)}>Delete entry</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </span>
                                    </div>
                                ))}
                        </div>
                        {entries.length > 0 && (
                            <AlertDialog>
                                <AlertDialogTrigger className={buttonVariants({ variant: "ghost", size: "sm" })} style={{ marginTop: 14 }}>
                                    Clear the vault
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Erase every stored password?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            The vault is deleted from this device. There is no copy anywhere —
                                            that is the point — so there is also no way to get them back.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Keep them</AlertDialogCancel>
                                        <AlertDialogAction onClick={this._vaultClearNow}>Erase everything</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                    </div>
                    <aside className="dl-panel">
                        <h3>Store a password</h3>
                        <form onSubmit={this._vaultAdd}>
                            <div className="dl-field">
                                <Label htmlFor="dl-vl">Name</Label>
                                <Input id="dl-vl"  value={vlt.label || ""} placeholder="e.g. tax-return-2026.pdf"
                                    onChange={(e) => this._setVault({ label: e.target.value, error: "" })} />
                            </div>
                            <div className="dl-field">
                                <Label htmlFor="dl-vp">Password</Label>
                                <Input id="dl-vp"  type="password" value={vlt.password || ""} placeholder="The password to keep"
                                    onChange={(e) => this._setVault({ password: e.target.value, error: "" })} />
                            </div>
                            <button className={buttonVariants()} style={{ width: "100%", marginTop: 6 }} disabled={vlt.busy} type="submit">
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
                            <Tabs value={a.mode === "signup" ? "signup" : "signin"}
                                onValueChange={(m) => this._setAcct({ mode: m, error: "" })}>
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="signin">Sign in</TabsTrigger>
                                    <TabsTrigger value="signup">Sign up</TabsTrigger>
                                </TabsList>
                            </Tabs>
                            {a.error && <div className="dl-err" role="alert">{a.error}</div>}
                            {a.needsEmailCode ? (
                                <form onSubmit={this._acctVerifyEmail}>
                                    <p style={{ fontSize: 13.5, color: "var(--dl-muted)" }}>We emailed a code to <b>{a.email}</b>. Enter it to finish signing up.</p>
                                    <div className="dl-field">
                                        <Label htmlFor="dl-code">Email code</Label>
                                        <Input id="dl-code"  value={a.emailCode}
                                            onChange={(e) => this._setAcct({ emailCode: e.target.value, error: "" })} autoComplete="one-time-code" />
                                    </div>
                                    <button className={buttonVariants()} style={{ width: "100%" }} disabled={a.busy} type="submit">
                                        {a.busy ? "Checking…" : "Verify"}
                                    </button>
                                </form>
                            ) : (
                                <form onSubmit={this._acctSubmit}>
                                    <div className="dl-field">
                                        <Label htmlFor="dl-email">Email</Label>
                                        <Input id="dl-email"  type="email" required value={a.email}
                                            onChange={(e) => this._setAcct({ email: e.target.value, error: "" })} autoComplete="email" />
                                    </div>
                                    {a.mode === "recover" && (
                                        <div className="dl-field">
                                            <Label htmlFor="dl-rec">Recovery code</Label>
                                            <Input id="dl-rec"  required value={acctRecoveryInput}
                                                onChange={(e) => this._setAcct({ recoveryInput: e.target.value, error: "" })} />
                                            <span className="dl-hintl">The code shown once at signup — it’s the only way back in.</span>
                                        </div>
                                    )}
                                    <div className="dl-field">
                                        <Label htmlFor="dl-pass">{a.mode === "recover" ? "New password" : "Password"}</Label>
                                        <Input id="dl-pass"  type={a.showPassword ? "text" : "password"} required
                                            minLength={a.mode === "signin" ? undefined : MIN_PASSWORD_LENGTH}
                                            value={a.password}
                                            onChange={(e) => this._setAcct({ password: e.target.value, error: "" })}
                                            autoComplete={a.mode === "signin" ? "current-password" : "new-password"} />
                                        <Label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--dl-muted)", fontWeight: 500 }}>
                                            <input type="checkbox" checked={!!a.showPassword}
                                                onChange={(e) => this._setAcct({ showPassword: e.target.checked })} /> Show password
                                        </Label>
                                        {strength && <span className="dl-hintl">Strength: {strength.label}</span>}
                                    </div>
                                    <button className={buttonVariants()} style={{ width: "100%" }} disabled={a.busy} type="submit">
                                        {a.busy ? "Working…" : a.mode === "signup" ? "Create account" : a.mode === "recover" ? "Reset password" : "Sign in"}
                                    </button>
                                </form>
                            )}
                            {a.mode !== "recover" && !a.needsEmailCode && (
                                <button className={buttonVariants({ variant: "ghost", size: "sm" })} style={{ marginTop: 4 }} onClick={acctShowRecover}>
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
                            <button className={buttonVariants({ variant: "outline", size: "sm" })} onClick={acctCopyRecovery}>
                                {a.recoverySaved ? "Copied ✓" : "Copy code"}
                            </button>
                            <button className={buttonVariants({ variant: "outline", size: "sm" })} onClick={acctDownloadRecovery}>Download as file</button>
                            <button className={buttonVariants({ size: "sm" })} onClick={acctAckRecovery}>I’ve saved it</button>
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
                        <button className={buttonVariants({ variant: "outline", size: "sm" })} onClick={this._acctNewKey}>Create key</button>
                        <button className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={this._acctSignOut}>Sign out</button>
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
                            <div className="dl-keyrow" key={k.key_id}>
                                <Badge variant="wash">KEY</Badge>
                                <code>{describeKey(k)}</code>
                                <span className="kd">{k.label}</span>
                                <button className={buttonVariants({ variant: "ghost", size: "sm" })}
                                    onClick={() => this._acctRevoke(k.key_id)}>Revoke</button>
                            </div>
                        ))}
                </div>
                <div className="dl-panel" style={{ maxWidth: 640, marginTop: 40 }}>
                    <h3>Recovery code</h3>
                    <p style={{ fontSize: 13.5, color: "var(--dl-muted)" }}>
                        Mislaid your code? You can replace it — the old one stops working the moment a new one is issued.
                    </p>
                    {!a.rotating ? (
                        <button className={buttonVariants({ variant: "outline", size: "sm" })} style={{ marginTop: 12 }} onClick={acctToggleRotate}>
                            Replace my recovery code
                        </button>
                    ) : (
                        <form onSubmit={this._acctRotate}>
                            <div className="dl-field">
                                <Label htmlFor="dl-rotp">Confirm your password</Label>
                                <Input id="dl-rotp"  type="password" required value={a.rotatePassword}
                                    onChange={acctSetRotatePassword} autoComplete="current-password" />
                                <span className="dl-hintl">Required so a stolen session alone can’t mint a code that outlives a password change.</span>
                            </div>
                            <div style={{ display: "flex", gap: 10 }}>
                                <button className={buttonVariants({ size: "sm" })} disabled={a.busy} type="submit">
                                    {a.busy ? "Working…" : "Issue new code"}
                                </button>
                                <button className={buttonVariants({ variant: "ghost", size: "sm" })} type="button" onClick={acctToggleRotate}>Cancel</button>
                            </div>
                        </form>
                    )}
                </div>
                <div className="dl-panel" style={{ maxWidth: 640, marginTop: 22, borderColor: "color-mix(in srgb, var(--dl-red) 35%, transparent)" }}>
                    <h3>Delete this account</h3>
                    <p style={{ fontSize: 13.5, color: "var(--dl-muted)" }}>
                        Removes the account and revokes every API key immediately. Your files were never
                        stored, so there is nothing else to erase.
                    </p>
                    <AlertDialog>
                        <AlertDialogTrigger className={buttonVariants({ variant: "outline", size: "sm" })} style={{ marginTop: 12, color: "var(--dl-red)" }} disabled={a.busy}>
                            Delete account
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete this account for good?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    The account and every API key are removed immediately. Your files were
                                    never stored, so there is nothing else to erase — and nothing to recover.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Keep my account</AlertDialogCancel>
                                <AlertDialogAction onClick={this._acctDeleteNow}>Delete for good</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
        );
    }

    /* ── trust / security ── */

    Security() {
        return (
            <div className="dl-wrap">
                <div className="dl-heror rv rv-p">
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
                        ["There is nothing to sign up for to use a tool, no third-party script watching you, and nothing to sell. The site is owner-funded. Your history — kept on your device — records tool and time only, never files or filenames."]]]
                        .map(([h, how, ps]) => (
                            <div className="dl-promise" key={h}>
                                <div><h3>{h}</h3><div className="how">{how}</div></div>
                                <div>{ps.map((p, i) => <p key={i}>{p}</p>)}</div>
                            </div>
                        ))}
                </div>
                <section className="dl-sec rv" style={{ paddingTop: 64 }}>
                    <div className="dl-sec-head"><div><h2 className="dl-sec-title">Where we’re not perfect</h2><p className="dl-sec-sub">Said plainly, because that’s the point</p></div></div>
                    <Accordion type="single" collapsible className="dl-acc">
                        <AccordionItem value="models">
                            <AccordionTrigger>Some on-device AI tools download their models from a CDN</AccordionTrigger>
                            <AccordionContent>Background removal and similar tools fetch model weights — not your files — on first use, disclosed in the privacy policy. Your document still never leaves the browser.</AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="server">
                            <AccordionTrigger>Server tools mean trusting our server</AccordionTrigger>
                            <AccordionContent>For those tools, “deleted after use” is our promise, not something your network tab can prove. If a document is too sensitive for that, use a local-only tool — the chip tells you which is which.</AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="besteffort">
                            <AccordionTrigger>One server, best effort — no failover</AccordionTrigger>
                            <AccordionContent>Server-backed tools run on a single disclosed machine in Mumbai. If it’s down, they’re down until it’s fixed — the status page will say so honestly, and every local tool keeps working.</AccordionContent>
                        </AccordionItem>
                    </Accordion>
                    <div className="dl-reprow">
                        <div>
                            <b>Found a security issue?</b>
                            <p>Straight to the owner, no triage queue. Our disclosure policy lives at <a href="/.well-known/security.txt">security.txt</a>.</p>
                        </div>
                        <a className={buttonVariants({ variant: "outline" })} href="mailto:hello@privatools.me?subject=Security%20report">Report a vulnerability</a>
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
                <section className="dl-sec" style={{ paddingTop: 60, paddingBottom: 8 }}>
                    <div className="dl-sec-head"><div>
                        <h2 className="dl-sec-title">The long-form breakdowns</h2>
                        <p className="dl-sec-sub">One honest deep-dive per competitor — their strengths included</p>
                    </div></div>
                    <div className="dl-bgrid" style={{ paddingTop: 8 }}>
                        {["privatools-vs-ilovepdf", "privatools-vs-smallpdf", "privatools-vs-sejda", "privatools-vs-ihatepdf"].map((sl) => {
                            const b = blogPosts.find((x) => x.slug === sl);
                            return b && (
                                <a key={sl} className="dl-bpost" href={`#/blog/${sl}`}>
                                    <div className="bm"><span className="bt">{b.tags[0]}</span><span>{fmtDate(b.publishedAt)}</span><span>{b.readTime}</span></div>
                                    <h3>{b.title}</h3>
                                    <p>{b.description}</p>
                                </a>
                            );
                        })}
                    </div>
                </section>
            </div>
        );
    }

    Blog() {
        const post = blogPosts.find((b) => b.slug === this.state.post);
        if (post) {
            const related = (post.relatedTools || []).map((sl) => BY_SLUG.get(sl)).filter(Boolean);
            const i = POSTS_NEWEST.indexOf(post);
            const newer = POSTS_NEWEST[i - 1];
            const older = POSTS_NEWEST[i + 1];
            return (
                <div className="dl-wrap">
                    <Breadcrumb style={{ paddingTop: 36 }}>
                        <BreadcrumbList>
                            <BreadcrumbItem><BreadcrumbLink href="#/blog">Blog</BreadcrumbLink></BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem><BreadcrumbPage>{post.title}</BreadcrumbPage></BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                    <div className="dl-artgrid">
                        <article className="dl-article">
                            <div className="dl-eyebrow">{post.tags[0]}</div>
                            <h1>{post.title}</h1>
                            <div className="am">{fmtDate(post.publishedAt)} · {post.readTime} · {post.author || "Lakshya Lodha"}</div>
                            {post.tldr && <div className="dl-tldr"><b>TL;DR</b><p>{post.tldr}</p></div>}
                            {/* Our own authored HTML from src/data/blog.ts — the same body the
                                server injects for crawlers, so what Google reads is what people see. */}
                            <div className="dl-artbody" dangerouslySetInnerHTML={{ __html: post.body }} />
                            <div className="dl-artfoot">
                                {older && <a href={`#/blog/${older.slug}`}>← {older.title}</a>}
                                {newer && <a className="nx" href={`#/blog/${newer.slug}`}>{newer.title} →</a>}
                            </div>
                        </article>
                        <aside className="dl-proserail">
                            {related.length > 0 && (
                                <div className="dl-panel dl-facts">
                                    <h3>Tools in this guide</h3>
                                    <p className="fine">Every one free — no account, no caps.</p>
                                    {related.map((t) => <a key={t.slug} className={buttonVariants({ variant: "outline" })} href={`#/tool/${t.slug}`}>{t.name} →</a>)}
                                </div>
                            )}
                            <div className="dl-panel dl-facts">
                                <h3>Verify, don’t trust</h3>
                                <p className="fine">Claims in our posts come with checks you can run yourself.</p>
                                <a className={buttonVariants({ variant: "outline" })} href="#/security">The 60-second test →</a>
                            </div>
                        </aside>
                    </div>
                </div>
            );
        }

        const counts = {};
        for (const b of blogPosts) for (const t of b.tags) counts[t] = (counts[t] || 0) + 1;
        const TAGS = Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, 7).map(([t]) => t);
        const tag = this.state.blogTag;
        const posts = tag ? POSTS_NEWEST.filter((b) => b.tags.includes(tag)) : POSTS_NEWEST;
        const [feat, ...rest] = posts;
        return (
            <div className="dl-wrap">
                <div className="dl-pghero">
                    <div className="dl-eyebrow">Notes &amp; guides</div>
                    <h1>The blog</h1>
                    <p>Short, technical, honest — how private file handling actually works, from the people building it. {blogPosts.length} posts and counting.</p>
                </div>
                <div className="dl-btags" role="group" aria-label="Filter posts by topic">
                    <button className={`dl-chip${tag === "" ? " on" : ""}`} onClick={() => this.setState({ blogTag: "" })}>All · {blogPosts.length}</button>
                    {TAGS.map((t) => (
                        <button key={t} className={`dl-chip${tag === t ? " on" : ""}`} onClick={() => this.setState({ blogTag: tag === t ? "" : t })}>{t} · {counts[t]}</button>
                    ))}
                </div>
                {feat && (
                    <a className="dl-bfeat" href={`#/blog/${feat.slug}`}>
                        <div className="bm"><span className="bt">{feat.tags[0]}</span><span>{fmtDate(feat.publishedAt)}</span><span>{feat.readTime}</span></div>
                        <h2>{feat.title}</h2>
                        <p>{feat.description}</p>
                        <span className="more">Read the post →</span>
                    </a>
                )}
                <div className="dl-bgrid">
                    {rest.map((b) => (
                        <a key={b.slug} className="dl-bpost" href={`#/blog/${b.slug}`}>
                            <div className="bm"><span className="bt">{b.tags[0]}</span><span>{fmtDate(b.publishedAt)}</span><span>{b.readTime}</span></div>
                            <h3>{b.title}</h3>
                            <p>{b.description}</p>
                        </a>
                    ))}
                </div>
            </div>
        );
    }

    Doc(title, eyebrow, sections, rail) {
        return (
            <div className="dl-wrap">
                <div className="dl-pghero rv rv-p">
                    <div className="dl-eyebrow">{eyebrow}</div>
                    <h1>{title}</h1>
                </div>
                <div className={rail ? "dl-prosegrid" : undefined}>
                    <div className="dl-doc rv rv-p" data-d="1">
                        {sections.map(([h, body]) => (
                            <React.Fragment key={h}>
                                <h2 id={h.toLowerCase().replace(/[^a-z0-9]+/g, "-")}>{h}</h2>
                                {Array.isArray(body)
                                    ? <ul className="dl-doclist">{body.map((li) => <li key={li}>{li}</li>)}</ul>
                                    : <p>{body}</p>}
                            </React.Fragment>
                        ))}
                    </div>
                    {rail && <aside className="dl-proserail rv rv-p" data-d="2">{rail}</aside>}
                </div>
            </div>
        );
    }

    /** A quiet fact card for the prose pages' rail. */
    Facts(title, rows) {
        return (
            <div className="dl-panel dl-facts">
                <h3>{title}</h3>
                {rows.map(([k, v]) => (
                    <div className="dl-factr" key={k}><span>{k}</span><b>{v}</b></div>
                ))}
            </div>
        );
    }

    About() {
        return this.Doc("About", "What this is", [
            ["The short version", `PrivaTools is ${TOTAL} file tools built on one rule: your documents are yours. Wherever a tool can run in your browser, it does; when a server is needed, it says so first, and deletes everything after use.`],
            ["Who pays for it", "The owner. There are no ads, no trackers, no premium tier and no investors to satisfy — which is why there is nothing on this site that tries to convert you into anything."],
            ["Where things run", "The site and its processing run from our disclosed server in Mumbai, India. Most tools never touch it — they run entirely on your device."],
            ["The rule we build by", "If a job can run on your device, it must. The server is a fallback we disclose, never a default we hide — and every promise on this site is written so you can check it yourself."],
        ], <>
            {this.Facts("At a glance", [
                ["Tools", `${TOTAL}`],
                ["Runs", "Browser-first"],
                ["Server", "Mumbai, IN"],
                ["Funding", "Owner"],
                ["Accounts", "API only"],
                ["Price", "Free"],
            ])}
            <div className="dl-panel dl-facts">
                <h3>Check the claims</h3>
                <p className="fine">Nothing here asks to be believed.</p>
                <a className={buttonVariants({ variant: "outline" })} href="#/security">How to verify →</a>
                <a className={buttonVariants({ variant: "outline" })} href="#/compare">Against the others →</a>
            </div>
        </>);
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
        ], <>
            {this.Facts("Where your file goes", [
                ["Local tools", "Nowhere"],
                ["Server tools", "Mumbai, IN"],
                ["Kept for", "The job only"],
                ["Copies", "None"],
                ["3rd-party trackers", "None"],
            ])}
            <div className="dl-panel dl-facts">
                <h3>Don’t take our word</h3>
                <p className="fine">Every claim here has a check you can run from your own browser.</p>
                <a className={buttonVariants({ variant: "outline" })} href="#/security">Verify it yourself →</a>
            </div>
        </>);
    }

    Terms() {
        return this.Doc("Terms", "Legal", [
            ["The service", "PrivaTools provides file utilities free of charge, without accounts, for lawful personal and commercial use. The service is provided as-is, without warranty; verify important results before relying on them."],
            ["Acceptable use", "Don’t use the tools to process content you have no right to process, and don’t attempt to disrupt the service for others."],
            ["Liability", "To the maximum extent permitted by law, we are not liable for losses arising from use of the service. Your sole remedy is to stop using it — which costs nothing, because so does using it."],
        ], <>
            {this.Facts("In plain words", [
                ["Cost", "Free"],
                ["Use", "Personal & commercial"],
                ["Warranty", "None — verify results"],
                ["Your files", "Yours, always"],
            ])}
            <div className="dl-panel dl-facts">
                <h3>Something unclear?</h3>
                <p className="fine">A person reads every message.</p>
                <a className={buttonVariants({ variant: "outline" })} href="#/support">Ask on Support →</a>
            </div>
        </>);
    }

    Status() { return this.HousePage(HouseStatus, "Status"); }

    Support() {
        return (
            <div className="dl-wrap">
                <div className="dl-pghero rv rv-p">
                    <div className="dl-eyebrow">Support</div>
                    <h1>A person reads this.<br /><em>Really.</em></h1>
                    <p>Owner-funded means owner-answered. No ticket deflection, no chatbot maze — say what broke or what’s missing and it gets read.</p>
                    <div className="dl-supcta">
                        <a className={buttonVariants()} href="mailto:hello@privatools.me">Email hello@privatools.me</a>
                        <span>Straight to the owner’s inbox — replies in days, not ticket queues.</span>
                    </div>
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
                                                                        : view === "notfound" ? this.NotFound()
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
            </div>
        );
    }
}
