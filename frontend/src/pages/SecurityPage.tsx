/**
 * SecurityPage - factual trust and vulnerability reporting page.
 *
 * Keep claims tied to things the codebase currently does: open source,
 * no accounts, no paid tier, temporary processing, no-store API responses,
 * and browser-side tools where applicable. Do not imply external audits,
 * certifications, SOC 2, ISO, or formal bug bounty coverage.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  FileText,
  Github,
  History,
  KeyRound,
  Link2,
  List,
  Mail,
  Shield,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LAST_UPDATED = "June 18, 2026";
const GIT_HISTORY_URL = "https://github.com/deadpoolrulesmarvel1-svg/privatools/commits/main/frontend/src/pages/SecurityPage.tsx";

interface Section { id: string; title: string; flag?: boolean }
const SECTIONS: Section[] = [
  { id: "short-version", title: "The Short Version", flag: true },
  { id: "reporting", title: "1. Reporting Vulnerabilities" },
  { id: "threat-model", title: "2. Threat Model" },
  { id: "file-handling", title: "3. File Handling" },
  { id: "transparency", title: "4. Transparency Report" },
  { id: "rights", title: "5. Privacy Rights" },
  { id: "subprocessors", title: "6. Subprocessors" },
  { id: "security-txt", title: "7. security.txt" },
  { id: "limitations", title: "8. Limitations" },
  { id: "contact", title: "9. Contact" },
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

const SUBPROCESSORS = [
  { name: "Oracle Cloud Infrastructure", purpose: "Hosting the PrivaTools processing server and static deployment environment." },
  { name: "Cloudflare", purpose: "Optional edge CDN, TLS acceleration, and static asset delivery. File-processing API responses are marked no-store." },
  { name: "Google Analytics 4", purpose: "Aggregate pageview telemetry. It does not receive uploaded file contents." },
  { name: "Hugging Face CDN", purpose: "Browser-side AI model downloads for local WebAssembly tools. Model requests do not include user file contents." },
  { name: "GitHub", purpose: "Source hosting, issue reports, and public change history." },
];

export default function SecurityPage() {
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

  const scrollToHeading = (id: string) => {
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
  };

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
  }, []);

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

      <article className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_220px] gap-12">
          <article ref={articleRef} className="min-w-0 animate-fade-up">
            <nav className="mb-8 flex items-center justify-between flex-wrap gap-3" aria-label="Document navigation">
              <Link
                to="/privacy"
                className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground hover:text-accent transition-colors"
              >
                <ArrowLeft size={12} /> Privacy
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
                  <Shield size={10} /> Trust / Security
                </span>
              </div>

              <h1
                className="font-display font-bold text-foreground tracking-[-0.025em] leading-tight text-3xl sm:text-4xl lg:text-5xl"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
              >
                Security
              </h1>

              <p className="font-display text-[16px] sm:text-[17px] text-muted-foreground mt-5 leading-relaxed max-w-prose">
                How to report vulnerabilities, what PrivaTools protects against, and where the
                service still depends on infrastructure providers. This page is intentionally
                factual: no certifications, audits, or guarantees are claimed here.
              </p>

              <div className="mt-7 pb-7 border-b border-border flex items-center flex-wrap gap-x-4 gap-y-2 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                <span className="text-foreground">PrivaTools</span>
                <span className="text-muted-foreground/40">/</span>
                <span>Last updated <time dateTime="2026-06-18" className="text-accent">{LAST_UPDATED}</time></span>
                <span className="text-muted-foreground/40">/</span>
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

            <section id="short-version" className="mb-10 scroll-mt-20">
              <h2 className="sr-only">The Short Version</h2>
              <aside className="relative rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="relative p-5 sm:p-6">
                  <CornerMarks />
                  <div className="flex items-center gap-2 mb-3">
                    <KeyRound size={13} className="text-accent" />
                    <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent font-semibold">§ The short version</span>
                  </div>
                  <p className="font-display text-[15.5px] text-foreground leading-relaxed mb-3">
                    Security reports go to <a className="text-accent hover:underline underline-offset-2" href="mailto:hello@privatools.me">hello@privatools.me</a>.
                    PrivaTools is open source, has no accounts, and keeps file-processing routes on
                    temporary server storage or in your browser, depending on the tool.
                  </p>
                  <p className="font-display text-[15.5px] text-foreground/85 leading-relaxed">
                    The public service is not a certified or externally audited compliance product.
                    For the strictest control, use the MIT-licensed codebase to self-host your own instance.
                  </p>
                </div>
              </aside>
            </section>

            <div className="blog-prose prose-headings:scroll-mt-20">
              <h2 id="reporting">1. Reporting Vulnerabilities</h2>
              <p>
                Please email security reports to <a href="mailto:hello@privatools.me">hello@privatools.me</a> with
                the subject prefix <code>[Security]</code>. Include the affected route, steps to reproduce,
                impact, browser or operating system details, and proof-of-concept notes that avoid exposing
                anyone else's data.
              </p>
              <p>
                We aim to acknowledge security reports within 72 hours. Fix timing depends on severity,
                reproducibility, and deployment risk. Please avoid public disclosure until we have had a
                reasonable chance to investigate and ship a fix.
              </p>

              <h2 id="threat-model">2. Threat Model</h2>
              <p>
                PrivaTools is designed around a simple assumption: files can be sensitive, even when a tool
                looks routine. The main risks we design against are accidental file retention, shared-cache
                exposure, third-party upload leakage, cross-site scripting, overly broad browser permissions,
                and operational logs that reveal more than they need to.
              </p>
              <ul>
                <li><strong>No account layer:</strong> there are no user accounts, passwords, billing records, or saved workspaces on the public service.</li>
                <li><strong>Temporary processing:</strong> server-side tools use temporary paths and cleanup routines rather than permanent document storage.</li>
                <li><strong>Browser-side tools:</strong> many developer utilities and selected AI tools run locally in the browser.</li>
                <li><strong>Cache controls:</strong> dynamic <code>/api/</code> responses carry <code>no-store</code> headers in the backend.</li>
                <li><strong>Source visibility:</strong> the code is public, MIT-licensed, and self-hostable.</li>
              </ul>

              <h2 id="file-handling">3. File Handling</h2>
              <p>
                Server-side tools receive files over HTTPS, process them inside the PrivaTools container,
                and return the result. The service does not intentionally retain uploaded files, outputs,
                thumbnails, or extracted text after a request is complete. Browser-side tools process data
                locally and do not send file contents to the PrivaTools backend.
              </p>
              <p>
                Standard infrastructure metadata can still exist: request path, status code, timestamp,
                user agent, and connection metadata may be visible to the server or infrastructure providers.
                Uploaded file bodies are not used for analytics, advertising, profiling, or model training.
              </p>

              <h2 id="transparency">4. Transparency Report</h2>
              <p>
                PrivaTools does not publish a formal incident archive yet. As of {LAST_UPDATED}, the public
                trust artifacts are this page, <code>SECURITY.md</code>, the RFC 9116 <code>security.txt</code>,
                the privacy policy, and the public source history.
              </p>
              <ul>
                <li><strong>External certifications:</strong> none claimed.</li>
                <li><strong>External security audit:</strong> none claimed.</li>
                <li><strong>Bug bounty:</strong> no paid bounty program is advertised.</li>
                <li><strong>Public cleanup metrics endpoint:</strong> deferred; the current slice does not add <code>/api/transparency/janitor</code>.</li>
              </ul>

              <h2 id="rights">5. Privacy Rights</h2>
              <p>
                Because PrivaTools has no accounts and does not intentionally retain uploaded file contents,
                most file-specific access, deletion, or export requests cannot be fulfilled after processing:
                the service should no longer have the file. For privacy questions about operational logs,
                analytics, or infrastructure metadata, contact <a href="mailto:hello@privatools.me">hello@privatools.me</a>.
              </p>
              <p>
                The <Link to="/privacy">Privacy Policy</Link> explains anonymous telemetry, subprocessors,
                and browser-side processing in more detail.
              </p>

              <h2 id="subprocessors">6. Subprocessors</h2>
              <p>
                These providers may see ordinary web or infrastructure metadata. They should not receive
                uploaded file contents from PrivaTools file-processing API responses.
                Fonts are self-hosted from <code>/fonts</code> on <code>privatools.me</code>.
              </p>
            </div>

            <div className="my-5 overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border bg-paper-2/50 font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Provider</th>
                    <th className="px-4 py-3 font-medium">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {SUBPROCESSORS.map(item => (
                    <tr key={item.name}>
                      <td className="px-4 py-3 font-semibold text-foreground align-top">{item.name}</td>
                      <td className="px-4 py-3 text-muted-foreground leading-relaxed">{item.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="blog-prose prose-headings:scroll-mt-20">
              <h2 id="security-txt">7. security.txt</h2>
              <p>
                The security contact file is published at{" "}
                <a href="/.well-known/security.txt">/.well-known/security.txt</a>. It follows RFC 9116
                with contact, expiration, preferred language, canonical URL, and policy fields.
              </p>
              <pre><code>{`Contact: mailto:hello@privatools.me
Expires: 2027-06-17T23:59:00Z
Preferred-Languages: en
Canonical: https://privatools.me/.well-known/security.txt
Policy: https://privatools.me/security`}</code></pre>

              <h2 id="limitations">8. Limitations</h2>
              <p>
                PrivaTools is provided for general-purpose file processing. Do not treat it as a regulated
                compliance environment unless you have reviewed, deployed, and controlled your own instance.
                The public site does not claim SOC 2, ISO 27001, HIPAA, PCI DSS, or GDPR certification.
              </p>
              <p>
                Please do not run destructive tests, denial-of-service tests, social engineering,
                credential attacks, or scans that degrade service for other users.
              </p>

              <h2 id="contact">9. Contact</h2>
              <p>
                Security and privacy questions: <a href="mailto:hello@privatools.me">hello@privatools.me</a>.
                Source code and public issues:{" "}
                <a href="https://github.com/deadpoolrulesmarvel1-svg/privatools" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>.
              </p>
            </div>

            <aside className="mt-12 pt-8 border-t border-border">
              <p className="section-mark mb-5">§ Related</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Link
                  to="/privacy"
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-accent/45 hover:bg-accent/[0.04] hover:-translate-y-0.5 transition-all"
                >
                  <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 shrink-0 mt-0.5">§01</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-[14.5px] font-semibold text-foreground tracking-[-0.015em] group-hover:text-accent transition-colors">Privacy Policy</p>
                    <p className="text-[12.5px] text-muted-foreground mt-1 leading-snug">File handling, telemetry, and subprocessors.</p>
                  </div>
                </Link>
                <a
                  href="/.well-known/security.txt"
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-accent/45 hover:bg-accent/[0.04] hover:-translate-y-0.5 transition-all"
                >
                  <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 shrink-0 mt-0.5">§02</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-[14.5px] font-semibold text-foreground tracking-[-0.015em] group-hover:text-accent transition-colors inline-flex items-center gap-1.5">
                      <FileText size={12} /> security.txt
                    </p>
                    <p className="text-[12.5px] text-muted-foreground mt-1 leading-snug">Machine-readable vulnerability contact.</p>
                  </div>
                </a>
                <a
                  href="mailto:hello@privatools.me"
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-accent/45 hover:bg-accent/[0.04] hover:-translate-y-0.5 transition-all"
                >
                  <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 shrink-0 mt-0.5">§03</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-[14.5px] font-semibold text-foreground tracking-[-0.015em] group-hover:text-accent transition-colors inline-flex items-center gap-1.5">
                      <Mail size={12} /> Report
                    </p>
                    <p className="text-[12.5px] text-muted-foreground mt-1 leading-snug">Use subject prefix [Security].</p>
                  </div>
                </a>
              </div>
            </aside>
          </article>

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
                  <TriangleAlert size={11} className="text-accent" />
                  <span>No certification claims</span>
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
                  className="w-full text-left text-[13px] text-muted-foreground hover:text-accent transition-colors"
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </article>

      {showTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-10 right-5 z-40 h-10 w-10 rounded-full border border-border bg-card shadow-lg flex items-center justify-center text-muted-foreground hover:text-accent hover:border-accent/45 transition-colors print:hidden"
          aria-label="Back to top"
        >
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  );
}
