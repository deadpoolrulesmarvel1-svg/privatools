/**
 * NotFound — 404 with recovery paths.
 *
 * - "Did you mean" fuzzy suggestions from the URL's last segment.
 * - Falls back to MOST POPULAR tools when no plausible match exists, so the
 *   page is useful even on a random `/foo` URL where the slug yields nothing.
 * - Three explicit recovery paths: go home, open ⌘K, browse all tools.
 * - Workshop tone — slightly playful "EXTRA! EXTRA!" newspaper flag, then
 *   reassures the user their files never left the device.
 * - Report-broken-link CTA opens a prefilled GitHub issue.
 */
import { useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, Search, ArrowRight, Compass, Flag } from "lucide-react";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

/**
 * Set <meta name="robots" content="noindex,nofollow"> while NotFound is mounted
 * and restore the document-default index,follow when the user navigates away.
 *
 * Dead URLs that reach the SPA shouldn't be indexed — without an explicit
 * noindex Google can still capture the 404 body, dilute crawl budget, and
 * occasionally rank the broken URL ahead of the real tool. The frontend SPA
 * routes deliver `index.html` (HTTP 200) for unknown paths, so the visible
 * 404 page is the only signal crawlers see; an explicit noindex makes that
 * signal unambiguous.
 */
function useNoIndexMeta(): void {
    useEffect(() => {
        const META_NAME = "robots";
        let el = document.querySelector(`meta[name="${META_NAME}"]`) as HTMLMetaElement | null;
        const previous = el?.getAttribute("content") ?? null;
        if (!el) {
            el = document.createElement("meta");
            el.setAttribute("name", META_NAME);
            document.head.appendChild(el);
        }
        el.setAttribute("content", "noindex,nofollow");
        return () => {
            // Restore the previous value (or the index,follow default if the
            // tag didn't exist before NotFound mounted) so subsequent tool
            // pages aren't accidentally hidden from search engines.
            if (previous === null) {
                el?.setAttribute("content", "index,follow,max-image-preview:large");
            } else {
                el?.setAttribute("content", previous);
            }
        };
    }, []);
}

type Suggestion = { name: string; href: string; description?: string };

function fuzzyScore(needle: string, haystack: string): number {
  if (!needle) return 0;
  if (haystack === needle) return 1000;
  if (haystack.includes(needle)) return 600 + needle.length * 5;
  let score = 0;
  let i = 0;
  for (const c of needle) {
    const idx = haystack.indexOf(c, i);
    if (idx === -1) return score - 50;
    score += 10 - (idx - i);
    i = idx + 1;
  }
  return score;
}

// Curated "most popular" fallback — used when the URL has no segment or
// no segment ranks well against the tool catalog. These mirror the
// LandingPage `featuredTools` so the user gets a consistent recovery menu.
const POPULAR_SLUGS = ["merge-pdf", "compress-pdf", "split-pdf"];

function popularFallback(): Suggestion[] {
  return POPULAR_SLUGS
    .map(slug => {
      const t = tools.find(t => t.slug === slug);
      if (!t) return null;
      return { name: t.name, href: `/tool/${t.slug}`, description: t.description } as Suggestion;
    })
    .filter((s): s is Suggestion => s !== null);
}

function suggestions(path: string): { items: Suggestion[]; isFallback: boolean } {
  const seg = path.split("/").filter(Boolean).pop() || "";
  const needle = seg.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!needle) return { items: popularFallback(), isFallback: true };

  const pdfCandidates: Suggestion[] = tools.map(t => ({ name: t.name, href: `/tool/${t.slug}`, description: t.description }));
  const nonPdfCandidates: Suggestion[] = nonPdfTools.map(t => ({ name: t.name, href: `/tools/${t.slug}`, description: t.description }));
  const all = [...pdfCandidates, ...nonPdfCandidates];
  const ranked = all
    .map(s => ({ s, score: fuzzyScore(needle, s.href.split("/").pop() || "") }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // If no candidate scores above a meaningful threshold, fall back to popular tools.
  if (ranked.length === 0 || (ranked[0]?.score ?? 0) < 30) {
    return { items: popularFallback(), isFallback: true };
  }
  return { items: ranked.slice(0, 6).map(x => x.s), isFallback: false };
}

const TOTAL = tools.length + nonPdfTools.length;

const REPORT_URL = (path: string) => {
  const title = encodeURIComponent(`Broken link: ${path}`);
  const body = encodeURIComponent(
    `**URL:** \`${path}\`\n\n` +
    `**Where I came from:** _(referrer page, e.g. blog post, search result, external link)_\n\n` +
    `**What I expected:** _(which tool or page were you trying to reach?)_\n\n` +
    `**Browser / device:** _(optional)_`
  );
  return `https://github.com/deadpoolrulesmarvel1-svg/privatools/issues/new?title=${title}&body=${body}&labels=broken-link`;
};

export default function NotFound() {
  const location = useLocation();
  useNoIndexMeta();
  const { items: sugg, isFallback } = useMemo(() => suggestions(location.pathname), [location.pathname]);

  const openCmdK = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));

  return (
    <div>
      {/* AppShell already provides `<main id="main-content">` — this page-level
         wrapper is a plain <div> to avoid nested-main markup. */}
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-16 sm:py-24 text-center">
        {/* Newspaper "EXTRA!" header */}
        <div className="mb-6">
          <span className="section-flag text-lg tracking-[0.2em] px-4 py-2">EXTRA! EXTRA!</span>
        </div>

        {/* Big 404 — kept as a watermark behind the heading */}
        <p
          className="font-heading text-[120px] sm:text-[180px] font-black leading-none select-none text-foreground/5 mb-[-2rem] sm:mb-[-3rem]"
          aria-hidden="true"
        >
          404
        </p>

        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4">
          Page Not Found
        </h1>

        <div className="rule-accent mx-auto w-12 mb-6" />

        {/* Path echo — shows the user the URL the router saw */}
        <p className="font-mono-meta text-[11px] text-muted-foreground/85 break-all max-w-md mx-auto mb-6">
          <span className="text-accent">§</span> {location.pathname}
        </p>

        <p className="font-serif-body text-base text-muted-foreground max-w-md mx-auto leading-relaxed mb-10">
          This page does not exist or has been moved. But rest assured —
          <strong className="text-foreground/90"> your files are still safe.</strong> They never left
          your computer.
        </p>

        {/* Three recovery paths */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link to="/" className="btn-editorial inline-flex items-center gap-2">
            <Home size={14} /> Go home
          </Link>
          <button
            type="button"
            onClick={openCmdK}
            className="inline-flex items-center gap-2 h-11 px-5 font-sans-ui text-sm font-semibold text-foreground border border-border rounded-lg hover:border-foreground/30 hover:bg-secondary/40 transition-all"
            aria-label="Open command palette"
          >
            <Search size={14} /> Search tools
            <kbd className="hidden sm:inline-flex items-center gap-0.5 ml-1 font-mono text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-secondary/80">
              ⌘K
            </kbd>
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 h-11 px-5 font-sans-ui text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <Compass size={14} /> Browse all {TOTAL}+ tools
          </Link>
        </div>

        {/* Suggestions */}
        {sugg.length > 0 && (
          <section className="mt-14 text-left">
            <p className="font-mono-meta text-[11px] uppercase tracking-widest text-muted-foreground mb-4 text-center">
              <span className="text-accent">§</span>{" "}
              {isFallback ? "Try one of our most popular tools" : "Did you mean"}
            </p>
            <ul className="grid sm:grid-cols-2 gap-2 max-w-xl mx-auto">
              {sugg.map(s => (
                <li key={s.href}>
                  <Link
                    to={s.href}
                    className="group flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-accent/45 hover:bg-accent/[0.04] hover:-translate-y-0.5 transition-all"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-sm font-semibold text-foreground truncate group-hover:text-accent transition-colors">
                        {s.name}
                      </p>
                      {s.description && (
                        <p className="font-mono-meta text-[10.5px] text-muted-foreground mt-0.5 truncate">
                          {s.description}
                        </p>
                      )}
                    </div>
                    <ArrowRight
                      size={14}
                      className="text-muted-foreground/70 shrink-0 mt-1 group-hover:translate-x-0.5 group-hover:text-accent transition-all"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Report broken link */}
        <div className="mt-12 pt-8 border-t border-border max-w-md mx-auto">
          <p className="font-mono-meta text-[10.5px] uppercase tracking-widest text-muted-foreground mb-2">
            Followed a link here?
          </p>
          <a
            href={REPORT_URL(location.pathname)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-sans-ui text-sm text-accent hover:text-accent/80 transition-colors"
          >
            <Flag size={12} /> Report this broken link
          </a>
        </div>

        <p className="mt-12 font-mono-meta text-[10px] text-muted-foreground/85 uppercase tracking-widest">
          PrivaTools · {TOTAL}+ Privacy-First File Tools
        </p>
      </div>
    </div>
  );
}
