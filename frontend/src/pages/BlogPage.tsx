/**
 * BlogPage — workshop journal index with reading aids.
 *
 * Adds substance beyond the original grid:
 *   - Full-text search with 150ms debounce and live match highlighting in
 *     titles and descriptions (mark element with accent underline)
 *   - Tag cloud with counts — clicking a tag filters the grid. Tags are
 *     visually weighted by count (popular tags render larger / bolder).
 *   - "New" badge on posts whose updatedAt is within 30 days (animated dot)
 *   - Featured post on a clean state; below the featured panel a §-numbered
 *     "More like this" rail (other posts sharing the featured's primary tag)
 *   - Empty state shows what was searched + suggests up to 3 alternative
 *     queries derived from existing tag tokens that share a prefix/substring
 *   - Result count chip with mono dateline
 *
 * Workshop styling preserved: § masthead, mono dateline, featured post with
 * corner marks, §-numbered article grid, category chip rail.
 */
import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { blogPosts, type BlogPost } from "@/data/blog";
import {
  ArrowRight, Clock, Calendar, BookOpen, Sparkles, Shield, Compass, Code2, Search, X, Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Category {
  id: string;
  label: string;
  icon: typeof BookOpen;
  toneFg: string;
  toneBg: string;
}

const HOWTO:   Category = { id: "howto",   label: "How-to",     icon: BookOpen,  toneFg: "text-accent",     toneBg: "bg-accent/[0.08] border-accent/30" };
const COMPARE: Category = { id: "compare", label: "Comparison", icon: Compass,   toneFg: "text-copper",     toneBg: "bg-copper/15 border-copper/30" };
const PRIVACY: Category = { id: "privacy", label: "Privacy",    icon: Shield,    toneFg: "text-accent",     toneBg: "bg-accent/[0.08] border-accent/30" };
const AI:      Category = { id: "ai",      label: "AI",         icon: Sparkles,  toneFg: "text-foreground", toneBg: "bg-foreground/10 border-foreground/30" };
const DEV:     Category = { id: "dev",     label: "Developer",  icon: Code2,     toneFg: "text-foreground", toneBg: "bg-secondary/60 border-border-strong" };

const TAG_CATEGORIES: Record<string, Category> = {
  "How-To": HOWTO,
  Comparison: COMPARE, Review: COMPARE,
  Privacy: PRIVACY, Security: PRIVACY,
  AI,
  Developer: DEV, JWT: DEV,
};

function categoryFor(post: BlogPost): Category {
  for (const tag of post.tags) {
    if (TAG_CATEGORIES[tag]) return TAG_CATEGORIES[tag];
  }
  return HOWTO;
}

/** Is the post recently updated (within 30 days)? */
function isRecentlyUpdated(p: BlogPost): boolean {
  const last = p.updatedAt || p.publishedAt;
  const ms = Date.now() - new Date(last).getTime();
  return ms < 30 * 24 * 60 * 60 * 1000;
}

/**
 * Escape a substring for safe insertion into a RegExp source. Used by the
 * search-highlight helper below — keeps quote/dot/parens/etc. literal so the
 * user's query never explodes the matcher.
 */
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wrap occurrences of `query` (case-insensitive) inside `text` with a `<mark>`
 * element so the matched substring shows the accent underline. Returns a JSX
 * fragment array — preserves the surrounding text untouched.
 */
function highlight(text: string, query: string) {
  if (!query) return text;
  const re = new RegExp(`(${escapeRegExp(query)})`, "ig");
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part) && part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-accent/20 text-accent rounded px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  );
}

const ALL_CATEGORIES: Category[] = [
  { id: "all", label: "All", icon: BookOpen, toneFg: "text-foreground", toneBg: "bg-card border-border" },
  HOWTO, COMPARE, PRIVACY, AI, DEV,
];

export default function BlogPage() {
  const [activeCat, setActiveCat] = useState<string>("all");
  const [query, setQuery] = useState("");
  // Debounced version of `query` used for filtering — keeps the input snappy
  // even when the user types fast against the 16-post in-memory index.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 150ms debounce — the body is small but the same pattern scales for free
  // when the journal grows. Clears prior timeout when typing continues.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 150);
    return () => window.clearTimeout(t);
  }, [query]);

  // Keyboard shortcut: "/" focuses search (skipped if user is already typing
  // somewhere else). A small affordance for power users.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sorted = useMemo(
    () => [...blogPosts].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)),
    []
  );

  // Tag cloud — count occurrences of every tag.
  const tagCloud = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of sorted) {
      for (const t of p.tags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [sorted]);

  // Tag-weight bucketing for the cloud — assigns 1..5 to each tag based on its
  // share of the maximum count, used to pick font size + opacity at render.
  const tagMaxCount = tagCloud[0]?.[1] || 1;

  const q = debouncedQuery.trim().toLowerCase();
  const filtered = useMemo(() => {
    return sorted.filter(p => {
      if (activeCat !== "all" && categoryFor(p).id !== activeCat) return false;
      if (activeTag && !p.tags.includes(activeTag)) return false;
      if (q) {
        const hay = `${p.title} ${p.description} ${p.tldr || ""} ${p.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sorted, activeCat, activeTag, q]);

  // Suggested searches for the empty state — when the user's query has no
  // direct match, surface up to 3 tag tokens that share at least one letter
  // bigram with the query. Cheap heuristic, but feels intelligent for the
  // small corpus.
  const suggestions = useMemo(() => {
    if (!q) return [];
    const all = tagCloud.map(([t]) => t);
    const scored: { tag: string; score: number }[] = [];
    for (const tag of all) {
      const tagL = tag.toLowerCase();
      // Prefix match wins big, then substring, then bigram overlap.
      let s = 0;
      if (tagL.startsWith(q.slice(0, 2))) s += 4;
      if (tagL.includes(q)) s += 3;
      for (let i = 0; i < q.length - 1; i++) {
        if (tagL.includes(q.slice(i, i + 2))) s += 1;
      }
      if (s > 0) scored.push({ tag, score: s });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 3).map(s => s.tag);
  }, [q, tagCloud]);

  const featured = sorted[0];
  const showFeatured = activeCat === "all" && !activeTag && !q;
  const filteredRest = showFeatured ? filtered.filter(p => p.slug !== featured?.slug) : filtered;

  // "More like this" rail — sibling posts to the featured guide, picked by
  // the featured's first recognised tag. Only renders on the clean state.
  const moreLikeFeatured = useMemo(() => {
    if (!showFeatured || !featured) return [];
    const primary = featured.tags.find(t => TAG_CATEGORIES[t]) || featured.tags[0];
    if (!primary) return [];
    return sorted
      .filter(p => p.slug !== featured.slug && p.tags.includes(primary))
      .slice(0, 4);
  }, [showFeatured, featured, sorted]);

  const hasFilters = activeCat !== "all" || activeTag || q;
  const clearFilters = () => { setActiveCat("all"); setActiveTag(null); setQuery(""); };

  return (
    <div>
      {/* No nested <main> — AppShell already provides `<main id="main-content">`. */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">

        {/* ── Masthead ── */}
        <header className="mb-10 animate-fade-up">
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border">
            <p className="section-mark">PrivaTools Journal</p>
            <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
              {blogPosts.length} guides · updated {formatDate(sorted[0]?.publishedAt || "2026-01-01")}
            </p>
          </div>
          <h1 className="font-display font-bold text-foreground tracking-[-0.025em] leading-[1.05] text-4xl sm:text-6xl max-w-3xl"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
            Privacy-first guides to file tools, <span className="italic text-accent">AI</span>, &amp; the web.
          </h1>
          <p className="font-display text-[16px] sm:text-[18px] text-muted-foreground max-w-2xl mt-5 leading-relaxed">
            Long-form, opinionated, never sponsored. Comparisons of free PDF tools, deep dives into in-browser AI, and step-by-step guides to working with files privately.
          </p>
        </header>

        {/* ── Search + category chips ── */}
        <div className="mb-8 space-y-3 animate-fade-up stagger-1">
          {/* Search */}
          <div className="rounded-xl border border-border bg-card overflow-hidden focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-colors">
            <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
              <span><span className="text-accent">§</span> Search</span>
              <span className="flex items-center gap-3">
                {q && (
                  <span className="text-accent tabular-nums">
                    {filtered.length} {filtered.length === 1 ? "match" : "matches"}
                  </span>
                )}
                <kbd className="hidden sm:inline-flex h-5 items-center px-1.5 rounded border border-border bg-paper-2/60 text-[9.5px] tracking-[0.06em] text-muted-foreground/80">/</kbd>
              </span>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search across titles, descriptions, and tags…"
                aria-label="Search articles"
                className="w-full pl-10 pr-10 py-3 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Category chips */}
          <nav className="flex flex-wrap gap-2" aria-label="Filter by category">
            {ALL_CATEGORIES.map(c => {
              const active = activeCat === c.id;
              const Icon = c.icon;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveCat(c.id)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border font-mono text-[10.5px] tracking-[0.10em] uppercase transition-colors",
                    active
                      ? `${c.toneBg} ${c.toneFg} font-semibold ring-1 ring-accent/40`
                      : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground"
                  )}
                >
                  <Icon size={11} /> {c.label}
                </button>
              );
            })}
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-paper-2/30 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground hover:text-accent hover:border-accent/45"
              >
                <X size={11} /> Clear all
              </button>
            )}
          </nav>

          {/* Active tag pill */}
          {activeTag && (
            <div className="flex items-center gap-2 animate-fade-in">
              <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Tag filter:</span>
              <button
                onClick={() => setActiveTag(null)}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-accent/45 bg-accent/[0.08] font-mono text-[10.5px] tracking-[0.06em] text-accent hover:bg-accent/[0.12]"
              >
                <Tag size={10} /> {activeTag} <X size={10} />
              </button>
            </div>
          )}
        </div>

        {/* ── Featured (only when no filters applied) ── */}
        {showFeatured && featured && (() => {
          const cat = categoryFor(featured);
          const Icon = cat.icon;
          return (
            <Link
              to={`/blog/${featured.slug}`}
              className="group block mb-6 relative overflow-hidden rounded-2xl border border-accent/30 bg-accent/[0.04] hover:border-accent hover:bg-accent/[0.06] transition-colors animate-fade-up stagger-2"
            >
              <div className="relative grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-0">
                <CornerMarks />
                <div className="p-8 sm:p-10">
                  <div className="flex items-center gap-2 mb-4 flex-wrap">
                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-accent/20 border border-accent/45 text-accent font-mono text-[10px] tracking-[0.10em] uppercase font-semibold">
                      <Sparkles size={9} /> Featured
                    </span>
                    {isRecentlyUpdated(featured) && (
                      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-accent/15 border border-accent/40 text-accent font-mono text-[10px] tracking-[0.10em] uppercase">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-70" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                        </span>
                        New
                      </span>
                    )}
                    {featured.tags.slice(0, 2).map(t => {
                      const tagCat = TAG_CATEGORIES[t];
                      return tagCat ? (
                        <span key={t} className={cn(
                          "inline-flex items-center h-6 px-2 rounded-full border font-mono text-[10px] tracking-[0.10em] uppercase",
                          tagCat.toneBg, tagCat.toneFg
                        )}>
                          {tagCat.label}
                        </span>
                      ) : null;
                    })}
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground leading-tight tracking-[-0.025em] mb-3 group-hover:text-foreground/95 transition-colors"
                      style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                    {featured.title}
                  </h2>
                  <p className="text-[15px] text-muted-foreground leading-relaxed mb-6 max-w-xl">
                    {featured.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Calendar size={11} /> {formatDate(featured.publishedAt)}</span>
                    <span className="inline-flex items-center gap-1"><Clock size={11} /> {featured.readTime}</span>
                    {featured.author && <span>by <span className="text-foreground">{featured.author}</span></span>}
                  </div>
                </div>
                <div className="relative hidden lg:block bg-paper-2/30 border-l border-border">
                  <div className="absolute inset-0 flex items-center justify-center p-10 text-center">
                    <div>
                      <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-accent/40 bg-accent/[0.06]">
                        <Icon size={32} className="text-accent" />
                      </div>
                      <p className="mt-5 font-display text-[17px] font-semibold text-foreground tracking-[-0.015em]">{cat.label} guide</p>
                      <p className="mt-1 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">{featured.tags.join(" · ")}</p>
                      <div className="mt-5 inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent">
                        Read the guide <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          );
        })()}

        {/* ── More like this — rail under the featured guide, surfaces sibling
            posts sharing the featured's primary tag. Renders only on clean state. ── */}
        {showFeatured && moreLikeFeatured.length > 0 && (() => {
          const primary = featured?.tags.find(t => TAG_CATEGORIES[t]) || featured?.tags[0];
          return (
            <section className="mb-10 animate-fade-up stagger-2" aria-label="More like the featured post">
              <div className="flex items-center justify-between mb-3">
                <p className="section-mark">More like this</p>
                {primary && (
                  <button
                    onClick={() => setActiveTag(primary)}
                    className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground hover:text-accent inline-flex items-center gap-1.5 transition-colors"
                  >
                    All {primary} <ArrowRight size={11} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {moreLikeFeatured.map((p, i) => (
                  <Link
                    key={p.slug}
                    to={`/blog/${p.slug}`}
                    className="group rounded-xl border border-border bg-card p-3.5 hover:border-accent/45 hover:bg-accent/[0.03] transition-colors"
                  >
                    <p className="font-mono text-[9.5px] tracking-[0.10em] uppercase text-accent/70 mb-1">§{String(i + 1).padStart(2, "0")}</p>
                    <p className="font-display text-[13px] font-semibold text-foreground leading-snug tracking-[-0.015em] line-clamp-3 group-hover:text-accent transition-colors">
                      {p.title}
                    </p>
                    <p className="mt-2 font-mono text-[9.5px] tracking-[0.06em] uppercase text-muted-foreground inline-flex items-center gap-1.5">
                      <Clock size={9} /> {p.readTime}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })()}

        {/* ── Article grid ── */}
        {filteredRest.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRest.map((post, i) => {
              const cat = categoryFor(post);
              const Icon = cat.icon;
              const idx = i + (showFeatured && featured ? 2 : 1);
              const recent = isRecentlyUpdated(post);
              return (
                <Link
                  key={post.slug}
                  to={`/blog/${post.slug}`}
                  className="group relative flex flex-col rounded-xl border border-border bg-card p-5 hover:border-accent/45 hover:bg-accent/[0.02] hover:-translate-y-0.5 transition-all overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-4 gap-2">
                    <span className={cn(
                      "inline-flex items-center gap-1 h-6 px-2 rounded-full border font-mono text-[9.5px] tracking-[0.10em] uppercase",
                      cat.toneBg, cat.toneFg
                    )}>
                      <Icon size={10} /> {cat.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {recent && (
                        <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded font-mono text-[9px] tracking-[0.10em] uppercase font-semibold bg-accent/15 border border-accent/35 text-accent">
                          <span className="relative flex h-1 w-1">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-70" />
                            <span className="relative inline-flex h-1 w-1 rounded-full bg-accent" />
                          </span>
                          New
                        </span>
                      )}
                      <span className="font-mono text-[9.5px] tracking-[0.10em] uppercase text-muted-foreground">{post.readTime}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 mb-2">
                    <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 shrink-0 mt-1">§{String(idx).padStart(2, "0")}</span>
                    <h3 className="font-display text-[17px] font-bold text-foreground leading-snug tracking-[-0.02em] group-hover:text-foreground/95 transition-colors">
                      {highlight(post.title, q)}
                    </h3>
                  </div>
                  <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-3 mb-5 flex-1">
                    {highlight(post.description, q)}
                  </p>
                  <div className="flex items-center justify-between pt-3 border-t border-border/60">
                    <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground">{formatDate(post.publishedAt)}</span>
                    <span className="inline-flex items-center gap-1 font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent">
                      Read <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-paper-2/20 py-16 text-center px-6">
            <p className="font-mono text-[11px] tracking-[0.10em] uppercase text-muted-foreground">No posts match these filters</p>
            {q && (
              <p className="mt-3 text-[14px] text-muted-foreground">
                Searched for <span className="font-mono text-accent">"{query}"</span>
              </p>
            )}
            {suggestions.length > 0 && (
              <div className="mt-6">
                <p className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground/80 mb-2">Try one of these instead</p>
                <div className="inline-flex flex-wrap justify-center gap-2">
                  {suggestions.map(s => (
                    <button
                      key={s}
                      onClick={() => { setQuery(""); setActiveTag(s); setActiveCat("all"); }}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-accent/35 bg-accent/[0.04] font-mono text-[10.5px] tracking-[0.06em] text-accent hover:bg-accent/[0.10]"
                    >
                      <Tag size={10} /> {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={clearFilters}
              className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
            >
              <X size={12} /> Clear filters
            </button>
          </div>
        )}

        {/* ── Tag cloud — weighted by frequency ──
            Popular tags render bigger and bolder so the visual hierarchy
            doubles as an at-a-glance topic map. Each tag also shows its
            count for clarity. */}
        {tagCloud.length > 0 && (
          <section className="mt-16 rounded-xl border border-border bg-card overflow-hidden animate-fade-up">
            <div className="px-5 py-3 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
              <span><span className="text-accent">§</span> All tags</span>
              <span>{tagCloud.length} unique · weighted by post count</span>
            </div>
            <div className="p-4 flex flex-wrap items-baseline gap-x-2 gap-y-2">
              {tagCloud.map(([tag, count]) => {
                const active = activeTag === tag;
                // Map count → bucket 0..4 → font/opacity weight. Smallest bucket
                // still readable; largest sits roughly 1.5x base.
                const weight = Math.min(4, Math.round(((count - 1) / Math.max(1, tagMaxCount - 1)) * 4));
                const sizeCls = ["text-[11px]", "text-[12px]", "text-[13px]", "text-[14.5px]", "text-[16px]"][weight];
                const opacityCls = ["opacity-70", "opacity-80", "opacity-90", "opacity-100", "opacity-100"][weight];
                const fontWeightCls = weight >= 3 ? "font-semibold" : "font-medium";
                return (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(active ? null : tag)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 transition-all leading-none",
                      sizeCls, opacityCls, fontWeightCls,
                      active
                        ? "border-accent bg-accent/[0.10] text-accent ring-1 ring-accent/40"
                        : "border-border bg-card text-foreground/85 hover:border-accent/45 hover:text-accent hover:bg-accent/[0.04]"
                    )}
                  >
                    <span>{tag}</span>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">{count}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Newsletter / CTA ── */}
        <section className="mt-12 rounded-2xl border border-accent/30 bg-accent/[0.04] overflow-hidden animate-fade-up">
          <div className="relative p-8 sm:p-10 text-center">
            <CornerMarks />
            <p className="section-mark mb-3 inline-block">Workshop</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-foreground tracking-[-0.025em] leading-tight"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
              Want guides like these without the <span className="italic text-accent">privacy guesswork</span>?
            </h2>
            <p className="mt-4 text-[14px] text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              PrivaTools is free, open-source, and built for private file work — browser-only where possible, with isolated temporary processing when a backend is needed.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/" className="btn-accent">
                Browse {blogPosts.length}+ guides <ArrowRight size={13} />
              </Link>
              <a
                href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
              >
                View source on GitHub
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
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
