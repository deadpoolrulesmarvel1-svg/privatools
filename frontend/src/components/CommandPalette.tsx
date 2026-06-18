import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowRight, Clock, GitBranch, Layers, BookOpen, Scale, Info, Home, Zap, FileUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { tools, categoryMeta, Category } from "@/data/tools";
import { nonPdfTools, nonPdfCategoryMeta, NonPdfCategory } from "@/data/non-pdf-tools";
import { useHistory } from "@/hooks/useHistory";
import { storeFileHandoff } from "@/lib/file-handoff";

// Per-tool synonyms — invisible search hints so "join pdfs" finds merge-pdf,
// "shrink" finds compress-pdf, etc. Keep concise; add only common phrasings.
//
// New synonyms should be added directly on the tool object's `synonyms`
// field in `src/data/tools.ts` / `src/data/non-pdf-tools.ts`. This map is
// kept as a legacy override — entries here are merged into the inline
// field, so old aliases stay searchable without forcing churn on the
// canonical tool catalog.
const SYNONYMS: Record<string, string> = {
    "merge-pdf":        "join combine concat unite stitch",
    "split-pdf":        "separate divide cut slice break",
    "compress-pdf":     "shrink reduce smaller optimize size",
    "rotate-pdf":       "turn flip orient clockwise counter",
    "ocr-pdf":          "text recognize read scanned searchable",
    "protect-pdf":      "password encrypt secure lock",
    "unlock-pdf":       "decrypt remove password",
    "watermark":        "stamp brand mark logo",
    "pdf-to-word":      "doc docx convert export editable",
    "pdf-to-excel":     "xlsx spreadsheet table",
    "pdf-to-image":     "jpg png screenshot picture",
    "image-to-pdf":     "jpg png photo picture combine",
    "extract-pages":    "pull take grab specific",
    "delete-pages":     "remove drop discard",
    "summarize-pdf":    "ai summary tldr abstract synopsis",
    "smart-redact":     "censor blackout privacy pii hide name email",
    "highlight-pdf":    "mark yellow underline find",
    "redact-pdf":       "blackout hide remove sensitive",
    "fill-form":        "complete sign field acroform",
    "remove-background": "transparent cutout subject extract bg",
    "image-compressor": "shrink optimize jpg png webp size",
    "video-to-gif":     "animate looping share preview",
    "compress-video":   "smaller mp4 webm size",
    "extract-audio":    "rip audio mp3 from video soundtrack",
    "qr-code":          "qrcode link generate scan",
    "qr-reader":        "decode scan camera",
    "hash-generator":   "md5 sha checksum digest fingerprint",
    "json-xml-formatter": "pretty print beautify lint validate",
    "base64":           "encode decode binary text",
    "url-encoder":      "percent escape decode jwt",
    "color-converter":  "hex rgb hsl picker palette",
    "pdf-page-counter": "count pages quantity number",
    "audio-converter":  "convert format mp3 wav ogg flac aac transcode",
    "image-upscaler":   "enhance enlarge bigger 2x 4x lanczos",
    "audio-merge":      "join combine concat audio tracks",
    "video-merge":      "join combine concat videos",
    "batch-compress-pdf": "bulk multiple zip many",
    // New synonyms — better coverage for common phrasings + competitor naming
    "edit-pdf":         "modify change update annotate text",
    "sign-pdf":         "signature handwritten signature sign electronic",
    "esign-pdf":        "electronic signature docusign hellosign",
    "annotate-pdf":     "notes comment markup pen",
    "stamp-pdf":        "draft confidential approved rubber stamp",
    "whiteout-pdf":     "erase delete redact white cover",
    "auto-crop":        "trim margins white space cropper bounding box",
    "deskew-pdf":       "straighten skew tilt rotate angle scan",
    "repair-pdf":       "fix damaged corrupted broken recover",
    "flatten-pdf":      "merge layers freeze annotations content",
    "remove-blank-pages":"empty white delete clean",
    "reverse-pdf":      "order backwards last first invert",
    "booklet-pdf":      "imposition saddle stitch print layout",
    "grayscale-pdf":    "black white bw monochrome desaturate",
    "invert-colors":    "negative dark mode reverse colors",
    "nup":              "n-up multi-page sheet print layout 2up 4up",
    "split-in-half":    "two columns down middle horizontal vertical",
    "split-by-bookmarks":"chapters sections by toc",
    "split-by-size":    "by mb max kilobytes file size limit",
    "split-by-text":    "by phrase by string search divider",
    "set-permissions":  "owner password disable copy print",
    "strip-metadata":   "remove metadata clean privacy gps exif",
    "sanitize-pdf":     "remove javascript scripts malware safe",
    "pdfa-validator":   "pdfa archival iso validation check",
    "verify-signature": "digital signature check verify authentic",
    "metadata":         "title author keywords properties subject",
    "delete-annotations":"remove comments notes clean",
    "add-attachment":   "embed file attach inside pdf",
    "add-hyperlinks":   "links clickable url anchor reference",
    "add-shapes":       "rectangle circle ellipse line polygon",
    "page-numbers":     "numbering pagination print order",
    "header-footer":    "running headers running footers top bottom text",
    "bates-numbering":  "legal discovery prefix sequence litigation",
    "bookmarks":        "outline toc table of contents index",
    "transparent-background":"alpha clear see through transparency",
    "web-optimize-pdf": "linearize fast web view streaming",
    "form-creator":     "fillable form fields acroform text checkbox",
    "compare-pdf":      "diff difference compare versions changes",
    "alternate-mix":    "interleave shuffle mix front back",
    "overlay":          "overlay stamp watermark superimpose layer",
    "pdf-to-jpg":       "convert jpg jpeg image picture",
    "pdf-to-png":       "convert png transparent picture",
    "pdf-to-pptx":      "powerpoint slides presentation",
    "pdf-to-text":      "txt plain extract content",
    "pdf-to-html":      "web html web export",
    "pdf-to-rtf":       "rich text format word legacy",
    "pdf-to-markdown":  "md markdown github readme docs",
    "pdf-to-epub":      "ebook kindle reader book",
    "pdf-to-svg":       "vector scalable graphics",
    "pdf-to-pdfa":      "archival iso archive long term",
    "extract-tables":   "table csv rows columns data scrape",
    "extract-images":   "embedded photos pictures scrape get",
    "word-to-pdf":      "docx ms word convert export",
    "excel-to-pdf":     "xlsx ms excel spreadsheet convert",
    "pptx-to-pdf-convert":"powerpoint slides deck convert",
    "txt-to-pdf":       "text plain convert",
    "markdown-to-pdf":  "md markdown convert pdf",
    "csv-to-pdf":       "csv table data convert",
    "json-to-pdf":      "json convert document",
    "xml-to-pdf":       "xml convert document",
    "epub-to-pdf":      "ebook kindle to pdf",
    "rtf-to-pdf":       "rich text convert",
    "odt-to-pdf":       "openoffice libreoffice convert",
    "html-to-pdf":      "webpage url to pdf print page",
    "office-to-pdf":    "doc docx xls xlsx ppt pptx convert",
    "jpg-to-pdf":       "image photo picture to pdf",
    "png-to-pdf":       "image graphic transparent to pdf",
    "heic-to-pdf":      "iphone apple photo to pdf",
    "webp-to-pdf":      "google webp to pdf",
    "tiff-to-pdf":      "scan tiff to pdf",
    "bmp-to-pdf":       "bitmap windows to pdf",
    "gif-to-pdf":       "gif image to pdf",
    "svg-to-pdf":       "vector svg to pdf",
    // Non-PDF
    "image-converter":  "format convert jpg png webp avif tiff bmp gif",
    "resize-crop-image":"resize scale crop dimensions size",
    "image-watermark":  "watermark stamp brand image logo",
    "remove-exif":      "exif metadata gps strip clean privacy",
    "view-exif":        "metadata gps camera info",
    "generate-favicon": "favicon icon ico website",
    "make-collage":     "collage grid mosaic photo album",
    "merge-images":     "join combine concat horizontal vertical",
    "image-ocr":        "text extract from picture recognize",
    "video-converter":  "convert format mp4 mov webm avi mkv",
    "video-resizer":    "resize scale dimensions width height",
    "video-thumbnail":  "preview screenshot still image cover",
    "video-to-pdf":     "frames pages slideshow",
    "trim-media":       "cut clip slice shorten",
    "gif-to-mp4":       "convert gif to video mp4",
    "add-subtitles":    "subtitle srt caption burn in",
    "subtitle-converter":"srt vtt ass convert subtitles format",
    "extract-archive":  "unzip extract zip tar gz files",
    "create-zip":       "zip archive compress files into one",
    "url-to-pdf":       "save webpage to pdf url print",
    // Phase 7 new tools
    "mute-video":       "remove audio silent strip soundtrack",
    "reverse-video":    "backwards play in reverse rewind",
    "video-speed":      "speed up slow down fast forward 2x slow motion",
    "audio-trim":       "cut clip slice shorten audio",
    "image-palette":    "color palette dominant colors extract designer",
    "pixelate-image":   "censor blur mosaic obscure privacy face",
    "rotate-image":     "turn spin angle 90 180 270 sideways tilt upright",
    "flip-image":       "mirror reverse horizontal vertical selfie unmirror reflect",
    // v1.4.0 aliases
    "jpg-to-png":       "convert format lossless transparency",
    "png-to-jpg":       "convert format smaller photo",
    "jpg-to-webp":      "convert smaller google modern format",
    "png-to-webp":      "convert smaller google modern",
    "tiff-to-jpg":      "scan convert smaller",
    "tiff-to-png":      "scan convert lossless",
    "bmp-to-jpg":       "windows bitmap convert smaller",
    "bmp-to-png":       "windows bitmap convert lossless",
    "gif-to-jpg":       "first frame convert image",
    "gif-to-png":       "first frame convert lossless",
    "webp-to-jpg":      "google webp convert universal",
    "webp-to-png":      "google webp convert lossless",
    "heic-to-png":      "iphone apple convert universal",
    "heic-to-jpg":      "iphone apple convert universal",
    "m4a-to-mp3":       "iphone voice memo convert universal",
    "mp4-to-mp3":       "extract audio from video",
    "mov-to-mp4":       "apple quicktime convert universal",
    "avi-to-mp4":       "legacy windows convert modern",
    "webm-to-mp4":      "google convert universal apple compatible",
    "mp4-to-webm":      "convert smaller open web vp9",
    // Browser-only dev tools
    "yaml-to-json":     "kubernetes yaml convert config",
    "json-to-yaml":     "kubernetes config convert",
    "case-converter":   "camelcase snake kebab title upper lower",
    "jwt-decoder":      "json web token decode parse",
    "regex-tester":     "regular expression pattern match test",
    "timestamp-converter":"unix epoch iso 8601 date time",
    "uuid-generator":   "guid v4 v7 random id unique",
    "password-generator":"password random secure strong",
    "lorem-ipsum":      "placeholder dummy text greek latin",
    "word-counter":     "words characters sentences paragraphs",
    "csv-json":         "csv to json convert format",
    "markdown-html":    "md html convert preview rendering",
    "text-diff":        "compare text difference changes",
    "generate-barcode": "barcode ean upc code128 qr",
    // Filling synonym gaps surfaced in the audit pass
    "organize-pages":   "reorder rearrange shuffle drag drop thumbnails sort pages",
    "resize-pdf":       "page size a4 letter legal dimensions scale physical",
    "crop-pdf":         "trim margins box visible area edges cropper",
    "pdf-to-tiff":      "tif scan archival fax multi-page convert",
    "pdf-to-bmp":       "bitmap windows legacy convert",
    "pdf-to-gif":       "convert pages animation gif",
    "svg-to-png":       "vector to raster convert png image",
};

// Short label shown as a chip on the right of each result.
const _CAT_LABEL: Record<string, string> = {
    // PDF
    organize: "PDF", edit: "PDF", optimize: "PDF", security: "PDF",
    "to-pdf": "PDF", "from-pdf": "PDF", advanced: "PDF",
    // Non-PDF
    image: "Image", "video-audio": "Video/Audio",
    developer: "Dev", archive: "Archive", "document-office": "Docs",
};

// Quick actions — non-tool routes searchable from the palette. These
// surface alongside tool results so users can jump to Pipeline / Batch /
// etc. without leaving the keyboard. Marked `isAction: true` so the UI
// can render them differently if needed.
type QuickAction = {
    slug: string;
    name: string;
    description: string;
    icon: typeof Search;
    href: string;
    iconBg: string;
    iconColor: string;
    categoryLabel: string;
    synonyms: string;
    nameLower: string;
    descLower: string;
    synLower: string;
    slugTokens: string[];
    popularity: number;
    accepts?: string;
    isAction: true;
};
const QUICK_ACTIONS: QuickAction[] = [
    { name: "Home",     description: "Browse every tool by suite",                   icon: Home,      href: "/",         slug: "go-home",       synonyms: "index landing main",        categoryLabel: "Go" },
    { name: "Pipeline", description: "Chain tools — convert, optimize, redact",      icon: GitBranch, href: "/pipeline", slug: "go-pipeline",   synonyms: "chain workflow stages flow", categoryLabel: "Go" },
    { name: "Batch",    description: "Apply one tool to many files at once",         icon: Layers,    href: "/batch",    slug: "go-batch",      synonyms: "bulk multiple many",        categoryLabel: "Go" },
    { name: "Compare",  description: "PrivaTools vs. iLovePDF, Smallpdf, Adobe",     icon: Scale,     href: "/compare",  slug: "go-compare",    synonyms: "alternative competitor vs", categoryLabel: "Go" },
    { name: "Blog",     description: "Privacy guides, recipes, release notes",       icon: BookOpen,  href: "/blog",     slug: "go-blog",       synonyms: "articles posts writing",    categoryLabel: "Go" },
    { name: "About",    description: "The story behind PrivaTools",                  icon: Info,      href: "/about",    slug: "go-about",      synonyms: "story mission team",        categoryLabel: "Go" },
].map(a => ({
    ...a,
    iconBg: "bg-accent/10",
    iconColor: "text-accent",
    nameLower: a.name.toLowerCase(),
    descLower: a.description.toLowerCase(),
    synLower: a.synonyms,
    slugTokens: a.slug.split("-"),
    popularity: 0,
    isAction: true as const,
}));

// Build searchable index once. We pre-lowercase everything and bake
// popularity into the tool itself so the scoring loop stays tight.
//
// Synonyms come from the tool's own `synonyms` field (preferred — kept
// next to the tool definition) and fall back to the legacy SYNONYMS map
// above. The two are merged so old palette overrides still work.
function resolveSyn(slug: string, inline?: string): string {
    const merged = [inline, SYNONYMS[slug]].filter(Boolean).join(" ");
    return merged;
}
const allTools = [
    ...tools.map(t => ({
        slug: t.slug, name: t.name, description: t.description, icon: t.icon,
        href: `/tool/${t.slug}`,
        iconBg: categoryMeta[t.category as Category]?.iconBg ?? "bg-blue-500/10",
        iconColor: categoryMeta[t.category as Category]?.iconColor ?? "text-blue-400",
        categoryLabel: _CAT_LABEL[t.category] ?? "PDF",
        synonyms: resolveSyn(t.slug, t.synonyms),
        accepts: t.accepts,
        nameLower: t.name.toLowerCase(),
        descLower: t.description.toLowerCase(),
        synLower: resolveSyn(t.slug, t.synonyms).toLowerCase(),
        slugTokens: t.slug.split("-"),
        popularity: (t as { popularity?: number }).popularity ?? 999,
    })),
    ...nonPdfTools.map(t => ({
        slug: t.slug, name: t.name, description: t.description, icon: t.icon,
        href: `/tools/${t.slug}`,
        iconBg: nonPdfCategoryMeta[t.category as NonPdfCategory]?.iconBg ?? "bg-pink-500/10",
        iconColor: nonPdfCategoryMeta[t.category as NonPdfCategory]?.iconColor ?? "text-pink-400",
        categoryLabel: _CAT_LABEL[t.category] ?? "Tool",
        synonyms: resolveSyn(t.slug, t.synonyms),
        accepts: t.accepts,
        nameLower: t.name.toLowerCase(),
        descLower: t.description.toLowerCase(),
        synLower: resolveSyn(t.slug, t.synonyms).toLowerCase(),
        slugTokens: t.slug.split("-"),
        popularity: (t as { popularity?: number }).popularity ?? 999,
    })),
];

// Type guard for quick actions in render. We can't compare against the
// `isAction` property because spreading typescript intersections drops
// undefined fields — `slug.startsWith("go-")` is the durable signal.
const isQuickAction = (slug: string) => slug.startsWith("go-");

function extensionFromMime(type: string): string {
    const subtype = type.split("/")[1]?.split(";")[0]?.toLowerCase() || "bin";
    if (subtype === "jpeg") return "jpg";
    if (subtype === "svg+xml") return "svg";
    return subtype.replace(/[^a-z0-9]+/g, "") || "bin";
}

function fileExtension(file: File): string {
    const fromName = file.name.split(".").pop()?.toLowerCase();
    if (fromName && fromName !== file.name.toLowerCase()) return fromName;
    return extensionFromMime(file.type);
}

function fileFromClipboard(data: DataTransfer | null): File | null {
    if (!data) return null;
    const direct = Array.from(data.files || [])[0];
    if (direct) return direct;
    const itemFile = Array.from(data.items || [])
        .find(item => item.kind === "file")
        ?.getAsFile();
    if (!itemFile) return null;
    if (itemFile.name) return itemFile;
    return new File([itemFile], `clipboard.${extensionFromMime(itemFile.type)}`, {
        type: itemFile.type,
        lastModified: Date.now(),
    });
}

function acceptsFile(accepts: string | undefined, file: File): boolean {
    if (!accepts || accepts.trim() === "*" || accepts.trim() === "") return false;
    const ext = fileExtension(file);
    const mime = file.type.toLowerCase();
    return accepts.split(",").some(raw => {
        const token = raw.trim().toLowerCase();
        if (!token || token === "*") return false;
        if (token.startsWith(".")) return token.slice(1) === ext;
        if (token.endsWith("/*")) return Boolean(mime) && mime.startsWith(token.slice(0, -1));
        if (token.includes("/")) return Boolean(mime) && mime === token;
        return token.replace(/^\./, "") === ext;
    });
}

type CommandPaletteProps = {
    defaultOpen?: boolean;
};

export default function CommandPalette({ defaultOpen = false }: CommandPaletteProps) {
    const [open, setOpen] = useState(defaultOpen);
    const [query, setQuery] = useState("");
    const [pastedFile, setPastedFile] = useState<File | null>(null);
    const [selected, setSelected] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    // Remember the element that had focus when the palette opened so we
    // can restore it on close — accessibility (WCAG 2.4.3 focus order).
    const previouslyFocused = useRef<HTMLElement | null>(null);
    const navigate = useNavigate();
    const { history } = useHistory();

    const openResult = useCallback((result: { href: string; slug: string; isAction?: boolean }) => {
        const navigateNow = () => {
            setOpen(false);
            navigate(result.href);
        };
        if (pastedFile && !result.isAction) {
            void storeFileHandoff(pastedFile, result.slug).finally(navigateNow);
            return;
        }
        setOpen(false);
        navigate(result.href);
    }, [navigate, pastedFile]);

    // Global keyboard shortcut
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                setOpen(prev => !prev);
            }
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    // Focus input when opened — and restore focus to the previous element
    // on close so screen-reader / keyboard users don't lose context.
    useEffect(() => {
        if (open) {
            previouslyFocused.current = document.activeElement as HTMLElement | null;
            setQuery("");
            setPastedFile(null);
            setSelected(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        } else if (previouslyFocused.current) {
            // Only restore if the element is still in the DOM.
            if (document.contains(previouslyFocused.current)) {
                previouslyFocused.current.focus();
            }
            previouslyFocused.current = null;
        }
    }, [open]);

    // Search results — multi-token fuzzy scoring with popularity tiebreaker.
    // We type `Result` so both the recents branch and the popularity branch
    // return the same shape (isRecent is optional) and downstream JSX can
    // safely read `tool.isRecent`.
    type Result = (typeof allTools)[number] & { isRecent?: boolean; isAction?: boolean };
    // Searchable index = tools + quick actions. Built once per render so
    // the score loop only iterates the merged list.
    const searchable = useMemo(() => [...allTools, ...QUICK_ACTIONS], []);
    const results = useMemo<Result[]>(() => {
        if (!query.trim()) {
            // Empty state: recents (if any) then quick actions, then a
            // handful of popular tools — gives users something to click
            // without typing.
            const initial: Result[] = [];
            if (history.length > 0) {
                const recents = history.slice(0, 5).map(h => {
                    const tool = allTools.find(t => t.slug === h.slug);
                    return tool ? { ...tool, isRecent: true } : null;
                }).filter(Boolean) as Result[];
                initial.push(...recents);
            }
            // Always show the Go-* quick actions in the empty state.
            initial.push(...QUICK_ACTIONS.map(a => ({ ...a, isAction: true })) as Result[]);
            // Pad with popular tools.
            const top = allTools.slice(0, 6) as Result[];
            for (const t of top) {
                if (!initial.find(r => r.slug === t.slug)) initial.push(t);
            }
            return initial.slice(0, 16);
        }
        const q = query.toLowerCase().trim();
        const qDash = q.replace(/\s+/g, "-");
        // Split query into tokens — "to pdf" → ["to", "pdf"]. Drops 1-letter
        // tokens so "a pdf" doesn't blow up scoring.
        const tokens = q.split(/[\s,]+/).filter(t => t.length >= 2);
        const scored: { tool: typeof searchable[number]; score: number }[] = [];
        for (const t of searchable) {
            let score = 0;
            // 1. Exact / prefix / contains on the name.
            if (t.nameLower === q) score = 1000;
            else if (t.nameLower.startsWith(q)) score = 800;
            else if (t.nameLower.includes(q)) score = 600;
            // 2. Slug match — converts "merge pdf" → "merge-pdf".
            else if (t.slug === qDash) score = 700;
            else if (t.slug.includes(qDash)) score = 500;
            // 3. Synonym contains (whole phrase).
            else if (t.synLower.includes(q)) score = 400;
            // 4. Multi-token AND — every query word matches name, slug, or
            //    synonyms. Higher score for more tokens.
            else if (tokens.length >= 2) {
                const haystack = `${t.nameLower} ${t.slug} ${t.synLower}`;
                const matched = tokens.filter(tok => haystack.includes(tok)).length;
                if (matched === tokens.length) score = 300 + matched * 20;
                else if (matched >= 1 && matched === tokens.length - 1) score = 100 + matched * 10;
            }
            // 5. Description fallback.
            else if (t.descLower.includes(q)) score = 200;
            // 6. Slug-token match — "pdf" → all "pdf-*" tools.
            else if (t.slugTokens.includes(q)) score = 250;

            if (score > 0) {
                // Popularity tiebreaker: lower rank (= more popular) gets a
                // small boost — bounded so it never outranks a real match.
                score += Math.max(0, 50 - (t.popularity / 5));
                scored.push({ tool: t, score });
            }
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, 16).map(s => ({
            ...s.tool,
            isAction: isQuickAction(s.tool.slug),
        })) as Result[];
    }, [query, history, searchable]);

    const fileResults = useMemo<Result[]>(() => {
        if (!pastedFile) return [];
        return allTools
            .filter(t => acceptsFile(t.accepts, pastedFile))
            .sort((a, b) => a.popularity - b.popularity)
            .slice(0, 16) as Result[];
    }, [pastedFile]);
    const activeResults = pastedFile ? fileResults : results;

    // Keyboard navigation — also includes a tiny focus trap. The palette has
    // a single tab-stop (the input); Tab/Shift+Tab keep focus inside so users
    // can't escape behind the backdrop with their keyboard.
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected(prev => Math.min(prev + 1, Math.max(0, activeResults.length - 1)));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected(prev => Math.max(prev - 1, 0));
            } else if (e.key === "Home") {
                e.preventDefault();
                setSelected(0);
            } else if (e.key === "End") {
                e.preventDefault();
                setSelected(Math.max(0, activeResults.length - 1));
            } else if (e.key === "Enter" && activeResults[selected]) {
                e.preventDefault();
                openResult(activeResults[selected]);
            } else if (e.key === "Tab") {
                // Focus trap: bounce focus back to the input. The palette has
                // only the input as a real tab-stop — results are picked via
                // ↑↓ + Enter.
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open, selected, activeResults, openResult]);

    // Scroll selected into view
    useEffect(() => {
        if (!listRef.current) return;
        const item = listRef.current.children[selected] as HTMLElement;
        item?.scrollIntoView({ block: "nearest" });
    }, [selected]);

    if (!open) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                aria-hidden="true"
                className="fixed inset-0 z-[100] bg-foreground/35 backdrop-blur-md animate-in fade-in-0 duration-150"
                onClick={() => setOpen(false)}
            />

            {/* Palette */}
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Search tools"
                className="fixed inset-x-0 top-[12vh] z-[101] mx-auto w-full max-w-2xl px-4 animate-in fade-in-0 slide-in-from-top-4 duration-200"
            >
                <div className="rounded-2xl border border-border-strong bg-paper shadow-[0_30px_60px_-20px_rgba(20,15,5,0.35)] dark:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)] overflow-hidden">

                    {/* Header dateline */}
                    <div className="px-5 py-2 border-b border-border bg-paper-2/50 flex items-center justify-between font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground">
                        <span><span className="text-accent">§</span> Command palette</span>
                        <span>{pastedFile
                            ? `${activeResults.length} compatible`
                            : query.trim()
                            ? `${activeResults.length} match${activeResults.length !== 1 ? "es" : ""}`
                            : `${allTools.length} tools indexed`}
                        </span>
                    </div>

                    {/* Search input — combobox pattern (WAI-ARIA APG):
                       role=combobox + aria-controls=results + aria-activedescendant
                       so screen readers announce the highlighted option as ↑↓
                       move through results without focus leaving the input. */}
                    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border">
                        <Search size={17} strokeWidth={1.8} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                        <input
                            ref={inputRef}
                            role="combobox"
                            aria-expanded="true"
                            aria-controls="command-palette-results"
                            aria-autocomplete="list"
                            aria-activedescendant={activeResults[selected] ? `cmdk-opt-${activeResults[selected].slug}` : undefined}
                            className="flex-1 bg-transparent outline-none text-[15px] text-foreground placeholder:text-muted-foreground/85"
                            placeholder={`Search ${allTools.length} tools or jump to a page…`}
                            value={query}
                            onChange={e => { setPastedFile(null); setQuery(e.target.value); setSelected(0); }}
                            onPaste={e => {
                                const file = fileFromClipboard(e.clipboardData);
                                if (!file) return;
                                e.preventDefault();
                                setPastedFile(file);
                                setQuery(file.name || file.type || "Clipboard file");
                                setSelected(0);
                            }}
                            aria-label="Search tools"
                        />
                        <kbd className="hidden sm:inline-flex items-center font-mono text-[10px] text-muted-foreground bg-secondary border border-border rounded px-1.5 py-0.5">
                            ESC
                        </kbd>
                    </div>

                    {/* Live region — announce result count to assistive tech
                       so a SR user knows how many tools matched their query. */}
                    <div role="status" aria-live="polite" className="sr-only">
                        {pastedFile
                            ? `${activeResults.length} ${activeResults.length === 1 ? "tool" : "tools"} can use ${pastedFile.name || "the pasted file"}`
                            : query.trim()
                            ? `${activeResults.length} ${activeResults.length === 1 ? "result" : "results"} for ${query.trim()}`
                            : ""}
                    </div>

                    {pastedFile && (
                        <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-accent/[0.04]">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10">
                                <FileUp size={14} className="text-accent" strokeWidth={1.75} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[13.5px] font-semibold text-foreground truncate">{pastedFile.name || "Clipboard file"}</p>
                                <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground">
                                    {activeResults.length} compatible tool{activeResults.length !== 1 ? "s" : ""}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setPastedFile(null); setQuery(""); setSelected(0); inputRef.current?.focus(); }}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
                                aria-label="Clear pasted file"
                            >
                                <X size={13} />
                            </button>
                        </div>
                    )}

                    {/* Results */}
                    <div
                        ref={listRef}
                        id="command-palette-results"
                        role="listbox"
                        aria-label="Search results"
                        className="max-h-[55vh] overflow-y-auto py-2 px-2"
                    >
                        {!pastedFile && !query.trim() && history.length > 0 && (
                            <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5">
                                <span className="text-accent font-mono text-[10px]">§</span>
                                <Clock size={10} className="text-muted-foreground" />
                                <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recent</span>
                            </div>
                        )}

                        {activeResults.length > 0 ? (
                            activeResults.map((tool, i) => {
                                const Ic = tool.icon;
                                // First non-recent and first quick-action and
                                // first tool transitions get a section label
                                // when no query is active.
                                const prev = activeResults[i - 1];
                                const startActions = !pastedFile && !query.trim() && tool.isAction && !prev?.isAction;
                                const startTools = !pastedFile && !query.trim() && !tool.isAction && !tool.isRecent && (prev?.isAction || prev?.isRecent);
                                return (
                                    <div key={tool.slug}>
                                        {startActions && (
                                            <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
                                                <span className="text-accent font-mono text-[10px]">§</span>
                                                <Zap size={10} className="text-muted-foreground" />
                                                <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Go to</span>
                                            </div>
                                        )}
                                        {startTools && (
                                            <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
                                                <span className="text-accent font-mono text-[10px]">§</span>
                                                <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">All tools</span>
                                            </div>
                                        )}
                                        <button
                                            id={`cmdk-opt-${tool.slug}`}
                                            role="option"
                                            aria-selected={i === selected}
                                            tabIndex={-1}
                                            onClick={() => openResult(tool)}
                                            onMouseEnter={() => setSelected(i)}
                                            className={cn(
                                                "group flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-left transition-colors",
                                                i === selected
                                                    ? "bg-accent/10 ring-1 ring-accent/30"
                                                    : "hover:bg-secondary/60"
                                            )}
                                        >
                                            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", tool.iconBg)}>
                                                <Ic size={14} strokeWidth={1.75} className={tool.iconColor} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className={cn("text-[14px] font-semibold tracking-[-0.01em] truncate", i === selected ? "text-foreground" : "text-foreground/90")}>
                                                    {tool.name}
                                                </p>
                                                <p className="text-[11.5px] text-muted-foreground truncate leading-snug">{tool.description}</p>
                                            </div>
                                            <span className={cn(
                                                "hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold tracking-[0.10em] uppercase shrink-0",
                                                tool.isAction
                                                    ? "text-accent bg-accent/10 border border-accent/30"
                                                    : "text-muted-foreground bg-secondary border border-border"
                                            )}>
                                                {tool.categoryLabel}
                                            </span>
                                            <ArrowRight
                                                size={12}
                                                className={cn(
                                                    "shrink-0 transition-all",
                                                    i === selected ? "text-accent opacity-100 translate-x-0" : "text-muted-foreground/40 opacity-0 -translate-x-1"
                                                )}
                                            />
                                        </button>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="py-14 px-6 text-center">
                                <p className="font-display text-[18px] font-medium text-foreground italic">
                                    {pastedFile ? "No compatible tools found." : `No tools match “${query}”.`}
                                </p>
                                {!pastedFile && (
                                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-2">
                                        Try “merge”, “compress”, “redact”, or “qr”
                                    </p>
                                )}
                                <button
                                    onClick={() => { setPastedFile(null); setQuery(""); inputRef.current?.focus(); }}
                                    className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-secondary/60 hover:bg-secondary hover:border-border-strong font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    Clear search
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Footer hint */}
                    <div className="px-5 py-2.5 border-t border-border bg-paper-2/40 flex items-center gap-4 font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                            <kbd className="font-mono bg-secondary border border-border rounded px-1.5 py-0.5">↑↓</kbd> navigate
                        </span>
                        <span className="flex items-center gap-1.5">
                            <kbd className="font-mono bg-secondary border border-border rounded px-1.5 py-0.5">↵</kbd> open
                        </span>
                        <span className="flex items-center gap-1.5">
                            <kbd className="font-mono bg-secondary border border-border rounded px-1.5 py-0.5">esc</kbd> close
                        </span>
                        <span className="ml-auto hidden sm:inline">
                            <span className="text-accent">§</span> Private search — never leaves your browser
                        </span>
                    </div>
                </div>
            </div>
        </>
    );
}
