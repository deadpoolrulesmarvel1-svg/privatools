/**
 * BlogPostPage — workshop article view with reading aids.
 *
 * Adds substance beyond the original layout:
 *   - Reading-progress bar at the top of the viewport (signal-green fill,
 *     1.5px tall, glow strong enough to read against any background)
 *   - Floating right-side TOC auto-extracted from the article's h2/h3 tags,
 *     with active section highlighting + estimated minutes remaining
 *   - Hash-link anchors on every heading (§ marker visible on hover, clicking
 *     a heading copies the deep link to clipboard with a toast)
 *   - Scroll-to-top button that fades in after 800px
 *   - Share menu — copy link, X/Twitter, LinkedIn (Web Share API if available)
 *   - Expandable TL;DR — collapsed by default to one-line, expand for full
 *   - Related-tools rail + "Browse all tools" link
 *   - "More articles" picked by tag overlap (most relevant first)
 *   - Code-block copy-to-clipboard buttons (decorates <pre> on mount)
 *   - All images lazy-loaded and decoded async
 *
 * Workshop styling: mono dateline, accent TL;DR with corner marks,
 * §-numbered related-tool cards.
 *
 * Critical constraints:
 *   - Every hook (useMemo/useRef/useState/useLayoutEffect/useEffect) must run
 *     unconditionally BEFORE the `!post → NotFound` early return. Putting any
 *     return above the hooks crashes React with "Rendered fewer hooks than
 *     expected" when navigating between valid and invalid slugs.
 *   - We don't wrap the article in `<div className="h-full overflow-y-auto">` —
 *     AppShell's <main id="workspace"> is the real scroll container, and
 *     adding a nested scroller broke TOC click-to-scroll in a previous build.
 *   - The TOC walks up from `articleRef` to find the genuinely scrollable
 *     ancestor (scrollHeight > clientHeight). Falls back to #workspace.
 *   - Smooth scroll uses a hand-rolled rAF helper because native
 *     scrollTo({behavior:"smooth"}) silently no-ops on nested overflow
 *     containers in some Chromium configurations.
 */
import { useParams, Link } from "react-router-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getBlogPost, blogPosts } from "@/data/blog";
import { toolBySlug } from "@/data/tools";
import { nonPdfToolBySlug } from "@/data/non-pdf-tools";
import {
  ArrowLeft, Clock, ArrowRight, Wrench, Sparkles, Calendar, ArrowUp, Link2, Check,
  List, Share2, Twitter, Linkedin, ChevronDown, Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import NotFound from "./NotFound";

/** Resolve a tool slug to its data + the correct URL prefix. */
function toolFor(slug: string): { name: string; description: string; href: string } | null {
  const pdf = toolBySlug[slug];
  if (pdf) return { name: pdf.name, description: pdf.description, href: `/tool/${slug}` };
  const np = nonPdfToolBySlug[slug];
  if (np) return { name: np.name, description: np.description, href: `/tools/${slug}` };
  return null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Parse "8 min read" / "12-min read" → 8. Tolerates leading/trailing text,
 * defaults to 5 when no integer found. Used by the TOC to estimate minutes
 * remaining as the reader scrolls.
 */
function readTimeMinutes(label: string): number {
  const m = label.match(/(\d+)/);
  return m ? Math.max(1, parseInt(m[1], 10)) : 5;
}

/**
 * Hand-rolled smooth scroll. Browsers' native `scrollTo({behavior:"smooth"})`
 * is unreliable on nested overflow containers (Chromium silently no-ops in
 * some configurations, including the dev preview headless runner). This rAF
 * loop animates `el.scrollTop` from current to target with an ease-out
 * curve, respects prefers-reduced-motion by snapping instantly, and cancels
 * cleanly if a new animation starts mid-flight.
 */
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
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.scrollTop = start + dist * ease;
    if (t < 1) smoothScrollRaf = requestAnimationFrame(step);
    else smoothScrollRaf = 0;
  };
  smoothScrollRaf = requestAnimationFrame(step);
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").trim().replace(/^-|-$/g, "");
}

interface TocItem { id: string; text: string; level: 2 | 3 }

/**
 * Inject id="…" attributes into h2/h3 elements of the rendered HTML and
 * extract a flat list of {id, text, level} for the TOC. Also adds
 * loading="lazy" + decoding="async" to inline images so long posts don't
 * choke on initial paint. Returns the augmented HTML + the TOC items.
 */
function processBodyForToc(html: string): { html: string; items: TocItem[] } {
  if (typeof window === "undefined") return { html, items: [] };
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  const items: TocItem[] = [];
  const seen = new Set<string>();
  wrapper.querySelectorAll("h2, h3").forEach((h) => {
    const text = h.textContent || "";
    let id = slugify(text);
    let n = 2;
    while (seen.has(id)) id = `${slugify(text)}-${n++}`;
    seen.add(id);
    h.setAttribute("id", id);
    // Attach a hash anchor we render via the heading-anchor class.
    h.classList.add("heading-anchor");
    items.push({ id, text, level: h.tagName === "H2" ? 2 : 3 });
  });
  // Lazy-load + async-decode every inline image. Cheap perf win for any
  // post with screenshots and avoids layout thrash on slow connections.
  wrapper.querySelectorAll("img").forEach((img) => {
    if (!img.hasAttribute("loading")) img.setAttribute("loading", "lazy");
    if (!img.hasAttribute("decoding")) img.setAttribute("decoding", "async");
  });
  return { html: wrapper.innerHTML, items };
}

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const post = getBlogPost(slug ?? "");

  // NOTE: hooks below must run unconditionally for every render — never put
  // an early `return` (e.g. `<NotFound />`) before them, or React will throw
  // "Rendered fewer hooks than expected" when navigating between valid and
  // invalid slugs. We pass an empty body to memo when post is missing and
  // do the NotFound bailout at the bottom of the hook stack.

  // Pre-process body once per post to inject heading ids + build TOC.
  const { html: processedHtml, items: tocItems } = useMemo(
    () => processBodyForToc(post?.body || ""),
    [post?.body]
  );

  // Pick 3 "more articles" with the highest tag overlap to the current post,
  // tie-breaking by recency. Falls back to recent posts when no overlap.
  const others = useMemo(() => {
    if (!post) return [];
    const here = new Set(post.tags);
    return blogPosts
      .filter(p => p.slug !== post.slug)
      .map(p => ({
        post: p,
        overlap: p.tags.filter(t => here.has(t)).length,
        recency: +new Date(p.publishedAt),
      }))
      .sort((a, b) => b.overlap - a.overlap || b.recency - a.recency)
      .slice(0, 3)
      .map(x => x.post);
  }, [post]);

  const articleRef = useRef<HTMLElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);

  // Reading progress — updates a top fixed bar as the user scrolls past the
  // article container. Throttled with rAF for smoothness on long pages.
  const [progress, setProgress] = useState(0);
  // Active heading id (current section) — highlighted in the TOC.
  const [activeId, setActiveId] = useState<string | null>(null);
  // Scroll-to-top button visibility.
  const [showTop, setShowTop] = useState(false);
  // Link-copy feedback (top button).
  const [copied, setCopied] = useState(false);
  // Heading-anchor copy feedback — keyed by heading id so each shows its own
  // brief "Copied" state without conflicting with the global copy button.
  const [anchorCopied, setAnchorCopied] = useState<string | null>(null);
  // Share menu open state — controls the small popover next to the dateline.
  const [shareOpen, setShareOpen] = useState(false);
  // TL;DR expansion — start collapsed so the preview is one line; users can
  // expand to read the full summary without leaving the layout.
  const [tldrExpanded, setTldrExpanded] = useState(false);
  // Ref to the share menu wrapper so we can close on outside click.
  const shareMenuRef = useRef<HTMLDivElement>(null);

  // Locate the *actual* scrollable parent. AppShell's <main id="workspace">
  // is the real scroll container; child wrappers that declare overflow-y-auto
  // are no-ops when their parent doesn't fix their height. We walk up and
  // only return ancestors whose scrollHeight > clientHeight (genuinely
  // scrollable). Fall back to #workspace (AppShell's known scroller) or
  // window if neither resolves.
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

  // Scroll progress + active TOC. This only adds passive listeners and
  // updates state on rAF — it doesn't measure layout that the same paint
  // must consume, so useEffect (post-paint, non-blocking) is correct.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;

    const scrollEl = getScrollEl(article);
    let raf = 0;

    const update = () => {
      raf = 0;
      const rect = article.getBoundingClientRect();
      const containerEl = scrollEl || document.documentElement;
      const viewportH = scrollEl ? scrollEl.clientHeight : window.innerHeight;
      const articleTop = rect.top - (scrollEl ? scrollEl.getBoundingClientRect().top : 0);
      const totalDistance = Math.max(1, rect.height - viewportH);
      const scrolled = Math.min(Math.max(-articleTop, 0), totalDistance);
      setProgress((scrolled / totalDistance) * 100);

      const scrollTop = scrollEl ? scrollEl.scrollTop : (window.scrollY || document.documentElement.scrollTop);
      setShowTop(scrollTop > 800);

      // Active TOC item — first heading whose top is below the viewport's
      // upper "comfort zone" (≈ 25% from top), counted from the article.
      const headingEls = Array.from(article.querySelectorAll<HTMLElement>("h2[id], h3[id]"));
      const comfort = viewportH * 0.25;
      let current: string | null = null;
      for (const h of headingEls) {
        const top = h.getBoundingClientRect().top - (scrollEl ? scrollEl.getBoundingClientRect().top : 0);
        if (top - comfort <= 0) current = h.id;
        else break;
      }
      setActiveId(current);
      void containerEl; // keep ref to satisfy lint
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    const target = scrollEl || window;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [processedHtml]);

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

  /**
   * Copy a deep link to a specific heading. Updates the URL hash + shows a
   * scoped "Copied" pill next to the heading for ~1.6s. Best-effort: if
   * clipboard.writeText rejects (insecure context, denied permission), we
   * still update the hash so the URL bar reflects the new anchor.
   */
  const copyHeadingLink = async (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch { /* permission denied — fall through */ }
    history.replaceState(null, "", `#${id}`);
    setAnchorCopied(id);
    setTimeout(() => setAnchorCopied(prev => prev === id ? null : prev), 1600);
  };

  // Share helpers — open the relevant network's compose URL in a new tab.
  // We prefer Web Share API on touch devices for the native sheet but fall
  // back to direct URLs on desktop where the sheet usually no-ops.
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareTitle = post?.title || "";
  const tweetHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareTitle)}&url=${encodeURIComponent(shareUrl)}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  const nativeShare = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
          title: shareTitle, url: shareUrl,
        });
        setShareOpen(false);
        return true;
      } catch { /* user dismissed */ }
    }
    return false;
  };

  // Outside-click handler for the share menu.
  useEffect(() => {
    if (!shareOpen) return;
    const handler = (e: MouseEvent) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [shareOpen]);

  // After the article HTML mounts, intercept heading clicks for smooth-scroll
  // and copy-to-clipboard, then decorate every <pre> with a copy button.
  useEffect(() => {
    const proseEl = proseRef.current;
    if (!proseEl) return;

    // (1) Heading click → smooth scroll + copy URL.
    const headingHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      const heading = target.closest("h2[id], h3[id]");
      if (!heading) return;
      const id = heading.getAttribute("id");
      if (!id) return;
      e.preventDefault();
      scrollToHeading(id);
      void copyHeadingLink(id);
    };
    proseEl.addEventListener("click", headingHandler);

    // (2) Decorate every <pre> with a copy button. We append a small button
    // inside each <pre> wrapper; clicking it copies the raw text content of
    // the code block. The button is absolutely positioned in the top-right.
    const decoratePres = () => {
      const pres = Array.from(proseEl.querySelectorAll<HTMLPreElement>("pre"));
      for (const pre of pres) {
        if (pre.dataset.copyDecorated === "1") continue;
        pre.dataset.copyDecorated = "1";
        pre.style.position = "relative";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", "Copy code");
        btn.className =
          "code-copy-btn absolute top-2 right-2 inline-flex items-center gap-1 h-6 px-2 rounded border border-border bg-card/90 backdrop-blur " +
          "font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground hover:text-accent hover:border-accent/45 transition-colors opacity-0";
        btn.textContent = "Copy";

        // Show on hover/focus of the pre.
        const show = () => { btn.style.opacity = "1"; };
        const hide = () => { btn.style.opacity = btn.dataset.sticky === "1" ? "1" : "0"; };
        pre.addEventListener("mouseenter", show);
        pre.addEventListener("mouseleave", hide);
        pre.addEventListener("focusin", show);
        pre.addEventListener("focusout", hide);

        btn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
          try {
            await navigator.clipboard.writeText(code);
            btn.textContent = "Copied";
            btn.dataset.sticky = "1";
            btn.style.opacity = "1";
            setTimeout(() => {
              btn.textContent = "Copy";
              btn.dataset.sticky = "0";
              btn.style.opacity = "0";
            }, 1400);
          } catch { /* ignore */ }
        });

        pre.appendChild(btn);
      }
    };
    decoratePres();

    return () => {
      proseEl.removeEventListener("click", headingHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedHtml]);

  // ── TOC-aware reading time ──────────────────────────────────────────
  // Estimate minutes remaining as `(1 - progress) * totalMinutes` clamped to
  // an int. Cheap proxy that lines up with the "8 min read" label and avoids
  // text re-scanning while the user scrolls.
  const totalMinutes = post ? readTimeMinutes(post.readTime) : 0;
  const minutesLeft = Math.max(0, Math.round(totalMinutes * (1 - progress / 100)));

  // Bad slug → render NotFound. Safe here because every hook above ran first.
  if (!post) return <NotFound />;

  return (
    <div className="relative">

      {/* ── Reading progress bar — sticks to the top of AppShell's workspace.
          Bumped from h-0.5 → h-1 so it's visible without leaning in; glow
          stays subtle so it doesn't fight the body content. ── */}
      <div className="sticky top-0 left-0 right-0 z-30 h-1 bg-transparent print:hidden">
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Article reading progress"
          className="h-full bg-accent transition-[width] duration-150 ease-out shadow-[0_0_12px_hsl(var(--accent)/0.6)]"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* AppShell already exposes `<main id="main-content">` — use <article> here
         to give the post body an explicit landmark for screen readers. */}
      <article className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_220px] gap-12">

          {/* ── Article column ── */}
          <article ref={articleRef} className="min-w-0 animate-fade-up">

            {/* Back link + share row */}
            <nav className="mb-8 flex items-center justify-between flex-wrap gap-3 print:hidden">
              <Link
                to="/blog"
                className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground hover:text-accent transition-colors"
              >
                <ArrowLeft size={12} /> All articles
              </Link>
              <div className="flex items-center gap-2">
                {/* Print — surfaces the existing print stylesheet without burying it in browser chrome. */}
                <button
                  onClick={() => window.print()}
                  aria-label="Print article"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground hover:text-accent hover:border-accent/45 hover:bg-accent/[0.04] transition-colors"
                >
                  <Printer size={11} /> Print
                </button>

                {/* Share — copy + Twitter + LinkedIn. Native share sheet wins on touch. */}
                <div className="relative" ref={shareMenuRef}>
                  <button
                    onClick={async () => {
                      const used = await nativeShare();
                      if (!used) setShareOpen(o => !o);
                    }}
                    aria-haspopup="menu"
                    aria-expanded={shareOpen}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground hover:text-accent hover:border-accent/45 hover:bg-accent/[0.04] transition-colors"
                  >
                    <Share2 size={11} /> Share
                  </button>
                  {shareOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-2 z-30 min-w-[180px] rounded-lg border border-border bg-card shadow-xl overflow-hidden animate-fade-in"
                    >
                      <button
                        role="menuitem"
                        onClick={() => { void copyLink(); setShareOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-foreground hover:bg-secondary/60 transition-colors"
                      >
                        {copied ? <Check size={13} className="text-accent" /> : <Link2 size={13} />}
                        {copied ? "Copied!" : "Copy link"}
                      </button>
                      <a
                        role="menuitem"
                        href={tweetHref}
                        target="_blank" rel="noreferrer noopener"
                        onClick={() => setShareOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-foreground hover:bg-secondary/60 transition-colors"
                      >
                        <Twitter size={13} /> Share on X
                      </a>
                      <a
                        role="menuitem"
                        href={linkedinHref}
                        target="_blank" rel="noreferrer noopener"
                        onClick={() => setShareOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-foreground hover:bg-secondary/60 transition-colors"
                      >
                        <Linkedin size={13} /> Share on LinkedIn
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </nav>

            {/* ── Header ── */}
            <header className="mb-8">
              <div className="flex flex-wrap gap-2 mb-5">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center h-6 px-2 rounded-full border border-accent/30 bg-accent/[0.06] font-mono text-[9.5px] tracking-[0.10em] uppercase text-accent"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <h1 className="font-display font-bold text-foreground tracking-[-0.025em] leading-tight text-3xl sm:text-4xl lg:text-5xl"
                  style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                {post.title}
              </h1>

              <p className="font-display text-[16px] sm:text-[17px] text-muted-foreground mt-5 leading-relaxed">
                {post.description}
              </p>

              {/* Dateline */}
              <div className="mt-7 pb-7 border-b border-border flex items-center flex-wrap gap-x-4 gap-y-2 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                <span className="text-foreground">{post.author || "PrivaTools"}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar size={11} /> <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                </span>
                {post.updatedAt && post.updatedAt !== post.publishedAt && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span>Updated <time dateTime={post.updatedAt} className="text-accent">{formatDate(post.updatedAt)}</time></span>
                  </>
                )}
                <span className="text-muted-foreground/40">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={11} /> {post.readTime}
                </span>
              </div>
            </header>

            {/* ── TL;DR — corner-marked accent panel with expand toggle ── */}
            {post.tldr && (
              <aside className="post-tldr mb-10 relative rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="relative p-5 sm:p-6">
                  <CornerMarks />
                  <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} className="text-accent" />
                      <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent font-semibold">§ TL;DR</span>
                    </div>
                    <button
                      onClick={() => setTldrExpanded(v => !v)}
                      aria-expanded={tldrExpanded}
                      className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground hover:text-accent transition-colors print:hidden"
                    >
                      {tldrExpanded ? "Collapse" : "Read full"}
                      <ChevronDown size={11} className={cn("transition-transform", tldrExpanded && "rotate-180")} />
                    </button>
                  </div>
                  {/* CSS grid trick: the wrapper transitions between
                      grid-template-rows: 0fr → 1fr, which animates the row's
                      auto height without the JS-measure / max-height hack. */}
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
                      tldrExpanded ? "grid-rows-[1fr]" : "grid-rows-[2.95em]"
                    )}
                  >
                    <p className={cn(
                      "font-display text-[15.5px] text-foreground leading-relaxed overflow-hidden min-h-0",
                      !tldrExpanded && "line-clamp-2"
                    )}>
                      {post.tldr}
                    </p>
                  </div>
                </div>
              </aside>
            )}

            {/* Mobile TOC — appears above article body on narrow viewports */}
            {tocItems.length > 0 && (
              <details className="lg:hidden mb-8 rounded-xl border border-border bg-card overflow-hidden group print:hidden">
                <summary className="px-4 py-3 list-none cursor-pointer flex items-center gap-2 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground hover:bg-secondary/40 transition-colors">
                  <List size={12} className="text-accent" />
                  <span><span className="text-accent">§</span> Table of contents</span>
                  <span className="ml-auto font-mono text-[10px] tracking-wider text-accent">{tocItems.length}</span>
                </summary>
                <ul className="px-4 pb-3 space-y-1.5">
                  {tocItems.map(t => (
                    <li key={t.id}>
                      <button
                        onClick={() => scrollToHeading(t.id)}
                        className={cn(
                          "block w-full text-left text-[12.5px] py-1 hover:text-accent transition-colors",
                          t.level === 3 && "pl-3 text-muted-foreground border-l border-border/60",
                          activeId === t.id && "text-accent font-medium"
                        )}
                      >
                        {t.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* ── Article body ── */}
            <div
              ref={proseRef}
              className="blog-prose prose prose-sm sm:prose-base dark:prose-invert max-w-none
                prose-headings:font-display prose-headings:tracking-[-0.02em] prose-headings:font-bold prose-headings:scroll-mt-20 prose-headings:cursor-pointer
                prose-p:text-foreground/90 prose-p:leading-relaxed
                prose-a:text-accent prose-a:no-underline hover:prose-a:underline
                prose-code:bg-paper-2 prose-code:text-foreground prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.9em] prose-code:font-mono prose-code:before:content-[''] prose-code:after:content-['']
                prose-strong:text-foreground
                prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:bg-accent/[0.04] prose-blockquote:py-1
                prose-li:marker:text-accent"
              dangerouslySetInnerHTML={{ __html: processedHtml }}
            />

            {/* Per-heading copy feedback toast — anchored bottom-right, briefly
                visible after a heading is clicked. */}
            {anchorCopied && (
              <div
                role="status"
                aria-live="polite"
                className="fixed bottom-24 right-6 z-40 inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-accent/45 bg-card font-mono text-[11px] tracking-[0.06em] uppercase text-accent shadow-lg animate-fade-in print:hidden"
              >
                <Check size={11} /> Heading link copied
              </div>
            )}

            {/* ── Related tools ── */}
            {post.relatedTools && post.relatedTools.length > 0 && (
              <aside className="mt-12 pt-8 border-t border-border">
                <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <Wrench size={13} className="text-accent" />
                    <h2 className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent font-semibold">§ Tools mentioned</h2>
                  </div>
                  <Link
                    to="/"
                    className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground hover:text-accent inline-flex items-center gap-1.5 transition-colors print:hidden"
                  >
                    Browse all tools <ArrowRight size={11} />
                  </Link>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {post.relatedTools.map((s, i) => {
                    const t = toolFor(s);
                    if (!t) return null;
                    return (
                      <Link
                        key={s}
                        to={t.href}
                        className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-accent/45 hover:bg-accent/[0.04] hover:-translate-y-0.5 transition-all"
                      >
                        <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 shrink-0 mt-0.5">§{String(i + 1).padStart(2, "0")}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-display text-[14.5px] font-semibold text-foreground tracking-[-0.015em] group-hover:text-accent transition-colors">{t.name}</p>
                          <p className="text-[12.5px] text-muted-foreground mt-1 line-clamp-2 leading-snug">{t.description}</p>
                        </div>
                        <ArrowRight size={13} className="text-muted-foreground shrink-0 mt-1 group-hover:translate-x-0.5 group-hover:text-accent transition-all" />
                      </Link>
                    );
                  })}
                </div>
              </aside>
            )}

            {/* ── More articles — most relevant by tag overlap, recency tie-break ── */}
            {others.length > 0 && (
              <aside className="mt-16 pt-8 border-t border-border">
                <p className="section-mark mb-5">§ More like this</p>
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="divide-y divide-border">
                    {others.map((p, i) => (
                      <Link
                        key={p.slug}
                        to={`/blog/${p.slug}`}
                        className="flex items-start gap-3 px-5 py-4 hover:bg-accent/[0.04] transition-colors group"
                      >
                        <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent/70 shrink-0 mt-1">§{String(i + 1).padStart(2, "0")}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-display text-[15px] font-semibold text-foreground tracking-[-0.015em] group-hover:text-accent transition-colors leading-snug">
                            {p.title}
                          </p>
                          <p className="mt-1 font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground inline-flex items-center gap-1.5 flex-wrap">
                            <Clock size={10} /> {p.readTime}
                            {/* Surface up to 2 shared tags so the relevance signal is visible. */}
                            {p.tags.filter(t => post.tags.includes(t)).slice(0, 2).map(t => (
                              <span key={t} className="text-accent/80">· {t}</span>
                            ))}
                          </p>
                        </div>
                        <ArrowRight size={13} className="text-muted-foreground shrink-0 mt-1.5 group-hover:translate-x-0.5 group-hover:text-accent transition-all" />
                      </Link>
                    ))}
                  </div>
                </div>
              </aside>
            )}
          </article>

          {/* ── Sticky TOC sidebar (desktop only) ── */}
          {tocItems.length > 0 && (
            <aside className="hidden lg:block print:hidden">
              <div className="sticky top-8">
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span className="flex items-center gap-1.5"><List size={10} className="text-accent" /> Contents</span>
                    <span className="text-accent tabular-nums">{Math.round(progress)}%</span>
                  </div>
                  <nav className="p-3 max-h-[60vh] overflow-y-auto relative" aria-label="Table of contents">
                    {/* Single sliding accent rail — translates vertically to
                        the active item's center via inline transform.
                        Avoids the flicker of a per-item conditional span and
                        gives the active marker a confident vertical glide. */}
                    <TocRail tocItems={tocItems} activeId={activeId} />
                    <ul className="space-y-0.5">
                      {tocItems.map(t => {
                        const isActive = activeId === t.id;
                        return (
                          <li key={t.id}>
                            <button
                              data-toc-id={t.id}
                              onClick={() => scrollToHeading(t.id)}
                              className={cn(
                                "relative block w-full text-left text-[12px] leading-snug py-1.5 rounded transition-colors",
                                // Stronger left-indent + tint for h3 so subsection nesting reads cleanly.
                                t.level === 2 ? "pl-3" : "pl-5 border-l border-border/40 ml-2",
                                isActive
                                  ? "text-accent font-medium bg-accent/[0.06]"
                                  : t.level === 3
                                    ? "text-muted-foreground/85 hover:text-foreground hover:bg-secondary/40"
                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                              )}
                            >
                              {t.text}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </nav>
                  {/* Footer — minutes-remaining estimate. Tiny touch that
                      tells the reader how much runway is left. */}
                  <div className="px-4 py-2 border-t border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><Clock size={10} className="text-accent/70" /> {minutesLeft} min left</span>
                    <button
                      onClick={scrollToTop}
                      className="text-muted-foreground hover:text-accent transition-colors"
                    >
                      Top
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>
      </article>

      {/* ── Scroll-to-top button — only visible past 800px scroll ── */}
      <button
        onClick={scrollToTop}
        aria-label="Scroll to top"
        className={cn(
          "fixed bottom-8 right-6 z-40 h-10 w-10 rounded-full border border-accent/35 bg-card text-accent shadow-lg backdrop-blur transition-all hover:bg-accent/[0.08] hover:scale-105 print:hidden",
          showTop ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-2 pointer-events-none"
        )}
      >
        <ArrowUp size={15} className="mx-auto" />
      </button>
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

/**
 * Sticky-TOC active-item rail. A single accent bar that translates
 * vertically to the active item's center on scroll, rather than
 * disappearing + reappearing across N <li>s. The actual movement is a
 * `transform: translateY(Npx)` so the GPU handles it; the CSS class adds
 * the easing + duration (see `.toc-rail-marker` in index.css).
 */
function TocRail({ tocItems, activeId }: { tocItems: { id: string; level: number }[]; activeId: string | null }) {
  const [rect, setRect] = useState<{ y: number; visible: boolean }>({ y: 0, visible: false });

  useLayoutEffect(() => {
    if (!activeId) {
      setRect(r => ({ ...r, visible: false }));
      return;
    }
    // Locate the active TOC button by data attribute and measure its
    // vertical center relative to the nav container.
    const btn = document.querySelector<HTMLButtonElement>(`[data-toc-id="${CSS.escape(activeId)}"]`);
    if (!btn) {
      setRect(r => ({ ...r, visible: false }));
      return;
    }
    const nav = btn.closest("nav");
    if (!nav) return;
    const navRect = nav.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    // Center the 16px rail on the button's vertical midpoint, accounting
    // for the nav's own scroll offset.
    const y = btnRect.top - navRect.top + nav.scrollTop + btnRect.height / 2 - 8;
    setRect({ y, visible: true });
  }, [activeId, tocItems]);

  return (
    <span
      aria-hidden="true"
      className="toc-rail-marker"
      style={{
        transform: `translateY(${rect.y}px)`,
        opacity: rect.visible ? 1 : 0,
      }}
    />
  );
}
