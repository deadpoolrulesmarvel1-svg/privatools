/**
 * ComparePage — workshop lab-report comparing PrivaTools to competitors.
 *
 * Two views:
 *   1. Directory view (no slug) — quick-answer matrix + head-to-head cards.
 *   2. Detail view (/compare/:slug) — full feature table + verdict.
 *
 * Workshop styling: § markers, mono dateline, corner-marked PrivaTools row in matrix,
 * signal-green Check / muted X, accent value-prop cards.
 */
import { useParams, Link } from "react-router-dom";
import { useMemo, useState } from "react";
import {
  Shield, Check, X, Zap, Globe, Lock, Heart, Github, ArrowRight, Cloud, ServerCog,
  DollarSign, Eye, EyeOff, ArrowLeft, ArrowUpDown, Trophy, Minus, Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CompetitorData {
  name: string;
  slug: string;
  tagline: string;
  toolCount?: string;
  pricing?: string;
  freeLimit?: string;
  openSource?: boolean;
  selfHostable?: boolean;
  cloudUploads?: boolean;
  features: Record<string, boolean | string>;
}

const competitors: Record<string, CompetitorData> = {
  ilovepdf: {
    name: "iLovePDF", slug: "ilovepdf",
    tagline: "Popular PDF tool suite with ads and file limits",
    toolCount: "~25 (PDF only)", pricing: "$4/mo Premium", freeLimit: "25 MB free",
    openSource: false, selfHostable: false, cloudUploads: true,
    features: {
      "Free to use": "Limited", "No account required": "No",
      "No file size limits": "No (25MB free)", "No ads": "No",
      "Open source": "No", "Self-hostable": "No",
      "Files processed privately": "No (files uploaded to their servers)",
      "No watermarks on free tier": "Limited",
      "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)",
      "Works offline / client-side tools": "No",
      "JSON-LD structured data": "Yes",
      "API available": "Yes (paid)",
    },
  },
  smallpdf: {
    name: "Smallpdf", slug: "smallpdf",
    tagline: "Swiss PDF tool with aggressive upsells",
    toolCount: "30+ (PDF + AI)", pricing: "$9/mo Pro", freeLimit: "2 tasks/day",
    openSource: false, selfHostable: false, cloudUploads: true,
    features: {
      "Free to use": "Limited (2 tasks/day)", "No account required": "No",
      "No file size limits": "No", "No ads": "No",
      "Open source": "No", "Self-hostable": "No",
      "Files processed privately": "No (files uploaded to their servers)",
      "No watermarks on free tier": "Limited",
      "175+ tools (PDF, image, video, audio, dev)": "No (21 tools, PDF only)",
      "Works offline / client-side tools": "No",
      "Desktop app included": "Yes (paid)", "API available": "Yes (paid)",
    },
  },
  "adobe-acrobat": {
    name: "Adobe Acrobat Online", slug: "adobe-acrobat",
    tagline: "Industry standard with expensive subscription",
    toolCount: "20+ (PDF)", pricing: "$23/mo Pro", freeLimit: "Very limited",
    openSource: false, selfHostable: false, cloudUploads: true,
    features: {
      "Free to use": "Very limited", "No account required": "No (Adobe ID required)",
      "No file size limits": "No", "No ads": "Yes",
      "Open source": "No", "Self-hostable": "No",
      "Files processed privately": "No (Adobe cloud)",
      "No watermarks on free tier": "Limited",
      "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)",
      "Works offline / client-side tools": "Desktop app (paid)",
      "E-signatures": "Yes (paid)", "API available": "Yes (paid)",
    },
  },
  sejda: {
    name: "Sejda PDF", slug: "sejda",
    tagline: "PDF editor with 3 task/hour and file size limits",
    toolCount: "~35 (PDF)", pricing: "$7.50/mo Pro", freeLimit: "3 tasks/hour, 50 MB",
    openSource: false, selfHostable: false, cloudUploads: true,
    features: {
      "Free to use": "Limited (3 tasks/hour)", "No account required": "No",
      "No file size limits": "No (50MB free)", "No ads": "No",
      "Open source": "No", "Self-hostable": "No",
      "Files processed privately": "No (files uploaded to their servers)",
      "No watermarks on free tier": "Yes",
      "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)",
      "Works offline / client-side tools": "No",
      "Desktop app included": "No", "API available": "Yes (paid)",
    },
  },
  pdf24: {
    name: "PDF24", slug: "pdf24",
    tagline: "Free PDF tool suite — but not open source",
    toolCount: "95+ (PDF only)", pricing: "Free (ad-supported)", freeLimit: "Generous",
    openSource: false, selfHostable: false, cloudUploads: true,
    features: {
      "Free to use": "Yes", "No account required": "Yes",
      "No file size limits": "Limited", "No ads": "No",
      "Open source": "No", "Self-hostable": "No",
      "Files processed privately": "No (files uploaded to their servers)",
      "No watermarks on free tier": "Yes",
      "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)",
      "Works offline / client-side tools": "No",
      "Desktop app included": "Yes (Windows)", "API available": "No",
    },
  },
  foxit: {
    name: "Foxit PDF", slug: "foxit",
    tagline: "Enterprise PDF suite with paid subscription",
    toolCount: "15+ (PDF + e-sign)", pricing: "$14/mo Cloud", freeLimit: "Very limited",
    openSource: false, selfHostable: false, cloudUploads: true,
    features: {
      "Free to use": "No (paid subscription)", "No account required": "No",
      "No file size limits": "No", "No ads": "Yes",
      "Open source": "No", "Self-hostable": "Enterprise only",
      "Files processed privately": "No (Foxit cloud)",
      "No watermarks on free tier": "N/A (no free tier)",
      "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)",
      "Works offline / client-side tools": "Desktop app (paid)",
      "E-signatures": "Yes (paid)", "API available": "Yes (paid)",
    },
  },
  lightpdf: {
    name: "LightPDF", slug: "lightpdf",
    tagline: "Freemium PDF tools with AI features behind paywall",
    toolCount: "~20 (PDF + AI)", pricing: "$10/mo Premium", freeLimit: "Limited",
    openSource: false, selfHostable: false, cloudUploads: true,
    features: {
      "Free to use": "Limited", "No account required": "No",
      "No file size limits": "No", "No ads": "No",
      "Open source": "No", "Self-hostable": "No",
      "Files processed privately": "No (files uploaded to their servers)",
      "No watermarks on free tier": "Limited",
      "175+ tools (PDF, image, video, audio, dev)": "No (PDF + basic image)",
      "Works offline / client-side tools": "No",
      "Desktop app included": "No", "API available": "Yes (paid)",
    },
  },
  "stirling-pdf": {
    name: "Stirling PDF", slug: "stirling-pdf",
    tagline: "Open-source self-hosted PDF suite (Docker only)",
    toolCount: "~50 (PDF only)", pricing: "Free (self-host)", freeLimit: "No demo",
    openSource: true, selfHostable: true, cloudUploads: false,
    features: {
      "Free to use": "Yes", "No account required": "Yes (self-hosted)",
      "No file size limits": "Depends on your server", "No ads": "Yes",
      "Open source": "Yes (GPL-3.0)", "Self-hostable": "Yes (Docker required)",
      "Files processed privately": "Yes (your own server)",
      "No watermarks on free tier": "Yes",
      "175+ tools (PDF, image, video, audio, dev)": "No (PDF only)",
      "Works offline / client-side tools": "No (server-side only)",
      "Desktop app included": "No", "API available": "Yes (self-hosted)",
    },
  },
  dochub: {
    name: "DocHub", slug: "dochub",
    tagline: "Document signing and editing platform",
    toolCount: "Form-fill / e-sign", pricing: "$7/mo Pro", freeLimit: "5 docs/mo",
    openSource: false, selfHostable: false, cloudUploads: true,
    features: {
      "Free to use": "Limited (1 user, 5 docs/month)", "No account required": "No",
      "No file size limits": "No", "No ads": "Yes",
      "Open source": "No", "Self-hostable": "No",
      "Files processed privately": "No (DocHub cloud)",
      "No watermarks on free tier": "Yes",
      "175+ tools (PDF, image, video, audio, dev)": "No (document editing only)",
      "Works offline / client-side tools": "No",
      "E-signatures": "Yes (limited free)", "API available": "Yes (paid)",
    },
  },
  pdfescape: {
    name: "PDFescape", slug: "pdfescape",
    tagline: "Free online PDF editor with basic tools",
    toolCount: "~15 (basic)", pricing: "$3/mo Premium", freeLimit: "10 MB, 100 pages",
    openSource: false, selfHostable: false, cloudUploads: true,
    features: {
      "Free to use": "Limited (10MB, 100 pages)", "No account required": "Yes (online version)",
      "No file size limits": "No (10MB limit free)", "No ads": "No",
      "Open source": "No", "Self-hostable": "No",
      "Files processed privately": "No (uploaded to their servers)",
      "No watermarks on free tier": "Yes",
      "175+ tools (PDF, image, video, audio, dev)": "No (basic PDF editing only)",
      "Works offline / client-side tools": "No",
      "Desktop app included": "Yes (Windows, paid)", "API available": "No",
    },
  },
  "nitro-pdf": {
    name: "Nitro PDF", slug: "nitro-pdf",
    tagline: "Business PDF suite with paid subscription",
    toolCount: "PDF + e-sign", pricing: "$129/yr Pro", freeLimit: "14-day trial",
    openSource: false, selfHostable: false, cloudUploads: true,
    features: {
      "Free to use": "No (paid, 14-day trial only)", "No account required": "No",
      "No file size limits": "No", "No ads": "Yes",
      "Open source": "No", "Self-hostable": "No",
      "Files processed privately": "No (Nitro cloud)",
      "No watermarks on free tier": "N/A (no free tier)",
      "175+ tools (PDF, image, video, audio, dev)": "No (PDF + e-sign only)",
      "Works offline / client-side tools": "Desktop app (paid)",
      "E-signatures": "Yes (paid)", "API available": "Yes (paid)",
    },
  },
};

const privatoolsFeatures: Record<string, boolean | string> = {
  "Free to use": "Yes — 100% free",
  "No account required": "Yes",
  "No file size limits": "500MB per file",
  "No ads": "Yes",
  "Open source": "Yes (MIT license)",
  "Self-hostable": "Yes (Docker)",
  "Files processed privately": "Yes — deleted immediately",
  "No watermarks on free tier": "Yes",
  "175+ tools (PDF, image, video, audio, dev)": "Yes",
  "Works offline / client-side tools": "Yes (dev tools)",
  "JSON-LD structured data": "Yes",
  "Desktop app included": "PWA installable",
  "E-signatures": "Yes (free)",
  "API available": "Coming soon",
};

/**
 * FeatureCell — renders a Yes / No / nuanced cell with workshop styling.
 *
 * Contrast guarantees:
 *   - "Yes" uses a low-opacity accent chip — passes WCAG AA on light + dark.
 *   - "No"  uses a low-opacity copper chip with bold X — distinguishes it from
 *     a "limited" string, which stays inline (no chip) so the eye reads it as
 *     mid-tier rather than a hard fail.
 */
function FeatureCell({ value, highlight }: { value: boolean | string; highlight?: boolean }) {
  if (value === true || value === "Yes") {
    return <span className={cn(
      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-accent/12 border border-accent/30 font-mono text-[12px] tracking-[0.04em]",
      highlight ? "text-accent font-semibold" : "text-accent"
    )}><Check size={13} strokeWidth={2.5} /> Yes</span>;
  }
  if (value === false || value === "No") {
    return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-copper/10 border border-copper/30 font-mono text-[12px] tracking-[0.04em] text-copper">
      <X size={13} strokeWidth={2.5} /> No
    </span>;
  }
  const v = value as string;
  const isPositive = v.startsWith("Yes") || v === "500MB per file" || v.startsWith("PWA");
  return <span className={cn(
    "font-mono text-[12px] tracking-[0.02em] leading-snug",
    isPositive ? (highlight ? "text-accent font-semibold" : "text-accent") : "text-muted-foreground"
  )}>{v}</span>;
}

// Approximate monthly pricing — used for the savings calc on Compare directory.
const MONTHLY_PRICING: Record<string, number> = {
  ilovepdf: 4, smallpdf: 9, "adobe-acrobat": 23, sejda: 7.5, pdf24: 0,
  foxit: 14, lightpdf: 10, "stirling-pdf": 0, dochub: 7, pdfescape: 3, "nitro-pdf": 10.75,
};

/**
 * Per-competitor honest tradeoff: the one area where this competitor genuinely
 * beats PrivaTools today. Showing this builds trust — every "winner badge X/4"
 * looks more credible when paired with an honest concession.
 *
 * If a competitor truly has no meaningful edge, leave the field undefined and
 * the UI falls back to "fair tie · no compelling edge".
 */
const COMPETITOR_EDGE: Record<string, string | undefined> = {
  ilovepdf:        "Mobile apps for iOS & Android with offline mode",
  smallpdf:        "Polished desktop apps (Mac + Windows) and OCR via paid tier",
  "adobe-acrobat": "Industry-standard E-sign workflow with audit trail + Acrobat Pro desktop",
  sejda:           "Mature OCR engine + bookmark editor not yet in PrivaTools",
  pdf24:           "Mature Windows desktop suite with deep file-explorer integration",
  foxit:           "Enterprise SSO, DLP, and SharePoint connector",
  lightpdf:        "Multilingual AI-summary tied to their account, with longer history",
  "stirling-pdf":  "Bigger contributor count + earlier mover in the self-host PDF niche",
  dochub:          "Google Workspace + Microsoft 365 integration for in-app signing",
  pdfescape:       "Long-running brand recognition since 2007",
  "nitro-pdf":     "Enterprise volume licensing and Sign-as-a-Service product",
};

/** Count how many of the four "fundamental" axes PrivaTools wins on. */
function privatoolsWinsVs(c: CompetitorData): number {
  let wins = 0;
  // Truly free
  if (!c.pricing?.toLowerCase().startsWith("free")) wins++;
  if (!c.openSource) wins++;
  if (!c.selfHostable) wins++;
  if (c.cloudUploads) wins++;
  return wins;
}

type SortKey = "default" | "tools" | "price" | "wins";
type FilterId = "all" | "free" | "paid" | "open" | "selfhost" | "private";

export default function ComparePage() {
  const { competitor } = useParams<{ competitor: string }>();
  const comp = competitor ? competitors[competitor] : null;

  // ═════ Directory view ═════
  if (!comp) {
    return <DirectoryView />;
  }

  // ═════ Detail view — vs single competitor ═════
  const allFeatures = [...new Set([...Object.keys(comp.features), ...Object.keys(privatoolsFeatures)])];

  return (
    <div>
      {/* No nested <main> — AppShell already provides `<main id="main-content">`. */}
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-14 space-y-12">

        {/* ── Back link ── */}
        <nav>
          <Link to="/compare" className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground hover:text-accent transition-colors">
            <ArrowLeft size={12} /> All comparisons
          </Link>
        </nav>

        {/* ── Hero ── */}
        <header className="animate-fade-up text-center">
          <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-accent/30 bg-accent/[0.05] font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent mb-5">
            <Shield size={11} /> Honest comparison · updated May 2026
          </span>
          <h1 className="font-display font-bold text-foreground tracking-[-0.025em] leading-tight text-3xl sm:text-5xl"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
            PrivaTools <span className="text-muted-foreground/60">vs</span> <span className="italic text-accent">{comp.name}</span>
          </h1>
          {/* Competitor tagline + pricing snapshot — gives the hero specificity instead of a generic byline. */}
          <p className="font-display italic text-[15px] sm:text-[17px] text-muted-foreground/85 max-w-xl mx-auto mt-3 leading-relaxed">
            "{comp.tagline}"
          </p>
          <p className="comparison-summary font-display text-[15px] sm:text-[17px] text-muted-foreground max-w-2xl mx-auto mt-4 leading-relaxed">
            Side-by-side comparison of features, pricing, and privacy practices — including the one area where {comp.name} genuinely beats us today.
          </p>
          <div className="mt-5 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border border-border bg-card font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">
            <Trophy size={10} className="text-accent" />
            PrivaTools wins <span className="text-accent font-semibold">{privatoolsWinsVs(comp)}</span>/4 fundamentals
          </div>
        </header>

        {/* ── Quick stats ── */}
        <section className="grid grid-cols-2 sm:grid-cols-3 gap-3 animate-fade-up">
          {[
            { label: "Pricing",    value: comp.pricing || "—",    Icon: DollarSign },
            { label: "Free tier",  value: comp.freeLimit || "—",  Icon: Zap },
            { label: "Tools",      value: comp.toolCount || "—",  Icon: ServerCog },
          ].map((s, i) => {
            const Icon = s.Icon;
            return (
              <div key={i} className="rounded-xl border border-border bg-card p-4">
                <Icon size={13} className="text-muted-foreground" />
                <p className="mt-2 font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">{s.label}</p>
                <p className="mt-1 font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">{s.value}</p>
              </div>
            );
          })}
        </section>

        {/* ── Feature matrix ── */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden animate-fade-up">
          <div className="px-5 py-3 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
            <span className="text-accent">§</span> Feature matrix
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-paper-2/20">
                  <th className="text-left px-5 py-2.5 font-mono text-[9.5px] tracking-[0.10em] uppercase text-muted-foreground w-[40%]">Feature</th>
                  <th className="text-left px-4 py-2.5 font-mono text-[9.5px] tracking-[0.10em] uppercase text-accent">PrivaTools</th>
                  <th className="text-left px-4 py-2.5 font-mono text-[9.5px] tracking-[0.10em] uppercase text-muted-foreground">{comp.name}</th>
                </tr>
              </thead>
              <tbody>
                {allFeatures.map((feature, i) => (
                  <tr key={feature} className={cn("border-b border-border last:border-0", i % 2 === 1 && "bg-paper-2/15")}>
                    <td className="px-5 py-3 text-[13px] font-medium text-foreground">{feature}</td>
                    <td className="px-4 py-3">
                      <FeatureCell value={privatoolsFeatures[feature] ?? false} highlight />
                    </td>
                    <td className="px-4 py-3">
                      <FeatureCell value={comp.features[feature] ?? false} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Honest tradeoff card ── */}
        <section className="animate-fade-up rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground inline-flex items-center gap-1.5 w-full">
            <Scale size={11} className="text-accent" />
            <span><span className="text-accent">§</span> Honest tradeoff</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
            <div className="p-6 sm:p-7">
              <p className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent mb-2 inline-flex items-center gap-1.5">
                <Trophy size={11} /> PrivaTools wins for
              </p>
              <h3 className="font-display text-[18px] font-bold text-foreground tracking-[-0.02em] mb-3 leading-snug">
                Privacy, price, and breadth
              </h3>
              <ul className="space-y-2 text-[13px] text-muted-foreground leading-relaxed">
                <li className="flex items-start gap-2"><Check size={13} className="text-accent mt-0.5 shrink-0" /> Files unlinked the moment we finish, never retained.</li>
                <li className="flex items-start gap-2"><Check size={13} className="text-accent mt-0.5 shrink-0" /> Zero account, zero quota, zero upsell pop-ups.</li>
                <li className="flex items-start gap-2"><Check size={13} className="text-accent mt-0.5 shrink-0" /> 175+ tools across PDF, image, video, audio, dev — one suite.</li>
                <li className="flex items-start gap-2"><Check size={13} className="text-accent mt-0.5 shrink-0" /> MIT-licensed, fully self-hostable in one Docker command.</li>
              </ul>
            </div>
            <div className="p-6 sm:p-7 bg-paper-2/30">
              <p className="font-mono text-[10px] tracking-[0.10em] uppercase text-copper mb-2 inline-flex items-center gap-1.5">
                <Trophy size={11} /> {comp.name} wins for
              </p>
              <h3 className="font-display text-[18px] font-bold text-foreground tracking-[-0.02em] mb-3 leading-snug">
                {COMPETITOR_EDGE[comp.slug] ? "A few specific scenarios" : "Brand familiarity only"}
              </h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                {COMPETITOR_EDGE[comp.slug] ?? "On the axes we measure, we don't see a meaningful edge for this competitor — they're competing primarily on legacy brand recognition."}
              </p>
              <p className="mt-3 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                <Minus size={10} className="inline mr-1" />
                If that workflow is your main need, this competitor may serve you better.
              </p>
            </div>
          </div>
        </section>

        {/* ── Why PrivaTools ── */}
        <section className="animate-fade-up">
          <p className="section-mark mb-2">Verdict</p>
          <h2 className="font-display text-[26px] sm:text-[30px] font-bold text-foreground tracking-[-0.025em] leading-tight"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
            Why choose <span className="italic text-accent">PrivaTools</span>?
          </h2>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { icon: Lock,  title: "True privacy",     desc: "Files processed and immediately deleted. No cloud storage, no data mining." },
              { icon: Heart, title: "Actually free",    desc: "No '2 tasks/day' limits, no premium upsells, no watermarks. Every tool, every time." },
              { icon: Globe, title: "Open source",      desc: "MIT licensed. Audit every line of code. Self-host with Docker if you don't trust anybody." },
              { icon: Zap,   title: "175+ tools",       desc: "Not just PDF — image, video, audio, and developer tools too. All in one place." },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="rounded-xl border border-border bg-card p-4 hover:border-accent/45 transition-colors">
                  <div className="flex items-center gap-2">
                    <Icon size={14} className="text-accent" />
                    <h3 className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">{item.title}</h3>
                  </div>
                  <p className="mt-2 text-[12.5px] text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
          <div className="relative p-7 sm:p-9 text-center">
            <CornerMarks />
            <p className="section-mark mb-3 inline-block">Try it free</p>
            <h2 className="font-display text-[26px] sm:text-[30px] font-bold text-foreground tracking-[-0.025em] leading-tight"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
              Switch in <span className="italic text-accent">one click</span>.
            </h2>
            <p className="mt-2 text-[14px] text-muted-foreground">No sign-up. No quota. No catch.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/" className="btn-accent">
                Browse all tools <ArrowRight size={13} />
              </Link>
              <a
                href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
              >
                <Github size={13} /> View source
              </a>
            </div>
          </div>
        </section>

        {/* ── Other comparisons ── */}
        <section className="pb-4">
          <p className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground text-center mb-4">
            <span className="text-accent">§</span> Other comparisons · wins / 4
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {Object.entries(competitors)
              .filter(([key]) => key !== competitor)
              .map(([key, c]) => {
                const w = privatoolsWinsVs(c);
                return (
                  <Link
                    key={key}
                    to={`/compare/${key}`}
                    className="group inline-flex items-center gap-1.5 h-8 pl-3 pr-1.5 rounded-full border border-border bg-card font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground hover:border-accent/45 hover:bg-accent/[0.04] hover:text-accent transition-colors"
                  >
                    <span>vs {c.name}</span>
                    <span className={cn(
                      "inline-flex items-center gap-0.5 h-5 px-1.5 rounded-full font-mono text-[9.5px] tracking-[0.06em] uppercase",
                      w >= 3 ? "bg-accent/15 text-accent border border-accent/30" : "bg-secondary/60 text-muted-foreground border border-border"
                    )}>
                      <Trophy size={9} /> {w}/4
                    </span>
                  </Link>
                );
              })}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * DirectoryView — the no-slug listing page.
 *
 * Adds substance:
 *   - Filter chips (free / open / self-host / private) with one-click toggle
 *   - Sort control (default / by-tool-count / by-price / by-wins)
 *   - Per-competitor "PrivaTools wins X/4" badge based on the four axes
 *   - Annual-savings tile pulling from MONTHLY_PRICING
 *   - Pruned/filtered count chip
 */
function DirectoryView() {
  const allEntries = Object.entries(competitors);
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortKey>("default");

  const filtered = useMemo(() => {
    return allEntries.filter(([, c]) => {
      switch (filter) {
        case "free":     return c.pricing?.toLowerCase().startsWith("free");
        case "paid":     return !c.pricing?.toLowerCase().startsWith("free");
        case "open":     return c.openSource;
        case "selfhost": return c.selfHostable;
        case "private":  return !c.cloudUploads;
        default:         return true;
      }
    });
  }, [allEntries, filter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    switch (sort) {
      case "tools": {
        return list.sort(([, a], [, b]) => {
          const ax = parseInt((a.toolCount || "0").replace(/[^\d]/g, ""), 10) || 0;
          const bx = parseInt((b.toolCount || "0").replace(/[^\d]/g, ""), 10) || 0;
          return bx - ax;
        });
      }
      case "price":
        return list.sort(([ka], [kb]) => (MONTHLY_PRICING[ka] ?? 0) - (MONTHLY_PRICING[kb] ?? 0));
      case "wins":
        return list.sort(([, a], [, b]) => privatoolsWinsVs(b) - privatoolsWinsVs(a));
      default:
        return list;
    }
  }, [filtered, sort]);

  const annualSavingsAll = Math.round(allEntries.reduce((sum, [k]) => sum + (MONTHLY_PRICING[k] || 0) * 12, 0));

  const FILTERS: { id: FilterId; label: string; Icon: typeof DollarSign }[] = [
    { id: "all",      label: "All competitors",  Icon: ServerCog },
    { id: "free",     label: "Truly free",       Icon: DollarSign },
    { id: "paid",     label: "Paid only",        Icon: DollarSign },
    { id: "open",     label: "Open source",      Icon: Lock },
    { id: "selfhost", label: "Self-hostable",    Icon: ServerCog },
    { id: "private",  label: "No cloud uploads", Icon: Shield },
  ];

  const SORTS: { id: SortKey; label: string }[] = [
    { id: "default", label: "Default" },
    { id: "tools",   label: "Tool count" },
    { id: "price",   label: "Price ↑" },
    { id: "wins",    label: "Where we win" },
  ];

  return (
    <div>
      {/* No nested <main> — AppShell already provides `<main id="main-content">`. */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14 space-y-12">

        {/* ── Masthead ── */}
        <header className="animate-fade-up max-w-3xl">
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border">
            <p className="section-mark">Honest comparisons</p>
            <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
              {allEntries.length} competitors · updated May 2026
            </p>
          </div>
          <h1 className="font-display font-bold text-foreground tracking-[-0.025em] leading-[1.05] text-4xl sm:text-6xl"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
            PrivaTools <span className="text-muted-foreground/60">vs</span> <span className="italic text-accent">everyone</span> else.
          </h1>
          <p className="font-display text-[16px] sm:text-[18px] text-muted-foreground mt-5 leading-relaxed">
            Direct, no-spin comparisons against every major PDF and file tool. We tell you when a competitor wins — and which ones charge for features we give away free.
          </p>
        </header>

        {/* ── At-a-glance stat row — last tile is the savings calc ── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-up stagger-1">
          {[
            { icon: DollarSign, label: "Truly free",     value: "No quotas" },
            { icon: Lock,       label: "Open source",    value: "MIT licensed" },
            { icon: ServerCog,  label: "Self-hostable",  value: "Docker" },
            { icon: Zap,        label: "All categories", value: "175+ tools" },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="relative rounded-xl border border-accent/30 bg-accent/[0.05] p-4 overflow-hidden hover:bg-accent/[0.08] transition-colors">
                <CornerMarks />
                <Icon size={14} className="text-accent" />
                <p className="mt-2 font-mono text-[9.5px] tracking-[0.10em] uppercase text-muted-foreground">{s.label}</p>
                <p className="mt-1 font-display text-[14px] font-bold text-foreground tracking-[-0.015em] leading-snug">{s.value}</p>
              </div>
            );
          })}
        </section>

        {/* ── Savings calculator tile ── */}
        <section className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
          <div className="relative p-7 sm:p-9 grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-7 items-center">
            <CornerMarks />
            <div>
              <p className="section-mark mb-2">§ Annual savings</p>
              <h2 className="font-display text-[22px] sm:text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight"
                  style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                If you bought everyone below
              </h2>
              <div className="mt-5 flex items-baseline gap-2">
                <span className="font-display font-bold text-foreground text-6xl sm:text-7xl tracking-[-0.04em] leading-none"
                      style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                  ${annualSavingsAll}
                </span>
                <span className="font-mono text-[12px] tracking-[0.06em] uppercase text-muted-foreground">/ yr</span>
              </div>
              <p className="mt-2 font-mono text-[11px] tracking-[0.04em] uppercase text-accent">
                <span>§</span> What PrivaTools saves you
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground flex items-center justify-between">
                <span><span className="text-accent">§</span> Competitor pricing</span>
                <span>monthly</span>
              </div>
              <div className="divide-y divide-border max-h-72 overflow-y-auto">
                {allEntries.map(([k, c]) => (
                  <div key={k} className="px-4 py-2 flex items-center justify-between text-[13px]">
                    <span className="text-foreground">{c.name}</span>
                    <span className="font-mono text-muted-foreground">
                      {MONTHLY_PRICING[k] === 0 ? "Free" : `$${MONTHLY_PRICING[k].toFixed(2)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Filter + sort controls ── */}
        <section className="space-y-3 animate-fade-up">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <nav className="flex flex-wrap gap-2">
              {FILTERS.map(f => {
                const active = filter === f.id;
                const FI = f.Icon;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border font-mono text-[10.5px] tracking-[0.10em] uppercase transition-colors",
                      active
                        ? "border-accent bg-accent/[0.08] text-accent"
                        : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground"
                    )}
                  >
                    <FI size={11} /> {f.label}
                  </button>
                );
              })}
            </nav>
            <div className="inline-flex items-center gap-1 p-1 rounded-md border border-border bg-paper-2/40">
              <ArrowUpDown size={11} className="text-muted-foreground ml-1.5" />
              {SORTS.map(s => {
                const active = sort === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSort(s.id)}
                    className={cn(
                      "h-7 px-2.5 rounded font-mono text-[10.5px] tracking-[0.06em] uppercase transition-colors",
                      active ? "bg-card border border-accent text-accent" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
            <span className="text-accent">§</span> Showing <span className="text-accent">{sorted.length}</span> of {allEntries.length} competitors
          </p>
        </section>

        {/* ── Quick-answer matrix ── */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden animate-fade-up">
          <div className="px-5 py-3 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
            <span><span className="text-accent">§</span> Quick-answer matrix · click headers to sort</span>
            <span>{sorted.length} rows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-paper-2/20">
                  <th className="text-left px-5 py-2.5 font-mono text-[9.5px] tracking-[0.10em] uppercase text-muted-foreground">Tool</th>
                  <SortableHeader label="Free"      align="center" thisKey="price" sort={sort} setSort={setSort} />
                  <SortableHeader label="Open src"  align="center" thisKey="wins"  sort={sort} setSort={setSort} />
                  <SortableHeader label="Self-host" align="center" thisKey="wins"  sort={sort} setSort={setSort} />
                  <SortableHeader label="Private"   align="center" thisKey="wins"  sort={sort} setSort={setSort} />
                  <SortableHeader label="Tools"     align="right"  thisKey="tools" sort={sort} setSort={setSort} />
                </tr>
              </thead>
              <tbody>
                {/* PrivaTools — highlighted */}
                <tr className="border-b border-accent/20 bg-accent/[0.06] hover:bg-accent/[0.09] transition-colors">
                  <td className="px-5 py-3.5">
                    <span className="font-display font-bold text-foreground tracking-[-0.015em]">PrivaTools</span>
                    <span className="ml-2 inline-flex items-center h-5 px-1.5 rounded font-mono text-[9px] tracking-[0.10em] uppercase font-bold bg-accent/25 text-accent border border-accent/40">Us</span>
                  </td>
                  {/* Each cell pairs the icon with a sr-only text label so screen
                     readers don't have to interpret a bare green check as "yes". */}
                  <td className="text-center px-3"><Check size={14} className="inline text-accent" strokeWidth={2.5} aria-hidden="true" /><span className="sr-only">Yes</span></td>
                  <td className="text-center px-3"><Check size={14} className="inline text-accent" strokeWidth={2.5} aria-hidden="true" /><span className="sr-only">Yes</span></td>
                  <td className="text-center px-3"><Check size={14} className="inline text-accent" strokeWidth={2.5} aria-hidden="true" /><span className="sr-only">Yes</span></td>
                  <td className="text-center px-3"><Check size={14} className="inline text-accent" strokeWidth={2.5} aria-hidden="true" /><span className="sr-only">Yes</span></td>
                  <td className="text-right px-5 font-mono text-[12px] text-accent font-semibold">175+</td>
                </tr>
                {sorted.map(([key, c]) => {
                  const yes = (label: string) => (<><Check size={13} className="inline text-accent" strokeWidth={2.5} aria-hidden="true" /><span className="sr-only">{label}: yes</span></>);
                  const no  = (label: string) => (<><X size={13} className="inline text-muted-foreground/40" aria-hidden="true" /><span className="sr-only">{label}: no</span></>);
                  return (
                  <tr key={key} className="border-b border-border last:border-0 hover:bg-secondary/40 transition-colors">
                    <td className="px-5 py-3">
                      <Link to={`/compare/${key}`} className="font-display font-semibold text-[14px] text-foreground tracking-[-0.015em] hover:text-accent transition-colors">{c.name}</Link>
                    </td>
                    <td className="text-center px-3">{c.pricing?.toLowerCase().startsWith("free") ? yes("Free") : no("Free")}</td>
                    <td className="text-center px-3">{c.openSource ? yes("Open source") : no("Open source")}</td>
                    <td className="text-center px-3">{c.selfHostable ? yes("Self-hostable") : no("Self-hostable")}</td>
                    <td className="text-center px-3">{!c.cloudUploads ? yes("Private") : no("Private")}</td>
                    <td className="text-right px-5 font-mono text-[11.5px] text-muted-foreground">{c.toolCount || "—"}</td>
                  </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center">
                      <p className="font-mono text-[11px] tracking-[0.10em] uppercase text-muted-foreground">No competitors match this filter</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Head-to-head cards ── */}
        <section className="animate-fade-up">
          <p className="section-mark mb-2">Head-to-head</p>
          <h2 className="font-display text-[28px] sm:text-[32px] font-bold text-foreground tracking-[-0.025em] leading-tight"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
            Pick a comparison
          </h2>
          <p className="text-[14px] text-muted-foreground mt-2 mb-6">Each page is a full feature-by-feature breakdown plus pricing, free-tier limits, and our honest verdict.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map(([key, c], i) => {
              const wins = privatoolsWinsVs(c);
              const monthly = MONTHLY_PRICING[key] || 0;
              const theirEdge = COMPETITOR_EDGE[key];
              return (
                <Link
                  key={key}
                  to={`/compare/${key}`}
                  className="group relative flex flex-col rounded-xl border border-border bg-card p-5 hover:border-accent/45 hover:bg-accent/[0.02] hover:-translate-y-0.5 transition-all overflow-hidden"
                >
                  <div className="flex items-start justify-between mb-3 gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 mb-1">§{String(i + 1).padStart(2, "0")}</p>
                      <h3 className="font-display text-[19px] font-bold text-foreground tracking-[-0.02em] group-hover:text-accent transition-colors leading-tight">
                        vs {c.name}
                      </h3>
                      <p className="text-[12.5px] text-muted-foreground mt-1 leading-snug">{c.tagline}</p>
                    </div>
                    {/* Winner badge */}
                    <div className={cn(
                      "shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full border font-mono text-[10px] tracking-[0.06em] uppercase",
                      wins >= 3 ? "border-accent/45 bg-accent/[0.08] text-accent" : "border-border bg-card text-muted-foreground"
                    )}>
                      <Trophy size={10} /> {wins}/4
                    </div>
                  </div>
                  <div className="space-y-1.5 mt-3 mb-3 font-mono text-[11px] tracking-[0.02em]">
                    <div className="flex items-center gap-2">
                      <DollarSign size={11} className="text-muted-foreground shrink-0" />
                      <span className="text-foreground">{c.pricing || "Paid"}</span>
                      {monthly > 0 && <span className="text-muted-foreground/60 ml-auto">= ${Math.round(monthly * 12)}/yr</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Zap size={11} className="text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">Free: {c.freeLimit || "limited"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.cloudUploads ? <Cloud size={11} className="text-copper shrink-0" /> : <Lock size={11} className="text-accent shrink-0" />}
                      <span className="text-muted-foreground">{c.cloudUploads ? "Uploads to their cloud" : "Self-hosted only"}</span>
                    </div>
                  </div>

                  {/* Honest-tradeoff line — surfaces the one thing the competitor genuinely
                      wins on. Builds trust by not pretending PrivaTools is strictly best at
                      everything. Falls back to a neutral note when nothing stands out. */}
                  <div className="mb-4 rounded-md border border-border/70 bg-paper-2/40 px-2.5 py-2">
                    <p className="font-mono text-[9.5px] tracking-[0.10em] uppercase text-copper mb-0.5 inline-flex items-center gap-1">
                      <Scale size={9} /> Where they win
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground leading-snug">
                      {theirEdge ?? "Fair tie · no compelling edge"}
                    </p>
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5 mt-auto pt-3 border-t border-border">
                    {c.openSource && (
                      <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded font-mono text-[9.5px] tracking-[0.10em] uppercase bg-accent/15 border border-accent/30 text-accent">
                        <Lock size={9} /> Open
                      </span>
                    )}
                    {c.selfHostable && (
                      <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded font-mono text-[9.5px] tracking-[0.10em] uppercase bg-accent/15 border border-accent/30 text-accent">
                        <ServerCog size={9} /> Self
                      </span>
                    )}
                    {!c.openSource && !c.cloudUploads && (
                      <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded font-mono text-[9.5px] tracking-[0.10em] uppercase bg-secondary/60 border border-border text-muted-foreground">
                        <EyeOff size={9} /> Closed
                      </span>
                    )}
                    {c.cloudUploads && (
                      <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded font-mono text-[9.5px] tracking-[0.10em] uppercase bg-copper/15 border border-copper/30 text-copper">
                        <Eye size={9} /> Sees files
                      </span>
                    )}
                    <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent">
                      Compare <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── Why us / value-prop ── */}
        <section className="rounded-2xl border border-accent/30 bg-accent/[0.04] overflow-hidden animate-fade-up">
          <div className="relative p-7 sm:p-9 animate-corner-extend">
            <CornerMarks />
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr] gap-8">
              <div>
                <p className="section-mark mb-2">Why us</p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-foreground tracking-[-0.025em] leading-tight"
                    style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                  <span className="italic text-accent">${annualSavingsAll}/yr</span> worth of tools — for $0.
                </h2>
                <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
                  Every paid tier we benchmarked, combined into one MIT-licensed suite. No account, no quota, no upsell. Self-host on Docker if you don't trust the public deploy — the source is right there.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link to="/" className="btn-accent inline-flex">
                    Browse all 175+ tools <ArrowRight size={13} />
                  </Link>
                  <a
                    href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                  >
                    <Github size={13} /> View source · MIT
                  </a>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { icon: Lock,  title: "True privacy",     desc: "Files processed in an isolated container and deleted immediately. No 2-hour retention." },
                  { icon: Heart, title: "Actually free",    desc: "No \"2 tasks/day\" limits, no premium upsells, no watermarks, no account ever required." },
                  { icon: Globe, title: "Open source",      desc: "MIT-licensed. Audit every line. Self-host on Docker if you don't trust anybody." },
                  { icon: Zap,   title: "175+ tools",       desc: "PDF, image, video, audio, dev utilities — plus browser-side AI for summarization and redaction." },
                ].map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div key={i} className="rounded-xl border border-border bg-card p-4 hover:border-accent/45 transition-colors">
                      <div className="h-9 w-9 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center">
                        <Icon size={15} className="text-accent" />
                      </div>
                      <h3 className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em] mt-3">{item.title}</h3>
                      <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * SortableHeader — a column-header <th> button that toggles the parent's sort.
 *
 * We map four matrix columns onto the existing three sortable axes:
 *   - "Free"      → sort by Price (cheap first)
 *   - "Open src" / "Self-host" / "Private" → sort by Where-we-win (which favors
 *     competitors that share these properties with PrivaTools)
 *   - "Tools"     → sort by tool-count
 *
 * Multiple columns mapping to "wins" is intentional: clicking any of the three
 * privacy-leaning columns re-ranks the table to put the competitors closest to
 * PrivaTools first, which is what the user clicking those columns wants.
 */
function SortableHeader({
  label, align, thisKey, sort, setSort,
}: { label: string; align: "left" | "center" | "right"; thisKey: SortKey; sort: SortKey; setSort: (k: SortKey) => void }) {
  const active = sort === thisKey;
  return (
    <th className={cn(
      "px-3 py-2.5 font-mono text-[9.5px] tracking-[0.10em] uppercase",
      align === "right" && "text-right pr-5",
      align === "left"  && "text-left pl-5",
      align === "center" && "text-center",
    )}>
      <button
        type="button"
        onClick={() => setSort(active ? "default" : thisKey)}
        aria-sort={active ? "descending" : "none"}
        className={cn(
          "inline-flex items-center gap-1 transition-colors",
          align === "right" && "ml-auto",
          align === "center" && "mx-auto",
          active ? "text-accent" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
        <ArrowUpDown size={9} className={cn(active ? "opacity-100" : "opacity-50")} />
      </button>
    </th>
  );
}

function CornerMarks() {
  const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
  return (
    <>
      <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 left-0 w-px h-3 bg-accent/70" /></span>
      <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 right-0 w-px h-3 bg-accent/70" /></span>
      <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" /></span>
      <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" /></span>
    </>
  );
}
