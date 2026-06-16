/**
 * TermsPage — workshop-styled terms of service.
 *
 * Layout parity with PrivacyPage and BlogPostPage:
 *   - Sticky right-side TOC (desktop) + collapsible TOC (mobile)
 *   - Reading-progress bar
 *   - § markers, mono dateline, corner-marked highlighted clauses
 *   - Last-updated timestamp links to git history for diff transparency
 */
import { Link } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, ArrowLeft, ArrowUp, Link2, Check, List, History, Mail, Github } from "lucide-react";
import { cn } from "@/lib/utils";

const LAST_UPDATED = "March 29, 2026";
const GIT_HISTORY_URL = "https://github.com/deadpoolrulesmarvel1-svg/privatools/commits/main/frontend/src/pages/TermsPage.tsx";

interface Section { id: string; title: string; flag?: boolean }
const SECTIONS: Section[] = [
  { id: "acceptance",            title: "1. Acceptance of Terms" },
  { id: "description",           title: "2. Description of Service" },
  { id: "acceptable-use",        title: "3. Acceptable Use", flag: true },
  { id: "file-processing",       title: "4. File Processing" },
  { id: "no-warranty",           title: "5. No Warranty", flag: true },
  { id: "liability",             title: "6. Limitation of Liability", flag: true },
  { id: "intellectual-property", title: "7. Intellectual Property" },
  { id: "availability",          title: "8. Service Availability" },
  { id: "changes",               title: "9. Changes to Terms" },
  { id: "contact",               title: "10. Contact" },
];

let smoothScrollRaf = 0;
function smoothScrollTo(el: HTMLElement, target: number, duration = 380) {
  if (smoothScrollRaf) cancelAnimationFrame(smoothScrollRaf);
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { el.scrollTop = target; return; }
  const start = el.scrollTop;
  const dist = target - start;
  if (Math.abs(dist) < 1) return;
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    const ease = 1 - Math.pow(1 - t, 3);
    el.scrollTop = start + dist * ease;
    if (t < 1) smoothScrollRaf = requestAnimationFrame(step);
    else smoothScrollRaf = 0;
  };
  smoothScrollRaf = requestAnimationFrame(step);
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

export default function TermsPage() {
  const articleRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showTop, setShowTop] = useState(false);
  const [copied, setCopied] = useState(false);

  const getScrollEl = (article: HTMLElement | null): HTMLElement | null => {
    if (!article) return null;
    let el: HTMLElement | null = article.parentElement;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      const overflowOk = /(auto|scroll)/.test(style.overflowY);
      const isScrollable = el.scrollHeight - el.clientHeight > 1;
      if (overflowOk && isScrollable) return el;
      el = el.parentElement;
    }
    return document.getElementById("workspace");
  };

  // Passive scroll listener — no measurement-then-paint dependency, so
  // useEffect (post-paint) is correct and doesn't block the first paint.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const scrollEl = getScrollEl(article);
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = article.getBoundingClientRect();
      const viewportH = scrollEl ? scrollEl.clientHeight : window.innerHeight;
      const articleTop = rect.top - (scrollEl ? scrollEl.getBoundingClientRect().top : 0);
      const totalDistance = Math.max(1, rect.height - viewportH);
      const scrolled = Math.min(Math.max(-articleTop, 0), totalDistance);
      setProgress((scrolled / totalDistance) * 100);
      const scrollTop = scrollEl ? scrollEl.scrollTop : (window.scrollY || document.documentElement.scrollTop);
      setShowTop(scrollTop > 800);
      const headingEls = Array.from(article.querySelectorAll<HTMLElement>("h2[id]"));
      const comfort = viewportH * 0.25;
      let current: string | null = null;
      for (const h of headingEls) {
        const top = h.getBoundingClientRect().top - (scrollEl ? scrollEl.getBoundingClientRect().top : 0);
        if (top - comfort <= 0) current = h.id;
        else break;
      }
      setActiveId(current);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    const target = scrollEl || window;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const scrollToHeading = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const scrollEl = getScrollEl(articleRef.current);
    if (scrollEl) {
      const top = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop - 80;
      smoothScrollTo(scrollEl, top);
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    history.replaceState(null, "", `#${id}`);
  }, []);

  const scrollToTop = () => {
    const scrollEl = getScrollEl(articleRef.current);
    if (scrollEl) smoothScrollTo(scrollEl, 0);
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && SECTIONS.some(s => s.id === hash)) {
      const t = setTimeout(() => scrollToHeading(hash), 60);
      return () => clearTimeout(t);
    }
  }, [scrollToHeading]);

  return (
    <div className="relative">
      <div className="sticky top-0 left-0 right-0 z-30 h-1 bg-transparent print:hidden">
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Document reading progress"
          className="h-full bg-accent transition-[width] duration-150 ease-out shadow-[0_0_12px_hsl(var(--accent)/0.6)]"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* AppShell already provides `<main id="main-content">` — use <article>
         for the document body so screen readers expose it as a landmark. */}
      <article className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_220px] gap-12">

          <article ref={articleRef} className="min-w-0 animate-fade-up">

            <nav className="mb-8 flex items-center justify-between flex-wrap gap-3" aria-label="Document navigation">
              <Link
                to="/about"
                className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground hover:text-accent transition-colors"
              >
                <ArrowLeft size={12} /> About
              </Link>
              <button
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground hover:text-accent hover:border-accent/45 hover:bg-accent/[0.04] transition-colors"
              >
                {copied ? <><Check size={11} className="text-accent" /> Copied</> : <><Link2 size={11} /> Copy link</>}
              </button>
            </nav>

            <header className="mb-8">
              <div className="flex flex-wrap gap-2 mb-5 items-center">
                <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-accent/30 bg-accent/[0.06] font-mono text-[9.5px] tracking-[0.10em] uppercase text-accent">
                  <FileText size={10} /> Legal · Terms
                </span>
              </div>

              <h1
                className="font-display font-bold text-foreground tracking-[-0.025em] leading-tight text-3xl sm:text-4xl lg:text-5xl"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
              >
                Terms of Service
              </h1>

              <p className="font-display text-[16px] sm:text-[17px] text-muted-foreground mt-5 leading-relaxed max-w-prose">
                The rules of the road for using PrivaTools. Short, plain-English, and aligned with the
                spirit of the MIT license under which the project is published.
              </p>

              <div className="mt-7 pb-7 border-b border-border flex items-center flex-wrap gap-x-4 gap-y-2 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                <span className="text-foreground">PrivaTools</span>
                <span className="text-muted-foreground/40">·</span>
                <span>Last updated <time dateTime="2026-03-29" className="text-accent">{LAST_UPDATED}</time></span>
                <span className="text-muted-foreground/40">·</span>
                <a
                  href={GIT_HISTORY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-accent transition-colors"
                >
                  <History size={11} /> Version history
                </a>
              </div>
            </header>

            <div className="blog-prose prose-headings:scroll-mt-20">
              <h2 id="acceptance">1. Acceptance of Terms</h2>
              <p>
                By accessing or using PrivaTools (<a href="https://privatools.me">privatools.me</a>),
                you agree to these Terms of Service. If you do not agree, do not use the service.
                PrivaTools is provided as a free, open-source tool suite and may be used without
                creating an account.
              </p>

              <h2 id="description">2. Description of Service</h2>
              <p>
                PrivaTools provides browser-based file processing tools for PDF, image, video, and
                developer workflows. Files are processed on our server in temporary memory and
                immediately deleted after processing. Some tools run entirely in your browser with
                no server interaction. The service is free, has no usage limits, and requires no
                registration.
              </p>
            </div>

            {/* Highlighted clause — Acceptable Use */}
            <section id="acceptable-use" className="my-10 scroll-mt-20">
              <h2 className="font-display font-bold text-[1.625rem] tracking-[-0.02em] leading-tight mt-10 mb-3 text-foreground">
                3. Acceptable Use
              </h2>
              <aside className="relative rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="relative p-5 sm:p-6">
                  <CornerMarks />
                  <p className="font-display text-[15.5px] text-foreground leading-relaxed mb-3">You agree not to:</p>
                  <ul className="font-display text-[15.5px] text-foreground leading-relaxed space-y-1.5 list-disc pl-6">
                    <li>Use the service to process files that violate applicable laws</li>
                    <li>Attempt to access, tamper with, or disrupt the server infrastructure</li>
                    <li>Use automated scripts to overload the service (reasonable API usage is fine)</li>
                    <li>Redistribute the service under a different name while claiming original authorship</li>
                  </ul>
                  <p className="font-display text-[15.5px] text-muted-foreground leading-relaxed mt-3">
                    The MIT license grants you full rights to fork, modify, and self-host the PrivaTools
                    codebase for any purpose.
                  </p>
                </div>
              </aside>
            </section>

            <div className="blog-prose prose-headings:scroll-mt-20">
              <h2 id="file-processing">4. File Processing</h2>
              <p>
                Files you upload are processed in temporary server memory and deleted immediately
                after your result is delivered. We do not retain, inspect, or back up your files.
                See our <Link to="/privacy">Privacy Policy</Link> for full details on file handling.
              </p>
            </div>

            {/* Highlighted clauses — No Warranty + Limitation of Liability (the two clauses users actually need to see) */}
            <section id="no-warranty" className="my-10 scroll-mt-20">
              <h2 className="font-display font-bold text-[1.625rem] tracking-[-0.02em] leading-tight mt-10 mb-3 text-foreground">
                5. No Warranty
              </h2>
              <aside className="relative rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="relative p-5 sm:p-6">
                  <CornerMarks />
                  <p className="font-display text-[15.5px] text-foreground leading-relaxed">
                    PrivaTools is provided <strong>"as is"</strong> without warranty of any kind, express or
                    implied. We do not guarantee that the service will be uninterrupted, error-free, or that
                    processing results will be perfect for every file. You are responsible for verifying
                    output files meet your requirements before relying on them.
                  </p>
                </div>
              </aside>
            </section>

            <section id="liability" className="my-10 scroll-mt-20">
              <h2 className="font-display font-bold text-[1.625rem] tracking-[-0.02em] leading-tight mt-10 mb-3 text-foreground">
                6. Limitation of Liability
              </h2>
              <aside className="relative rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="relative p-5 sm:p-6">
                  <CornerMarks />
                  <p className="font-display text-[15.5px] text-foreground leading-relaxed">
                    To the maximum extent permitted by law, PrivaTools and its contributors shall not
                    be liable for any indirect, incidental, special, consequential, or punitive damages
                    arising from your use of the service, including but not limited to data loss, file
                    corruption, or service unavailability.
                  </p>
                </div>
              </aside>
            </section>

            <div className="blog-prose prose-headings:scroll-mt-20">
              <h2 id="intellectual-property">7. Intellectual Property</h2>
              <p>
                The PrivaTools codebase is open source under the{" "}
                <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener noreferrer">
                  MIT License
                </a>
                . You retain all rights to the files you upload and the outputs you download. We claim
                no ownership or license over your content.
              </p>

              <h2 id="availability">8. Service Availability</h2>
              <p>
                We aim to keep PrivaTools available 24/7, but we do not guarantee uptime. The service
                may be temporarily unavailable due to maintenance, updates, or infrastructure issues.
                If the hosted service is unavailable, you can always self-host using the open-source
                codebase.
              </p>

              <h2 id="changes">9. Changes to Terms</h2>
              <p>
                We may update these terms at any time. Changes take effect when posted to this page
                with an updated "Last updated" date. Continued use of the service after changes
                constitutes acceptance. Every change is tracked in the public git history linked above.
              </p>

              <h2 id="contact">10. Contact</h2>
              <p>
                For questions about these terms, contact us at{" "}
                <a href="mailto:hello@privatools.me">hello@privatools.me</a> or open an issue on{" "}
                <a href="https://github.com/deadpoolrulesmarvel1-svg/privatools/issues" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>.
              </p>
            </div>

            <aside className="mt-12 pt-8 border-t border-border">
              <p className="section-mark mb-5">§ Related</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Link
                  to="/privacy"
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-accent/45 hover:bg-accent/[0.04] hover:-translate-y-0.5 transition-all"
                >
                  <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 shrink-0 mt-0.5">§01</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-[14.5px] font-semibold text-foreground tracking-[-0.015em] group-hover:text-accent transition-colors">Privacy Policy</p>
                    <p className="text-[12.5px] text-muted-foreground mt-1 leading-snug">How PrivaTools handles your files and data.</p>
                  </div>
                </Link>
                <a
                  href="mailto:hello@privatools.me"
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-accent/45 hover:bg-accent/[0.04] hover:-translate-y-0.5 transition-all"
                >
                  <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 shrink-0 mt-0.5">§02</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-[14.5px] font-semibold text-foreground tracking-[-0.015em] group-hover:text-accent transition-colors inline-flex items-center gap-1.5">
                      <Mail size={12} /> Email us
                    </p>
                    <p className="text-[12.5px] text-muted-foreground mt-1 leading-snug">hello@privatools.me — questions on these terms.</p>
                  </div>
                </a>
              </div>
            </aside>

          </article>

          {/* Sticky TOC sidebar (desktop) */}
          <aside className="hidden lg:block">
            <div className="sticky top-8">
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">
                  <span className="flex items-center gap-1.5"><List size={10} className="text-accent" /> Contents</span>
                  <span className="text-accent tabular-nums">{Math.round(progress)}%</span>
                </div>
                <nav className="p-3 max-h-[70vh] overflow-y-auto" aria-label="Table of contents">
                  <ul className="space-y-0.5">
                    {SECTIONS.map(s => {
                      const isActive = activeId === s.id;
                      return (
                        <li key={s.id}>
                          <button
                            onClick={() => scrollToHeading(s.id)}
                            className={cn(
                              "relative block w-full text-left text-[12px] leading-snug pl-3 py-1.5 rounded transition-colors",
                              isActive
                                ? "text-accent font-medium bg-accent/[0.06]"
                                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                            )}
                          >
                            {isActive && (
                              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded bg-accent" aria-hidden="true" />
                            )}
                            {s.flag && <span className="text-accent mr-1" aria-hidden="true">§</span>}
                            {s.title}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
                <div className="px-4 py-3 border-t border-border bg-paper-2/40 flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground">
                  <a
                    href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-accent transition-colors"
                  >
                    <Github size={11} /> Source
                  </a>
                </div>
              </div>
            </div>
          </aside>

        </div>

        <details className="lg:hidden mt-6 rounded-xl border border-border bg-card overflow-hidden">
          <summary className="px-4 py-3 list-none cursor-pointer flex items-center gap-2 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground hover:bg-secondary/40 transition-colors">
            <List size={12} className="text-accent" />
            <span><span className="text-accent">§</span> Table of contents</span>
            <span className="ml-auto font-mono text-[10px] tracking-wider text-accent">{SECTIONS.length}</span>
          </summary>
          <ul className="px-4 pb-3 space-y-1.5">
            {SECTIONS.map(s => (
              <li key={s.id}>
                <button
                  onClick={() => scrollToHeading(s.id)}
                  className="block w-full text-left text-[12.5px] py-1 hover:text-accent transition-colors"
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </article>

      <button
        onClick={scrollToTop}
        aria-label="Scroll to top"
        className={cn(
          "fixed bottom-8 right-6 z-40 h-10 w-10 rounded-full border border-accent/35 bg-card text-accent shadow-lg backdrop-blur transition-all hover:bg-accent/[0.08] hover:scale-105",
          showTop ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-2 pointer-events-none"
        )}
      >
        <ArrowUp size={15} className="mx-auto" />
      </button>
    </div>
  );
}
