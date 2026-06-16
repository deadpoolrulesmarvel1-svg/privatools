/**
 * LandingPage — public marketing surface (lazy-loaded, currently unrouted but
 * preserved for SSR / future marketing-site split).
 *
 * Sells PrivaTools in three seconds: hero headline, three load-bearing trust
 * signals above the fold (MIT, no-account, self-hostable), featured tool tiles,
 * and a community CTA.
 *
 * All numbers are derived from `tools` + `nonPdfTools` so the page never goes
 * stale relative to the catalog.
 */
import { Link } from "react-router-dom";
import { Github, ArrowRight, Lock, Zap, Code2, Heart, Shield, Globe, FileCheck, ServerOff, Package, Check } from "lucide-react";
import { tools, categoryMeta } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { cn } from "@/lib/utils";

const featuredSlugs = ["merge-pdf", "split-pdf", "compress-pdf", "ocr-pdf", "edit-pdf", "sign-pdf"];

// Derived totals — never let marketing numbers diverge from the catalog.
const TOTAL = tools.length + nonPdfTools.length;
const PDF_COUNT = tools.length;
const NONPDF_COUNT = nonPdfTools.length;
const CLIENT_ONLY = nonPdfTools.filter(t => t.clientOnly).length;

// Round to the nearest 5 below TOTAL for the marketing "N+ tools" pitch.
const TOTAL_ROUNDED = Math.floor(TOTAL / 5) * 5;

const features = [
  { icon: Lock,   title: "100% Private",       desc: "All processing happens in temporary server memory and is purged immediately. Or self-host so files never leave your infrastructure." },
  { icon: Zap,    title: "Lightning Fast",     desc: "No queues, no usage gates, no upsells. Drop in a file and a result comes back in seconds." },
  { icon: Globe,  title: "Works Everywhere",   desc: "Any modern browser, any device, any OS. No installs, no plugins, no extensions required." },
  { icon: Code2,  title: "Open Source",        desc: "MIT-licensed. Every line of code that touches your files is public — audit it, fork it, self-host it." },
  { icon: Heart,  title: "Completely Free",    desc: "No freemium, no paywalls, no sign-ups. Every tool is free for everyone, forever." },
  { icon: Shield, title: "No Tracking",        desc: "No cookies for ads, no fingerprinting, no behavioural profiles. Anonymous analytics only — and blockers don't break anything." },
];

// Trust signals — surface above the fold next to the hero.
const TRUST_SIGNALS = [
  { icon: FileCheck,  label: "MIT licensed",       sub: "Audit the code"    , href: "https://github.com/deadpoolrulesmarvel1-svg/privatools/blob/main/LICENSE" },
  { icon: ServerOff,  label: "No account required",sub: "Zero sign-up flow" , href: undefined },
  { icon: Package,    label: "Self-hostable",      sub: "Docker, one command", href: "https://github.com/deadpoolrulesmarvel1-svg/privatools#self-host" },
];

export default function LandingPage() {
  const featured = featuredSlugs.map(s => tools.find(t => t.slug === s)).filter((t): t is NonNullable<typeof t> => Boolean(t));

  return (
    <div>
      {/* No nested <main> — AppShell already provides `<main id="main-content">`. */}
      <div>
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <section className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-20 pb-12">
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-12 items-start">
            {/* Left column — main story */}
            <div>
              <p className="section-mark mb-4">Privacy-first file tools</p>
              <h1
                className="font-display font-bold text-foreground tracking-tight leading-[1.05] text-4xl sm:text-5xl lg:text-6xl"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
              >
                The Only Toolkit That Never Sees Your Files
              </h1>
              <div className="rule-accent mt-6 mb-6 w-16" />
              <p className="font-display text-lg sm:text-xl text-foreground/80 leading-relaxed max-w-lg">
                PrivaTools gives you {TOTAL_ROUNDED}+ powerful file tools — PDF, image, video, and developer
                utilities — with one promise: your files never leave your server. No cloud uploads. No tracking.
                No accounts. Just tools that work.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-start gap-3">
                <Link to="/" className="btn-editorial inline-flex items-center gap-2">
                  Explore all tools <ArrowRight size={14} />
                </Link>
                <a
                  href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 h-11 px-5 font-sans-ui text-sm font-semibold text-foreground border border-border rounded-lg hover:border-foreground/30 hover:bg-secondary/40 transition-all"
                >
                  <Github size={14} /> View on GitHub
                </a>
              </div>

              {/* Trust signals — three load-bearing chips visible above the fold. */}
              <ul className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
                {TRUST_SIGNALS.map(s => {
                  const Icon = s.icon;
                  const content = (
                    <span className="inline-flex items-center gap-1.5">
                      <Check size={11} className="text-accent shrink-0" />
                      <Icon size={11} className="text-accent/80 shrink-0" />
                      <span className="uppercase tracking-[0.06em]">{s.label}</span>
                      <span className="text-muted-foreground/60 normal-case">· {s.sub}</span>
                    </span>
                  );
                  return (
                    <li key={s.label}>
                      {s.href ? (
                        <a href={s.href} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                          {content}
                        </a>
                      ) : (
                        content
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Right column — sidebar */}
            <div className="space-y-6">
              {/* By the numbers — derived from the catalog */}
              <div className="editorial-insert p-6">
                <h2 className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent font-semibold mb-4 inline-flex items-center gap-1.5">
                  <span aria-hidden="true">§</span> By the numbers
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { num: `${TOTAL}`,           label: "Tools" },
                    { num: "0",                  label: "Data collected" },
                    { num: "100%",               label: "Open source" },
                    { num: `${CLIENT_ONLY}`,     label: "Browser-only tools" },
                  ].map(stat => (
                    <div key={stat.label}>
                      <p className="font-display text-3xl font-bold text-foreground nums-tabular">{stat.num}</p>
                      <p className="font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground mt-1 uppercase">{stat.label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 pt-4 border-t border-border font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85">
                  {PDF_COUNT} PDF · {NONPDF_COUNT} non-PDF
                </p>
              </div>

              {/* Today's picks */}
              <div className="editorial-insert p-6">
                <div className="section-flag mb-4">Today's picks</div>
                <div className="space-y-3">
                  {featured.slice(0, 4).map((tool, i) => {
                    const Icon = tool.icon;
                    return (
                      <Link
                        key={tool.slug}
                        to={`/tool/${tool.slug}`}
                        className={cn(
                          "flex items-start gap-3 group opacity-0 animate-fade-up",
                          `stagger-${i + 1}`
                        )}
                      >
                        <Icon size={16} className="text-accent mt-0.5 shrink-0" />
                        <div>
                          <p className="font-display text-sm font-bold text-foreground group-hover:text-accent transition-colors">
                            {tool.name}
                          </p>
                          <p className="font-mono text-[10.5px] text-muted-foreground line-clamp-1">
                            {tool.description}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="rule-thin mx-4 sm:mx-6" />

        {/* ── Featured Tools ──────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16">
          <div className="text-center mb-10">
            <div className="section-flag mx-auto">Most popular</div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-foreground mt-4 tracking-[-0.02em]">
              Start With the Tools Everyone Uses
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {featured.map((tool, i) => {
              const m = categoryMeta[tool.category];
              const Icon = tool.icon;
              return (
                <Link
                  key={tool.slug}
                  to={`/tool/${tool.slug}`}
                  className={cn(
                    "tool-card editorial-insert p-5 group opacity-0 animate-fade-up",
                    `stagger-${i + 1}`
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-sm", m.iconBg)}>
                      <Icon size={18} strokeWidth={1.75} className={m.iconColor} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="category-tag">{m.label}</p>
                      <p className="font-display text-base font-bold text-foreground mt-1 group-hover:text-accent transition-colors">
                        {tool.name}
                      </p>
                      <p className="font-mono text-[11.5px] text-muted-foreground mt-1 line-clamp-2 leading-snug">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-1 font-sans-ui text-xs font-semibold text-accent">
                    Use tool <ArrowRight size={12} />
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="text-center mt-8">
            <Link
              to="/"
              className="font-sans-ui text-sm font-semibold text-accent hover:text-accent/80 transition-colors inline-flex items-center gap-1"
            >
              View all {TOTAL}+ tools <ArrowRight size={14} />
            </Link>
          </div>
        </section>

        <div className="rule-thin mx-4 sm:mx-6" />

        {/* ── Why PrivaTools ──────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16">
          <div className="text-center mb-10">
            <div className="section-flag mx-auto">Why PrivaTools</div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-foreground mt-4 tracking-[-0.02em]">
              Built Different, by Design
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => {
              const FIcon = f.icon;
              return (
                <div
                  key={f.title}
                  className={cn(
                    "editorial-insert p-6 opacity-0 animate-fade-up",
                    `stagger-${i + 1}`
                  )}
                >
                  <FIcon size={22} strokeWidth={1.5} className="text-accent mb-4" />
                  <h3 className="font-display text-lg font-bold text-foreground mb-2 tracking-[-0.015em]">{f.title}</h3>
                  <p className="font-display text-[14.5px] text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        <div className="rule-thin mx-4 sm:mx-6" />

        {/* ── Open Source CTA ─────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 text-center">
          <Github size={32} className="mx-auto text-foreground/30 mb-4" />
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-foreground mb-3 tracking-[-0.02em]">
            Open Source & Community-Driven
          </h2>
          <p className="font-display text-base text-muted-foreground max-w-md mx-auto leading-relaxed mb-8">
            PrivaTools is built in the open. Star us on GitHub, report issues, suggest features, or submit a pull request.
          </p>
          <a
            href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-editorial inline-flex items-center gap-2"
          >
            <Github size={14} /> Star on GitHub
          </a>
          <div className="mt-6 flex items-center justify-center gap-6 font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground uppercase">
            <span>MIT License</span>
            <span aria-hidden="true">·</span>
            <span>PRs Welcome</span>
            <span aria-hidden="true">·</span>
            <span>Self-Hostable</span>
          </div>
        </section>
      </div>
    </div>
  );
}
