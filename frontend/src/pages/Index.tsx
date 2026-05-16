import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
    Search, X, ArrowRight, Shield, GitBranch, Star, Upload, Lock, Github, Sparkles,
    Command,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tools, categoryMeta, Category } from "@/data/tools";
import { nonPdfTools, nonPdfCategoryMeta, NonPdfCategory } from "@/data/non-pdf-tools";
import { useHistory } from "@/hooks/useHistory";
import { useFavorites } from "@/hooks/useFavorites";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";
import { HeroArtwork } from "@/components/HeroArtwork";

type Suite = "pdf" | "image" | "video-audio" | "developer" | "archive" | "document-office";
const SUITE_IDS: Suite[] = ["pdf", "image", "video-audio", "developer", "archive", "document-office"];

const TOTAL_TOOL_COUNT = tools.length + nonPdfTools.length;
const PDF_TOOL_COUNT = tools.length;

const FEATURED_SLUGS = [
    "merge-pdf", "compress-pdf", "edit-pdf", "image-to-pdf",
    "ocr-pdf", "summarize-pdf", "smart-redact", "highlight-pdf",
];
const FEATURED_TAGLINES: Record<string, string> = {
    "merge-pdf":      "Combine multiple PDFs into one",
    "compress-pdf":   "Shrink files by up to 90%",
    "edit-pdf":       "Edit text, images, and shapes",
    "image-to-pdf":   "JPG, PNG, HEIC into PDF",
    "ocr-pdf":        "Extract text from scans, 17 languages",
    "summarize-pdf":  "Local AI summary — never uploaded",
    "smart-redact":   "Auto-detect PII with local NER",
    "highlight-pdf":  "Highlight every match of a phrase",
};
const featuredTools = FEATURED_SLUGS
    .map(s => tools.find(t => t.slug === s) || nonPdfTools.find(t => t.slug === s))
    .filter(Boolean) as (typeof tools[number])[];

const suites: { id: Suite; label: string; count: () => number }[] = [
    { id: "pdf",             label: "PDF",       count: () => PDF_TOOL_COUNT },
    { id: "image",           label: "Image",     count: () => nonPdfTools.filter(t => t.category === "image").length },
    { id: "video-audio",     label: "Video",     count: () => nonPdfTools.filter(t => t.category === "video-audio").length },
    { id: "developer",       label: "Developer", count: () => nonPdfTools.filter(t => t.category === "developer").length },
    { id: "archive",         label: "Archive",   count: () => nonPdfTools.filter(t => t.category === "archive").length },
    { id: "document-office", label: "Docs",      count: () => nonPdfTools.filter(t => t.category === "document-office").length },
];

const pdfCategories: { id: Category; title: string }[] = [
    { id: "organize", title: "Organize" },
    { id: "edit",     title: "Edit" },
    { id: "optimize", title: "Optimize" },
    { id: "security", title: "Security" },
    { id: "to-pdf",   title: "Convert to PDF" },
    { id: "from-pdf", title: "Convert from PDF" },
    { id: "advanced", title: "Advanced" },
];

const nonPdfSuiteCategories: Partial<Record<Suite, NonPdfCategory>> = {
    image: "image", "video-audio": "video-audio",
    developer: "developer", archive: "archive", "document-office": "document-office",
};

// ── Tool card (single anchor, colored category tile, tighter density) ─
function ToolCard({ name, description, icon: Icon, href, slug, catClass, isFav, onToggleFav }: {
    name: string; description: string; icon: React.ElementType;
    href: string; slug?: string; catClass: string;
    isFav?: boolean; onToggleFav?: (slug: string) => void;
}) {
    return (
        <Link
            to={href}
            className={cn("tool-card group relative flex items-start gap-3 p-3.5 sm:p-4 transition-all", catClass)}
            aria-label={`${name} — ${description}`}
        >
            <span className="icon-tile icon-tile-sm shrink-0">
                <Icon size={15} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-foreground tracking-tight leading-tight">
                    {name}
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
                    {description}
                </p>
            </div>
            {slug && onToggleFav && (
                <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFav(slug); }}
                    className="p-1 rounded text-muted-foreground/80 hover:text-foreground hover:bg-secondary transition-all opacity-0 group-hover:opacity-100 shrink-0"
                    title={isFav ? "Remove from favorites" : "Add to favorites"}
                    aria-label={isFav ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
                    aria-pressed={isFav}
                >
                    <Star size={12} className={cn(isFav && "text-accent fill-current opacity-100")} />
                </button>
            )}
        </Link>
    );
}

const catClass = (cat: string) => `cat-${cat}`;

/** Match a file extension to relevant tools. */
function getToolsForExtension(ext: string) {
    const e = ext.toLowerCase().replace(/^\./, "");
    const matchingPdf = tools.filter(t =>
        t.accepts.split(",").some(a => a.trim().replace(/^\./, "") === e)
    );
    const matchingNonPdf = nonPdfTools.filter(t =>
        t.accepts === "*" ? false : t.accepts.split(",").some(a => a.trim().replace(/^\./, "") === e)
    );
    return {
        pdf:    matchingPdf.map(t =>    ({ ...t, href: `/tool/${t.slug}`, catClass: catClass(t.category) })),
        nonPdf: matchingNonPdf.map(t => ({ ...t, href: `/tools/${t.slug}`, catClass: catClass(t.category) })),
    };
}

export default function Index() {
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get("tab") as Suite | null;
    const initialTab: Suite = tabParam && SUITE_IDS.includes(tabParam) ? tabParam : "pdf";
    const [activeTab, setActiveTabState] = useState<Suite>(initialTab);
    const setActiveTab = (id: Suite) => {
        setActiveTabState(id);
        const next = new URLSearchParams(searchParams);
        if (id === "pdf") next.delete("tab"); else next.set("tab", id);
        setSearchParams(next, { replace: true });
    };
    const [query, setQuery] = useState("");
    const { history } = useHistory();
    const { favorites, toggle: toggleFav, isFavorite } = useFavorites();
    const navigate = useNavigate();

    useEffect(() => {
        const t = searchParams.get("tab") as Suite | null;
        if (t && SUITE_IDS.includes(t) && t !== activeTab) setActiveTabState(t);
        if (!t && activeTab !== "pdf") setActiveTabState("pdf");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // Drag-and-drop overlay state
    const [dragging, setDragging] = useState(false);
    const [droppedFile, setDroppedFile] = useState<File | null>(null);
    const [matchedTools, setMatchedTools] = useState<{ pdf: ReturnType<typeof getToolsForExtension>["pdf"]; nonPdf: ReturnType<typeof getToolsForExtension>["nonPdf"] } | null>(null);
    const [dragDepth, setDragDepth] = useState(0);

    const handleDragEnter = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragDepth(d => d + 1);
        if (e.dataTransfer?.types.includes("Files")) setDragging(true);
    }, []);
    const handleDragLeave = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragDepth(d => {
            if (d - 1 <= 0) { setDragging(false); return 0; }
            return d - 1;
        });
    }, []);
    const handleDragOver = useCallback((e: DragEvent) => { e.preventDefault(); }, []);
    const handleDrop = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragging(false); setDragDepth(0);
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        const ext = file.name.split(".").pop() || "";
        const matched = getToolsForExtension(ext);
        const all = [...matched.pdf, ...matched.nonPdf];
        if (all.length === 1) {
            const reader = new FileReader();
            reader.onload = () => {
                sessionStorage.setItem("privatools_dropped_file", JSON.stringify({ name: file.name, type: file.type, data: reader.result }));
                navigate(all[0].href);
            };
            reader.readAsDataURL(file);
        } else if (all.length > 0) {
            setDroppedFile(file);
            setMatchedTools(matched);
        }
    }, [navigate]);

    useEffect(() => {
        document.addEventListener("dragenter", handleDragEnter);
        document.addEventListener("dragleave", handleDragLeave);
        document.addEventListener("dragover", handleDragOver);
        document.addEventListener("drop", handleDrop);
        return () => {
            document.removeEventListener("dragenter", handleDragEnter);
            document.removeEventListener("dragleave", handleDragLeave);
            document.removeEventListener("dragover", handleDragOver);
            document.removeEventListener("drop", handleDrop);
        };
    }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

    // Search across all tools
    const allSearchable = [
        ...tools.map(t => ({ slug: t.slug, name: t.name, description: t.description, icon: t.icon, href: `/tool/${t.slug}`, catClass: catClass(t.category) })),
        ...nonPdfTools.map(t => ({ slug: t.slug, name: t.name, description: t.description, icon: t.icon, href: `/tools/${t.slug}`, catClass: catClass(t.category) })),
    ];
    const filtered = query.trim()
        ? allSearchable.filter(t => t.name.toLowerCase().includes(query.toLowerCase()) || t.description.toLowerCase().includes(query.toLowerCase()))
        : null;

    const activeNonPdfCat = nonPdfSuiteCategories[activeTab];
    const allMatched = matchedTools ? [...matchedTools.pdf, ...matchedTools.nonPdf] : [];

    return (
        <div className="min-h-screen bg-background">
            <EditorialMasthead />

            {/* Drag overlay */}
            {dragging && (
                <div className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-sm flex items-center justify-center animate-fade-in">
                    <div className="text-center space-y-4 animate-pulse-border border-2 border-dashed border-primary/40 rounded-2xl px-16 py-12 max-w-md">
                        <Upload size={36} className="text-primary mx-auto" />
                        <p className="text-lg font-semibold text-foreground">Drop your file</p>
                        <p className="text-sm text-muted-foreground">We'll show you the right tools</p>
                    </div>
                </div>
            )}

            {/* Matched tools view (after drop) */}
            {droppedFile && matchedTools && allMatched.length > 0 && (
                <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <p className="text-[11px] uppercase tracking-widest text-muted-foreground/85 mb-1.5">
                                Tools for your file
                            </p>
                            <p className="text-lg font-semibold text-foreground">
                                {droppedFile.name}
                                <span className="text-xs font-normal text-muted-foreground ml-2">
                                    {allMatched.length} matching tool{allMatched.length !== 1 ? "s" : ""}
                                </span>
                            </p>
                        </div>
                        <button
                            onClick={() => { setDroppedFile(null); setMatchedTools(null); }}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                        >
                            <X size={13} /> Back to all tools
                        </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                        {allMatched.map(t => (
                            <ToolCard key={t.slug} name={t.name} description={t.description} icon={t.icon}
                                href={t.href} slug={t.slug} catClass={t.catClass} isFav={isFavorite(t.slug)} onToggleFav={toggleFav} />
                        ))}
                    </div>
                </div>
            )}

            {!droppedFile && <>
                <main id="main-content">
                {/* ─── HERO — asymmetric: text left, animated art right ──── */}
                <section aria-label="Hero" className="relative overflow-hidden border-b border-border">
                    <div className="hero-backdrop" aria-hidden="true" />
                    <span className="hero-orb hero-orb-1" aria-hidden="true" />
                    <span className="hero-orb hero-orb-2" aria-hidden="true" />
                    <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pt-20 pb-16 sm:pt-24 sm:pb-20 lg:pt-28 lg:pb-28">
                        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-12 items-center">
                        <div className="text-center lg:text-left max-w-2xl mx-auto lg:mx-0">
                            {/* Trust pill */}
                            <a
                                href="https://github.com/taiyeba-dg/privatools"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-3 h-7 rounded-full border border-border bg-card/60 backdrop-blur text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors mb-8"
                            >
                                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                                {TOTAL_TOOL_COUNT} tools — open source on GitHub
                                <ArrowRight size={11} className="opacity-60" />
                            </a>

                            <h1 className="font-bold text-foreground tracking-[-0.045em] leading-[1.02] text-[56px] sm:text-[72px] lg:text-[88px]">
                                Every file task,
                                <br />
                                <span className="relative inline-block">
                                    done <span className="relative">
                                        <span className="relative z-10">privately</span>
                                        <span className="absolute inset-x-0 bottom-1 sm:bottom-2 h-3 sm:h-4 bg-accent/25 -z-0 -skew-y-1" aria-hidden="true" />
                                    </span>.
                                </span>
                            </h1>

                            <p className="mt-7 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
                                {TOTAL_TOOL_COUNT} free tools for PDFs, images, video, and developer work.
                                Self-hostable, MIT licensed — your files stay on your own infrastructure.
                            </p>

                            <div className="mt-9 flex flex-col items-center lg:items-start gap-3">
                                {/* Search-shaped CTA — clicking opens the global ⌘K command palette */}
                                <button
                                    onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
                                    className="group w-full max-w-md inline-flex items-center gap-3 h-12 px-4 rounded-full border border-border bg-card hover:border-foreground/30 hover:bg-card-tint transition-colors text-left"
                                >
                                    <Search size={16} className="text-muted-foreground" />
                                    <span className="flex-1 text-[14px] text-muted-foreground">
                                        Search {TOTAL_TOOL_COUNT} tools or paste a file…
                                    </span>
                                    <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-1 rounded-md border border-border bg-secondary/60 font-mono text-[10px] text-muted-foreground">
                                        <Command size={10} />K
                                    </kbd>
                                </button>
                                <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
                                    <a href="#all-tools" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                                        Browse all {TOTAL_TOOL_COUNT} <ArrowRight size={11} />
                                    </a>
                                    <span className="text-muted-foreground/85">·</span>
                                    <span>or drop any file anywhere</span>
                                </div>
                            </div>

                        </div>

                        {/* Right column: animated hero artwork (desktop only) */}
                        <div className="hidden lg:flex justify-center items-center">
                            <HeroArtwork />
                        </div>
                        </div>
                    </div>
                </section>

                <section aria-label="Tools and content" className="mx-auto max-w-7xl px-4 sm:px-6 pb-20">

                    {/* ─── FEATURED TOOLS (Smallpdf curated + per-cat color) ─ */}
                    <section className="mt-12 sm:mt-16">
                        <div className="flex items-baseline justify-between mb-5">
                            <h2 className="text-xl font-bold tracking-tight text-foreground">Most popular</h2>
                            <a href="#all-tools" className="text-sm font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors">
                                See all {TOTAL_TOOL_COUNT}
                                <ArrowRight size={12} />
                            </a>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 sm:gap-3">
                            {featuredTools.map((tool) => {
                                const Icon = tool.icon;
                                const slug = tool.slug;
                                const isNonPdf = !!nonPdfTools.find(t => t.slug === slug);
                                const href = isNonPdf ? `/tools/${slug}` : `/tool/${slug}`;
                                return (
                                    <Link
                                        key={slug}
                                        to={href}
                                        className={cn("hero-tile group flex flex-col items-center text-center gap-3 px-3 py-6 sm:py-7", catClass(tool.category))}
                                    >
                                        <span className="icon-tile icon-tile-lg">
                                            <Icon size={22} strokeWidth={1.75} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[13px] sm:text-[14px] font-semibold text-foreground leading-tight">
                                                {tool.name}
                                            </p>
                                            <p className="text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-2 hidden sm:block">
                                                {FEATURED_TAGLINES[slug] || tool.description}
                                            </p>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    </section>

                    {/* ─── PIPELINE PROMO STRIP — bigger, more confident ─ */}
                    <section className="mt-12">
                        <Link
                            to="/pipeline"
                            className="group relative overflow-hidden flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-7 rounded-2xl border border-border bg-gradient-to-br from-card via-card to-secondary/30 p-6 sm:p-8 hover:border-accent/40 transition-all"
                        >
                            <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-accent/15 blur-3xl pointer-events-none" />
                            <div className="absolute -bottom-12 -left-12 h-32 w-32 rounded-full bg-blue-500/5 blur-3xl pointer-events-none" />

                            <div className="relative h-14 w-14 sm:h-16 sm:w-16 rounded-2xl bg-accent/12 border border-accent/25 flex items-center justify-center shrink-0">
                                <GitBranch size={26} className="text-accent" />
                            </div>

                            <div className="relative flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                    <span className="px-1.5 py-0.5 text-[9px] font-bold tracking-wider bg-accent text-accent-foreground rounded leading-none">NEW</span>
                                    <span className="text-[11px] uppercase tracking-widest text-accent font-semibold">Industry first</span>
                                </div>
                                <p className="text-lg sm:text-xl font-bold text-foreground tracking-tight leading-tight">
                                    Chain tools together with Pipeline
                                </p>
                                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                                    Merge → Compress → Watermark — in one click. No other tool in the market offers this.
                                </p>
                            </div>

                            <span className="relative inline-flex items-center gap-2 text-sm font-semibold text-background whitespace-nowrap shrink-0 px-4 h-10 rounded-full bg-foreground group-hover:bg-foreground/90 transition-colors">
                                Try Pipeline <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                            </span>
                        </Link>
                    </section>

                    {/* ─── ALL TOOLS — search + tabs + grid ──────────────── */}
                    <section id="all-tools" className="mt-20 scroll-mt-20">
                        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-5">
                            <div>
                                <h2 className="text-2xl font-bold tracking-tight text-foreground">All tools</h2>
                                <p className="text-sm text-muted-foreground mt-1">{TOTAL_TOOL_COUNT} tools across {suites.length} suites</p>
                            </div>
                            <div className="relative w-full sm:max-w-md">
                                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    className="w-full h-11 pl-10 pr-10 rounded-full border border-border bg-card text-[14px] text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
                                    placeholder={`Search ${TOTAL_TOOL_COUNT} tools…`}
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    aria-label="Search tools"
                                />
                                {query && (
                                    <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Search results take over the grid when there's a query */}
                        {filtered ? (
                            filtered.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                                    {filtered.map(t => (
                                        <ToolCard key={t.slug} name={t.name} description={t.description} icon={t.icon}
                                            href={t.href} slug={t.slug} catClass={t.catClass} isFav={isFavorite(t.slug)} onToggleFav={toggleFav} />
                                    ))}
                                </div>
                            ) : (
                                <div className="py-20 text-center border border-dashed border-border rounded-xl">
                                    <p className="text-base font-semibold text-foreground mb-1">No tools found</p>
                                    <p className="text-sm text-muted-foreground">Try a different keyword</p>
                                </div>
                            )
                        ) : (
                            <>
                                {/* Suite tabs — pill style, consistent with rest of the UI */}
                                <div role="tablist" aria-label="Tool suites" className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mb-6">
                                    {suites.map(s => {
                                        const active = activeTab === s.id;
                                        return (
                                            <button
                                                key={s.id}
                                                role="tab"
                                                aria-selected={active}
                                                onClick={() => setActiveTab(s.id)}
                                                className={cn(
                                                    "inline-flex items-center gap-1.5 h-8 px-3.5 text-[13px] font-medium whitespace-nowrap rounded-full border transition-colors",
                                                    active
                                                        ? "bg-foreground text-background border-foreground"
                                                        : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                                                )}
                                            >
                                                {s.label}
                                                <span className={cn(
                                                    "text-[11px] font-mono px-1.5 py-0.5 rounded",
                                                    active ? "bg-background/15 text-background" : "text-muted-foreground/80 bg-secondary/60"
                                                )}>
                                                    {s.count()}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Favorites rail */}
                                {favorites.length > 0 && (() => {
                                    const favItems = favorites.slice(0, 6).map(slug => {
                                        const pdfTool = tools.find(t => t.slug === slug);
                                        const nonPdfTool = nonPdfTools.find(t => t.slug === slug);
                                        if (pdfTool) return { slug: pdfTool.slug, name: pdfTool.name, description: pdfTool.description, icon: pdfTool.icon, href: `/tool/${pdfTool.slug}`, catClass: catClass(pdfTool.category) };
                                        if (nonPdfTool) return { slug: nonPdfTool.slug, name: nonPdfTool.name, description: nonPdfTool.description, icon: nonPdfTool.icon, href: `/tools/${nonPdfTool.slug}`, catClass: catClass(nonPdfTool.category) };
                                        return null;
                                    }).filter(Boolean) as { slug: string; name: string; description: string; icon: React.ElementType; href: string; catClass: string }[];
                                    if (!favItems.length) return null;
                                    return (
                                        <div className="mb-10">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Star size={12} className="text-accent fill-current" />
                                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Favorites</p>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                                                {favItems.map(t => (
                                                    <ToolCard key={t.slug} {...t} isFav={true} onToggleFav={toggleFav} />
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Recently used rail */}
                                {history.length > 0 && (() => {
                                    const recentItems = history.slice(0, 4).map(h => {
                                        const pdfTool = tools.find(t => t.slug === h.slug);
                                        const nonPdfTool = nonPdfTools.find(t => t.slug === h.slug);
                                        if (pdfTool) return { slug: pdfTool.slug, name: pdfTool.name, description: pdfTool.description, icon: pdfTool.icon, href: `/tool/${pdfTool.slug}`, catClass: catClass(pdfTool.category) };
                                        if (nonPdfTool) return { slug: nonPdfTool.slug, name: nonPdfTool.name, description: nonPdfTool.description, icon: nonPdfTool.icon, href: `/tools/${nonPdfTool.slug}`, catClass: catClass(nonPdfTool.category) };
                                        return null;
                                    }).filter(Boolean) as { slug: string; name: string; description: string; icon: React.ElementType; href: string; catClass: string }[];
                                    if (!recentItems.length) return null;
                                    return (
                                        <div className="mb-10">
                                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Recently used</p>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                                                {recentItems.map(t => (
                                                    <ToolCard key={t.slug} {...t} isFav={isFavorite(t.slug)} onToggleFav={toggleFav} />
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* PDF — sectioned grid by category */}
                                {activeTab === "pdf" && (
                                    <div className="space-y-10">
                                        {pdfCategories.map(cat => {
                                            const catTools = tools.filter(t => t.category === cat.id);
                                            return (
                                                <section key={cat.id}>
                                                    <div className="flex items-baseline gap-3 mb-4">
                                                        <h3 className="text-base font-semibold text-foreground tracking-tight">{cat.title}</h3>
                                                        <span className="text-[11px] font-mono text-muted-foreground/80">{catTools.length} tools</span>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                                                        {catTools.map(t => (
                                                            <ToolCard key={t.slug} name={t.name} description={t.description} icon={t.icon}
                                                                href={`/tool/${t.slug}`} slug={t.slug} catClass={catClass(t.category)}
                                                                isFav={isFavorite(t.slug)} onToggleFav={toggleFav} />
                                                        ))}
                                                    </div>
                                                </section>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Non-PDF suites */}
                                {activeTab !== "pdf" && activeNonPdfCat && (() => {
                                    const catTools = nonPdfTools.filter(t => t.category === activeNonPdfCat);
                                    const activeSuite = suites.find(s => s.id === activeTab)!;
                                    return (
                                        <section>
                                            <div className="flex items-baseline gap-3 mb-4">
                                                <h3 className="text-base font-semibold text-foreground tracking-tight">{activeSuite.label} tools</h3>
                                                <span className="text-[11px] font-mono text-muted-foreground/80">{catTools.length} tools</span>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                                                {catTools.map(t => (
                                                    <ToolCard key={t.slug} name={t.name} description={t.description} icon={t.icon}
                                                        href={`/tools/${t.slug}`} slug={t.slug} catClass={catClass(t.category)}
                                                        isFav={isFavorite(t.slug)} onToggleFav={toggleFav} />
                                                ))}
                                            </div>
                                        </section>
                                    );
                                })()}
                            </>
                        )}
                    </section>

                    {/* ─── WHY PRIVATE — feature section ─────────────────── */}
                    <section className="mt-24 sm:mt-32">
                        <div className="text-center max-w-2xl mx-auto mb-10">
                            <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest text-accent font-semibold mb-3">
                                <span className="h-px w-6 bg-accent/40" />
                                The privacy difference
                                <span className="h-px w-6 bg-accent/40" />
                            </p>
                            <h2 className="text-[28px] sm:text-[36px] font-bold tracking-[-0.03em] text-foreground leading-[1.1]">
                                Built different — by design.
                            </h2>
                            <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
                                Every other PDF tool uploads your file to their servers. PrivaTools doesn't.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                            {[
                                { icon: Lock,      title: "Self-hosted by default",  body: "Run the entire stack with one Docker command. Files stay on hardware you control — never on our servers, never on a third-party cloud." },
                                { icon: Sparkles,  title: "Local AI tools",          body: "Summarize PDFs and detect PII without sending anything to OpenAI or Anthropic. The model runs in your browser via WebAssembly." },
                                { icon: Github,    title: "Open source you can audit", body: "MIT licensed, every line public. The privacy claim is verifiable — fork it, deploy it, change it. No proprietary black boxes." },
                                { icon: GitBranch, title: "Pipeline — industry first", body: "Chain merge → compress → watermark in one click. No competitor offers this." },
                                { icon: Search,    title: "Cmd-K everywhere",         body: `Linear-style command palette finds any of the ${tools.length + nonPdfTools.length} tools in two keystrokes. Built for keyboard-first power users.` },
                                { icon: Shield,    title: "Zero accounts forever",    body: "No sign-up, no email, no behavioural tracking. Anonymous pageview counts only — disable with any tracking blocker. Open the page, do the thing, close the tab." },
                            ].map(f => {
                                const FIcon = f.icon;
                                return (
                                    <div key={f.title} className="rounded-xl border border-border bg-card p-5 hover:border-accent/40 transition-colors">
                                        <div className="h-10 w-10 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center mb-3">
                                            <FIcon size={18} className="text-accent" strokeWidth={1.75} />
                                        </div>
                                        <p className="text-[15px] font-semibold text-foreground tracking-tight">{f.title}</p>
                                        <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">{f.body}</p>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Comparison strip */}
                        <div className="mt-10 rounded-xl border border-border bg-card overflow-hidden">
                            <div className="grid grid-cols-3 text-[13px]">
                                <div className="p-4 sm:p-5 border-r border-border">
                                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground/85 font-semibold mb-2">Feature</p>
                                    <ul className="space-y-2.5">
                                        <li className="font-medium text-foreground">Files uploaded to a server</li>
                                        <li className="font-medium text-foreground">Account / sign-up required</li>
                                        <li className="font-medium text-foreground">Open source code</li>
                                        <li className="font-medium text-foreground">Self-hostable</li>
                                        <li className="font-medium text-foreground">Local AI</li>
                                        <li className="font-medium text-foreground">Pipeline / chaining</li>
                                    </ul>
                                </div>
                                <div className="p-4 sm:p-5 border-r border-border bg-card-tint">
                                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground/85 font-semibold mb-2">iLovePDF / Smallpdf</p>
                                    <ul className="space-y-2.5 text-muted-foreground">
                                        <li>Yes (their server)</li>
                                        <li>Yes (after free limit)</li>
                                        <li>No</li>
                                        <li>No</li>
                                        <li>Cloud-only</li>
                                        <li>No</li>
                                    </ul>
                                </div>
                                <div className="p-4 sm:p-5 bg-accent/[0.04]">
                                    <p className="text-[11px] uppercase tracking-wider text-accent font-semibold mb-2">PrivaTools</p>
                                    <ul className="space-y-2.5 text-foreground">
                                        <li className="font-medium">Your own infrastructure</li>
                                        <li className="font-medium">Never</li>
                                        <li className="font-medium">MIT licensed</li>
                                        <li className="font-medium">Yes (Docker, one command)</li>
                                        <li className="font-medium">In-browser, WebAssembly</li>
                                        <li className="font-medium">Yes — industry first</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </section>
                </section>
                </main>
            </>}

            <EditorialFooter />
        </div>
    );
}
