/**
 * Dashboard — the home workspace.
 *
 * Workshop-style landing: greeting + ⌘K, pinned tools, recently used,
 * suggested workflows, featured tool of the day, privacy receipts.
 *
 * No marketing hero — that energy lives in the brand voice throughout.
 * This page assumes the user has already arrived and wants to *work*.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    Search, X, ArrowRight, Upload, Command, GitBranch,
    Sparkles, FileText, Image as ImageIcon, Video, Code as CodeIcon,
    Archive as ArchiveIcon, FileBox, Cpu,
    Pin, Clock, ShieldCheck, Newspaper,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { blogPosts } from "@/data/blog";
import { useHistory } from "@/hooks/useHistory";
import { useFavorites } from "@/hooks/useFavorites";
import { useFirstRun } from "@/hooks/useFirstRun";
import { FirstRunWelcome } from "@/components/FirstRunWelcome";
import { EmptyState } from "@/components/EmptyState";
import { storeFileHandoff } from "@/lib/file-handoff";

const TOOL_TOTAL = tools.length + nonPdfTools.length;

const PDF_COUNT  = tools.length;
const IMG_COUNT  = nonPdfTools.filter(t => t.category === "image").length;
const VID_COUNT  = nonPdfTools.filter(t => t.category === "video-audio").length;
const DEV_COUNT  = nonPdfTools.filter(t => t.category === "developer").length;
const ARC_COUNT  = nonPdfTools.filter(t => t.category === "archive").length;
const DOC_COUNT  = nonPdfTools.filter(t => t.category === "document-office").length;

// 8 default "starters" for users with no favorites yet
const STARTER_SLUGS = [
    "merge-pdf", "compress-pdf", "edit-pdf", "image-to-pdf",
    "ocr-pdf", "summarize-pdf", "smart-redact", "remove-background",
];

const STARTER_TAGLINES: Record<string, string> = {
    "merge-pdf":         "Combine multiple PDFs into one",
    "compress-pdf":      "Shrink files by up to 90%",
    "edit-pdf":          "Edit text, images, and shapes",
    "image-to-pdf":      "JPG, PNG, HEIC into PDF",
    "ocr-pdf":           "Extract text from scans, 17 langs",
    "summarize-pdf":     "Local AI summary — never uploads",
    "smart-redact":      "Auto-detect PII with local NER",
    "remove-background": "Remove image bg with local AI",
    "highlight-pdf":     "Highlight every match of a phrase",
};

const SUITE_TILES = [
    { id: "pdf",             label: "PDF",       icon: FileText,     count: PDF_COUNT, catClass: "cat-optimize",         href: "/?tab=pdf",             example: "Merge · Compress · OCR · Redact",       blurb: "Edit, optimize, secure" },
    { id: "image",           label: "Image",     icon: ImageIcon,    count: IMG_COUNT, catClass: "cat-image",            href: "/?tab=image",           example: "Compress · Convert · Bg remove",        blurb: "Convert, resize, retouch" },
    { id: "video-audio",     label: "Video",     icon: Video,        count: VID_COUNT, catClass: "cat-video-audio",      href: "/?tab=video-audio",     example: "Convert · Trim · Extract audio",        blurb: "Convert, trim, transcode" },
    { id: "developer",       label: "Developer", icon: CodeIcon,     count: DEV_COUNT, catClass: "cat-developer",        href: "/?tab=developer",       example: "JSON · Base64 · Regex · JWT",           blurb: "Encode, format, inspect" },
    { id: "archive",         label: "Archive",   icon: ArchiveIcon,  count: ARC_COUNT, catClass: "cat-archive",          href: "/?tab=archive",         example: "Extract · Create ZIP",                  blurb: "Zip, unzip, bundle" },
    { id: "document-office", label: "Docs",      icon: FileBox,      count: DOC_COUNT, catClass: "cat-document-office",  href: "/?tab=document-office", example: "Word · Excel · PPT to PDF",             blurb: "Office to PDF, and back" },
];

// Latest blog post — computed once at module load, used in the "What's new" strip.
const LATEST_POST = [...blogPosts].sort(
    (a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt),
)[0];

// Pre-baked pipelines (matches what /pipeline can chain)
const SUGGESTED_PIPELINES = [
    {
        title: "Clean & share a scanned PDF",
        steps: ["OCR", "Deskew", "Compress", "Sanitize"],
        description: "Make a scan searchable, shrink it, strip metadata",
    },
    {
        title: "Prepare a contract for e-sign",
        steps: ["Merge", "Compress", "Watermark", "Sign"],
        description: "Combine, optimize, mark, and sign in one pass",
    },
    {
        title: "Anonymise a report",
        steps: ["Smart Redact", "Strip Metadata", "Compress"],
        description: "Local NER finds PII, then strip everything else",
    },
];

// Drop-file flow
function getToolsForExtension(ext: string) {
    const e = ext.toLowerCase().replace(/^\./, "");
    const matchingPdf = tools.filter(t =>
        t.accepts.split(",").some(a => a.trim().replace(/^\./, "") === e)
    );
    const matchingNonPdf = nonPdfTools.filter(t =>
        t.accepts === "*" ? false : t.accepts.split(",").some(a => a.trim().replace(/^\./, "") === e)
    );
    return {
        pdf:    matchingPdf.map(t =>    ({ ...t, href: `/tool/${t.slug}`, catClass: `cat-${t.category}` })),
        nonPdf: matchingNonPdf.map(t => ({ ...t, href: `/tools/${t.slug}`, catClass: `cat-${t.category}` })),
    };
}

export default function Index() {
    const navigate = useNavigate();
    const { history } = useHistory();
    const { favorites } = useFavorites();
    const { isFirstRun, markCompleted } = useFirstRun();

    const greeting = useMemo(() => {
        const h = new Date().getHours();
        if (h < 5)  return "Late night";
        if (h < 12) return "Good morning";
        if (h < 18) return "Good afternoon";
        return "Good evening";
    }, []);

    // Pinned tools — favorites first, fall back to starters
    const pinnedSlugs = favorites.length > 0 ? favorites.slice(0, 8) : STARTER_SLUGS;
    const pinned = useMemo(() =>
        pinnedSlugs.map(slug => {
            const pdf = tools.find(t => t.slug === slug);
            const nonPdf = nonPdfTools.find(t => t.slug === slug);
            if (pdf) return { slug: pdf.slug, name: pdf.name, icon: pdf.icon, description: STARTER_TAGLINES[pdf.slug] || pdf.description, href: `/tool/${pdf.slug}`, catClass: `cat-${pdf.category}` };
            if (nonPdf) return { slug: nonPdf.slug, name: nonPdf.name, icon: nonPdf.icon, description: STARTER_TAGLINES[nonPdf.slug] || nonPdf.description, href: `/tools/${nonPdf.slug}`, catClass: `cat-${nonPdf.category}` };
            return null;
        }).filter(Boolean) as {
            slug: string; name: string; icon: typeof FileText; description: string; href: string; catClass: string;
        }[]
    , [pinnedSlugs]);

    const recent = useMemo(() =>
        history.slice(0, 5).map(h => {
            const pdf = tools.find(t => t.slug === h.slug);
            const nonPdf = nonPdfTools.find(t => t.slug === h.slug);
            if (pdf) return { slug: pdf.slug, name: pdf.name, icon: pdf.icon, href: `/tool/${pdf.slug}`, catClass: `cat-${pdf.category}`, when: h.timestamp };
            if (nonPdf) return { slug: nonPdf.slug, name: nonPdf.name, icon: nonPdf.icon, href: `/tools/${nonPdf.slug}`, catClass: `cat-${nonPdf.category}`, when: h.timestamp };
            return null;
        }).filter(Boolean)
    , [history]);

    // Drop-anywhere
    const [dragging, setDragging] = useState(false);
    const [dragDepth, setDragDepth] = useState(0);
    const [droppedFile, setDroppedFile] = useState<File | null>(null);
    const [matchedTools, setMatchedTools] = useState<{ pdf: ReturnType<typeof getToolsForExtension>["pdf"]; nonPdf: ReturnType<typeof getToolsForExtension>["nonPdf"] } | null>(null);

    const openToolWithFile = useCallback((file: File, tool: { slug: string; href: string }) => {
        void storeFileHandoff(file, tool.slug).finally(() => navigate(tool.href));
    }, [navigate]);

    const onDragEnter = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragDepth(d => d + 1);
        if (e.dataTransfer?.types.includes("Files")) setDragging(true);
    }, []);
    const onDragLeave = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragDepth(d => {
            if (d - 1 <= 0) { setDragging(false); return 0; }
            return d - 1;
        });
    }, []);
    const onDragOver = useCallback((e: DragEvent) => { e.preventDefault(); }, []);
    const onDrop = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragging(false); setDragDepth(0);
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        const ext = file.name.split(".").pop() || "";
        const matched = getToolsForExtension(ext);
        const all = [...matched.pdf, ...matched.nonPdf];
        if (all.length === 1) {
            openToolWithFile(file, all[0]);
        } else if (all.length > 0) {
            setDroppedFile(file);
            setMatchedTools(matched);
        }
    }, [openToolWithFile]);

    useEffect(() => {
        document.addEventListener("dragenter", onDragEnter);
        document.addEventListener("dragleave", onDragLeave);
        document.addEventListener("dragover", onDragOver);
        document.addEventListener("drop", onDrop);
        return () => {
            document.removeEventListener("dragenter", onDragEnter);
            document.removeEventListener("dragleave", onDragLeave);
            document.removeEventListener("dragover", onDragOver);
            document.removeEventListener("drop", onDrop);
        };
    }, [onDragEnter, onDragLeave, onDragOver, onDrop]);

    const openCmdK = () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    };

    const allMatched = matchedTools ? [...matchedTools.pdf, ...matchedTools.nonPdf] : [];

    return (
        <>
            {/* Drag overlay */}
            {dragging && (
                <div className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-md flex items-center justify-center animate-fade-in">
                    <div className="relative animate-success-pop">
                        <div className="relative text-center px-20 py-14 max-w-md rounded-2xl border-2 border-dashed border-accent bg-paper shadow-[0_30px_60px_-20px_hsl(var(--accent)/0.4)]">
                            {/* Corner registration marks */}
                            <span className="absolute -top-1 -left-1 h-3 w-3">
                                <span className="absolute top-0 left-0 h-px w-3 bg-accent" />
                                <span className="absolute top-0 left-0 w-px h-3 bg-accent" />
                            </span>
                            <span className="absolute -top-1 -right-1 h-3 w-3">
                                <span className="absolute top-0 right-0 h-px w-3 bg-accent" />
                                <span className="absolute top-0 right-0 w-px h-3 bg-accent" />
                            </span>
                            <span className="absolute -bottom-1 -left-1 h-3 w-3">
                                <span className="absolute bottom-0 left-0 h-px w-3 bg-accent" />
                                <span className="absolute bottom-0 left-0 w-px h-3 bg-accent" />
                            </span>
                            <span className="absolute -bottom-1 -right-1 h-3 w-3">
                                <span className="absolute bottom-0 right-0 h-px w-3 bg-accent" />
                                <span className="absolute bottom-0 right-0 w-px h-3 bg-accent" />
                            </span>

                            <div className="h-16 w-16 mx-auto rounded-2xl bg-accent/15 border border-accent/40 flex items-center justify-center mb-4">
                                <Upload size={28} className="text-accent" strokeWidth={1.75} />
                            </div>
                            <p className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-accent mb-2">§ Drop anywhere</p>
                            <p className="font-display text-[28px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                Release to <span className="italic text-accent">match tools</span>
                            </p>
                            <p className="mt-2 text-[13px] text-muted-foreground">We'll show you every tool that handles this file type</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Matched tools view (after drop) */}
            {droppedFile && matchedTools && allMatched.length > 0 ? (
                <div className="mx-auto max-w-6xl px-4 sm:px-8 py-10">
                    <div className="flex items-start justify-between gap-3 mb-7">
                        <div className="min-w-0 flex-1">
                            <p className="section-mark mb-2">Matched tools</p>
                            <p className="font-display text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
                                {droppedFile.name}
                            </p>
                            <p className="font-mono text-[11px] tracking-[0.06em] uppercase text-muted-foreground mt-1">
                                {allMatched.length} matching tool{allMatched.length !== 1 ? "s" : ""}
                            </p>
                        </div>
                        <button
                            onClick={() => { setDroppedFile(null); setMatchedTools(null); }}
                            className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                        >
                            <X size={13} /> <span className="hidden sm:inline">Back to dashboard</span><span className="sm:hidden">Back</span>
                        </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {allMatched.map(t => {
                            const Icon = t.icon;
                            return (
                                <Link
                                    key={t.slug}
                                    to={t.href}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        openToolWithFile(droppedFile, t);
                                    }}
                                    className={cn("tool-card group flex items-start gap-3 p-4", t.catClass)}
                                >
                                    <span className="icon-tile icon-tile-sm shrink-0">
                                        <Icon size={15} strokeWidth={1.75} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[14px] font-semibold text-foreground tracking-[-0.01em] leading-tight">{t.name}</p>
                                        <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div className="mx-auto max-w-6xl px-4 sm:px-8 py-8 sm:py-10">

                    {/* First-run welcome card — replaces the greeting for brand-new visitors.
                        Any CTA (or a 5-minute idle timer) calls markCompleted() and the
                        card never shows again. See `useFirstRun` + `FirstRunWelcome`. */}
                    {isFirstRun && <FirstRunWelcome onComplete={markCompleted} />}

                    {/* ─── Greeting + Dropzone hero ─────────────────────── */}
                    {/* Hidden during first run — the welcome card above carries the
                        primary intent ("pick a tool / try sample / take tour"). */}
                    {!isFirstRun && (
                    <section className="mb-10 animate-fade-up stagger-1">
                        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                            <span className="section-mark reveal-underline">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
                            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground/85">
                                <ShieldCheck size={11} className="text-accent" />
                                Private by default
                            </span>
                        </div>
                        <h1 className="font-display font-bold text-foreground text-[40px] sm:text-[52px] tracking-[-0.035em] leading-[1.05]" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            {greeting}.<br />
                            <span className="text-muted-foreground italic font-medium">What are we doing today?</span>
                        </h1>
                        <p className="mt-4 max-w-[58ch] text-[14.5px] sm:text-[15px] text-muted-foreground leading-relaxed">
                            <span className="text-foreground font-medium">{TOOL_TOTAL} tools</span> for PDFs, images, video, code and archives — browser-only where possible, self-hosted when processing needs a server. No accounts, no watermarks.
                        </p>

                        {/* Big workshop CTA — primary action on the dashboard */}
                        <div className="mt-7">
                            <button
                                type="button"
                                onClick={openCmdK}
                                aria-label={`Open command palette to search ${TOOL_TOTAL} tools`}
                                className="btn-accent w-full sm:w-auto h-14 px-7 text-[15px] sm:text-[16px] gap-3 shine-sweep group"
                            >
                                <Search size={17} strokeWidth={1.9} className="shrink-0" />
                                <span className="font-semibold tracking-[-0.01em]">
                                    Press <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-current/40 bg-foreground/10 font-mono text-[11px] align-middle"><Command size={10} />K</kbd> to search {TOOL_TOTAL} tools
                                </span>
                                <ArrowRight size={15} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
                            </button>
                        </div>

                        {/* Dropzone-style ⌘K */}
                        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3">
                            <button
                                onClick={openCmdK}
                                className="group relative flex items-center gap-3 h-14 px-4 pr-2 rounded-xl border border-border bg-card hover:bg-card hover:border-border-strong transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:border-accent/60"
                                aria-label="Open command palette to search all tools"
                            >
                                <Search size={17} className="text-muted-foreground shrink-0 group-hover:text-accent transition-colors" />
                                <span className="flex-1 text-[14px] sm:text-[15px] text-muted-foreground truncate">
                                    Search {TOOL_TOTAL} tools <span className="hidden sm:inline text-muted-foreground/70">— try "compress", "redact", "JWT"…</span>
                                </span>
                                <kbd className="inline-flex items-center gap-0.5 px-2 py-1 rounded-md border border-border bg-secondary/60 font-mono text-[11px] text-muted-foreground shrink-0">
                                    <Command size={11} />K
                                </kbd>
                            </button>
                            <label className="group cursor-pointer flex items-center gap-3 h-14 px-4 rounded-xl border-2 border-dashed border-border-strong bg-paper-2/40 hover:border-accent/60 hover:bg-accent/[0.04] transition-all">
                                <Upload size={17} className="text-accent shrink-0" />
                                <span className="flex-1 text-[13.5px] sm:text-[14px] text-muted-foreground">
                                    or drop any file <span className="hidden sm:inline opacity-70">anywhere on this page</span>
                                </span>
                                <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground/85">↓</span>
                                <input
                                    type="file"
                                    className="sr-only"
                                    aria-label="Upload a file to match against tools"
                                    onChange={e => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const ext = file.name.split(".").pop() || "";
                                        const matched = getToolsForExtension(ext);
                                        const all = [...matched.pdf, ...matched.nonPdf];
                                        if (all.length === 1) {
                                            openToolWithFile(file, all[0]);
                                        } else if (all.length > 0) {
                                            setDroppedFile(file);
                                            setMatchedTools(matched);
                                        }
                                    }}
                                />
                            </label>
                        </div>

                        {/* What's new — links the latest article so the homepage shows recency */}
                        {LATEST_POST && (
                            <Link
                                to={`/blog/${LATEST_POST.slug}`}
                                className="group mt-4 inline-flex items-center gap-2 max-w-full text-left rounded-lg border border-border/70 bg-paper-2/30 hover:bg-accent/[0.05] hover:border-accent/40 px-3 py-2 transition-colors"
                            >
                                <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.10em] uppercase text-accent shrink-0">
                                    <Newspaper size={11} /> New
                                </span>
                                <span className="text-[12.5px] text-muted-foreground truncate group-hover:text-foreground transition-colors">
                                    {LATEST_POST.title}
                                </span>
                                <ArrowRight size={11} className="text-muted-foreground/60 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
                            </Link>
                        )}
                    </section>
                    )}

                    {/* ─── Pinned / Starter tools ──────────────────────── */}
                    <section className="mb-12 animate-fade-up stagger-2">
                        <div className="mb-4">
                            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                <div className="flex items-baseline gap-2.5">
                                    <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-accent">§</span>
                                    <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground whitespace-nowrap">
                                        {favorites.length > 0 ? (<><Pin size={13} className="inline -mt-1 text-accent" /> Pinned</>) : "Start here"}
                                    </h2>
                                </div>
                                <Link to="/?tab=pdf" className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
                                    Browse all {TOOL_TOTAL} <ArrowRight size={11} />
                                </Link>
                            </div>
                            <p className="font-mono text-[10.5px] text-muted-foreground/80 mt-1 ml-[18px]">
                                {favorites.length > 0 ? "Your favorite tools, one click away" : "The eight tools people open most"}
                            </p>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 animate-grid-enter">
                            {pinned.map(tool => {
                                const Icon = tool.icon;
                                return (
                                    <Link
                                        key={tool.slug}
                                        to={tool.href}
                                        title={`${tool.name} — ${tool.description}`}
                                        className={cn("hero-tile shine-sweep group flex flex-col items-start gap-3 p-4 min-h-[124px]", tool.catClass)}
                                    >
                                        <span className="icon-tile icon-tile-sm">
                                            <Icon size={15} strokeWidth={1.75} />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[14px] font-semibold text-foreground tracking-tight leading-tight">{tool.name}</p>
                                            <p className="text-[11.5px] text-muted-foreground mt-1 leading-snug line-clamp-2">{tool.description}</p>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    </section>

                    {/* ─── Recent activity ─────────────────────────────── */}
                    <section className="mb-12 animate-fade-up stagger-3">
                        <div className="flex items-baseline gap-3 mb-4">
                            <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-accent">§</span>
                            <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">
                                <Clock size={14} className="inline -mt-1 text-muted-foreground" /> Recent
                            </h2>
                            <span className="font-mono text-[10.5px] text-muted-foreground/80">{recent.length > 0 ? "last session" : "nothing yet"}</span>
                        </div>
                        {recent.length > 0 ? (
                            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                                {recent.map(r => {
                                    if (!r) return null;
                                    const Icon = r.icon;
                                    const elapsed = relativeTime(r.when);
                                    return (
                                        <Link
                                            key={r.slug + r.when}
                                            to={r.href}
                                            className={cn("group flex items-center gap-3 px-4 py-3 min-h-[48px] hover:bg-secondary/40 transition-colors", r.catClass)}
                                        >
                                            <span className="icon-tile icon-tile-sm shrink-0">
                                                <Icon size={13} strokeWidth={1.75} />
                                            </span>
                                            <span className="flex-1 text-[13.5px] font-medium text-foreground truncate">{r.name}</span>
                                            <span className="font-mono text-[10.5px] text-muted-foreground tracking-wide shrink-0">{elapsed}</span>
                                            <ArrowRight size={12} className="text-muted-foreground/60 group-hover:text-foreground group-hover:translate-x-0.5 transition-all shrink-0" />
                                        </Link>
                                    );
                                })}
                            </div>
                        ) : (
                            <EmptyState
                                icon={Clock}
                                title="Nothing here yet"
                                description="Tools you open will show up here. Nothing is tracked off-device — this list lives in your browser's local storage."
                                ctas={[
                                    { label: "Compress PDF",  href: "/tool/compress-pdf"  },
                                    { label: "Summarize PDF", href: "/tool/summarize-pdf" },
                                    { label: "Smart Redact",  href: "/tool/smart-redact"  },
                                    { label: "Merge PDF",     href: "/tool/merge-pdf"     },
                                    { label: "JPG → PDF",     href: "/tool/image-to-pdf"  },
                                    { label: "Remove BG",     href: "/tools/remove-background" },
                                ]}
                            />
                        )}
                    </section>

                    {/* ─── Suite tiles ─────────────────────────────────── */}
                    <section className="mb-12 animate-fade-up stagger-4">
                        <div className="flex items-baseline gap-3 mb-4">
                            <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-accent">§</span>
                            <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">Suites</h2>
                            <span className="font-mono text-[10.5px] text-muted-foreground/80">browse by file type</span>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 animate-grid-enter">
                            {SUITE_TILES.map(s => {
                                const Icon = s.icon;
                                return (
                                    <Link
                                        key={s.id}
                                        to={s.href}
                                        title={`${s.label} suite — ${s.count} tools: ${s.example}`}
                                        className={cn("hero-tile shine-sweep group p-4 sm:p-5 min-h-[140px]", s.catClass)}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <span className="icon-tile">
                                                <Icon size={18} strokeWidth={1.75} />
                                            </span>
                                            <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground/85">
                                                {String(s.count).padStart(2, "0")} tools
                                            </span>
                                        </div>
                                        <p className="font-display text-[19px] sm:text-[20px] font-bold text-foreground tracking-[-0.02em] leading-tight">{s.label}</p>
                                        <p className="mt-0.5 text-[11.5px] sm:text-[12px] text-muted-foreground/85 leading-snug italic">{s.blurb}</p>
                                        <p className="mt-2 text-[12px] sm:text-[12.5px] text-muted-foreground leading-snug line-clamp-1">{s.example}</p>
                                        <p className="mt-3 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground/85 inline-flex items-center gap-1 group-hover:text-accent transition-colors">
                                            Open suite <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
                                        </p>
                                    </Link>
                                );
                            })}
                        </div>
                    </section>

                    {/* ─── Suggested workflows + featured ───────────────── */}
                    <section className="mb-12 grid lg:grid-cols-[1.4fr_1fr] gap-5 animate-fade-up stagger-5">
                        {/* Workflows */}
                        <div>
                            <div className="flex items-baseline gap-3 mb-4">
                                <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-accent">§</span>
                                <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">
                                    <GitBranch size={14} className="inline -mt-1 text-accent" /> Workflows
                                </h2>
                                <span className="font-mono text-[10.5px] text-muted-foreground/80">pre-baked Pipelines</span>
                            </div>
                            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                                {SUGGESTED_PIPELINES.map((p, i) => (
                                    <Link
                                        key={p.title}
                                        to="/pipeline"
                                        title={`Open pipeline builder — ${p.description}`}
                                        className="group block px-4 py-4 hover:bg-secondary/40 transition-colors"
                                    >
                                        <div className="flex items-start justify-between gap-4 mb-2">
                                            <p className="font-display text-[15px] font-semibold text-foreground tracking-[-0.015em] leading-tight">{p.title}</p>
                                            <span className="font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground/85 shrink-0">§{String(i + 1).padStart(2, "0")}</span>
                                        </div>
                                        <p className="text-[12.5px] text-muted-foreground leading-snug mb-2.5">{p.description}</p>
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                {p.steps.map((step, j) => (
                                                    <span key={step} className="inline-flex items-center">
                                                        <span className="px-2 py-0.5 rounded-md border border-border bg-paper-2 font-mono text-[10.5px] tracking-wide text-foreground/85">
                                                            {step}
                                                        </span>
                                                        {j < p.steps.length - 1 && <ArrowRight size={10} className="text-muted-foreground/60 mx-1" />}
                                                    </span>
                                                ))}
                                            </div>
                                            <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground/0 group-hover:text-accent transition-colors inline-flex items-center gap-1 shrink-0">
                                                Build <ArrowRight size={10} />
                                            </span>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </div>

                        {/* Featured */}
                        <div>
                            <div className="flex items-baseline gap-3 mb-4">
                                <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-accent">§</span>
                                <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">
                                    <Sparkles size={14} className="inline -mt-1 text-accent" /> Featured today
                                </h2>
                            </div>
                            <Link to="/tool/summarize-pdf" className="shine-sweep block relative overflow-hidden rounded-xl border border-border bg-card hover:border-accent/40 p-5 transition-colors cat-optimize group">
                                <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
                                <div className="absolute -top-16 -right-16 h-40 w-40 rounded-full bg-accent/15 blur-3xl pointer-events-none" />
                                <div className="relative">
                                    <div className="flex items-center gap-2 mb-3 font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent">
                                        <Cpu size={11} /> Browser AI
                                    </div>
                                    <p className="font-display text-[24px] font-bold text-foreground tracking-[-0.025em] leading-tight">
                                        Summarize PDF
                                    </p>
                                    <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
                                        Runs <span className="italic font-display">distilbart-cnn-12-6</span> entirely
                                        in your browser via WebAssembly. ~250 MB model
                                        downloads once and stays cached. The PDF never leaves your machine.
                                    </p>
                                    <p className="mt-4 font-mono text-[10.5px] tracking-[0.06em] uppercase text-accent inline-flex items-center gap-1 group-hover:gap-1.5 transition-all">
                                        Open tool <ArrowRight size={11} />
                                    </p>
                                </div>
                            </Link>
                        </div>
                    </section>

                    {/* ─── Privacy receipts — comparison strip ──────────── */}
                    <section className="mb-12 animate-fade-up stagger-6">
                        <div className="flex items-baseline gap-3 mb-4">
                            <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-accent">§</span>
                            <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">Receipts</h2>
                            <span className="font-mono text-[10.5px] text-muted-foreground/80">verifiable, no marketing</span>
                        </div>

                        {/* Mobile: stacked feature rows. Desktop: 3-col grid. */}
                        <div className="rounded-xl border border-border-strong bg-card overflow-hidden">
                            {/* Desktop / tablet — 3-column table */}
                            <div className="hidden sm:grid grid-cols-[1.1fr_1fr_1fr] text-[13px]">
                                <div className="p-5 border-r border-border">
                                    <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground/85 font-medium mb-4">Feature</p>
                                    <ul className="space-y-3 text-foreground/90">
                                        <li>Files uploaded to a 3rd party</li>
                                        <li>Account / sign-up</li>
                                        <li>Open source</li>
                                        <li>Self-hostable</li>
                                        <li>Local AI</li>
                                        <li>Pipeline / chaining</li>
                                    </ul>
                                </div>
                                <div className="p-5 border-r border-border bg-paper-2/50">
                                    <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground/85 font-medium mb-4">iLovePDF / Smallpdf</p>
                                    <ul className="space-y-3 text-muted-foreground">
                                        <li className="line-through decoration-muted-foreground/60">Their server</li>
                                        <li className="line-through decoration-muted-foreground/60">After free quota</li>
                                        <li className="line-through decoration-muted-foreground/60">Closed source</li>
                                        <li className="line-through decoration-muted-foreground/60">Not possible</li>
                                        <li className="line-through decoration-muted-foreground/60">Cloud-only</li>
                                        <li className="line-through decoration-muted-foreground/60">Not offered</li>
                                    </ul>
                                </div>
                                <div className="p-5 bg-accent/[0.06]">
                                    <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-accent font-medium mb-4">Privatools</p>
                                    <ul className="space-y-3 text-foreground">
                                        <li className="font-medium">Your own infra</li>
                                        <li className="font-medium">Never</li>
                                        <li className="font-medium">MIT licensed</li>
                                        <li className="font-medium">One Docker command</li>
                                        <li className="font-medium">In-browser WASM</li>
                                        <li className="font-medium">Industry first</li>
                                    </ul>
                                </div>
                            </div>

                            {/* Mobile — row-per-feature so each comparison stays readable at 375px */}
                            <div className="sm:hidden divide-y divide-border text-[13px]">
                                {[
                                    { feature: "Files uploaded to a 3rd party", them: "Their server",     us: "Your own infra" },
                                    { feature: "Account / sign-up",             them: "After free quota", us: "Never" },
                                    { feature: "Open source",                   them: "Closed source",    us: "MIT licensed" },
                                    { feature: "Self-hostable",                 them: "Not possible",     us: "One Docker command" },
                                    { feature: "Local AI",                      them: "Cloud-only",       us: "In-browser WASM" },
                                    { feature: "Pipeline / chaining",           them: "Not offered",      us: "Industry first" },
                                ].map(row => (
                                    <div key={row.feature} className="px-4 py-3">
                                        <p className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground/85 mb-1.5">{row.feature}</p>
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-muted-foreground line-through decoration-muted-foreground/60 text-[12.5px]">{row.them}</span>
                                            <span className="text-foreground font-medium text-[12.5px] text-right">{row.us}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                </div>
            )}
        </>
    );
}

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}
