import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, Search, ArrowRight } from "lucide-react";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

type Suggestion = { name: string; href: string };

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

function suggestions(path: string): Suggestion[] {
  // Pull the last URL segment (the would-be slug) and rank against all tools.
  const seg = path.split("/").filter(Boolean).pop() || "";
  const needle = seg.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!needle) return [];
  const pdfCandidates: Suggestion[] = tools.map(t => ({ name: t.name, href: `/tool/${t.slug}` }));
  const nonPdfCandidates: Suggestion[] = nonPdfTools.map(t => ({ name: t.name, href: `/tools/${t.slug}` }));
  const all = [...pdfCandidates, ...nonPdfCandidates];
  return all
    .map(s => ({ s, score: fuzzyScore(needle, s.href.split("/").pop() || "") }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(x => x.s);
}

const TOTAL = tools.length + nonPdfTools.length;

export default function NotFound() {
  const location = useLocation();
  const sugg = useMemo(() => suggestions(location.pathname), [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      <EditorialMasthead />

      <main id="main-content" className="mx-auto max-w-3xl px-4 sm:px-6 py-20 sm:py-28 text-center">
        {/* Newspaper "EXTRA!" header */}
        <div className="mb-8">
          <span className="section-flag text-lg tracking-[0.2em] px-4 py-2">EXTRA! EXTRA!</span>
        </div>

        {/* Big 404 */}
        <p className="font-heading text-[120px] sm:text-[180px] font-black leading-none select-none text-foreground/5 mb-[-2rem] sm:mb-[-3rem]">
          404
        </p>

        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4">
          Page Not Found
        </h1>

        <div className="rule-accent mx-auto w-12 mb-6" />

        <p className="font-serif-body text-base text-muted-foreground max-w-sm mx-auto leading-relaxed mb-10">
          The page you're looking for doesn't exist or has been moved.
          But rest assured — your files are still safe. They never left your computer.
        </p>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link to="/" className="btn-editorial inline-flex items-center gap-2">
            <Home size={14} /> GO HOME
          </Link>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
            className="inline-flex items-center gap-2 px-5 py-3 font-sans-ui text-xs font-bold uppercase tracking-widest text-muted-foreground border border-border hover:text-foreground hover:border-foreground/30 transition-all"
          >
            <Search size={14} /> Search tools (⌘K)
          </button>
        </div>

        {sugg.length > 0 && (
          <section className="mt-14 text-left">
            <p className="font-mono-meta text-[11px] uppercase tracking-widest text-muted-foreground mb-3 text-center">
              Did you mean
            </p>
            <ul className="grid sm:grid-cols-2 gap-2 max-w-xl mx-auto">
              {sugg.map(s => (
                <li key={s.href}>
                  <Link
                    to={s.href}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-foreground/30 transition-all"
                  >
                    <span className="text-sm font-medium text-foreground truncate">{s.name}</span>
                    <ArrowRight size={14} className="text-muted-foreground/70 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-16 font-mono-meta text-[10px] text-muted-foreground/85 uppercase tracking-widest">
          PrivaTools · {TOTAL}+ Privacy-First File Tools
        </p>
      </main>

      <EditorialFooter />
    </div>
  );
}
