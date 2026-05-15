import { Link } from "react-router-dom";
import { Github, ArrowRight, Lock, Zap, Code2, Heart, Shield, Globe } from "lucide-react";
import { tools, categoryMeta } from "@/data/tools";
import { cn } from "@/lib/utils";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";

const featuredTools = ["merge-pdf", "split-pdf", "compress-pdf", "ocr-pdf", "edit-pdf", "sign-pdf"];

const features = [
  { icon: Lock, title: "100% Private", desc: "All processing happens locally on your own server. Your files never leave your infrastructure." },
  { icon: Zap, title: "Lightning Fast", desc: "No waiting for uploads. Local processing means your files are ready in seconds." },
  { icon: Globe, title: "Works Everywhere", desc: "Any browser, any device, any OS. No installs, no plugins, no extensions required." },
  { icon: Code2, title: "Open Source", desc: "Every line of code is public. Audit it, fork it, self-host it, contribute to it." },
  { icon: Heart, title: "Completely Free", desc: "No freemium, no paywalls, no sign-ups. Every tool is free for everyone, forever." },
  { icon: Shield, title: "No Tracking", desc: "We don't collect data, set cookies, or track anything. Your privacy is absolute." },
];

export default function LandingPage() {
  const featured = featuredTools.map(s => tools.find(t => t.slug === s)!).filter(Boolean);

  return (
    <div className="min-h-screen bg-background">
      <EditorialMasthead />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-20 pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-12 items-start">
            {/* Left column — main story */}
            <div>
              <h2 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-[1.1] tracking-tight">
                The Only Toolkit That Never Sees Your Files
              </h2>
              <div className="rule-accent mt-6 mb-6 w-16" />
              <p className="drop-cap font-serif-body text-lg sm:text-xl text-foreground/80 leading-relaxed max-w-lg">
                PrivaTools gives you 152+ powerful file tools — PDF, image, video, and developer utilities — with a promise: your files never leave your server. No cloud uploads. No tracking. No accounts. Just tools that work.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-start gap-3">
                <Link
                  to="/"
                  className="btn-editorial inline-flex items-center gap-2"
                >
                  EXPLORE ALL TOOLS <ArrowRight size={14} />
                </Link>
                <a
                  href="https://github.com/taiyeba-dg/privatools"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-3 font-sans-ui text-xs font-bold uppercase tracking-widest text-muted-foreground border border-border hover:text-foreground hover:border-foreground/30 transition-all"
                >
                  <Github size={14} /> VIEW ON GITHUB
                </a>
              </div>
            </div>

            {/* Right column — sidebar */}
            <div className="space-y-6">
              {/* By the numbers */}
              <div className="editorial-insert p-6">
                <h3 className="font-sans-ui text-xs font-bold uppercase tracking-widest text-primary mb-4">
                  By The Numbers
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { num: "107", label: "Tools" },
                    { num: "0", label: "Data Collected" },
                    { num: "100%", label: "Open Source" },
                    { num: "∞", label: "Free Forever" },
                  ].map(stat => (
                    <div key={stat.label}>
                      <p className="font-heading text-3xl font-bold text-foreground">{stat.num}</p>
                      <p className="font-mono-meta text-xs text-muted-foreground mt-1">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Today's picks */}
              <div className="editorial-insert p-6">
                <div className="section-flag mb-4">TODAY'S PICKS</div>
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
                        <Icon size={16} className="text-primary mt-0.5 shrink-0" />
                        <div>
                          <p className="font-heading text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                            {tool.name}
                          </p>
                          <p className="font-serif-body text-xs text-muted-foreground line-clamp-1">
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
            <div className="section-flag mx-auto">MOST POPULAR</div>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mt-4">
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
                      <p className="font-heading text-base font-bold text-foreground mt-1 group-hover:text-primary transition-colors">
                        {tool.name}
                      </p>
                      <p className="font-serif-body text-sm text-muted-foreground mt-1 line-clamp-2">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-1 font-sans-ui text-xs font-semibold text-primary">
                    Use tool <ArrowRight size={12} />
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="text-center mt-8">
            <Link
              to="/"
              className="font-sans-ui text-sm font-semibold text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1"
            >
              View all 175+ tools <ArrowRight size={14} />
            </Link>
          </div>
        </section>

        <div className="rule-thin mx-4 sm:mx-6" />

        {/* ── Why PrivaTools ──────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16">
          <div className="text-center mb-10">
            <div className="section-flag mx-auto">WHY PRIVATOOLS</div>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mt-4">
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
                  <FIcon size={22} strokeWidth={1.5} className="text-primary mb-4" />
                  <h3 className="font-heading text-lg font-bold text-foreground mb-2">{f.title}</h3>
                  <p className="font-serif-body text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        <div className="rule-thin mx-4 sm:mx-6" />

        {/* ── Open Source CTA ─────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 text-center">
          <Github size={32} className="mx-auto text-foreground/30 mb-4" />
          <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-3">
            Open Source & Community-Driven
          </h2>
          <p className="font-serif-body text-base text-muted-foreground max-w-md mx-auto leading-relaxed mb-8">
            PrivaTools is built in the open. Star us on GitHub, report issues, suggest features, or submit a pull request.
          </p>
          <a
            href="https://github.com/taiyeba-dg/privatools"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-editorial inline-flex items-center gap-2"
          >
            <Github size={14} /> STAR ON GITHUB
          </a>
          <div className="mt-6 flex items-center justify-center gap-6 font-mono-meta text-xs text-muted-foreground">
            <span>MIT License</span>
            <span>PRs Welcome</span>
            <span>Self-Hostable</span>
          </div>
        </section>
      </main>

      <EditorialFooter />
    </div>
  );
}
