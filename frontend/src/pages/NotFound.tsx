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
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-20 sm:py-28 text-center">
      {/* The numeral is the artwork. Set in the display face at a size that
          reads as deliberate rather than as a ghost watermark behind the text. */}
      <p
        aria-hidden="true"
        className="font-display font-extrabold leading-none tracking-[-0.06em] text-[110px] sm:text-[168px] bg-clip-text text-transparent select-none"
        style={{ backgroundImage: "linear-gradient(160deg, hsl(var(--primary)), hsl(var(--cat-edit)) 55%, hsl(var(--accent)))" }}
      >
        404
      </p>

      <h1 className="font-display text-[30px] sm:text-[38px] font-extrabold text-foreground tracking-[-0.035em] leading-tight text-balance -mt-2">
        We couldn&rsquo;t find that page
      </h1>

      <p className="mt-3 text-[15.5px] text-muted-foreground max-w-lg mx-auto leading-relaxed">
        Nothing was lost. Whatever you were working on never left your device
        in the first place.
      </p>

      <p className="mt-4 inline-block rounded-full border border-border bg-paper-2 px-3.5 py-1.5 font-mono text-[12.5px] text-muted-foreground break-all">
        {location.pathname}
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-2.5">
        <Link to="/" className="btn-accent">
          <Home size={16} /> Go home
        </Link>
        <button
          onClick={openCmdK}
          className="press inline-flex items-center gap-2 h-12 px-6 rounded-full border border-border bg-card text-[15px] font-medium text-foreground hover:border-primary/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search size={16} /> Search {TOTAL} tools
        </button>
        <Link
          to="/"
          className="press inline-flex items-center gap-2 h-12 px-6 rounded-full border border-border bg-card text-[15px] font-medium text-foreground hover:border-primary/50 transition-colors"
        >
          <Compass size={16} /> Browse everything
        </Link>
      </div>

      <section className="mt-14 text-left">
        <h2 className="text-[13.5px] font-semibold text-muted-foreground mb-3 text-center">
          {isFallback ? "Or start with one of these" : "Did you mean one of these?"}
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-2 stagger-in">
          {sugg.map(s => (
            <Link
              key={s.href}
              to={s.href}
              className="press group flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 text-left hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold text-foreground">{s.name}</span>
                <span className="block text-[13px] text-muted-foreground truncate">{s.description}</span>
              </span>
              <ArrowRight size={16} className="shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </section>

      <p className="mt-12 text-[13.5px] text-muted-foreground">
        Followed a link here?{" "}
        <a
          href={REPORT_URL(location.pathname)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
        >
          <Flag size={13} /> Report the broken link
        </a>
      </p>
    </div>
    </div>
  );
}
