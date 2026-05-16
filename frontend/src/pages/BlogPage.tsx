import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";
import { blogPosts, type BlogPost } from "@/data/blog";
import { ArrowRight, Clock, Calendar, BookOpen, Sparkles, Shield, Compass, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Map a tag → which icon/color category it belongs to.
const TAG_CATEGORIES: Record<string, { id: string; label: string; icon: typeof BookOpen; accent: string }> = {
  AI: { id: "ai", label: "AI", icon: Sparkles, accent: "text-violet-400 bg-violet-500/10 border-violet-500/25" },
  Privacy: { id: "privacy", label: "Privacy", icon: Shield, accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
  Security: { id: "privacy", label: "Privacy", icon: Shield, accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
  Comparison: { id: "compare", label: "Comparison", icon: Compass, accent: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
  Review: { id: "compare", label: "Comparison", icon: Compass, accent: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
  Developer: { id: "dev", label: "Developer", icon: Code2, accent: "text-cyan-400 bg-cyan-500/10 border-cyan-500/25" },
  JWT: { id: "dev", label: "Developer", icon: Code2, accent: "text-cyan-400 bg-cyan-500/10 border-cyan-500/25" },
  "How-To": { id: "howto", label: "How-To", icon: BookOpen, accent: "text-blue-400 bg-blue-500/10 border-blue-500/25" },
};

function categoryFor(post: BlogPost) {
  for (const tag of post.tags) {
    if (TAG_CATEGORIES[tag]) return TAG_CATEGORIES[tag];
  }
  return TAG_CATEGORIES["How-To"];
}

const ALL_CATEGORIES = [
  { id: "all", label: "All posts", icon: BookOpen, accent: "text-foreground bg-secondary border-border" },
  { id: "howto", label: "How-To", icon: BookOpen, accent: "text-blue-400 bg-blue-500/10 border-blue-500/25" },
  { id: "compare", label: "Comparison", icon: Compass, accent: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
  { id: "privacy", label: "Privacy", icon: Shield, accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" },
  { id: "ai", label: "AI", icon: Sparkles, accent: "text-violet-400 bg-violet-500/10 border-violet-500/25" },
  { id: "dev", label: "Developer", icon: Code2, accent: "text-cyan-400 bg-cyan-500/10 border-cyan-500/25" },
];

export default function BlogPage() {
  const [activeCat, setActiveCat] = useState<string>("all");

  // Sort posts newest first
  const sorted = useMemo(
    () => [...blogPosts].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)),
    []
  );

  const filtered = useMemo(() => {
    if (activeCat === "all") return sorted;
    return sorted.filter(p => categoryFor(p).id === activeCat);
  }, [sorted, activeCat]);

  const featured = sorted[0];
  const rest = sorted.slice(1);
  const filteredRest = activeCat === "all" ? rest : filtered.filter(p => p.slug !== featured?.slug);

  return (
    <div className="min-h-screen bg-background">
      <EditorialMasthead />

      <main id="main-content" className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
        {/* Hero */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="section-flag">PRIVATOOLS JOURNAL</span>
            <span className="font-mono-meta text-[11px] text-muted-foreground">{blogPosts.length} guides · updated {formatDate(sorted[0]?.publishedAt || "2026-01-01")}</span>
          </div>
          <h1 className="font-heading text-4xl sm:text-6xl font-black text-foreground leading-[1.05] tracking-tight max-w-3xl">
            Privacy-first guides to file&nbsp;tools, AI, &amp; the&nbsp;web.
          </h1>
          <p className="font-serif-body text-base sm:text-lg text-muted-foreground max-w-2xl mt-5 leading-relaxed">
            Long-form, opinionated, never sponsored. Comparisons of free PDF tools, deep dives into in-browser AI, and step-by-step guides to working with files privately.
          </p>
        </header>

        {/* Category chips */}
        <nav className="flex flex-wrap gap-2 mb-10">
          {ALL_CATEGORIES.map(c => {
            const active = activeCat === c.id;
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onClick={() => setActiveCat(c.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-medium transition-all",
                  active
                    ? c.accent
                    : "text-muted-foreground bg-secondary/40 border-border hover:border-foreground/30 hover:text-foreground"
                )}
              >
                <Icon size={12} /> {c.label}
              </button>
            );
          })}
        </nav>

        {/* Featured post (only when viewing all) */}
        {activeCat === "all" && featured && (
          <Link
            to={`/blog/${featured.slug}`}
            className="group block mb-12 relative overflow-hidden rounded-2xl border border-border bg-card hover:border-foreground/30 transition-all"
          >
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-0">
              <div className="p-8 sm:p-10">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/25 border border-accent/40 text-foreground text-[10px] font-bold uppercase tracking-wider">
                    <Sparkles size={10} /> Featured
                  </span>
                  {featured.tags.slice(0, 2).map(t => {
                    const cat = TAG_CATEGORIES[t];
                    return cat ? (
                      <span key={t} className={cn("inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium", cat.accent)}>
                        {cat.label}
                      </span>
                    ) : null;
                  })}
                </div>
                <h2 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground leading-tight mb-3 group-hover:text-foreground/90 transition-colors">
                  {featured.title}
                </h2>
                <p className="font-serif-body text-[15px] text-muted-foreground leading-relaxed mb-6 max-w-xl">
                  {featured.description}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] font-mono-meta text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Calendar size={11} /> {formatDate(featured.publishedAt)}</span>
                  <span className="inline-flex items-center gap-1"><Clock size={11} /> {featured.readTime}</span>
                  {featured.author && <span>by {featured.author}</span>}
                </div>
              </div>
              <div className="relative hidden lg:block bg-gradient-to-br from-accent/10 via-card to-secondary/40 border-l border-border/60">
                <div className="absolute inset-0 flex items-center justify-center p-10 text-center">
                  <div>
                    {(() => {
                      const cat = categoryFor(featured);
                      const Icon = cat.icon;
                      return (
                        <div className={cn("inline-flex h-20 w-20 items-center justify-center rounded-2xl border-2", cat.accent)}>
                          <Icon size={36} />
                        </div>
                      );
                    })()}
                    <p className="mt-5 font-heading text-lg text-foreground/80">{categoryFor(featured).label} guide</p>
                    <p className="mt-1 font-mono-meta text-[11px] text-muted-foreground">{featured.tags.join(" · ")}</p>
                    <div className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-mono-meta text-primary">
                      Read the guide <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        )}

        {/* Grid of remaining posts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredRest.map((post) => {
            const cat = categoryFor(post);
            const Icon = cat.icon;
            return (
              <Link
                key={post.slug}
                to={`/blog/${post.slug}`}
                className="group flex flex-col rounded-xl border border-border bg-card p-5 hover:border-foreground/30 hover:translate-y-[-2px] transition-all"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium", cat.accent)}>
                    <Icon size={10} /> {cat.label}
                  </span>
                  <span className="font-mono-meta text-[10px] text-muted-foreground">{post.readTime}</span>
                </div>
                <h3 className="font-heading text-[17px] font-bold text-foreground leading-snug mb-2 group-hover:text-foreground/90 transition-colors">
                  {post.title}
                </h3>
                <p className="font-serif-body text-[13px] text-muted-foreground leading-relaxed line-clamp-3 mb-5 flex-1">
                  {post.description}
                </p>
                <div className="flex items-center justify-between pt-3 border-t border-border/60">
                  <span className="font-mono-meta text-[10px] text-muted-foreground">{formatDate(post.publishedAt)}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono-meta text-primary">
                    READ <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="font-serif-body text-muted-foreground">No posts in this category yet. Check back soon.</p>
          </div>
        )}

        {/* Newsletter-style CTA */}
        <section className="mt-16 rounded-2xl border border-border bg-card p-8 sm:p-10 text-center">
          <h2 className="font-heading text-xl sm:text-2xl font-bold text-foreground mb-2">
            Want guides like these without the cloud upload?
          </h2>
          <p className="font-serif-body text-[14px] text-muted-foreground max-w-2xl mx-auto mb-6">
            PrivaTools is free, open-source, and processes everything privately — files never leave the container, and the source code is on GitHub.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/" className="btn-editorial inline-flex items-center gap-2">
              Browse all {blogPosts.length}+ guides <ArrowRight size={14} />
            </Link>
            <a
              href="https://github.com/taiyeba-dg/privatools"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-secondary/40 text-[13px] font-medium text-foreground hover:border-foreground/30 transition-colors"
            >
              View source on GitHub
            </a>
          </div>
        </section>
      </main>

      <EditorialFooter />
    </div>
  );
}
