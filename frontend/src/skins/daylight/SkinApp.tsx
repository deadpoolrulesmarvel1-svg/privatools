/* eslint-disable */
// @ts-nocheck
import { passkeysSupported } from "@/lib/clerk/accountApi";
import ApiActivity from "@/components/account/ApiActivity";
import AccountWorkspaceHeader from "@/components/account/AccountWorkspaceHeader";
import { accountsConfigured, usernameAccountsEnabled, passkeyAccountsEnabled } from "@/lib/auth-mode";
import { canonicalPath, currentRoute, navigateTo } from "@/lib/navigation";
import { toolSeo } from "@/lib/tool-seo";
/**
 * Consumer application shell. Catalogue and counts derive from the registries.
 * withRealTools mounts the existing processing components; withVault and
 * withAccounts retain the existing state and persistence contracts.
 * Public paths determine the shell's active view.
 * The approved Home, navigation and search live in ./consumer.
 */
import React from "react";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import {
    ACCOUNT_COPY, MIN_PASSWORD_LENGTH, SOCIAL_SIGN_IN, EMAIL_RESET, describeKey, strengthOf,
} from "../accountLogic";
import { describeEntry, vaultApi } from "../vaultLogic";
import { readThemeChoice, resolveTheme, setThemeChoice, watchThemeChoice } from "@/lib/skinTheme";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AiHubDialog } from "@/components/byok/AiHubDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast as sonnerToast } from "sonner";
import { ConsumerHome } from "./consumer/ConsumerHome";
import { ConsumerHeader, ConsumerTabBar, ConsumerSearch, ConsumerLogo, FavoriteButton } from "./consumer/ConsumerChrome";
import consumerCSS from "./consumer/consumer.css?inline";
import { ExperienceShell, AppearanceControls } from "../experience/ExperienceShell";
import { ExperienceHome } from "../experience/ExperienceHome";
import { ToolWorkspace } from "../experience/ToolWorkspace";
import { CatalogStudio, AboutStudio, SupportStudio, MissingStudio } from "../experience/ContentStudio";
import experienceCSS from "../experience/experience.css?inline";
import { cn } from "@/lib/utils";
import { ToolFaq } from "@/components/ToolFaq";

/* Purpose-built product pages retain their processing controllers and persistence. */
const HousePipeline = React.lazy(() => import("@/pages/PipelinePage"));
const HouseBatch = React.lazy(() => import("@/pages/BatchPage"));
const HouseMyStuff = React.lazy(() => import("@/pages/MyStuffPage"));
const HouseStatus = React.lazy(() => import("@/pages/StatusPage"));
const HouseCompare = React.lazy(() => import("@/pages/ComparePage"));
const HouseAi = React.lazy(() => import("@/pages/AiPage"));
const HouseApi = React.lazy(() => import("@/pages/ApiPage"));
const HouseSettings = React.lazy(() => import("@/pages/AccountSettingsPage"));
const HouseTrust = React.lazy(() => import("../experience/TrustCenter"));
const HousePrivacy = React.lazy(() => import("@/pages/PrivacyPage"));
const HouseTerms = React.lazy(() => import("@/pages/TermsPage"));
const HouseSecurity = React.lazy(() => import("@/pages/SecurityPage"));

/* The journal and article titles read data/blog.ts, every article's HTML, so
   only blog routes load it. Everywhere else, including tool pages, stays
   without it (src/test/blog-module-boundary.test.ts). */
const GuidesStudio = React.lazy(() => import("../experience/GuidesStudio"));
let postTitles = null;
const loadPostTitles = () => import("@/data/blog").then(({ blogPosts }) => {
    postTitles = new Map(blogPosts.map((post) => [post.slug, post.title]));
});

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
 * Public path → view. Exported for the unit test.
 *
 * Also accepts legacy hash links. `/tools/<slug>` — the non-PDF tool path —
 * folds into the same tool view as `/tool/<slug>`.
 */
export function parseRoute(route) {
    const href = (route || "/").replace(/^#\/?/, "/").split("#", 1)[0];
    const queryIndex = href.indexOf("?");
    const path = queryIndex < 0 ? href : href.slice(0, queryIndex);
    const query = queryIndex < 0 ? "" : href.slice(queryIndex + 1);
    const seg = path.replace(/\/+$/, "").split("/").filter(Boolean);
    const cat = new URLSearchParams(query).get("cat") || "";

    if (seg.length === 0) return { view: "home" };
    if (seg[0] === "tool" && seg[1]) return { view: "tool", slug: seg.slice(1).join("/") };
    if (seg[0] === "tool") return { view: "tools", cat: "" };
    if (seg[0] === "tools" && seg[1]) return { view: "tool", slug: seg.slice(1).join("/") };
    if (seg[0] === "tools") return { view: "tools", cat };
    if (seg[0] === "my-stuff" && seg[1] === "vault") return { view: "vault" };
    if (seg[0] === "my-stuff") return { view: "mystuff" };
    if (seg[0] === "account" && seg[1] === "settings") return { view: "settings" };
    if (seg[0] === "account") return { view: "account", keys: seg[1] === "keys", ...(["sign-in", "sign-up"].includes(seg[1]) ? { authMode: seg[1] === "sign-up" ? "signup" : "signin" } : {}) };
    if (seg[0] === "settings") return { view: "settings" };
    if (seg[0] === "blog" && seg[1]) return { view: "blog", post: seg[1] };
    if (seg[0] === "blog") return { view: "blog", post: "" };
    if (seg[0] === "compare") return { view: "compare", competitor: seg[1] || "" };
    if (seg[0] === "security") return { view: "security" };
    const SIMPLE = ["pipeline", "batch", "compare", "about", "privacy", "terms", "status", "support", "ai", "api", "trust"];
    if (SIMPLE.includes(seg[0])) return { view: seg[0] };
    return { view: "notfound" };
}

export const parseHash = parseRoute;

const go = (href) => navigateTo(href);

const fmtDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]} ${d}, ${y}`;
};

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
const SOCIAL_ICONS = {
    google: (
        <svg viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
        </svg>
    ),
    github: (
        <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
    ),
};

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

/* Midnight — a true-black variant of dark: same accents, OLED surfaces. */
[data-theme="midnight"] .dl-root {
  --dl-paper:#000000; --dl-card:#0A0A0D; --dl-card2:#101014;
  --dl-ink:#F2F3F5; --dl-muted:#A6ACB3; --dl-faint:#787E85;
  --dl-rule:#1E1E24; --dl-rule-soft:#141419; --dl-rule-mid:#34343C;
  --dl-green:#3EE39C; --dl-green-deep:#6FEAB8; --dl-wash:#0E2A1E; --dl-ghost:#123526;
  --dl-amber:#E0AC41; --dl-amber-wash:#2A2109; --dl-red:#E86C61;
  --dl-on-accent:#06130C;
  --dl-band:#000000; --dl-band-ink:#F2F5F0; --dl-band-muted:#9AA19B; --dl-band-green:#3EE39C;
  --dl-sh1:0 1px 2px rgba(0,0,0,.6), 0 10px 28px -16px rgba(0,0,0,.85);
  --dl-sh2:0 2px 6px rgba(0,0,0,.65), 0 24px 56px -20px rgba(0,0,0,.9);
}
[data-theme="midnight"] .dl-band { border:1px solid var(--dl-rule); }
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
:where(.dl-root h1, .dl-root h2, .dl-root h3, .dl-root p, .dl-root ul, .dl-root figure) { margin:0; }
.dl-root button { font-family:inherit; cursor:pointer; }
/* Strips the design's default button chrome from buttons that should read as
   plain text. Every dl- control styles itself, so the whole family is exempt:
   this rule's specificity (0,4,1) silently beat all of them, which is why the
   filter chips had no pills and the social buttons no brand fill. */

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
.dl-root .dl-aibtn { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; font-size:13px; font-weight:650; border-radius:999px; flex:none; color:var(--dl-green-deep); background:var(--dl-wash); border:1px solid color-mix(in srgb, var(--dl-green) 45%, transparent); cursor:pointer; transition:transform 160ms cubic-bezier(0.23,1,0.32,1), background-color 160ms ease, border-color 160ms ease; }
.dl-root .dl-aibtn:hover { background:color-mix(in srgb, var(--dl-green) 22%, var(--dl-paper)); border-color:var(--dl-green); }
.dl-root .dl-aibtn:active { transform:scale(0.97); }
@media (max-width: 520px) { .dl-root .dl-aibtn { padding:8px 11px; } }
.dl-iconbtn { display:none; background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:999px; width:38px; height:38px; align-items:center; justify-content:center; flex:none; color:inherit; }
.dl-themebtn { background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:999px; width:38px; height:38px; display:flex; align-items:center; justify-content:center; flex:none; color:inherit; }
@media (max-width: 1120px) { .dl-links { display:none; } .dl-searchpill { display:none; } .dl-iconbtn { display:flex; margin-left:auto; } }
@media (max-width: 640px) { .dl-navcta { display:none; } }

/* hero */
.dl-root .dl-herobadge { margin-bottom:4px; font-weight:600; }
.dl-hero { display:grid; grid-template-columns:minmax(0,1.12fr) 340px; gap:64px; align-items:center; padding:80px 0 0; position:relative; }
.dl-hero::before { content:""; position:absolute; top:-120px; left:-160px; width:640px; height:520px; border-radius:50%; background:radial-gradient(closest-side, color-mix(in srgb, var(--dl-green) 9%, transparent), transparent 72%); pointer-events:none; }
.dl-hero > * { position:relative; }
@media (max-width: 1020px) { .dl-hero { grid-template-columns:1fr; gap:30px; padding-top:44px; } }
.dl-hero h1 { font-weight:700; font-size:clamp(50px, 6vw, 84px); line-height:1.02; letter-spacing:-.024em; margin:18px 0 22px; }
.dl-hero h1 em { font-style:normal; color:var(--dl-green); }
.dl-hero .sub { font-size:18px; color:var(--dl-muted); max-width:33em; margin-bottom:26px; }
.dl-hint { font-size:13px; color:var(--dl-faint); margin-top:16px; }
.dl-receipt { background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:18px; box-shadow:var(--dl-sh2); padding:24px 26px 20px; display:flex; flex-direction:column; transition:transform 220ms var(--dl-eo), box-shadow 220ms var(--dl-eo); }
@media (hover:hover) { .dl-receipt:hover { transform:translateY(-3px); } }
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

.dl-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); margin-top:64px; border:1px solid var(--dl-rule-soft); border-radius:16px; background:var(--dl-card); box-shadow:var(--dl-sh1); overflow:hidden; }
.dl-stat { display:flex; flex-direction:column; gap:6px; padding:22px 26px 20px; border-left:1px solid var(--dl-rule); }
.dl-stat:first-child { border-left:0; }
@media (max-width: 800px) {
  .dl-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .dl-stat { padding:18px 20px 16px; }
  .dl-stat:nth-child(3) { border-left:0; }
  .dl-stat:nth-child(n+3) { border-top:1px solid var(--dl-rule); }
}
.dl-stat b { font-weight:750; font-size:clamp(30px, 3vw, 40px); letter-spacing:-.03em; line-height:1.1; font-variant-numeric:tabular-nums; }
.dl-stat b small { font-size:.45em; font-weight:700; }
.dl-stat .cap { font-size:11px; font-weight:650; letter-spacing:0.07em; text-transform:uppercase; color:var(--dl-muted); }

.dl-grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:13px; }
@media (max-width: 980px) { .dl-grid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
@media (max-width: 560px) { .dl-grid { grid-template-columns:1fr; } }
.dl-root .dl-card { background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:14px; padding:18px 20px;
  display:flex; flex-direction:column; gap:7px; color:var(--dl-ink); position:relative; transition:transform 180ms var(--dl-eo), box-shadow .18s, border-color .18s; }
@media (hover:hover) and (pointer:fine) {
  .dl-root .dl-card:hover { transform:translateY(-2px); box-shadow:var(--dl-sh2); border-color:var(--dl-rule-mid); color:var(--dl-ink); }
  .dl-root .dl-card:active { transform:translateY(0) scale(0.988); }
  .dl-root .dl-ccard:active { transform:translateY(0) scale(0.988); }
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

.dl-whypanel { border:1px solid var(--dl-rule-soft); border-radius:16px; background:var(--dl-card); box-shadow:var(--dl-sh1); overflow:hidden; }
.dl-whypanel .row { display:grid; grid-template-columns:minmax(0,0.9fr) minmax(0,1.6fr); gap:10px 48px; padding:24px 30px; border-top:1px solid var(--dl-rule); align-items:start; }
.dl-whypanel .row:first-child { border-top:0; }
@media (max-width: 800px) { .dl-whypanel .row { grid-template-columns:1fr; padding:20px 22px; } }
.dl-whypanel .usual { font-size:14px; font-weight:550; color:var(--dl-faint); text-decoration:line-through; text-decoration-color:var(--dl-red); text-decoration-thickness:1.5px; padding-top:2px; }
.dl-whypanel b { font-size:15.5px; font-weight:700; letter-spacing:-.01em; }
.dl-whypanel p { font-size:13.5px; color:var(--dl-muted); line-height:1.6; margin-top:5px; max-width:46em; }

.dl-claims { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:0 28px; border-top:1px solid var(--dl-rule); padding-top:28px; }
@media (max-width: 900px) { .dl-claims { grid-template-columns:repeat(2, minmax(0,1fr)); gap:22px 28px; } }
.dl-claim b { display:flex; align-items:center; gap:8px; font-size:14.5px; font-weight:600; color:var(--dl-ink); }
.dl-claim b svg { color:var(--dl-green); }
.dl-claim p { font-size:13px; color:var(--dl-muted); line-height:1.55; margin-top:5px; }

.dl-band { background:var(--dl-band); color:var(--dl-band-ink); border-radius:22px; padding:52px; display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); gap:52px; position:relative; overflow:hidden; }
.dl-band::after { content:""; position:absolute; top:-40%; right:-12%; width:60%; height:120%; background:radial-gradient(closest-side, color-mix(in srgb, var(--dl-band-green) 13%, transparent), transparent 70%); pointer-events:none; }
@media (max-width: 980px) { .dl-band { grid-template-columns:1fr; padding:36px 28px; } }
.dl-band h2 { font-weight:700; font-size:33px; letter-spacing:-.022em; line-height:1.08; color:var(--dl-band-ink); }
.dl-band h2 em { font-style:normal; color:var(--dl-band-green); }
.dl-band .lead { color:var(--dl-band-muted); font-size:15px; margin-top:14px; max-width:30em; }
.dl-step { display:flex; gap:16px; padding:16px 0; border-top:1px solid rgba(255,255,255,.1); }
.dl-step:first-child { border-top:0; padding-top:0; }
.dl-step .dot { flex:none; width:32px; height:32px; border-radius:10px; background:color-mix(in srgb, var(--dl-band-green) 14%, transparent); display:flex; align-items:center; justify-content:center; color:var(--dl-band-green); }
.dl-step b { font-size:15px; font-weight:600; display:block; margin-bottom:2px; color:var(--dl-band-ink); }
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
.dl-root .dl-social-links { display:flex; gap:18px; margin-top:18px; flex-wrap:wrap; }
.dl-root .dl-social-links a { display:inline-flex; align-items:center; gap:7px; font-size:13px; color:var(--dl-muted); font-weight:500; transition:color 160ms ease; }
.dl-root .dl-social-links a:hover { color:var(--dl-ink); }
.dl-root .dl-social-links svg { width:14px; height:14px; flex:none; }
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
@media (max-width: 760px) {
  .dl-idxmeta { gap:10px; }
  /* index.css sets scrollbar-width:thin on every element via
     :root:not([data-skin]) *, which outranks a single class. */
  .dl-root .dl-idxmeta .dl-chips { scrollbar-width:none; }
  .dl-chips { flex:1 1 100%; flex-wrap:nowrap; overflow-x:auto; -ms-overflow-style:none;
              scroll-snap-type:x proximity; margin:0 -32px; padding:2px 32px; }
  .dl-chips::-webkit-scrollbar { display:none; }
  .dl-chip { flex:none; scroll-snap-align:start; }
  .dl-count { margin-left:0; }
}
.dl-catsec { padding-top:10px; padding-bottom:30px; }
.dl-catsec h2 { font-weight:700; font-size:19px; letter-spacing:-.01em; display:flex; align-items:center; gap:11px; padding-bottom:12px; border-bottom:2px solid color-mix(in srgb, var(--dl-cc) 32%, var(--dl-rule)); }
.dl-catsec h2 .ic { width:30px; height:30px; border-radius:9px; background:color-mix(in srgb, var(--dl-cc) 13%, var(--dl-card)); display:flex; align-items:center; justify-content:center; color:var(--dl-cc); }
.dl-catsec h2 .n { font-size:12.5px; color:var(--dl-faint); font-weight:500; margin-left:auto; }
.dl-tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(216px, 1fr)); gap:10px; padding-top:14px; }
.dl-root .dl-tile { display:flex; gap:12px; align-items:flex-start; background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh1); border-radius:13px; padding:14px 15px; color:var(--dl-ink); transition:transform 170ms var(--dl-eo), box-shadow .16s, border-color .16s; }
.dl-root .dl-tile b { font-size:14.5px; font-weight:650; letter-spacing:-.01em; }
.dl-root .dl-tile p { font-size:12.5px; line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
@media (hover:hover) { .dl-root .dl-tile:hover { border-color:color-mix(in srgb, var(--dl-cc, var(--dl-green)) 45%, var(--dl-rule)); } }
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
.dl-toolfine { margin:24px 2px 0; padding-top:14px; border-top:1px solid var(--dl-rule-soft); max-width:72ch; font-size:12px; line-height:1.65; color:var(--dl-faint); }
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
.dl-authwrap { display:flex; justify-content:center; padding:56px 0 32px; }
.dl-authcard { position:relative; width:min(464px, 100%); background:var(--dl-card); border:1px solid var(--dl-rule-soft); box-shadow:var(--dl-sh2); border-radius:18px; padding:36px 36px 26px; display:flex; flex-direction:column; gap:6px; }
@media (max-width: 560px) { .dl-authcard { padding:26px 22px 20px; } }
.dl-root .dl-authcard.is-blocked form, .dl-root .dl-authcard.is-blocked .dl-social { opacity:.5; pointer-events:none; }
.dl-authcard h2 { font-weight:700; font-size:23px; letter-spacing:-.015em; text-align:center; }
.dl-authcard .sub { font-size:13.5px; color:var(--dl-muted); margin:4px 0 10px; text-align:center; line-height:1.55; }
.dl-root .dl-authcard form { display:flex; flex-direction:column; gap:16px; margin-top:14px; }
.dl-root .dl-authcard .dl-field { display:flex; flex-direction:column; gap:6px; }
.dl-root .dl-authsubmit { width:100%; height:44px; font-size:14.5px; margin-top:2px; }
.dl-root .dl-pwmeter { display:flex; align-items:center; gap:10px; margin-top:8px; }
.dl-root .dl-pwmeter .bars { display:flex; gap:4px; flex:1; }
.dl-root .dl-pwmeter i { flex:1; height:3px; border-radius:2px; background:var(--dl-rule-mid); transition:background-color 220ms ease; }
.dl-root .dl-pwmeter .lvl { font-size:11.5px; font-weight:650; color:var(--dl-muted); }
.dl-root .dl-inputwrap { position:relative; }
.dl-root .dl-inputwrap input { padding-right:42px; }
.dl-root .dl-pweye { position:absolute; top:50%; right:5px; transform:translateY(-50%); display:flex; align-items:center; justify-content:center; width:32px; height:32px; border:0; background:transparent; color:var(--dl-muted); cursor:pointer; border-radius:8px; transition:color 160ms ease, background-color 160ms ease; }
.dl-root .dl-pweye:hover { color:var(--dl-ink); background:var(--dl-paper-2); }
.dl-root .dl-pweye svg { width:17px; height:17px; }
.dl-root .dl-sentline { font-size:13.5px; color:var(--dl-muted); line-height:1.55; }
.dl-root .dl-sentline b { color:var(--dl-ink); font-weight:650; }
.dl-root .dl-marks { display:contents; }
.dl-root .dl-marks i { position:absolute; width:13px; height:13px; border:0 solid var(--dl-rule-strong); opacity:0.8; pointer-events:none; }
.dl-root .dl-marks i:nth-child(1) { top:-7px; left:-7px; border-top-width:1.5px; border-left-width:1.5px; }
.dl-root .dl-marks i:nth-child(2) { top:-7px; right:-7px; border-top-width:1.5px; border-right-width:1.5px; }
.dl-root .dl-marks i:nth-child(3) { bottom:-7px; left:-7px; border-bottom-width:1.5px; border-left-width:1.5px; }
.dl-root .dl-marks i:nth-child(4) { bottom:-7px; right:-7px; border-bottom-width:1.5px; border-right-width:1.5px; }
.dl-root .dl-pwmeter i.on-1 { background:#D9534F; }
.dl-root .dl-pwmeter i.on-2 { background:#E0A03A; }
.dl-root .dl-pwmeter i.on-3 { background:var(--dl-green); }
.dl-root .dl-pwrow { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:7px; }
.dl-root .dl-pwrow label { display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--dl-muted); font-weight:500; cursor:pointer; }
.dl-root .dl-pwrow .lvl { font-size:12px; font-weight:650; color:var(--dl-muted); }
.dl-root .dl-social { display:flex; flex-direction:column; gap:11px; margin-top:18px; }
.dl-root .dl-social button { display:flex; align-items:center; justify-content:center; gap:12px; width:100%; height:50px; border-radius:15px; border:1px solid var(--dl-rule-soft); background:var(--dl-paper-2); color:var(--dl-ink); font-size:15px; font-weight:600; cursor:pointer; transition:background-color 160ms ease, border-color 160ms ease, transform 160ms cubic-bezier(0.23,1,0.32,1); }
.dl-root .dl-social button:hover { background:color-mix(in srgb, var(--dl-ink) 4%, var(--dl-paper-2)); border-color:var(--dl-rule-mid); }
.dl-root .dl-social button:active { transform:scale(0.985); }
.dl-root .dl-social svg { width:18px; height:18px; flex:none; }
.dl-root .dl-social button.github { background:#24292F; border-color:#24292F; color:#fff; }
.dl-root .dl-social button.github:hover { background:#32383F; border-color:#32383F; }
[data-theme="dark"] .dl-root .dl-social button.github,
[data-theme="midnight"] .dl-root .dl-social button.github { background:#F6F8FA; border-color:#F6F8FA; color:#24292F; }
[data-theme="dark"] .dl-root .dl-social button.github:hover,
[data-theme="midnight"] .dl-root .dl-social button.github:hover { background:#E7EBEF; border-color:#E7EBEF; }
.dl-root .dl-authdiv { display:flex; align-items:center; gap:12px; margin:18px 0 2px; }
.dl-root .dl-authdiv::before, .dl-root .dl-authdiv::after { content:""; flex:1; height:1px; background:var(--dl-rule); }
.dl-root .dl-authdiv span { font-size:11px; font-weight:650; letter-spacing:0.08em; text-transform:uppercase; color:var(--dl-muted); }
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
.dl-caveat { background:var(--dl-card); border:1px solid var(--dl-rule); border-radius:10px; padding:16px 20px; margin-top:10px; }
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
.dl-vimport { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:14px; font-size:12.5px; color:var(--dl-faint); }
.dl-vimphint { font-size:11.5px; color:var(--dl-faint); margin-top:10px; line-height:1.6; }
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
.dl-chip { border:1px solid var(--dl-rule); background:var(--dl-card); color:var(--dl-muted); border-radius:999px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; transition:transform 160ms var(--dl-eo), border-color 150ms ease, color 150ms ease; }
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

/* ═══════════════════════════ the component ═══════════════════════════ */

export default class DaylightSkinApp extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            aiHub: false,
            ...parseRoute(currentRoute()),
            themeMode: this.readTheme(),
            q: "", catFilter: parseRoute(currentRoute()).cat || "", idxView: "tiles", blogTag: "",
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
            if (t) return toolSeo(t).title;
            return "Tool not found · PrivaTools";
        }
        if (r.view === "blog" && r.post) {
            const title = postTitles?.get(r.post);
            if (title) return `${title} · PrivaTools`;
        }
        const NAMES = {
            tools: "All tools", pipeline: "Pipeline", batch: "Batch",
            mystuff: "My Stuff", vault: "Vault",
            account: r.keys ? "API keys" : r.authMode === "signup" ? "Create an account" : "Account", settings: "Account settings", ai: "AI studio", api: "Developer API", trust: "Trust center",
            compare: "Compare", blog: "Blog", about: "About",
            privacy: "Privacy", security: "Security & trust", terms: "Terms",
            status: "Status", support: "Support", notfound: "Page not found",
        };
        const name = NAMES[r.view];
        return name ? `${name} · PrivaTools` : "PrivaTools — Free, Open-Source Privacy-First File Tools";
    }

    /**
     * Sets the tab title for the current route. An article's title waits for
     * data/blog.ts, which its view loads anyway; until then the tab keeps what
     * it has, which on a first load is the server's title for that article.
     */
    applyTitle() {
        const r = this.state;
        if (r.view === "blog" && r.post && !postTitles) {
            const settle = () => {
                if (this.state.view === "blog" && this.state.post === r.post) document.title = this.titleFor(this.state);
            };
            loadPostTitles().then(settle, settle);
            return;
        }
        document.title = this.titleFor(r);
    }

    /** Extended by the mixins; the base contributes only the absorber they inject nav into. */
    renderVals() { return { dlNav: [] }; }

    /* ── lifecycle ── */
    componentDidMount() {
        if (super.componentDidMount) super.componentDidMount();
        this._onRoute = () => {
            const r = parseRoute(currentRoute());
            this.setState({ ...r, ...(r.view === "tools" ? { catFilter: r.cat || "" } : {}) }, () => {
                window.scrollTo(0, 0);
                this.applyTitle();
                this._timers.push(setTimeout(this._armReveals, 60));
                if (r.view === "tool" && BY_SLUG.has(r.slug)) this.logHistory(r.slug);
            });
        };
        window.addEventListener("popstate", this._onRoute);

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
        this._dropHijackable = () => !["tool", "batch", "pipeline", "mystuff", "vault", "account", "settings", "ai", "api"].includes(this.state.view);
        this._onDragEnter = (e) => { if (!this._dropHijackable() || !e.dataTransfer?.types?.includes("Files")) return; e.preventDefault(); this._depth++; if (!this.state.dragging) this.setState({ dragging: true }); };
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
            go("/");
            this.pickHomeFiles(files);
        };
        window.addEventListener("dragenter", this._onDragEnter);
        window.addEventListener("dragover", this._onDragOver);
        window.addEventListener("dragleave", this._onDragLeave);
        window.addEventListener("drop", this._onDrop);

        // Paint the stored choice now; index.html already pre-painted it, but a
        // hot-switch from the dock into this skin arrives without a reload.
        document.documentElement.setAttribute("data-theme", resolveTheme(this.state.themeMode));
        this._stopThemeWatch = watchThemeChoice("daylight", (themeMode) => this.setState({ themeMode }));
        if (new URLSearchParams(location.search).get("mode") === "signup" && location.pathname.startsWith("/account")) this._setAcct?.({ mode: "signup" });

        // First mount can already be deep-linked to a tool.
        this.applyTitle();
        if (this.state.view === "tool" && BY_SLUG.has(this.state.slug)) this.logHistory(this.state.slug);
    }

    componentWillUnmount() {
        if (super.componentWillUnmount) super.componentWillUnmount();
        window.removeEventListener("popstate", this._onRoute);
        window.removeEventListener("keydown", this._onKey);
        window.removeEventListener("beforeinstallprompt", this._onBip);
        window.removeEventListener("appinstalled", this._onInstalled);
        window.removeEventListener("dragenter", this._onDragEnter);
        window.removeEventListener("dragover", this._onDragOver);
        window.removeEventListener("dragleave", this._onDragLeave);
        window.removeEventListener("drop", this._onDrop);
        window.removeEventListener("scroll", this._onScrollReveal);
        this._stopThemeWatch?.();
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
        const order = ["system", "light", "dark"];
        const next = order[(order.indexOf(this.state.themeMode) + 1) % order.length];
        setThemeChoice("daylight", next);
        this.setState({ themeMode: next });
    };
    readHistory() {
        try {
            const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
            return Array.isArray(history) ? history.filter(item => item && typeof item.s === "string" && BY_SLUG.has(item.s) && Number.isFinite(item.ts)).slice(0, 30) : [];
        } catch { return []; }
    }
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
        return <>
            <ConsumerHeader view={this.state.view} theme={this.state.themeMode}
                onTheme={(theme) => { setThemeChoice("daylight", theme); this.setState({ themeMode: theme }); }}
                onSearch={() => this.setState({ palOpen: true })}
                onAi={() => this.setState({ aiHub: true })} onInstall={this._installApp}
                signedIn={Boolean(this.state.acct?.user || this.state.acct?.accountHint)} />
            <AiHubDialog open={this.state.aiHub} onOpenChange={(aiHub) => this.setState({ aiHub })} />
        </>;
    }

    ToolCard(t, i) {
        return (
            <a key={t.slug} className="dl-card" href={canonicalPath(`/tool/${t.slug}`)}
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
                        <a className="dl-brand" href="/"><ConsumerLogo /> PrivaTools</a>
                        <p>{TOTAL} tools for PDFs, images, text and everyday work. Free to use, with no account needed for tools.</p>
                        <button type="button" className={cn(buttonVariants({ variant: "outline" }), "finstall")} onClick={this._installApp}>
                            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.5 V9 M4 6.5 L7 9.5 L10 6.5 M2 12.5 H12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Install the app
                        </button>
                        <div className="dl-social-links">
                            <a href="https://x.com/ethereaglehq" target="_blank" rel="me noopener noreferrer"
                                aria-label="PrivaTools on X">
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                </svg>
                                @ethereaglehq
                            </a>
                            <a href="https://github.com/ethereaglehq/privatools" target="_blank"
                                rel="noopener noreferrer" aria-label="PrivaTools on GitHub">
                                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                                </svg>
                                Source
                            </a>
                        </div>
                    </div>
                    <div><h4>Popular</h4><ul>
                        {POPULAR.slice(0, 5).map((t) => <li key={t.slug}><a href={canonicalPath(`/tool/${t.slug}`)}>{t.name}</a></li>)}
                    </ul></div>
                    <div><h4>Browse</h4><ul>
                        <li><a href="/tools">All {TOTAL} tools</a></li>
                        <li><a href="/pipeline">Workflows & pipelines</a></li>
                        <li><a href="/batch">Batch</a></li>
                        <li><a href="/compare">Compare</a></li>
                        <li><a href="/blog">Blog</a></li>
                    </ul></div>
                    <div><h4>Product</h4><ul>
                        <li><a href="/security">Trust &amp; security</a></li>
                        <li><a href="/my-stuff">My Stuff</a></li>
                        <li><a href="/my-stuff/vault">Vault</a></li>
                        <li><a href="/status">Status</a></li>
                        <li><a href="/support">Support</a></li>
                        <li><a href="/about">About</a></li>
                        <li><a href="/privacy">Privacy</a></li>
                        <li><a href="/terms">Terms</a></li>
                    </ul></div>
                </div>
                <div className="base"><div>
                    <span>© 2026 PrivaTools · owner-funded · no ads · free tools</span>
                    <span>Processing location is shown before you start.</span>
                </div></div>
            </footer>
        );
    }

    TabBar() { return <ConsumerTabBar view={this.state.view} />; }

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
    _acctDeleteNow = () => this._acctDelete(true);
    _vaultClearNow = () => { this._setVault({ confirmingClear: true }); this._timers.push(setTimeout(() => this._vaultClear(), 30)); };

    /** Import vault entries from parsed rows — encrypted one by one on arrival. */
    _vaultImportEntries = async (rows, sourceLabel) => {
        const valid = (Array.isArray(rows) ? rows : []).filter(
            (r) => r && typeof r.label === "string" && r.label.trim() && typeof r.password === "string" && r.password);
        if (!valid.length) {
            this._setVault({ error: 'No usable entries — expected JSON like [{"label":"file.pdf","password":"…"}].' });
            return;
        }
        this._setVault({ busy: true, error: "" });
        try {
            for (const r of valid) await vaultApi.add(r.label.trim(), r.password);
            this._setVault({ busy: false });
            this._loadVault();
            this.say(`Imported ${valid.length} ${valid.length === 1 ? "entry" : "entries"} from ${sourceLabel} — encrypted on this device.`);
        } catch (err) {
            this._setVault({ busy: false, error: err.message });
        }
    };

    _vaultImportFile = (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!f) return;
        f.text().then((txt) => {
            let data;
            try { data = JSON.parse(txt); } catch { this._setVault({ error: `“${f.name}” isn’t valid JSON.` }); return; }
            this._vaultImportEntries(Array.isArray(data) ? data : data.entries, `“${f.name}”`);
        });
    };

    _vaultLoadSample = () => this._vaultImportEntries([
        { label: "sample-invoice.pdf", password: "inv-2026-demo" },
        { label: "sample-contract.pdf", password: "Contract#Demo1" },
        { label: "sample-payslip.pdf", password: "payslip-demo-9" },
    ], "the sample set");

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

    /* ═══════════════════════ ⌘K palette ═══════════════════════ */

    Palette() {
        return <ConsumerSearch open={this.state.palOpen} history={this.state.history}
            onOpenChange={(palOpen) => this.setState({ palOpen })} />;
    }

    /* ═══════════════════════ views ═══════════════════════ */

    pickHomeFiles = (files) => {
        this._droppedFiles = files;
        this.setState({ dropped: files.length ? { files: files.map(f => ({ name: f.name, size: f.size })) } : null });
    };

    Home() {
        return <ExperienceHome history={this.state.history} onClearHistory={this.clearHistory}
            files={this._droppedFiles || []} onFiles={this.pickHomeFiles}
            onBrowse={(q) => { this.setState({ q, catFilter: "" }); go("/tools"); }}
            onAi={() => this.setState({ aiHub: true })} />;
    }

    Tools() {
        return <CatalogStudio query={this.state.q} category={this.state.catFilter} onQuery={q=>this.setState({q})} onCategory={catFilter=>this.setState({catFilter})} />;
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
                        <div className="dl-crumb"><a href="/tools">All tools</a></div>
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
        return <ToolWorkspace tool={tool} categoryLabel={FAMILY_LABEL[tool.category] || tool.category}
            related={related} onFindTool={() => this.setState({ palOpen: true })}>
            {v.realToolUI}
        </ToolWorkspace>;
    }

    /* ── pipeline (native surface; the run is an illustration, and says so) ── */

    HousePage(Comp, label, props = {}) {
        return (
            <div className="pt-page-host">
                <React.Suspense fallback={this.PageLoading(label)}>
                    <Comp {...props} />
                </React.Suspense>
            </div>
        );
    }

    PageLoading(label) {
        return (
            <div style={{ marginTop: 48, display: "grid", gap: 14 }} aria-label={`Loading ${label}`}>
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-4 w-96 max-w-full" />
                <Skeleton className="h-40 w-full rounded-[14px]" />
                <Skeleton className="h-40 w-full rounded-[14px]" />
            </div>
        );
    }

    NotFound() { return <MissingStudio />; }

    Pipeline() {
        // Shared recipes initialize on mount; only a changed recipe resets the editor.
        const recipe = new URLSearchParams(window.location.search).get("p") || "";
        return this.HousePage(HousePipeline, "Pipeline", { key: recipe });
    }

    Batch() { return this.HousePage(HouseBatch, "Batch"); }

    MyStuff() { return this.HousePage(HouseMyStuff, "My Stuff"); }

    Vault() {
        const vlt = this.state.vlt || { entries: [], label: "", password: "", busy: false, error: "" };
        const entries = vlt.entries || [];
        const query = (vlt.search || "").trim().toLowerCase();
        const visible = entries.filter(entry => entry.label.toLowerCase().includes(query));
        const LockIcon = BY_SLUG.get("protect-pdf").icon;
        return (
            <div className="dl-wrap pt-studio-page pt-library-page pt-vault-page">
                <header className="pt-studio-header pt-workflow-header">
                    <div className="pt-workflow-heading"><p className="pt-studio-kicker">VAULT / ONLY ON THIS DEVICE</p><h1><span className="wf-air-copy">A safe place to remember.</span><span className="wf-play-copy">Keep it under lock.</span></h1><p>A personal place for the passwords you use with your PDFs. Encrypted here, ready when you need them.</p></div>
                    <a href="/my-stuff" className="wf-library-seal"><LockIcon size={26} /><span>Your password shelf<small>{entries.length} saved on this device</small></span></a>
                </header>
                {vlt.error && <div className="wf-notice wf-notice-error" role="alert">{vlt.error}</div>}
                {vlt.unreadable > 0 && <div className="wf-notice wf-notice-error" role="alert">{vlt.unreadable} entries can’t be read with this browser’s current encryption key.</div>}
                <div className="wf-vault-layout">
                    <section className="wf-vault-library wf-work-sheet">
                        <div className="wf-sheet-heading"><div><p className="wf-section-label">YOUR COLLECTION</p><h2>Stored passwords</h2></div><span className="wf-status-pill">AES-GCM encrypted</span></div>
                        {entries.length > 0 && <label className="wf-search wf-vault-search"><span>Find</span><input aria-label="Search saved passwords" placeholder="A document or a label…" value={vlt.search || ""} onChange={event => this._setVault({ search: event.target.value })} /></label>}
                        {entries.length === 0 ? <div className="wf-vault-empty"><div className="wf-vault-object" aria-hidden="true"><LockIcon size={42} strokeWidth={1.3} /><span>••••••••</span></div><h3>Your first password belongs here.</h3><p>Give it a name you’ll recognise. We’ll encrypt it in this browser, so it’s ready for Protect and Unlock PDF.</p><span className="wf-device-note">Nothing stored yet.</span></div> : visible.length === 0 ? <div className="wf-vault-empty"><h3>No matching passwords.</h3><p>Try part of a document name or clear your search.</p><button className="wf-button" onClick={() => this._setVault({ search: "" })}>Show all passwords</button></div> : <div className="wf-vault-entries">{visible.map((entry, index) => <article className="wf-vault-entry" key={entry.id}>
                            <div className="wf-vault-entry-top"><span className="wf-vault-entry-number">{String(index + 1).padStart(2, "0")}</span><LockIcon size={20} /></div><h3>{entry.label}</h3><code>{vlt.revealedId === entry.id ? vlt.revealedValue : "••••••••••••"}</code><p>{describeEntry(entry)}</p>
                            <div className="wf-vault-entry-actions"><button className="wf-text-button" onClick={() => this._vaultReveal(entry.id)}>{vlt.revealedId === entry.id ? "Hide" : "Reveal"}</button><button className="wf-text-button" onClick={() => this._vaultCopy(entry.id)}>Copy</button><AlertDialog><AlertDialogTrigger className="wf-text-button wf-danger-text" aria-label={`Delete ${entry.label}`}>Delete</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete “{entry.label}”?</AlertDialogTitle><AlertDialogDescription>This removes the password from this device. There is no copy to restore it from.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><AlertDialogAction onClick={() => this._vaultDelete(entry.id)}>Delete entry</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
                        </article>)}</div>}
                        {entries.length > 0 && <div className="wf-vault-clear"><AlertDialog><AlertDialogTrigger className="wf-text-button wf-danger-text">Clear the vault</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Erase every stored password?</AlertDialogTitle><AlertDialogDescription>The vault is deleted from this device. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep them</AlertDialogCancel><AlertDialogAction onClick={this._vaultClearNow}>Erase everything</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}
                    </section>
                    <aside className="wf-vault-add wf-work-sheet"><div className="wf-rail-heading"><div><p className="wf-section-label">KEEP SOMETHING HANDY</p><h2>Store a password</h2></div></div><p>Use a clear label so the right password is easy to find later.</p><form onSubmit={this._vaultAdd}>
                        <div className="wf-field"><Label htmlFor="dl-vl">Name</Label><Input id="dl-vl" value={vlt.label || ""} placeholder="e.g. my-tax-return.pdf" disabled={vlt.busy} onChange={event => this._setVault({ label: event.target.value, error: "" })} /></div>
                        <div className="wf-field"><Label htmlFor="dl-vp">Password</Label><Input id="dl-vp" type="password" autoComplete="new-password" value={vlt.password || ""} placeholder="The password to remember" disabled={vlt.busy} onChange={event => this._setVault({ password: event.target.value, error: "" })} /></div>
                        <button className="wf-button wf-button-primary" disabled={vlt.busy} type="submit"><LockIcon size={16} />{vlt.busy ? "Encrypting…" : "Encrypt & store"}</button>
                    </form><p className="wf-device-note">Protected with a non-extractable key stored in this browser. No account needed.</p>
                        <details className="wf-vault-import"><summary>Bring passwords you already have</summary><p>Import a JSON list. Each entry is encrypted as it is saved.</p><label className="wf-button">Import JSON…<input type="file" accept=".json,application/json" hidden disabled={vlt.busy} onChange={this._vaultImportFile} /></label><code>{"[{\"label\":\"file.pdf\",\"password\":\"…\"}]"}</code><button type="button" className="wf-text-button" disabled={vlt.busy} onClick={this._vaultLoadSample}>Load 3 sample entries</button><small>Samples are demo passwords you can delete.</small></details>
                    </aside>
                </div>
                <div className="wf-vault-facts"><div><span>01</span><h3>Stored right here.</h3><p>Your saved vault stays on this device. Clearing this site’s browser data deletes it permanently.</p></div><div><span>02</span><h3>Ready for your next PDF.</h3><p>Protect and Unlock PDF can use a saved password. Server-based jobs receive the password required for that job.</p></div><div><span>03</span><h3>Private, with clear limits.</h3><p>Encryption protects stored data from casual access. It cannot protect against malicious code running on this page.</p></div></div>
            </div>
        );
    }

    /* ── account (REAL via withAccounts; markup only renders its state) ── */

    Account(embedded = false) {
        const AccountHeading = embedded ? "h2" : "h1";
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


        // Recovery is a mandatory stop, including after a reset that signs out.
        if (acctRecoveryCode) {
            return <section className={`pt-studio-page pt-account-page pt-recovery-page ${embedded ? "is-embedded" : ""}`}>
                <div className="pt-recovery-story"><p className="pt-workspace-caption">One last thing</p><AccountHeading>Keep a way <br />back in.</AccountHeading><p>A small code. An important safety net. Put it somewhere you can find without signing into this account.</p><div className="pt-recovery-envelope" aria-hidden="true"><span>For your safekeeping</span><b>Your recovery code</b><span>Keep somewhere private</span></div></div>
                <div className="pt-recovery-sheet dl-reccode">
                    <span className="pt-workspace-caption">Save this before you continue</span><h2>Save your recovery code now</h2>
                    <p>It is shown exactly once, and it is the only way back into this account — there is no reset email.</p>
                    {!a.user && <p>Your password has been reset. Save this new recovery code, then sign in with your new password.</p>}
                    <code>{acctRecoveryCode}</code>
                    <div className="pt-inline-actions"><button className="pt-studio-button is-secondary" onClick={acctCopyRecovery}>{a.recoverySaved ? "Copied ✓" : "Copy code"}</button><button className="pt-studio-link" onClick={acctDownloadRecovery}>Download as file</button></div>
                    <button className="pt-studio-button pt-recovery-continue" onClick={acctAckRecovery}>I’ve saved it</button>
                </div>
            </section>;
        }

        if (!a.user) {
            return <section className={`pt-studio-page pt-account-page pt-auth-page ${embedded ? "is-embedded" : ""}`}>
                <div className="pt-auth-story">
                    <p className="pt-workspace-caption">Your PrivaTools account</p>
                    <AccountHeading>{a.mode === "signup" ? <>A little account. <br />More possibilities.</> : a.mode === "recover" ? <>Let’s get you <br />back in.</> : <>Welcome to your <br />own little workspace.</>}</AccountHeading>
                    <p>{a.mode === "recover" ? "Your account is waiting. Follow the steps to reset your password and pick up where you left off." : "For the routines you want to automate, and the projects you want to make your own."}</p>
                    <div className="pt-auth-object" aria-hidden="true"><div className="pt-auth-object-tab">Your workflow</div><div className="pt-auth-object-sheet"><span>Start with your files</span><div><b>Combine</b><i>→</i><b>Convert</b><i>→</i><b>Done</b></div><span>One less thing on your list.</span></div></div>
                    <div className="pt-auth-benefits"><div><b>Make room for automation</b><p>Create API keys for your scripts and integrations.</p></div><div><b>Your tools are always open</b><p>Every file tool works without an account.</p></div></div>
                    <a className="pt-studio-link" href="/tools">Just here for a tool? Explore the toolbox →</a>
                </div>
                <div className={`pt-auth-desk ${a.blocked ? "is-blocked" : ""}`}>
                    {!accountsConfigured() && <div className="pt-auth-unavailable" role="status"><b>Sign-in is temporarily unavailable.</b><p>You can still use every tool without an account.</p><a href="/tools">Continue to the tools →</a></div>}
                    <div className="pt-auth-form-heading"><h2>{a.mode === "signup" ? "Create your account" : a.mode === "recover" ? "Recover your account" : "Sign in to PrivaTools"}</h2><p>{a.signInVerification ? "One quick check to keep your account safe." : a.needsEmailCode ? "Check your inbox to finish." : a.mode === "signup" ? "Make yourself at home." : a.mode === "recover" ? "A fresh start for your password." : "Good to have you back."}</p></div>
                            <Tabs value={a.mode === "signup" ? "signup" : "signin"}
                                onValueChange={(m) => this._acctChooseMode(m)}>
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="signin" disabled={a.busy}>Sign in</TabsTrigger>
                                    <TabsTrigger value="signup" disabled={a.busy}>Sign up</TabsTrigger>
                                </TabsList>
                            </Tabs>
                            {a.error && <div className="pt-form-error" role="alert">{a.error}</div>}
                            {a.needsEmailCode || a.signInVerification ? (
                                <form onSubmit={a.signInVerification ? this._acctVerifySignIn : this._acctVerifyEmail}>
                                    <p className="pt-auth-sent">{a.signInVerification === "totp" ? "Enter the current six-digit code from your authenticator app." : <>We emailed a code to <b>{a.signInVerification ? a.verificationDestination : a.email}</b>. Enter it to {a.signInVerification ? "verify this device" : "finish signing up"}.</>}</p>
                                    <div className="pt-account-field">
                                        <Label htmlFor="dl-code">{a.signInVerification === "totp" ? "Authenticator code" : "Email code"}</Label>
                                        <InputOTP id="dl-code" maxLength={6} value={a.emailCode} autoComplete="one-time-code"
                                            onChange={(v) => this._setAcct({ emailCode: v, error: "" })}>
                                            <InputOTPGroup>
                                                {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
                                            </InputOTPGroup>
                                        </InputOTP>
                                    </div>
                                    <button className={cn(buttonVariants(), "pt-auth-submit")} disabled={a.busy} type="submit">
                                        {a.busy ? "Checking…" : "Verify and continue"}
                                    </button>
                                    {a.signInVerification !== "totp" && <button type="button" className="pt-studio-link" disabled={a.busy} onClick={this._acctResendCode}>Send a new email code</button>}
                                    <button type="button" className="pt-studio-link" disabled={a.busy} onClick={() => this._acctChooseMode(a.mode)}>Start again</button>
                                </form>
                            ) : (
                                <>
                                    {SOCIAL_SIGN_IN.length > 0 && a.mode !== "recover" && (
                                        <>
                                            <div className="pt-auth-social">
                                                {SOCIAL_SIGN_IN.filter((sp) => SOCIAL_ICONS[sp.id]).map((sp) => (
                                                    <button key={sp.id} type="button" className={`pt-social-button ${sp.id}`} onClick={() => this._acctSocial(sp.id)} disabled={a.busy || a.blocked}>
                                                        {SOCIAL_ICONS[sp.id]}
                                                        Continue with {sp.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="pt-auth-divider"><span>or use your account details</span></div>
                                        </>
                                    )}
                                    {a.mode === "signin" && passkeyAccountsEnabled() && <div className="pt-auth-passkey"><button type="button" className="pt-social-button" disabled={a.busy || a.blocked || !passkeysSupported()} onClick={this._acctPasskey}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 16v-4a4 4 0 0 1 8 0v5M5 14v-2a7 7 0 0 1 14 0v2M11 20c1-2 1-4 1-8M3 9a10 10 0 0 1 18 0M6 20c1-1 1-2 1-3M16 21c1-1 2-2 2-4"/></svg>Sign in with a passkey</button><p className="pt-account-hint">{passkeysSupported() ? "Use Face ID, Touch ID, Windows Hello or your device PIN." : "Passkeys need a supported browser. You can still use Google or your password."}</p></div>}
                                    <form onSubmit={this._acctSubmit}>
                                        {a.mode === "recover" && EMAIL_RESET && a.resetEmailSent ? (
                                            <p className="pt-auth-sent">We emailed a code to <b>{a.email}</b>. Enter it below with your new password.</p>
                                        ) : (
                                            <div className="pt-account-field">
                                                <Label htmlFor="dl-email">{a.mode === "signin" && usernameAccountsEnabled() ? "Email or username" : "Email"}</Label>
                                                <Input id="dl-email" type={a.mode === "signin" && usernameAccountsEnabled() ? "text" : "email"} required value={a.email}
                                                    onChange={(e) => this._setAcct({ email: e.target.value, error: "" })} autoComplete={a.mode === "signin" ? "username" : "email"} autoCapitalize="none" spellCheck={false} />
                                            </div>
                                        )}
                                        {a.mode === "signup" && usernameAccountsEnabled() && <div className="pt-account-field"><Label htmlFor="dl-username">Username <span className="pt-account-hint">(optional)</span></Label><Input id="dl-username" value={a.username || ""} onChange={e => this._setAcct({ username: e.target.value, error: "" })} minLength={4} maxLength={64} autoComplete="username" autoCapitalize="none" spellCheck={false} aria-describedby="dl-username-hint" /><span id="dl-username-hint" className="pt-account-hint">4–64 characters. You can use this instead of your email to sign in.</span></div>}
                                        {a.mode === "recover" && !EMAIL_RESET && (
                                            <div className="pt-account-field">
                                                <Label htmlFor="dl-rec">Recovery code</Label>
                                                <Input id="dl-rec" required value={acctRecoveryInput}
                                                    onChange={(e) => this._setAcct({ recoveryInput: e.target.value, error: "" })} />
                                                <span className="pt-account-hint">The code shown once at signup — it’s the only way back in.</span>
                                            </div>
                                        )}
                                        {a.mode === "recover" && EMAIL_RESET && a.resetEmailSent && (
                                            <div className="pt-account-field">
                                                <Label htmlFor="dl-rec">Code from the email</Label>
                                                <InputOTP id="dl-rec" maxLength={6} value={acctRecoveryInput} autoComplete="one-time-code"
                                                    onChange={(v) => this._setAcct({ recoveryInput: v, error: "" })}>
                                                    <InputOTPGroup>
                                                        {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
                                                    </InputOTPGroup>
                                                </InputOTP>
                                            </div>
                                        )}
                                        {!(a.mode === "recover" && EMAIL_RESET && !a.resetEmailSent) && (
                                            <div className="pt-account-field">
                                                <Label htmlFor="dl-pass">{a.mode === "recover" ? "New password" : "Password"}</Label>
                                                <div className="pt-secret-input">
                                                    <Input id="dl-pass" type={a.showPassword ? "text" : "password"} required
                                                        minLength={a.mode === "signin" ? undefined : MIN_PASSWORD_LENGTH}
                                                        maxLength={EMAIL_RESET && a.mode !== "signin" ? 72 : undefined}
                                                        value={a.password}
                                                        onChange={(e) => this._setAcct({ password: e.target.value, error: "" })}
                                                        autoComplete={a.mode === "signin" ? "current-password" : "new-password"} />
                                                    <button type="button" className="pt-password-visibility" onClick={() => this._setAcct({ showPassword: !a.showPassword })}
                                                        aria-label={a.showPassword ? "Hide password" : "Show password"} aria-pressed={!!a.showPassword}>
                                                        {a.showPassword ? "Hide" : "Show"}
                                                    </button>
                                                </div>
                                                {a.mode !== "signin" && <span className="pt-account-hint">At least {MIN_PASSWORD_LENGTH} characters. Spaces welcome; no compulsory capitals or symbols.</span>}
                                                {strength && (
                                                    <div className="pt-password-meter">
                                                        <span className="bars" aria-hidden="true">
                                                            {[1, 2, 3].map((n) => (
                                                                <i key={n} className={strength.score >= n ? `on-${strength.score}` : ""} />
                                                            ))}
                                                        </span>
                                                        <span className="lvl">{strength.label}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {a.mode === "recover" && EMAIL_RESET && !a.resetEmailSent && (
                                            <span className="pt-account-hint">We’ll email a six-digit code so you can set a new password.</span>
                                        )}
                                        {a.mode === "signup" && EMAIL_RESET && <div id="clerk-captcha" className="pt-auth-captcha" />}
                                        <button className={cn(buttonVariants(), "pt-auth-submit")} disabled={a.busy || a.blocked || !accountsConfigured()} type="submit">
                                            {a.busy
                                                ? (a.mode === "recover" && EMAIL_RESET && !a.resetEmailSent ? "Sending…" : "Working…")
                                                : a.mode === "signup" ? "Create account"
                                                : a.mode === "recover" ? (EMAIL_RESET && !a.resetEmailSent ? "Email me a reset code" : "Reset password")
                                                : "Sign in"}
                                        </button>
                                        {a.mode === "recover" && EMAIL_RESET && a.resetEmailSent && (
                                            <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })}
                                                disabled={a.busy} onClick={() => this._setAcct({ resetEmailSent: false, recoveryInput: "", password: "", error: "" })}>
                                                Didn’t get it? Send another code
                                            </button>
                                        )}
                                    </form>
                                </>
                            )}
                            {a.mode !== "recover" && !a.needsEmailCode && !a.signInVerification && (
                                <button className={buttonVariants({ variant: "ghost", size: "sm" })}  onClick={acctShowRecover}>
                                    {EMAIL_RESET ? "Forgot your password?" : "Lost your password? Recover with your code"}
                                </button>
                            )}
                            {a.mode === "recover" && !a.needsEmailCode && (
                                <button className={buttonVariants({ variant: "ghost", size: "sm" })}
                                    disabled={a.busy} onClick={() => this._acctChooseMode("signin")}>
                                    ← Back to sign in
                                </button>
                            )}
                            <p className="pt-auth-note" >
                                {ACCOUNT_COPY.recovery}
                            </p>

                </div>
            </section>;
        }

        return <section className={`pt-studio-page pt-account-page pt-account-workspace pt-api-access-page ${embedded ? "is-embedded" : ""}`}>
            <AccountWorkspaceHeader active="api" email={a.user.email} title="API access" description="Manage the keys your scripts use and keep track of your free API allowance." embedded={embedded} actions={<><button type="button" className="pt-studio-button" onClick={this._acctNewKey} disabled={a.busy || a.keysLoading || Boolean(a.freshKey)}>Create key</button><button type="button" className="pt-studio-link" onClick={this._acctSignOut} disabled={a.busy}>Sign out</button></>} />
            {a.error && <div className="pt-form-error" role="alert">{a.error}</div>}
            {passkeyAccountsEnabled() && <p className="pt-account-passkey-invite">Use a passkey for your next sign-in. <a href="/account/settings">Manage account security →</a></p>}
            {a.freshKey && <section className="pt-account-key-reveal dl-fresh" aria-labelledby="fresh-api-key-title"><div><p className="pt-workspace-caption">Shown only once</p><h2 id="fresh-api-key-title">Save your new API key</h2><p>Copy this key before leaving. Keep it out of shared documents and public code.</p></div><code>{a.freshKey}</code><div className="pt-inline-actions"><button type="button" className="pt-studio-button" onClick={this._acctCopyKey}>{a.freshKeyCopied ? "Key copied" : "Copy API key"}</button><button type="button" className="pt-studio-button is-secondary" onClick={this._acctAckKey}>I have saved this key</button></div></section>}
            <div className="pt-account-desk">
                <section className="pt-account-keys" aria-labelledby="account-keys-heading"><div className="pt-section-title"><div><h2 id="account-keys-heading">Your API keys</h2><p>{a.keysLoading ? "Loading your connections…" : a.keys.length ? `${a.keys.filter(k => !k.revoked).length} active · ${a.keys.filter(k => k.revoked).length} revoked` : "One key for each app or workflow."}</p></div><button type="button" className="pt-studio-link" disabled={a.busy || a.keysLoading} onClick={() => this._loadKeys()}>Refresh keys</button></div>
                    {a.keysLoading ? <div className="pt-account-key-loading" role="status"><span>Loading your API keys…</span><span aria-hidden="true" /><span aria-hidden="true" /></div> : (a.keys || []).length === 0 ? <div className="pt-account-empty"><span className="pt-account-key-object" aria-hidden="true">API</span><h3>{a.error ? "Your keys could not be loaded" : "Create your first API key"}</h3><p>{a.error ? "Refresh your keys to try again. Your existing keys have not changed." : "Connect a script, app or workflow, then see its allowance and recent requests here."}</p>{!a.error && <button type="button" className="pt-studio-button is-secondary" disabled={a.busy || Boolean(a.freshKey)} onClick={this._acctNewKey}>Create a key</button>}</div> : <div className="pt-account-key-list">{a.keys.map((k) => <article className={`pt-account-key ${k.revoked ? "is-revoked" : ""}`} key={k.key_id}><span className="pt-account-key-tag" aria-hidden="true">API</span><div><div className="pt-account-key-title"><h3>{k.label || "API key"}</h3><span className="pt-account-key-status">{k.revoked ? "Revoked" : "Active"}</span></div><code>Key ID: {k.key_id}</code><p className="pt-account-key-meta">{describeKey(k)}</p></div><button type="button" className="pt-studio-link" disabled={a.busy || k.revoked} onClick={() => this._acctRevoke(k.key_id)}>{k.revoked ? "Revoked" : "Revoke"}</button></article>)}</div>}
                </section>
                <aside className="pt-account-guide"><p className="pt-workspace-caption">Start building</p><h2>Make your first request</h2><p>Try a sample conversion in the playground, or start with a ready-to-run script.</p><div className="pt-account-guide-links"><a className="pt-studio-link" href="/api">Open API playground →</a><a className="pt-studio-link" href="/api-starters/privatools-api-starters.zip" download>Download starter kit ↓</a></div><p className="pt-account-guide-note">Background results expire after one hour. You can delete them sooner from the API.</p></aside>
                <ApiActivity accountId={a.user.id} keyVersion={a.keys.map(k => `${k.key_id}:${k.revoked}`).join(",")} />
                <section className="pt-account-care" aria-label="Account care">
                    {!EMAIL_RESET && <div className="pt-account-recovery"><div><p className="pt-workspace-caption">Keep a way back in</p><h2>Recovery code</h2><p>Mislaid your code? You can replace it — the old one stops working the moment a new one is issued.</p></div>{!a.rotating ? <button className="pt-studio-button is-secondary" onClick={acctToggleRotate}>Replace my recovery code</button> : <form onSubmit={this._acctRotate}><div className="pt-account-field"><Label htmlFor="dl-rotp">Confirm your password</Label><Input id="dl-rotp" type="password" required value={a.rotatePassword} onChange={acctSetRotatePassword} autoComplete="current-password" /><span className="pt-account-hint">Required so a stolen session alone can’t mint a code that outlives a password change.</span></div><div className="pt-inline-actions"><button className="pt-studio-button" disabled={a.busy} type="submit">{a.busy ? "Working…" : "Issue new code"}</button><button className="pt-studio-link" type="button" onClick={acctToggleRotate}>Cancel</button></div></form>}</div>}
                    <details className="pt-account-delete"><summary>Close your account <span aria-hidden="true">+</span></summary><p>Deletes your sign-in account and removes its API access. You may need to verify your identity first. Tool files are not stored in your account.</p><AlertDialog><AlertDialogTrigger className="pt-studio-link is-danger" disabled={a.busy}>Delete account</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this account for good?</AlertDialogTitle><AlertDialogDescription>Your sign-in account and API access will be removed. You may need to verify your identity first. Tool files are not stored in your account. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep my account</AlertDialogCancel><AlertDialogAction onClick={this._acctDeleteNow}>Delete for good</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></details>
                </section>
            </div>
        </section>;
    }

    /* ── trust / security ── */

    Security() {
        return (
            <div className="dl-wrap">
                <div className="dl-heror rv rv-p">
                    <div className="dl-pghero">
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
                        ["Many free tool sites load their actual processing code from public CDNs at runtime — unpinned scripts, fetched while you’re holding a sensitive document. We don’t. Every tool is bundled and served from privatools.me, integrity-checked at build time, behind a strict content-security policy.",
                            "Two disclosed exceptions, scoped by that same policy to the tools that need them: on-device AI models and the in-browser OCR engine download from pinned CDNs on first use. Those requests carry code and model weights toward you — never your file the other way."]],
                    ["Your AI key goes only to your provider", "How to check: network tab + the AI hub",
                        ["Bring-your-own-key AI sends each request from your browser straight to the provider you configured — Anthropic, OpenAI, Gemini, Groq, or your own self-hosted server. Run one and watch the network panel: the only call is to that provider. The page’s security policy refuses every other AI host, and it only opens provider access at all on the handful of AI tool pages.",
                            "The key itself is stored encrypted on your device, and the AI hub in the top bar shows and deletes it any time. It is never sent to PrivaTools."]],
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
                            <AccordionTrigger>On-device AI models download from a CDN once</AccordionTrigger>
                            <AccordionContent>Summarize, Smart Redact, Translate, Remove Background, Transcribe Audio, Subtitle Generator, Subtitle Translator and in-browser OCR fetch model weights or engine files — not your files — on first use, then cache them in your browser. The AI hub in the top bar lists every installed model with its real size and removes any of them. Your document still never leaves the browser.</AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="byok">
                            <AccordionTrigger>Your own AI key means trusting the provider you picked</AccordionTrigger>
                            <AccordionContent>With bring-your-own-key, the text of the document you run (or the page images, for vision OCR) goes to that provider under your agreement with them — that is the entire point, and it is your call per run. We keep ourselves out of the path; we cannot keep your provider out of it. The free on-device engines exist precisely for the documents where even that is too much.</AccordionContent>
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
        return this.HousePage(HouseCompare, "Comparison", { competitorSlug: this.state.competitor || undefined });
    }

    Blog() {
        // No pt-page-host wrapper: the journal renders exactly as it did when it was eager.
        return (
            <React.Suspense fallback={this.PageLoading("Guides")}>
                <GuidesStudio slug={this.state.post} tag={this.state.blogTag} onTag={blogTag=>this.setState({blogTag})} />
            </React.Suspense>
        );
    }

    Doc(title, eyebrow, sections, rail) {
        return (
            <div className="dl-wrap">
                <div className="dl-pghero rv rv-p">
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

    About() { return <AboutStudio />; }

    Privacy() {
        return this.Doc("Privacy", "Policy", [
            ["The short version", [
                "No account is needed to use any tool, and no ads or third-party trackers run on this site.",
                "Tools run in your browser wherever possible; those files never reach us.",
                "When a tool needs our server, your file is processed in isolated temporary storage in Mumbai, India, and deleted after use.",
                "Activity kept on your device holds tool and time only — never files or filenames.",
                "On-device AI models download once into your browser cache; your files never ride along.",
                "Optional bring-your-own-key AI talks to your chosen provider directly from your browser — we never see the key, the request, or the reply.",
            ]],
            ["Files", "Local-first is the default: if a tool can run entirely in your browser, it does, and your file never leaves your machine. Tools that require server processing say so before you add a file. Server processing is transient — files exist only for the duration of the job and are deleted after use. We keep no copies; once deleted, they are unrecoverable."],
            ["Accounts", "Tools never require an account. The optional developer account exists only for the API; it stores your email, a password hash, and your API keys — nothing else."],
            ["AI", "By default, AI features run on models downloaded into your browser — the download carries weights toward you, never your file the other way, and the AI hub can remove any model. If you add your own API key, requests for those runs go straight from your browser to that provider under your agreement with them; the key is stored encrypted on this device and is never transmitted to PrivaTools. Saved PDF passwords live in a separate device-local vault whose key the browser will not export."],
            ["The full policy", <>This page is Daylight’s summary. The complete policy — including the AI tools’ model downloads and the developer API’s specifics — is the site policy it summarises.</>],
        ], <>
            {this.Facts("Where your file goes", [
                ["Local tools", "Nowhere"],
                ["Server tools", "Mumbai, IN"],
                ["Kept for", "The job only"],
                ["Copies", "None"],
                ["3rd-party trackers", "None"],
                ["AI by default", "On-device"],
                ["With your key", "Browser → provider"],
            ])}
            <div className="dl-panel dl-facts">
                <h3>Don’t take our word</h3>
                <p className="fine">Every claim here has a check you can run from your own browser.</p>
                <a className={buttonVariants({ variant: "outline" })} href="/security">Verify it yourself →</a>
            </div>
        </>);
    }

    Terms() {
        return this.Doc("Terms", "Legal", [
            ["The service", "PrivaTools provides file utilities free of charge, without accounts, for lawful personal and commercial use. The service is provided as-is, without warranty; verify important results before relying on them."],
            ["Acceptable use", "Don’t use the tools to process content you have no right to process, and don’t attempt to disrupt the service for others."],
            ["Liability", "To the maximum extent permitted by law, we are not liable for losses arising from use of the service. Your sole remedy is to stop using it — which costs nothing, because so does using it."],
            ["Your own AI key", "Bring-your-own-key requests travel directly from your browser to the AI provider you configured and are governed by your agreement with that provider, including its pricing and data terms. PrivaTools never receives, stores, or proxies the key or that traffic, and is not a party to that relationship."],
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
                <a className={buttonVariants({ variant: "outline" })} href="/support">Ask on Support →</a>
            </div>
        </>);
    }

    Status() { return this.HousePage(HouseStatus, "Status"); }

    Support() { return <SupportStudio />; }

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
                                        : view === "settings" ? this.HousePage(HouseSettings, "Settings", { accountUser: this.state.acct?.user, accountChecking: !this.state.acct?.resolved, appearanceArea: <AppearanceControls expanded /> })
                                        : view === "ai" ? this.HousePage(HouseAi, "AI studio")
                                        : view === "api" ? this.HousePage(HouseApi, "Developer API")
                                        : view === "trust" ? this.HousePage(HouseTrust, "Trust center")
                                        : view === "security" ? this.HousePage(HouseSecurity, "Security")
                                            : view === "compare" ? this.Compare()
                                                : view === "blog" ? this.Blog()
                                                    : view === "about" ? this.About()
                                                        : view === "privacy" ? this.HousePage(HousePrivacy, "Privacy")
                                                            : view === "terms" ? this.HousePage(HouseTerms, "Terms")
                                                                : view === "status" ? this.Status()
                                                                    : view === "support" ? this.Support()
                                                                        : view === "notfound" ? this.NotFound()
                                                                        : this.Home();
        return (
            <div className="dl-root consumer-app">
                <style>{CSS + "\n" + consumerCSS + "\n" + experienceCSS}</style>
                <ExperienceShell view={view} signedIn={Boolean(this.state.acct?.user || this.state.acct?.accountHint)} onSearch={() => this.setState({ palOpen: true })}>{body}</ExperienceShell>
                <AiHubDialog open={this.state.aiHub} onOpenChange={(aiHub) => this.setState({ aiHub })} />
                {this.Palette()}
                {this.state.dragging && (
                    <div className="dl-dropov" aria-hidden="true">
                        <div><b>Choose your next task.</b><p>Drop files to see compatible tools. Nothing uploads yet.</p></div>
                    </div>
                )}
            </div>
        );
    }
}
