import { useParams, Link } from "react-router-dom";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";
import { getBlogPost, blogPosts } from "@/data/blog";
import { toolBySlug } from "@/data/tools";
import { nonPdfToolBySlug } from "@/data/non-pdf-tools";
import { ArrowLeft, Clock, Tag, ArrowRight, Wrench, Sparkles } from "lucide-react";
import NotFound from "./NotFound";

/** Resolve a tool slug to its data + the correct URL prefix (PDF vs non-PDF). */
function toolFor(slug: string): { name: string; description: string; href: string } | null {
  const pdf = toolBySlug[slug];
  if (pdf) return { name: pdf.name, description: pdf.description, href: `/tool/${slug}` };
  const np = nonPdfToolBySlug[slug];
  if (np) return { name: np.name, description: np.description, href: `/tools/${slug}` };
  return null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const post = getBlogPost(slug ?? "");

  if (!post) return <NotFound />;

  const others = blogPosts.filter((p) => p.slug !== post.slug).slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <EditorialMasthead />

      <main id="main-content" className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
        <nav className="mb-8">
          <Link
            to="/blog"
            className="flex items-center gap-1.5 text-xs font-mono-meta text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={12} /> ALL ARTICLES
          </Link>
        </nav>

        <article>
          <header className="mb-8">
            <div className="flex flex-wrap gap-2 mb-4">
              {post.tags.map((tag) => (
                <span key={tag} className="category-tag text-xs">
                  <Tag size={9} className="inline mr-1" />{tag}
                </span>
              ))}
            </div>

            <h1 className="font-heading text-3xl sm:text-4xl font-black text-foreground leading-tight mb-4">
              {post.title}
            </h1>

            <p className="font-serif-body text-base text-muted-foreground mb-5 leading-relaxed">
              {post.description}
            </p>

            <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono-meta pb-6 border-b border-border/60">
              <span className="font-semibold text-foreground">{post.author || "PrivaTools Team"}</span>
              <span>·</span>
              <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
              {post.updatedAt && post.updatedAt !== post.publishedAt && (
                <>
                  <span>·</span>
                  <span>Updated <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time></span>
                </>
              )}
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock size={11} />
                {post.readTime}
              </span>
            </div>
          </header>

          {/* TL;DR / Key facts box — short, snippet-friendly summary that AI
              engines and Google's featured-snippet algorithm can pull cleanly. */}
          {post.tldr && (
            <aside className="post-tldr mb-10 rounded-2xl border border-accent/25 bg-accent/[0.04] p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={14} className="text-accent" />
                <span className="font-mono-meta text-[10px] uppercase tracking-wider text-accent font-semibold">TL;DR</span>
              </div>
              <p className="font-serif-body text-[15px] text-foreground leading-relaxed">
                {post.tldr}
              </p>
            </aside>
          )}

          <div
            className="blog-prose"
            dangerouslySetInnerHTML={{ __html: post.body }}
          />

          {/* Tools mentioned in this article — internal linking + entity graph
              for AI engines so they can cite specific tools cleanly. */}
          {post.relatedTools && post.relatedTools.length > 0 && (
            <aside className="mt-12 pt-8 border-t border-border/60">
              <div className="flex items-center gap-2 mb-5">
                <Wrench size={14} className="text-accent" />
                <h2 className="font-mono-meta text-[11px] uppercase tracking-wider text-accent font-semibold">Tools mentioned in this article</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {post.relatedTools.map((slug) => {
                  const t = toolFor(slug);
                  if (!t) return null;
                  return (
                    <Link
                      key={slug}
                      to={t.href}
                      className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 hover:border-foreground/30 hover:translate-y-[-1px] transition-all"
                    >
                      <div className="min-w-0">
                        <p className="font-heading font-bold text-[14px] text-foreground group-hover:text-accent transition-colors">{t.name}</p>
                        <p className="font-serif-body text-[12px] text-muted-foreground mt-1 line-clamp-2 leading-snug">{t.description}</p>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground shrink-0 mt-1 group-hover:translate-x-0.5 group-hover:text-accent transition-all" />
                    </Link>
                  );
                })}
              </div>
            </aside>
          )}
        </article>

        {others.length > 0 && (
          <aside className="mt-16 pt-8 border-t border-border/60">
            <div className="section-flag mb-6">MORE ARTICLES</div>
            <div className="space-y-6">
              {others.map((p) => (
                <div key={p.slug} className="flex items-start justify-between gap-4 py-4 border-b border-border/30 last:border-0">
                  <div className="min-w-0">
                    <Link
                      to={`/blog/${p.slug}`}
                      className="font-heading text-base font-bold text-foreground hover:text-primary transition-colors block mb-1 leading-tight"
                    >
                      {p.title}
                    </Link>
                    <span className="text-xs text-muted-foreground font-mono-meta flex items-center gap-1">
                      <Clock size={10} /> {p.readTime}
                    </span>
                  </div>
                  <Link to={`/blog/${p.slug}`} aria-label={`Read ${p.title}`} className="shrink-0 text-muted-foreground hover:text-primary transition-colors mt-1">
                    <ArrowRight size={14} />
                  </Link>
                </div>
              ))}
            </div>
          </aside>
        )}
      </main>

      <EditorialFooter />
    </div>
  );
}
