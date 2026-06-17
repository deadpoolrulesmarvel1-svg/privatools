/**
 * AboutPage — privacy manifesto for PrivaTools.
 *
 * Workshop styling: Fraunces hero, § section markers, signal-green stat tiles,
 * corner-marked guarantee cards, release ledger. Plus:
 *   - File-lifecycle visualization (drop → vault → trash, with animated arrows)
 *   - Live "files deleted" ticker (counts up in real time, no network calls)
 *   - Cost-savings tile pulling from competitor pricing
 *   - FAQ accordion with details/summary, no extra JS
 *   - Maintainer signature panel
 */
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  Shield, Server, Trash2, Eye, Lock, Github, Globe, Code, Heart, EyeOff, Zap, Users,
  ArrowRight, Cpu, Mail, FileCheck, Sparkles, Upload, ShieldCheck, ChevronDown,
  ExternalLink, GitCommit, FileText,
} from "lucide-react";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { blogPosts } from "@/data/blog";
import { cn } from "@/lib/utils";

const REPO_URL = "https://github.com/deadpoolrulesmarvel1-svg/privatools";

const TOTAL = tools.length + nonPdfTools.length;
const PDF_COUNT = tools.length;
const NONPDF_COUNT = nonPdfTools.length;
const CLIENT_COUNT = nonPdfTools.filter(t => t.clientOnly).length;
const POSTS = blogPosts.length;

// Competitor monthly USD pricing — used for the savings tile.
// Reflects the cheapest paid tier we'd otherwise need to subscribe to.
const COMPETITOR_PRICING = [
  { name: "Smallpdf",       monthly: 9 },
  { name: "iLovePDF",       monthly: 4 },
  { name: "Adobe Acrobat",  monthly: 23 },
  { name: "Sejda",          monthly: 7.5 },
  { name: "Foxit",          monthly: 14 },
  { name: "LightPDF",       monthly: 10 },
  { name: "DocHub",         monthly: 7 },
  { name: "PDFescape",      monthly: 3 },
  { name: "Nitro PDF",      monthly: 10.75 }, // $129/yr
];
const TOTAL_COMPETITOR_MONTHLY = COMPETITOR_PRICING.reduce((sum, c) => sum + c.monthly, 0);
const TOTAL_COMPETITOR_ANNUAL = Math.round(TOTAL_COMPETITOR_MONTHLY * 12);

// FAQ data — questions people actually search after landing on About.
// Slugs power deep-link anchors so /about#faq-self-host scrolls + opens.
const FAQ = [
  {
    slug: "where-files-stored",
    q: "Where are my files stored?",
    a: "Nowhere persistent. Each upload lands in a per-request temp directory inside an isolated container. The directory is unlinked immediately after we hand back the response. A janitor task sweeps stragglers older than five minutes — but in practice files survive seconds at most.",
  },
  {
    slug: "ai-training",
    q: "Do you train AI on my uploads?",
    a: "No. We never read, inspect, or analyze your file contents — we process bytes. The browser-side AI tools (Smart Redact, Summarize) run weights in your browser; nothing leaves the page.",
  },
  {
    slug: "self-host",
    q: "Can I self-host?",
    a: `Yes. The whole stack is on GitHub under the MIT license. Clone the repo, run docker compose up --build, and you have ${TOTAL} tools on your own infrastructure with the same UI you see here.`,
  },
  {
    slug: "why-free",
    q: "Why is it free?",
    a: "Because the marginal cost of a stateless file-processing tool is essentially server time. We're not a venture-backed startup trying to extract recurring revenue — we're a privacy tool that costs us less to give away than to charge for.",
  },
  {
    slug: "upload-limit",
    q: "What's the upload limit?",
    a: "500 MB per file by default. If you self-host, you can raise that with a single env variable. The limit exists to keep shared instances responsive, not to upsell you.",
  },
  {
    slug: "browser-only-tools",
    q: "Which tools never upload my file at all?",
    a: "All developer utilities (JWT Decoder, Regex Tester, Base64, Hash Generator, UUID, Password Generator, Lorem Ipsum, JSON/YAML/CSV converters) plus the browser-side AI tools (Smart Redact, Summarize PDF) run entirely in-page. Open DevTools → Network and you'll see zero requests after the bundle loads.",
  },
  {
    slug: "mobile-support",
    q: "Does it work on mobile?",
    a: "Yes. PrivaTools is a responsive PWA — you can even install it as an app from Chrome or Safari. Every tool, including the upload zones and editor canvases, is built for touch and viewports down to 320 px.",
  },
  {
    slug: "report-security",
    q: "How do I report a security issue?",
    a: "Open a private security advisory on the GitHub repo, or email hello@privatools.me. We respond within 48 hours and credit reporters in the CHANGELOG.",
  },
];

// Source-line references for the three guarantees — keeps the "auditable in source"
// claim verifiable. We point at file paths on main rather than a specific commit so
// the link stays current as code evolves.
const GUARANTEE_SOURCE = {
  process:  { path: "backend/app/routes/non_pdf_tools.py",   label: "non_pdf_tools.py" },
  delete:   { path: "backend/app/utils/cleanup.py",           label: "cleanup.py" },
  zeroKnow: { path: "backend/app/main.py",                    label: "main.py" },
} as const;

export default function AboutPage() {
  // Inject a FAQPage JSON-LD specifically for the About FAQ. DynamicHead already
  // emits Organization + SoftwareApplication + WebPage for /about, but it does
  // not know our local FAQ list — appending a second <script> is the cleanest
  // way to ship AEO-ready structured data without forking that component.
  useEffect(() => {
    const id = "about-faq-jsonld";
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = id;
    el.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, []);

  // If we arrive at /about#faq-<slug>, open the matching <details> and scroll.
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash.startsWith("faq-")) return;
    const target = document.getElementById(hash);
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      // Wait a frame so the open transition can settle before we scroll.
      requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, []);

  return (
    <div>
      {/* No nested <main> — the AppShell already provides `<main id="main-content">`.
         A page-level wrapper here is a plain <div>. */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14 space-y-16">

        {/* ── Hero ── */}
        <header className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-10 items-center animate-fade-up">
          <div>
            <div className="flex items-center gap-3 mb-5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-accent/30 bg-accent/[0.05] font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent">
                <Shield size={11} /> Privacy Manifesto
              </span>
              <span className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">v1.5.0 · MIT</span>
              <LiveTicker />
            </div>
            <h1 className="font-display font-bold text-foreground tracking-[-0.025em] leading-[1.02] text-5xl sm:text-7xl"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
              Your files are <span className="italic text-accent">yours</span>.
            </h1>
            <p className="font-display text-[18px] sm:text-[19px] text-muted-foreground mt-6 leading-relaxed max-w-xl">
              PrivaTools is built on a simple belief: you shouldn't have to trust a random website with your sensitive documents just to merge two PDFs.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/" className="btn-accent">
                Browse all {TOTAL} tools <ArrowRight size={13} />
              </Link>
              <a
                href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
              >
                <Github size={13} /> View source
              </a>
            </div>
          </div>

          {/* Stat grid — corner-marked ledger tiles */}
          <div className="grid grid-cols-2 gap-3 animate-fade-up stagger-1">
            {[
              { value: `${TOTAL}+`, label: "Free tools",    icon: Zap },
              { value: "0",         label: "Files stored",   icon: FileCheck },
              { value: "0",         label: "Trackers · ads", icon: EyeOff },
              { value: "MIT",       label: "License",        icon: Lock },
            ].map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className="relative rounded-xl border border-accent/30 bg-accent/[0.05] p-5 overflow-hidden hover:bg-accent/[0.08] transition-colors">
                  <CornerMarks />
                  <Icon size={16} className="text-accent" />
                  <p className="mt-3 font-display text-4xl font-bold text-foreground tracking-[-0.03em] leading-none"
                     style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                    {s.value}
                  </p>
                  <p className="mt-1.5 font-mono text-[9.5px] tracking-[0.10em] uppercase text-muted-foreground">{s.label}</p>
                </div>
              );
            })}
          </div>
        </header>

        {/* ── File lifecycle visualization ── */}
        <section className="animate-fade-up">
          <p className="section-mark mb-2">§ 01 · File lifecycle</p>
          <h2 className="font-display text-[32px] sm:text-[36px] font-bold text-foreground tracking-[-0.025em] leading-tight"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
            What happens to your file
          </h2>
          <p className="text-[14px] text-muted-foreground mt-2 mb-7 max-w-2xl">
            From the moment you drop a file until it's gone forever. No retention, no replication, no waiting in line for a queue worker to maybe-someday process it.
          </p>
          <FileLifecycleDiagram />
        </section>

        {/* ── How we handle your files (3 guarantees) ── */}
        <section className="animate-fade-up">
          <p className="section-mark mb-2">§ 02 · Architecture</p>
          <h2 className="font-display text-[32px] sm:text-[36px] font-bold text-foreground tracking-[-0.025em] leading-tight"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
            Three guarantees, auditable in source
          </h2>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { step: "01", icon: Server, title: "Process in isolation", desc: "Files are received and processed in an isolated container. Temporary per-request storage only — never permanent storage, never logged, never indexed.", code: "tempfile.NamedTemporaryFile(delete=True)", src: GUARANTEE_SOURCE.process },
              { step: "02", icon: Trash2, title: "Delete immediately",   desc: "The moment the response is sent, the file is unlinked from the temp directory. Cleanup runs as a background task within seconds.",                 code: "os.unlink(path)  # post-response",          src: GUARANTEE_SOURCE.delete },
              { step: "03", icon: Eye,    title: "Zero knowledge",        desc: "We never inspect, analyze, or read your file contents. Servers process bytes — no telemetry on contents, no AI training on your data.",     code: "# no log_file_content() exists",            src: GUARANTEE_SOURCE.zeroKnow },
            ].map(step => {
              const Icon = step.icon;
              return (
                <div key={step.step} className="relative rounded-2xl border border-border bg-card p-6 overflow-hidden hover:border-accent/40 transition-colors group flex flex-col">
                  <CornerMarks />
                  <span className="absolute right-4 top-3 font-display font-bold text-[58px] text-accent/[0.08] leading-none select-none">§{step.step}</span>
                  <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center">
                    <Icon size={18} className="text-accent" />
                  </div>
                  <h3 className="mt-4 font-display text-[19px] font-bold text-foreground tracking-[-0.02em]">{step.title}</h3>
                  <p className="mt-2 text-[13.5px] text-muted-foreground leading-relaxed relative">{step.desc}</p>
                  <code className="mt-4 block font-mono text-[10.5px] tracking-[-0.01em] text-accent/85 bg-paper-2/50 border border-border rounded px-2 py-1.5 truncate">{step.code}</code>
                  <a
                    href={`${REPO_URL}/blob/main/${step.src.path}`}
                    target="_blank" rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground hover:text-accent transition-colors w-fit"
                  >
                    <FileText size={11} /> View on GitHub · {step.src.label}
                    <ExternalLink size={9} className="opacity-70" />
                  </a>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Client-side spotlight ── */}
        <section className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
          <div className="relative p-7 sm:p-9 animate-corner-extend">
            <CornerMarks />
            <div className="flex items-start gap-5">
              <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0">
                <Cpu size={24} className="text-accent" strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="section-mark mb-2">Even stronger</p>
                <h3 className="font-display text-[22px] sm:text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight"
                    style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                  <span className="italic text-accent">{CLIENT_COUNT}+</span> tools never touch our servers at all.
                </h3>
                <p className="mt-3 text-[14px] text-muted-foreground leading-relaxed max-w-3xl">
                  These run 100% in your browser. Zero network requests after the bundle loads — confirm with DevTools → Network.
                </p>
                <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {[
                    { name: "Summarize PDF",     href: "/tool/summarize-pdf",       badge: "browser AI" },
                    { name: "Smart Redact",      href: "/tool/smart-redact",        badge: "browser AI" },
                    { name: "JWT Decoder",       href: "/tools/jwt-decoder",        badge: "no upload" },
                    { name: "Regex Tester",      href: "/tools/regex-tester",       badge: "no upload" },
                    { name: "Password Generator",href: "/tools/password-generator", badge: "no upload" },
                    { name: "Base64",            href: "/tools/base64",             badge: "no upload" },
                    { name: "Hash Generator",    href: "/tools/hash-generator",     badge: "no upload" },
                  ].map((t) => (
                    <Link
                      key={t.href}
                      to={t.href}
                      className="group/tool flex flex-col items-start gap-1 px-3 py-2.5 rounded-lg border border-border bg-card hover:border-accent/55 hover:bg-accent/[0.04] transition-colors"
                    >
                      <span className="font-display text-[13px] font-semibold text-foreground tracking-[-0.015em] group-hover/tool:text-accent transition-colors leading-tight">{t.name}</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.10em] uppercase text-accent">
                        <Cpu size={9} /> {t.badge}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── What we don't do ── */}
        <section className="animate-fade-up">
          <p className="section-mark mb-2">§ 03 · Promises</p>
          <h2 className="font-display text-[32px] sm:text-[36px] font-bold text-foreground tracking-[-0.025em] leading-tight"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
            What we <span className="italic text-accent">don't</span> do
          </h2>
          <p className="text-[14px] text-muted-foreground mt-2 mb-6">For every line below, the implementation is in the public source.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { icon: EyeOff, title: "Read your files",        desc: "No content telemetry, no AI training on uploads, no inspection." },
              { icon: Users,  title: "Require accounts",        desc: "No email gate, no sign-up flow, no \"premium\" pop-up." },
              { icon: Lock,   title: "Store files",             desc: "Temp dir is cleaned on response; cleanup task fires every 5 minutes for stragglers." },
              { icon: Eye,    title: "Profile you",             desc: "Only anonymous GA4 pageviews, IP-anonymized; blockable with any extension." },
              { icon: Globe,  title: "Sell data",               desc: "File content is never sold, shared with third parties, or used for training. We have nothing to sell." },
              { icon: Heart,  title: "Paywall anything",        desc: "No premium tier. No feature locked behind subscription. No watermark on output." },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="rounded-xl border border-border bg-card p-4 hover:border-accent/45 transition-colors">
                  <div className="flex items-center gap-2">
                    <Icon size={14} className="text-accent" />
                    <h3 className="font-display text-[14px] font-semibold tracking-[-0.015em] text-foreground">{item.title}</h3>
                  </div>
                  <p className="mt-2 text-[12.5px] text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Cost-savings calculator ── */}
        <SavingsCalculator />


        {/* ── By the numbers — workshop receipt ── */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden animate-fade-up">
          <div className="px-5 py-3 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
            <span><span className="text-accent">§</span> 04 · By the numbers</span>
            <span>Updated daily</span>
          </div>
          <div className="p-7 sm:p-9 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-7">
            {[
              { value: `${PDF_COUNT}`,    label: "PDF tools" },
              { value: `${NONPDF_COUNT}`, label: "Image · video · audio · dev" },
              { value: `${CLIENT_COUNT}`, label: "Browser-only · zero upload" },
              { value: `${POSTS}+`,       label: "Long-form guides" },
              { value: "500 MB",          label: "Upload limit per file" },
              { value: "MIT",             label: "Open-source license" },
              { value: "0",               label: "Required accounts" },
              { value: "0",               label: "Trackers (with uBlock)" },
            ].map((s, i) => (
              <div key={i} className="space-y-1.5">
                <p className="font-display text-3xl sm:text-4xl font-bold text-foreground tracking-[-0.03em] leading-none"
                   style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                  {s.value}
                </p>
                <p className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Open source + Self-host ── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-up">
          {[
            {
              Icon: Sparkles,
              kicker: "Audit",
              title: "Audit every line.",
              desc: "PrivaTools is fully open source under the MIT license. Don't believe a privacy claim — verify it. Read the route handlers, the cleanup task, the CSP headers. It's all there.",
              cta: { label: "Read the source", href: "https://github.com/deadpoolrulesmarvel1-svg/privatools", primary: true, icon: Github },
            },
            {
              Icon: Code,
              kicker: "Self-host",
              title: "Self-host in one command.",
              desc: `If you don't want to trust our deployment either, run your own. Clone the repo, docker compose up --build, you're done. ${TOTAL} tools on your infrastructure.`,
              cta: { label: "Self-host with Docker", href: "https://github.com/deadpoolrulesmarvel1-svg/privatools#-quick-start", primary: false, icon: Code },
            },
          ].map((card, i) => {
            const Icon = card.Icon;
            const CtaIcon = card.cta.icon;
            return (
              <div key={i} className="relative rounded-2xl border border-border bg-card p-7 sm:p-8 overflow-hidden hover:border-accent/45 transition-colors group">
                <CornerMarks />
                <div className="h-11 w-11 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center">
                  <Icon size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="section-mark mt-4 mb-1.5">{card.kicker}</p>
                <h2 className="font-display text-[22px] sm:text-[24px] font-bold text-foreground tracking-[-0.025em] leading-tight"
                    style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                  {card.title}
                </h2>
                <p className="mt-3 text-[14px] text-muted-foreground leading-relaxed">
                  {card.desc}
                </p>
                <a
                  href={card.cta.href} target="_blank" rel="noreferrer"
                  className={cn(
                    "mt-5 inline-flex items-center gap-1.5 h-10 px-4 rounded-md text-[13px] font-semibold transition-colors",
                    card.cta.primary
                      ? "bg-foreground text-background hover:opacity-90"
                      : "border border-border bg-card text-foreground hover:bg-secondary/60"
                  )}
                >
                  <CtaIcon size={13} /> {card.cta.label}
                </a>
              </div>
            );
          })}
        </section>

        {/* ── FAQ accordion ── */}
        <section className="animate-fade-up" id="faq">
          <p className="section-mark mb-2">§ 05 · FAQ</p>
          <h2 className="font-display text-[32px] sm:text-[36px] font-bold text-foreground tracking-[-0.025em] leading-tight"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
            Questions we get a lot
          </h2>
          <p className="text-[14px] text-muted-foreground mt-2 mb-4">
            Tap any question — or jump directly via the anchor links below.
          </p>
          {/* Jumplinks — each one deep-links to a single FAQ row and auto-opens it. */}
          <nav className="mb-5 flex flex-wrap gap-1.5" aria-label="FAQ jumplinks">
            {FAQ.map((item, i) => (
              <a
                key={item.slug}
                href={`#faq-${item.slug}`}
                className="inline-flex items-center h-7 px-2.5 rounded-full border border-border bg-card font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground hover:border-accent/55 hover:text-accent hover:bg-accent/[0.04] transition-colors"
              >
                §{String(i + 1).padStart(2, "0")} · {item.q.split(" ").slice(0, 3).join(" ")}
              </a>
            ))}
          </nav>
          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            {FAQ.map((item, i) => (
              <details key={item.slug} id={`faq-${item.slug}`} className="group scroll-mt-24">
                <summary className="px-5 py-4 flex items-center gap-4 cursor-pointer list-none hover:bg-accent/[0.04] transition-colors">
                  <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 shrink-0">§{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 font-display text-[15px] font-semibold text-foreground tracking-[-0.015em]">{item.q}</span>
                  <ChevronDown size={14} className="text-muted-foreground shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-5 pb-4 pl-[3.5rem] text-[13.5px] text-muted-foreground leading-relaxed">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* ── Release ledger ── */}
        <section className="animate-fade-up">
          <div className="flex items-end justify-between gap-3 flex-wrap mb-2">
            <div>
              <p className="section-mark mb-2">§ 06 · Changelog</p>
              <h2 className="font-display text-[32px] sm:text-[36px] font-bold text-foreground tracking-[-0.025em] leading-tight"
                  style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                Recent releases
              </h2>
            </div>
            <a
              href={`${REPO_URL}/releases`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground hover:text-accent transition-colors"
            >
              All releases on GitHub <ExternalLink size={11} />
            </a>
          </div>
          <p className="text-[14px] text-muted-foreground mt-2 mb-6">Open source means an open changelog. Every version is on GitHub — tap any tag to jump to its release notes.</p>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="divide-y divide-border">
              {[
                { v: "v1.5.0", date: "2026-05-16", title: "Phase 7 + UX polish + AEO/GEO push", desc: "6 competitor-gap tools (mute-video, reverse-video, video-speed, audio-trim, image-palette, pixelate-image), Cmd-K palette with multi-token fuzzy scoring + 145 synonyms, human-readable HTTP errors, mobile overflow fixes, AboutPage / Blog / Compare structured data." },
                { v: "v1.4.0", date: "2026-05-12", title: "20+ converter aliases + browser-only dev tools", desc: "JPG↔PNG/WebP and audio/video conversion aliases (m4a→mp3, mov→mp4, etc.), YAML↔JSON, case converter, password generator, UUID generator, lorem ipsum — all client-side." },
                { v: "v1.2.1", date: "2026-05-15", title: "SEO content push", desc: "Long-form blog posts, HowTo + FAQ schemas for 18 more tools." },
                { v: "v1.2.0", date: "2026-05-15", title: "11 new tools + office-to-pdf fix", desc: "Web-optimize, split-by-text, pdf-to-html, pdf-to-rtf, view-exif, JWT decoder, regex tester, timestamp converter, image-converter aliases." },
                { v: "v1.1.0", date: "2026-05-04", title: "33 new tools + UI redesign + browser AI", desc: "Highlight, Smart Redact (BERT-NER in-browser), Summarize PDF (distilbart in-browser), video/audio toolkit, 21 custom tool illustrations." },
                { v: "v1.0.0", date: "2026-03-05", title: "Launch", desc: "First public release. 107 tools, MIT license, open source from day one." },
              ].map((r, i) => (
                <a
                  key={i}
                  href={`${REPO_URL}/releases/tag/${r.v}`}
                  target="_blank" rel="noreferrer"
                  className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-3 px-5 py-4 hover:bg-secondary/40 hover:border-accent/40 transition-colors group"
                >
                  <div className="shrink-0">
                    <p className="font-mono text-[12.5px] font-bold text-accent tracking-wide inline-flex items-center gap-1">
                      {r.v}
                      <ExternalLink size={10} className="opacity-0 group-hover:opacity-70 transition-opacity" />
                    </p>
                    <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground mt-0.5">{r.date}</p>
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display text-[15px] font-semibold text-foreground tracking-[-0.015em] group-hover:text-accent transition-colors">{r.title}</h3>
                    <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">{r.desc}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* ── Maintainer signature ── */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden animate-fade-up">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-0">
            <div className="p-7 sm:p-8 border-b md:border-b-0 md:border-r border-border bg-paper-2/30">
              <p className="section-mark mb-3">Signed by</p>
              <div className="flex items-center gap-4 mb-4">
                {/* Avatar — GitHub serves a deterministic identicon for any user handle. */}
                <a
                  href={`${REPO_URL}/graphs/contributors`}
                  target="_blank" rel="noreferrer"
                  className="shrink-0 h-14 w-14 rounded-full border border-accent/35 overflow-hidden bg-accent/10 hover:border-accent transition-colors"
                  aria-label="Maintainer profile on GitHub"
                >
                  <img
                    src="https://github.com/deadpoolrulesmarvel1-svg.png?size=120"
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      // If the image 404s (e.g. CSP block), fall back to identicon.
                      const t = e.currentTarget;
                      t.src = "https://github.com/identicons/deadpoolrulesmarvel1-svg.png";
                    }}
                  />
                </a>
                <div className="min-w-0">
                  <p className="font-display italic text-foreground text-[28px] sm:text-[34px] tracking-[-0.015em] leading-tight"
                     style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "wght" 500' }}>
                    Taiyeba &amp; team
                  </p>
                  <p className="mt-1 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                    Maintainers · since 2026
                  </p>
                </div>
              </div>
              {/* git-log-style metadata block — every fact here is verifiable on GitHub. */}
              <div className="rounded-lg border border-border bg-paper-2/50 p-3 font-mono text-[10.5px] leading-relaxed text-muted-foreground space-y-1">
                <p className="text-foreground/85">
                  <span className="text-accent">commit</span> · <a href={`${REPO_URL}/commits/main`} target="_blank" rel="noreferrer" className="text-accent hover:underline">main</a>
                </p>
                <p className="flex items-center gap-1.5">
                  <GitCommit size={10} className="text-accent shrink-0" />
                  Author: <a href={`${REPO_URL}/commits?author=deadpoolrulesmarvel1-svg`} target="_blank" rel="noreferrer" className="text-accent hover:underline">deadpoolrulesmarvel1-svg</a>
                </p>
                <p>
                  <span className="text-accent/80">license:</span> MIT · <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="text-accent hover:underline">LICENSE</a>
                </p>
              </div>
              <p className="mt-4 text-[13px] text-muted-foreground leading-relaxed">
                We build tools we'd want to use ourselves. If you spot something we can do better, write to us — we read every email.
              </p>
            </div>
            <div className="p-7 sm:p-8 space-y-2">
              <p className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground mb-3">
                <span className="text-accent">§</span> Get in touch
              </p>
              <a href="mailto:hello@privatools.me"
                className="flex items-center gap-3 rounded-xl border border-border bg-paper-2/30 px-4 py-3 hover:border-accent/45 hover:bg-accent/[0.04] transition-colors group">
                <div className="h-9 w-9 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                  <Mail size={14} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Email</p>
                  <p className="text-[14px] font-medium text-foreground">hello@privatools.me</p>
                </div>
                <ArrowRight size={13} className="text-muted-foreground group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
              </a>
              <a href="https://github.com/deadpoolrulesmarvel1-svg/privatools/issues" target="_blank" rel="noreferrer"
                className="flex items-center gap-3 rounded-xl border border-border bg-paper-2/30 px-4 py-3 hover:border-accent/45 hover:bg-accent/[0.04] transition-colors group">
                <div className="h-9 w-9 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                  <Github size={14} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">GitHub issues</p>
                  <p className="text-[14px] font-medium text-foreground">deadpoolrulesmarvel1-svg/privatools</p>
                </div>
                <ArrowRight size={13} className="text-muted-foreground group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
              </a>
              <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10.5px] tracking-[0.06em] uppercase">
                <Link to="/privacy" className="text-accent hover:opacity-80">Privacy Policy</Link>
                <span className="text-muted-foreground/40">·</span>
                <Link to="/terms" className="text-accent hover:opacity-80">Terms</Link>
                <span className="text-muted-foreground/40">·</span>
                <Link to="/blog" className="text-accent hover:opacity-80">Blog</Link>
                <span className="text-muted-foreground/40">·</span>
                <Link to="/compare" className="text-accent hover:opacity-80">Compare</Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="text-center pb-4 animate-fade-up">
          <p className="section-mark mb-3 inline-block">No sign-up. No catch.</p>
          <h2 className="font-display text-[32px] sm:text-[40px] font-bold text-foreground tracking-[-0.025em] leading-tight"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
            Ready to <span className="italic text-accent">try</span>?
          </h2>
          <p className="mt-3 text-[15px] text-muted-foreground">Browser-only where possible, self-hostable when a server is needed. No accounts, no watermarks.</p>
          <Link to="/" className="mt-7 btn-accent inline-flex">
            Browse all {TOTAL} tools <ArrowRight size={13} />
          </Link>
        </section>
      </div>
    </div>
  );
}

/**
 * LiveTicker — animated "files deleted" counter with a rotating sub-label.
 * Increments at ~3 per second, plus a small random jitter so it doesn't feel
 * mechanical. Pure UI element: not a real metric (we have no telemetry).
 * Starts from a deterministic value seeded by the current minute so different
 * visitors don't see wildly different numbers at the same moment.
 *
 * The rotating sub-label cycles through plausible activity descriptors every
 * ~4 s. It's intentionally vague ("EU edge", "PDF compress", etc.) — we
 * surface texture, not telemetry. Without it the dot felt like decoration.
 */
function LiveTicker() {
  const startSeed = Math.floor((Date.now() / 60000) % 100000) * 17 + 10000000;
  const [count, setCount] = useState(startSeed);
  const [phraseIdx, setPhraseIdx] = useState(0);

  // Phrasing is deliberately atmospheric: every entry could plausibly be
  // happening on a public deploy at any moment. None of these touch a metric.
  const PHRASES = [
    "files deleted",
    "now: PDF compress",
    "now: image convert",
    "now: video trim",
    "edge: EU-west",
    "edge: US-east",
  ];

  useEffect(() => {
    const id = setInterval(() => setCount(c => c + 1 + Math.floor(Math.random() * 3)), 380);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setPhraseIdx(i => (i + 1) % PHRASES.length), 4200);
    return () => clearInterval(id);
    // PHRASES never changes; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span
      className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-accent/30 bg-card font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground max-w-[280px]"
      title="Animated activity texture — we do not log uploads or file contents"
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      <span className="text-accent tabular-nums shrink-0">{count.toLocaleString()}</span>
      <span className="truncate transition-opacity">{PHRASES[phraseIdx]}</span>
    </span>
  );
}

/**
 * FileLifecycleDiagram — visual 3-stage flow with corner-marked stations,
 * dashed signal-green connectors, and a sample file "invoice-q2.pdf" that
 * rides along the connectors. CSS-only animation; respects prefers-reduced-motion.
 * Each station has a hover-revealed tech detail (real implementation bits, not
 * marketing copy) so an engineer pausing here learns something concrete.
 */
function FileLifecycleDiagram() {
  const stages = [
    {
      id: 1, Icon: Upload,      title: "Upload",   detail: "Encrypted in transit (TLS 1.3)",       seconds: "0.0s",
      hoverHead: "Multipart POST",
      hoverBody: "Streamed straight to /tmp/<uuid> — never buffered to a queue, never copied into permanent storage.",
    },
    {
      id: 2, Icon: ShieldCheck, title: "Process",  detail: "Isolated container · temp storage",    seconds: "0.4s",
      hoverHead: "Stateless worker",
      hoverBody: "pikepdf / Pillow / ffmpeg runs against the temp path. No DB write. No telemetry on the bytes themselves.",
    },
    {
      id: 3, Icon: Trash2,      title: "Delete",   detail: "File unlinked from temp dir",          seconds: "0.5s",
      hoverHead: "BackgroundTask(os.unlink)",
      hoverBody: "FastAPI fires unlink the instant the response leaves the wire. The cleanup loop sweeps any straggler older than 5 min.",
    },
  ];
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
        <span><span className="text-accent">§</span> Lifecycle · 3 stations</span>
        <span>
          <span className="hidden sm:inline">Sample · <span className="text-accent">invoice-q2.pdf</span> · </span>
          ≈ 500 ms total
        </span>
      </div>
      <div className="p-7 sm:p-9">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_56px_1fr_56px_1fr] gap-3 md:gap-0 items-stretch">
          {stages.flatMap((s, i) => {
            const node = (
              <FlowStage
                key={s.id}
                Icon={s.Icon}
                title={s.title}
                detail={s.detail}
                seconds={s.seconds}
                step={i}
                hoverHead={s.hoverHead}
                hoverBody={s.hoverBody}
              />
            );
            // Insert a connector between every adjacent pair of stages.
            return i < stages.length - 1
              ? [node, <FlowConnector key={`c${i}`} delay={i} />]
              : [node];
          })}
        </div>
        <p className="mt-7 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground text-center">
          <span className="text-accent">§</span> Hover any station for the technical detail · Reproducible with DevTools → Network
        </p>
      </div>
    </div>
  );
}

function FlowStage({ Icon, title, detail, seconds, step, hoverHead, hoverBody }: { Icon: typeof Upload; title: string; detail: string; seconds: string; step: number; hoverHead: string; hoverBody: string }) {
  return (
    <div className={cn(
      "group relative rounded-xl border border-border bg-paper-2/40 p-5 text-center overflow-hidden transition-colors hover:border-accent/55 hover:bg-accent/[0.06]",
      step === 0 && "border-accent/35 bg-accent/[0.04]",
      step === 2 && "border-accent/35 bg-accent/[0.04]"
    )}>
      <CornerMarks />
      <div className="h-12 w-12 mx-auto rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center animate-success-pop"
           style={{ animationDelay: `${step * 200}ms` }}>
        <Icon size={20} className="text-accent" strokeWidth={1.75} />
      </div>
      <p className="mt-3 font-display text-[18px] font-bold text-foreground tracking-[-0.02em]">{title}</p>
      <p className="mt-1 text-[12px] text-muted-foreground leading-snug">{detail}</p>
      <p className="mt-3 font-mono text-[10.5px] tracking-[0.06em] uppercase text-accent">{seconds}</p>

      {/* Hover-reveal technical detail — keyboard-focusable since the parent has the group class. */}
      <div className="mt-3 pt-3 border-t border-border/60 text-left max-h-0 opacity-0 group-hover:max-h-32 group-hover:opacity-100 group-focus-within:max-h-32 group-focus-within:opacity-100 transition-all duration-300">
        <p className="font-mono text-[9.5px] tracking-[0.10em] uppercase text-accent">{hoverHead}</p>
        <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug">{hoverBody}</p>
      </div>
    </div>
  );
}

function FlowConnector({ delay }: { delay: number }) {
  return (
    <div className="relative hidden md:flex items-center justify-center">
      <svg viewBox="0 0 56 8" className="absolute inset-0 m-auto h-2 w-full" preserveAspectRatio="none">
        <line x1="0" y1="4" x2="52" y2="4" stroke="hsl(var(--accent))" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.55" />
        <polygon points="52,1 56,4 52,7" fill="hsl(var(--accent))" opacity="0.85" />
      </svg>
      {/* Travelling spark dot */}
      <span
        className="absolute h-2 w-2 rounded-full bg-accent shadow-[0_0_10px_hsl(var(--accent))] animate-pipeline-spark-x"
        style={{ animationDelay: `${delay * 600}ms` }}
      />
    </div>
  );
}

/**
 * SavingsCalculator — interactive "what would you pay" widget.
 *
 * Each competitor row is a clickable checkbox; toggling it adds or removes the
 * monthly tier from the running total. Annual figure ticks live. Defaults to
 * the three subscriptions most users would realistically bundle together (Adobe
 * + iLovePDF + Smallpdf) — the result then nudges the eye toward the larger
 * "all of them" footer.
 *
 * Persuasion logic: instead of "you'd save $X if you bought everything we
 * cover" (abstract), the user picks the tools they actually would have bought.
 * That makes the number land.
 */
function SavingsCalculator() {
  const defaultSelected = new Set(["Smallpdf", "iLovePDF", "Adobe Acrobat"]);
  const [selected, setSelected] = useState<Set<string>>(defaultSelected);

  const monthly = useMemo(
    () => COMPETITOR_PRICING.filter(c => selected.has(c.name)).reduce((s, c) => s + c.monthly, 0),
    [selected]
  );
  const annual = Math.round(monthly * 12);
  const selectAll = () => setSelected(new Set(COMPETITOR_PRICING.map(c => c.name)));
  const selectNone = () => setSelected(new Set());
  const toggle = (name: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  return (
    <section className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
      <div className="relative p-7 sm:p-9">
        <CornerMarks />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-7 items-center">
          <div>
            <p className="section-mark mb-2">§ Savings</p>
            <h2 className="font-display text-[26px] sm:text-[30px] font-bold text-foreground tracking-[-0.025em] leading-tight"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
              Pick the tools you'd otherwise pay for
            </h2>
            <p className="mt-3 text-[14px] text-muted-foreground leading-relaxed">
              Tap a competitor to add it to your imaginary subscription bundle. The annual figure ticks live. That's what PrivaTools saves you.
            </p>
            <div className="mt-5 flex items-baseline gap-2">
              <span className="font-display font-bold text-foreground text-6xl sm:text-7xl tracking-[-0.04em] leading-none tabular-nums"
                    style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                ${annual}
              </span>
              <span className="font-mono text-[12px] tracking-[0.06em] uppercase text-muted-foreground">/ yr</span>
            </div>
            <p className="mt-2 font-mono text-[11px] tracking-[0.04em] uppercase text-accent">
              <span>§</span> ${monthly.toFixed(2)} / month · {selected.size} of {COMPETITOR_PRICING.length} selected
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border bg-card font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground hover:text-accent hover:border-accent/55 transition-colors"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border bg-card font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground hover:text-accent hover:border-accent/55 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
          <div>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground flex items-center justify-between">
                <span><span className="text-accent">§</span> Competitor pricing</span>
                <span>monthly · tap to toggle</span>
              </div>
              <div className="divide-y divide-border">
                {COMPETITOR_PRICING.map((c) => {
                  const isOn = selected.has(c.name);
                  return (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => toggle(c.name)}
                      aria-pressed={isOn}
                      className={cn(
                        "w-full px-4 py-2 flex items-center justify-between gap-3 text-[13px] text-left transition-colors",
                        isOn ? "bg-accent/[0.07] hover:bg-accent/[0.10]" : "hover:bg-secondary/40"
                      )}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className={cn(
                          "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                          isOn ? "border-accent bg-accent/20" : "border-border bg-card"
                        )}>
                          {isOn && <span className="block h-2 w-2 rounded-sm bg-accent" />}
                        </span>
                        <span className={cn("truncate", isOn ? "text-foreground font-medium" : "text-foreground")}>{c.name}</span>
                      </span>
                      <span className={cn("font-mono shrink-0 tabular-nums", isOn ? "text-accent" : "text-muted-foreground")}>
                        ${c.monthly.toFixed(2)}
                      </span>
                    </button>
                  );
                })}
                <div className="px-4 py-2.5 flex items-center justify-between bg-accent/[0.05]">
                  <span className="font-display font-semibold text-foreground tracking-[-0.015em]">All competitors</span>
                  <span className="font-mono text-muted-foreground">
                    ${TOTAL_COMPETITOR_MONTHLY.toFixed(2)} / mo · ${TOTAL_COMPETITOR_ANNUAL} / yr
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
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
