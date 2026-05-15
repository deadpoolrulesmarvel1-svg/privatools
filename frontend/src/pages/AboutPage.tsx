import { Link } from "react-router-dom";
import {
  Shield, Server, Trash2, Eye, Lock, Github, Globe, Code, Heart, EyeOff, Zap, Users,
  ArrowRight, Cpu, Mail, FileCheck, Sparkles,
} from "lucide-react";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { blogPosts } from "@/data/blog";
import { cn } from "@/lib/utils";

const TOTAL = tools.length + nonPdfTools.length;
const PDF_COUNT = tools.length;
const NONPDF_COUNT = nonPdfTools.length;
const CLIENT_COUNT = nonPdfTools.filter(t => t.clientOnly).length;
const POSTS = blogPosts.length;

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <EditorialMasthead />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
        {/* Hero */}
        <header className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-10 mb-16 items-center">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-accent/30 text-[11px] font-mono-meta uppercase tracking-widest text-accent">
                <Shield className="w-3 h-3" /> Privacy Manifesto
              </span>
              <span className="font-mono-meta text-[11px] text-muted-foreground">v1.2.1 · MIT licensed</span>
            </div>
            <h1 className="font-heading text-5xl sm:text-7xl font-black leading-[1.02] tracking-tight">
              Your files are <span className="italic text-accent">yours</span>.
            </h1>
            <p className="font-serif-body text-lg text-muted-foreground mt-6 leading-relaxed max-w-xl">
              PrivaTools is built on a simple belief: you shouldn't have to trust a random website with your sensitive documents just to merge two PDFs.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/" className="btn-editorial inline-flex items-center gap-2">
                Browse all {TOTAL} tools <ArrowRight size={14} />
              </Link>
              <a
                href="https://github.com/taiyeba-dg/privatools"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-secondary/40 text-[13px] font-medium text-foreground hover:border-foreground/30 transition-colors"
              >
                <Github size={14} /> View source
              </a>
            </div>
          </div>

          {/* Right column: live stat grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: `${TOTAL}+`, label: "Free tools", icon: Zap, color: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
              { value: "0", label: "Files stored", icon: FileCheck, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
              { value: "0", label: "Trackers/ads", icon: EyeOff, color: "text-blue-400 bg-blue-500/10 border-blue-500/25" },
              { value: "MIT", label: "License", icon: Lock, color: "text-violet-400 bg-violet-500/10 border-violet-500/25" },
            ].map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className={cn("rounded-2xl border p-5", s.color)}>
                  <Icon size={18} />
                  <p className="mt-3 font-heading text-3xl font-black text-foreground leading-none">{s.value}</p>
                  <p className="mt-1 font-mono-meta text-[10px] uppercase tracking-wider text-foreground/70">{s.label}</p>
                </div>
              );
            })}
          </div>
        </header>

        {/* Architecture / How We Handle Files */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-heading text-3xl font-bold text-foreground">How we handle your files</h2>
            <span className="hidden sm:inline-flex font-mono-meta text-[11px] text-muted-foreground">Three guarantees, all auditable in the source</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                step: "01",
                icon: Server,
                title: "Process in isolation",
                desc: "Files are received and processed in an isolated container. Memory only — never written to permanent storage, never logged, never indexed.",
                accent: "border-blue-500/25 bg-blue-500/[0.04]",
                iconColor: "text-blue-400",
              },
              {
                step: "02",
                icon: Trash2,
                title: "Delete immediately",
                desc: "The moment the response is sent, the file is unlinked from the temp directory. The cleanup runs as a background task that fires within seconds.",
                accent: "border-rose-500/25 bg-rose-500/[0.04]",
                iconColor: "text-rose-400",
              },
              {
                step: "03",
                icon: Eye,
                title: "Zero knowledge",
                desc: "We never inspect, analyze, or read your file contents. The servers process bytes — no telemetry on contents, no AI training on your data.",
                accent: "border-emerald-500/25 bg-emerald-500/[0.04]",
                iconColor: "text-emerald-400",
              },
            ].map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.step} className={cn("relative rounded-2xl border p-6 overflow-hidden", step.accent)}>
                  <span className="absolute right-4 top-3 font-heading font-black text-[44px] text-foreground/[0.06] leading-none">{step.step}</span>
                  <Icon className={cn("w-7 h-7 relative", step.iconColor)} />
                  <h3 className="mt-5 font-heading text-lg font-bold text-foreground relative">{step.title}</h3>
                  <p className="mt-2 font-serif-body text-[13.5px] text-muted-foreground leading-relaxed relative">{step.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Client-side highlight */}
        <section className="mb-16 rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/[0.06] to-transparent p-8">
          <div className="flex items-start gap-4">
            <div className="shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 border border-accent/30">
              <Cpu className="w-6 h-6 text-accent" />
            </div>
            <div className="flex-1">
              <p className="font-mono-meta text-[10px] uppercase tracking-wider text-accent mb-1">Even stronger</p>
              <h3 className="font-heading text-xl sm:text-2xl font-bold text-foreground leading-tight">
                {CLIENT_COUNT}+ tools never touch our servers at all.
              </h3>
              <p className="mt-3 font-serif-body text-[14px] text-muted-foreground leading-relaxed max-w-3xl">
                Tools like <Link to="/tool/summarize-pdf" className="text-accent hover:underline">Summarize PDF</Link>, <Link to="/tool/smart-redact" className="text-accent hover:underline">Smart Redact</Link>, <Link to="/tools/jwt-decoder" className="text-accent hover:underline">JWT Decoder</Link>, <Link to="/tools/regex-tester" className="text-accent hover:underline">Regex Tester</Link>, <Link to="/tools/password-generator" className="text-accent hover:underline">Password Generator</Link>, <Link to="/tools/base64" className="text-accent hover:underline">Base64</Link>, and <Link to="/tools/hash-generator" className="text-accent hover:underline">Hash Generator</Link> run 100% in your browser. Zero network requests after the page loads. Confirm with DevTools → Network.
              </p>
            </div>
          </div>
        </section>

        {/* What we DON'T do */}
        <section className="mb-16">
          <h2 className="font-heading text-3xl font-bold text-foreground mb-1">What we don't do</h2>
          <p className="font-serif-body text-sm text-muted-foreground mb-6">For every line below, the implementation is in the public source.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { icon: EyeOff, title: "Don't read your files", desc: "No content telemetry, no AI training on uploads, no inspection." },
              { icon: Users, title: "Don't require accounts", desc: "No email gate, no sign-up flow, no \"premium\" pop-up." },
              { icon: Lock, title: "Don't store files", desc: "Temp dir is cleaned on response; cleanup task fires every 5 minutes for stragglers." },
              { icon: Eye, title: "Don't profile you", desc: "Only anonymous GA4 pageviews, IP-anonymized; blockable with any extension." },
              { icon: Globe, title: "Don't sell data", desc: "File content never leaves the processing container. We have nothing to sell." },
              { icon: Heart, title: "Don't paywall anything", desc: "No premium tier. No feature locked behind a subscription. No watermark on output." },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="rounded-xl border border-border bg-card p-4 hover:border-foreground/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-heading font-bold text-sm text-foreground">{item.title}</h3>
                  </div>
                  <p className="mt-2 font-serif-body text-[12.5px] text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* By the numbers (richer stats) */}
        <section className="mb-16 rounded-2xl border border-border bg-card p-8 sm:p-10">
          <div className="flex items-center gap-2 mb-6">
            <span className="section-flag">BY THE NUMBERS</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            {[
              { value: `${PDF_COUNT}`, label: "PDF tools" },
              { value: `${NONPDF_COUNT}`, label: "Image, video, audio & dev tools" },
              { value: `${CLIENT_COUNT}`, label: "Browser-only tools (zero upload)" },
              { value: `${POSTS}+`, label: "Long-form guides" },
              { value: "500 MB", label: "Upload limit per file" },
              { value: "MIT", label: "Open-source license" },
              { value: "0", label: "Required accounts" },
              { value: "0", label: "Trackers (with uBlock)" },
            ].map((s, i) => (
              <div key={i}>
                <div className="font-heading text-3xl sm:text-4xl font-black text-foreground leading-none">{s.value}</div>
                <div className="mt-2 font-mono-meta text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Open source CTA */}
        <section className="mb-16 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
          <div className="rounded-2xl border border-border bg-card p-8">
            <Sparkles className="w-6 h-6 text-accent" />
            <h2 className="mt-4 font-heading text-2xl font-bold text-foreground leading-tight">Audit every line.</h2>
            <p className="mt-3 font-serif-body text-[14px] text-muted-foreground leading-relaxed">
              PrivaTools is fully open source under the MIT license. Don't believe a privacy claim — verify it. Read the route handlers, the cleanup task, the CSP headers. It's all there.
            </p>
            <a
              href="https://github.com/taiyeba-dg/privatools"
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-foreground/20 bg-foreground text-background text-[13px] font-medium hover:opacity-90 transition-opacity"
            >
              <Github size={14} /> Read the source
            </a>
          </div>

          <div className="rounded-2xl border border-border bg-card p-8">
            <Code className="w-6 h-6 text-accent" />
            <h2 className="mt-4 font-heading text-2xl font-bold text-foreground leading-tight">Self-host in one command.</h2>
            <p className="mt-3 font-serif-body text-[14px] text-muted-foreground leading-relaxed">
              If you don't want to trust <em>our</em> deployment either, run your own. Clone the repo, <code className="font-mono-meta text-[12px] bg-secondary px-1.5 py-0.5 rounded">docker compose up --build</code>, you're done. 175+ tools running on your own infrastructure.
            </p>
            <a
              href="https://github.com/taiyeba-dg/privatools#-quick-start"
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-secondary/40 text-[13px] font-medium text-foreground hover:border-foreground/30 transition-colors"
            >
              <Code size={14} /> Self-host with Docker
            </a>
          </div>
        </section>

        {/* Version timeline */}
        <section className="mb-16">
          <h2 className="font-heading text-3xl font-bold text-foreground mb-1">Recent releases</h2>
          <p className="font-serif-body text-sm text-muted-foreground mb-6">Open source means an open changelog. Every version is on GitHub.</p>
          <div className="space-y-3">
            {[
              { v: "v1.2.1", date: "2026-05-15", title: "SEO content push", desc: "6 long-form blog posts, HowTo + FAQ schemas for 18 more tools." },
              { v: "v1.2.0", date: "2026-05-15", title: "11 new tools + office-to-pdf fix", desc: "Web-optimize, split-by-text, pdf-to-html, pdf-to-rtf, view-exif, JWT decoder, regex tester, timestamp converter, image-converter aliases." },
              { v: "v1.1.0", date: "2026-05-04", title: "33 new tools + UI redesign + browser AI", desc: "Highlight, Smart Redact (BERT-NER in-browser), Summarize PDF (distilbart in-browser), video/audio toolkit, 21 custom tool illustrations." },
              { v: "v1.0.0", date: "2026-03-05", title: "Launch", desc: "First public release. 107 tools, MIT license, open source from day one." },
            ].map((r, i) => (
              <div key={i} className="flex items-start gap-4 rounded-xl border border-border bg-card p-5 hover:border-foreground/30 transition-colors">
                <div className="shrink-0 w-20">
                  <p className="font-mono-meta text-[12px] font-bold text-accent">{r.v}</p>
                  <p className="font-mono-meta text-[10px] text-muted-foreground mt-0.5">{r.date}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-heading font-bold text-foreground text-[15px]">{r.title}</h3>
                  <p className="mt-1 font-serif-body text-[13px] text-muted-foreground leading-relaxed">{r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section className="mb-16 rounded-2xl border border-border bg-card p-8 sm:p-10">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-6">
            <div>
              <h2 className="font-heading text-2xl font-bold text-foreground">Get in touch</h2>
              <p className="mt-3 font-serif-body text-[14px] text-muted-foreground leading-relaxed">
                Questions about privacy, the architecture, or how a specific tool works? We answer email and review every GitHub issue.
              </p>
            </div>
            <div className="space-y-3">
              <a href="mailto:hello@privatools.me" className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-4 hover:border-foreground/30 transition-colors">
                <Mail className="w-4 h-4 text-accent" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono-meta text-[10px] uppercase tracking-wider text-muted-foreground">Email</p>
                  <p className="font-heading text-sm text-foreground">hello@privatools.me</p>
                </div>
                <ArrowRight size={14} className="text-muted-foreground" />
              </a>
              <a href="https://github.com/taiyeba-dg/privatools/issues" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-4 hover:border-foreground/30 transition-colors">
                <Github className="w-4 h-4 text-accent" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono-meta text-[10px] uppercase tracking-wider text-muted-foreground">GitHub issues</p>
                  <p className="font-heading text-sm text-foreground">taiyeba-dg/privatools</p>
                </div>
                <ArrowRight size={14} className="text-muted-foreground" />
              </a>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-[12px] font-mono-meta">
            <Link to="/privacy" className="text-accent hover:underline">Privacy Policy</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/terms" className="text-accent hover:underline">Terms of Service</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/blog" className="text-accent hover:underline">Blog</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/compare" className="text-accent hover:underline">Compare</Link>
          </div>
        </section>

        {/* Final CTA */}
        <section className="text-center pb-4">
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-foreground">Ready to try?</h2>
          <p className="mt-3 font-serif-body text-base text-muted-foreground">No sign-up. No upload to anyone but us. No watermarks. Just pick a tool.</p>
          <Link to="/" className="mt-6 inline-flex items-center gap-2 btn-editorial">
            Browse all {TOTAL} tools <ArrowRight size={14} />
          </Link>
        </section>
      </main>

      <EditorialFooter />
    </div>
  );
}
