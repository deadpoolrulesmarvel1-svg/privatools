/**
 * PrivacyPage — workshop-styled privacy policy with reading aids.
 *
 * Layout parity with BlogPostPage:
 *   - Sticky right-side TOC (desktop) + collapsible TOC (mobile)
 *   - Reading-progress bar at top
 *   - Hash-link anchors on every section
 *   - § markers, mono dateline, corner-marked "short version" highlight
 *
 * Highlighted clauses (privacy-relevant) get an accent panel with corner marks.
 * Last-updated timestamp links to the git history for diff transparency.
 */
import { Link } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shield, ArrowLeft, ArrowUp, Link2, Check, List, History, Mail, Github } from "lucide-react";
import { cn } from "@/lib/utils";

const LAST_UPDATED = "May 15, 2026";
const GIT_HISTORY_URL = "https://github.com/deadpoolrulesmarvel1-svg/privatools/commits/main/frontend/src/pages/PrivacyPage.tsx";

interface Section { id: string; title: string; flag?: boolean }
const SECTIONS: Section[] = [
  { id: "short-version",       title: "The Short Version", flag: true },
  { id: "files-you-upload",    title: "1. Files You Upload" },
  { id: "client-side-tools",   title: "2. Client-Side Tools" },
  { id: "what-we-dont-collect",title: "3. Information We Do Not Collect", flag: true },
  { id: "server-infrastructure",title: "4. Server Infrastructure" },
  { id: "third-party",         title: "5. Third-Party Services" },
  { id: "open-source",         title: "6. Open Source Transparency" },
  { id: "childrens-privacy",   title: "7. Children's Privacy" },
  { id: "changes",             title: "8. Changes to This Policy" },
  { id: "contact",             title: "9. Contact" },
];

/** Hand-rolled smooth scroll (matches BlogPostPage logic) for nested overflow containers. */
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

export default function PrivacyPage() {
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

  // Honor hash on initial mount so /privacy#third-party scrolls into view.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && SECTIONS.some(s => s.id === hash)) {
      // Delay so layout settles after lazy-route mount.
      const t = setTimeout(() => scrollToHeading(hash), 60);
      return () => clearTimeout(t);
    }
  }, [scrollToHeading]);

  return (
    <div className="relative">
      {/* Reading progress bar */}
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

      {/* AppShell already exposes `<main id="main-content">` — use <article>
         for the policy body so screen readers expose it as its own landmark. */}
      <article className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_220px] gap-12">

          {/* ── Article column ── */}
          <article ref={articleRef} className="min-w-0 animate-fade-up">

            {/* Back link + copy-link row */}
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

            {/* ── Header ── */}
            <header className="mb-8">
              <div className="flex flex-wrap gap-2 mb-5 items-center">
                <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-accent/30 bg-accent/[0.06] font-mono text-[9.5px] tracking-[0.10em] uppercase text-accent">
                  <Shield size={10} /> Legal · Privacy
                </span>
              </div>

              <h1
                className="font-display font-bold text-foreground tracking-[-0.025em] leading-tight text-3xl sm:text-4xl lg:text-5xl"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
              >
                Privacy Policy
              </h1>

              <p className="font-display text-[16px] sm:text-[17px] text-muted-foreground mt-5 leading-relaxed max-w-prose">
                How PrivaTools handles your files, your network requests, and the small amount of anonymous data
                Google Analytics receives. Written plainly, with no dark patterns.
              </p>

              <div className="mt-7 pb-7 border-b border-border flex items-center flex-wrap gap-x-4 gap-y-2 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                <span className="text-foreground">PrivaTools</span>
                <span className="text-muted-foreground/40">·</span>
                <span>Last updated <time dateTime="2026-05-15" className="text-accent">{LAST_UPDATED}</time></span>
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

            {/* ── The Short Version (highlighted corner-marked panel) ── */}
            <section id="short-version" className="mb-10 scroll-mt-20">
              <h2 className="sr-only">The Short Version</h2>
              <aside className="relative rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="relative p-5 sm:p-6">
                  <CornerMarks />
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={13} className="text-accent" />
                    <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent font-semibold">§ The short version</span>
                  </div>
                  <p className="font-display text-[15.5px] text-foreground leading-relaxed mb-3">
                    <strong className="font-semibold">Your files are private.</strong> They are processed in temporary memory and
                    deleted immediately after the response is delivered. We never read, inspect, store, or share
                    their contents.
                  </p>
                  <p className="font-display text-[15.5px] text-foreground/85 leading-relaxed">
                    <strong className="font-semibold">We do collect anonymous pageview telemetry</strong> via Google Analytics 4
                    (with IP anonymization). No personal data, no behavioural profiling, no advertising — just aggregate
                    counts. You can disable it with any standard tracking blocker. If you want zero telemetry,
                    self-host the open-source build via Docker.
                  </p>
                </div>
              </aside>
            </section>

            <div className="blog-prose prose-headings:scroll-mt-20">

              <h2 id="files-you-upload">1. Files You Upload</h2>
              <p>
                When you use a server-side tool (e.g., Merge PDF, Compress PDF), your file is uploaded
                to our processing server over an encrypted HTTPS connection. Here is exactly what happens:
              </p>
              <ul>
                <li><strong>Processing:</strong> Your file is held in temporary server memory (RAM) only for the duration of processing. It is never written to disk or permanent storage.</li>
                <li><strong>Deletion:</strong> The moment processing completes and your result is delivered, the original file and the output are purged from memory. This typically takes less than one second after download.</li>
                <li><strong>No inspection:</strong> Our servers process raw bytes. We never read, analyze, index, or inspect the contents of your files. We have no knowledge of what you upload.</li>
                <li><strong>No retention:</strong> We do not retain copies, backups, thumbnails, or metadata from your files. Once deleted, they are unrecoverable.</li>
              </ul>

              <h2 id="client-side-tools">2. Client-Side Tools</h2>
              <p>
                A growing number of tools run <strong>entirely in your browser</strong> using JavaScript
                and (in some cases) WebAssembly. Your data never leaves your device — not even
                temporarily. You can verify by opening browser DevTools → Network and watching for
                requests during processing.
              </p>
              <ul>
                <li><strong>Developer utilities</strong>: JSON / XML Formatter, Text Diff, Base64
                  Encoder, Hash Generator, CSV ↔ JSON Converter, Markdown ↔ HTML Converter,
                  JWT Decoder, Regex Tester, Timestamp Converter, URL Encoder, Word Counter,
                  Color Converter, UUID Generator, Lorem Ipsum Generator, Password Generator.</li>
                <li><strong>Browser-side AI</strong>: Summarize PDF (distilbart-cnn-12-6) and Smart
                  Redact (BERT-base-NER) run AI models <em>in your browser</em> via the
                  @huggingface/transformers WebAssembly runtime. The models (~250 MB) are downloaded
                  once from the Hugging Face CDN and cached in your browser's IndexedDB storage.
                  After the model is cached, summarization and PII detection happen offline — your
                  PDF content never touches our server.</li>
                <li><strong>Subtitle Converter</strong>: SRT ↔ VTT ↔ ASS conversion happens entirely
                  in your browser.</li>
              </ul>
              <p>
                On first visit to a browser-side AI tool, your browser fetches the model from
                <code> huggingface.co</code> and <code>cdn.jsdelivr.net</code> over HTTPS. Hugging Face
                sees that <em>someone</em> requested the model file (the request includes your IP and
                user agent, as with any web request); they do not see the content you intend to
                summarise or redact. Subsequent uses of the tool, including processing your file, run
                entirely offline from the cached model.
              </p>
            </div>

            {/* ── Highlighted clause (key data minimisation) ── */}
            <section id="what-we-dont-collect" className="my-10 scroll-mt-20">
              <h2 className="font-display font-bold text-[1.625rem] tracking-[-0.02em] leading-tight mt-10 mb-3 text-foreground">
                3. Information We Do Not Collect
              </h2>
              <aside className="relative rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="relative p-5 sm:p-6">
                  <CornerMarks />
                  <p className="font-display text-[15.5px] text-foreground leading-relaxed mb-3">
                    We do not collect:
                  </p>
                  <ul className="font-display text-[15.5px] text-foreground leading-relaxed space-y-1.5 list-disc pl-6">
                    <li>Names, email addresses, or account credentials (no accounts exist)</li>
                    <li>Personally identifiable information (your IP address is anonymized before it reaches Google)</li>
                    <li>Browser fingerprints or canvas-based device identifiers</li>
                    <li>Behavioural profiles, session recordings, or remarketing audiences</li>
                    <li>Advertising cookies or tracking pixels from ad networks</li>
                    <li>File metadata, filenames, or content from uploaded files</li>
                  </ul>
                  <p className="font-display text-[15.5px] text-muted-foreground leading-relaxed mt-3">
                    We <em>do</em> collect aggregate pageview counts via Google Analytics 4 — see Section 5 for
                    details and how to opt out.
                  </p>
                </div>
              </aside>
            </section>

            <div className="blog-prose prose-headings:scroll-mt-20">
              <h2 id="server-infrastructure">4. Server Infrastructure</h2>
              <p>
                PrivaTools runs on Oracle Cloud Infrastructure (ARM-based, 24 GB RAM). The server is
                located in a single data center and is maintained by the PrivaTools team. We use HTTPS
                with HSTS for all connections. Our server does not log request bodies or file contents.
                Standard web server access logs (timestamps, HTTP status codes, request paths) may be
                retained for up to 7 days for operational debugging, but these logs never contain file
                data or personally identifiable information.
              </p>

              <h2 id="third-party">5. Third-Party Services</h2>
              <p>
                PrivaTools uses the following third-party services:
              </p>
              <ul>
                <li><strong>Google Analytics (GA4):</strong> We use Google Analytics to understand how visitors use the site — which tools are popular, how people find us, and general usage patterns. Google Analytics collects anonymized page view data, browser type, and approximate location (country-level). It does not have access to your uploaded files. You can opt out using a <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">browser extension</a>.</li>
                <li><strong>Google Fonts:</strong> Typography is loaded via Bunny Fonts (a privacy-respecting Google Fonts mirror) so font requests do not reach Google's servers.</li>
              </ul>
              <p>
                No advertising networks, remarketing scripts, or user profiling tools are used.
              </p>

              <h2 id="open-source">6. Open Source Transparency</h2>
              <p>
                The entire PrivaTools codebase — frontend and backend — is open source under the MIT
                license at{" "}
                <a href="https://github.com/deadpoolrulesmarvel1-svg/privatools" target="_blank" rel="noopener noreferrer">
                  github.com/deadpoolrulesmarvel1-svg/privatools
                </a>
                . You can audit every line of code that handles your files. If you prefer maximum privacy,
                you can self-host the entire application using Docker.
              </p>

              <h2 id="childrens-privacy">7. Children's Privacy</h2>
              <p>
                PrivaTools does not knowingly collect any information from anyone, including children
                under 13. Since we collect no personal data and require no accounts, there is no
                age-specific data to protect.
              </p>

              <h2 id="changes">8. Changes to This Policy</h2>
              <p>
                If we change this privacy policy, we will update the "Last updated" date at the top of
                this page. Since we collect no user data, we have no way to notify you directly — we
                recommend checking this page periodically if privacy is a concern. Every change is
                tracked in the public git history linked above.
              </p>

              <h2 id="contact">9. Contact</h2>
              <p>
                If you have questions about this privacy policy or how PrivaTools handles your files,
                contact us at{" "}
                <a href="mailto:hello@privatools.me">hello@privatools.me</a> or open an issue on{" "}
                <a href="https://github.com/deadpoolrulesmarvel1-svg/privatools/issues" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>.
              </p>
            </div>

            {/* ── Companion docs row ── */}
            <aside className="mt-12 pt-8 border-t border-border">
              <p className="section-mark mb-5">§ Related</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Link
                  to="/terms"
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-accent/45 hover:bg-accent/[0.04] hover:-translate-y-0.5 transition-all"
                >
                  <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 shrink-0 mt-0.5">§01</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-[14.5px] font-semibold text-foreground tracking-[-0.015em] group-hover:text-accent transition-colors">Terms of Service</p>
                    <p className="text-[12.5px] text-muted-foreground mt-1 leading-snug">The legal terms for using PrivaTools.</p>
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
                    <p className="text-[12.5px] text-muted-foreground mt-1 leading-snug">hello@privatools.me — questions on this policy.</p>
                  </div>
                </a>
              </div>
            </aside>

          </article>

          {/* ── Sticky TOC sidebar (desktop only) ── */}
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

        {/* Mobile TOC — appears below header on narrow viewports */}
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

      {/* Scroll-to-top */}
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
