import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowRight, Clock, Command } from "lucide-react";
import { cn } from "@/lib/utils";
import { tools, categoryMeta, Category } from "@/data/tools";
import { nonPdfTools, nonPdfCategoryMeta, NonPdfCategory } from "@/data/non-pdf-tools";
import { useHistory } from "@/hooks/useHistory";

// Per-tool synonyms — invisible search hints so "join pdfs" finds merge-pdf,
// "shrink" finds compress-pdf, etc. Keep concise; add only common phrasings.
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
};

// Build searchable index once. We pre-lowercase everything and bake
// popularity into the tool itself so the scoring loop stays tight.
const allTools = [
    ...tools.map(t => ({
        slug: t.slug, name: t.name, description: t.description, icon: t.icon,
        href: `/tool/${t.slug}`,
        iconBg: categoryMeta[t.category as Category]?.iconBg ?? "bg-blue-500/10",
        iconColor: categoryMeta[t.category as Category]?.iconColor ?? "text-blue-400",
        synonyms: SYNONYMS[t.slug] ?? "",
        nameLower: t.name.toLowerCase(),
        descLower: t.description.toLowerCase(),
        synLower: (SYNONYMS[t.slug] ?? "").toLowerCase(),
        slugTokens: t.slug.split("-"),
        popularity: (t as { popularity?: number }).popularity ?? 999,
    })),
    ...nonPdfTools.map(t => ({
        slug: t.slug, name: t.name, description: t.description, icon: t.icon,
        href: `/tools/${t.slug}`,
        iconBg: nonPdfCategoryMeta[t.category as NonPdfCategory]?.iconBg ?? "bg-pink-500/10",
        iconColor: nonPdfCategoryMeta[t.category as NonPdfCategory]?.iconColor ?? "text-pink-400",
        synonyms: SYNONYMS[t.slug] ?? "",
        nameLower: t.name.toLowerCase(),
        descLower: t.description.toLowerCase(),
        synLower: (SYNONYMS[t.slug] ?? "").toLowerCase(),
        slugTokens: t.slug.split("-"),
        popularity: (t as { popularity?: number }).popularity ?? 999,
    })),
];

export default function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const { history } = useHistory();

    const go = useCallback((href: string) => {
        setOpen(false);
        navigate(href);
    }, [navigate]);

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

    // Focus input when opened
    useEffect(() => {
        if (open) {
            setQuery("");
            setSelected(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    // Search results — multi-token fuzzy scoring with popularity tiebreaker.
    const results = useMemo(() => {
        if (!query.trim()) {
            // Show recent tools when no query — otherwise the most popular
            // ones (since tools are already sorted by popularity).
            if (history.length > 0) {
                return history.slice(0, 8).map(h => {
                    const tool = allTools.find(t => t.slug === h.slug);
                    return tool ? { ...tool, isRecent: true } : null;
                }).filter(Boolean) as (typeof allTools[0] & { isRecent?: boolean })[];
            }
            return allTools.slice(0, 8);
        }
        const q = query.toLowerCase().trim();
        const qDash = q.replace(/\s+/g, "-");
        // Split query into tokens — "to pdf" → ["to", "pdf"]. Drops 1-letter
        // tokens so "a pdf" doesn't blow up scoring.
        const tokens = q.split(/[\s,]+/).filter(t => t.length >= 2);
        const scored: { tool: typeof allTools[number]; score: number }[] = [];
        for (const t of allTools) {
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
        return scored.slice(0, 16).map(s => s.tool);
    }, [query, history]);

    // Keyboard navigation
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected(prev => Math.min(prev + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected(prev => Math.max(prev - 1, 0));
            } else if (e.key === "Enter" && results[selected]) {
                e.preventDefault();
                go(results[selected].href);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open, selected, results, go]);

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
                className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md animate-in fade-in-0 duration-150"
                onClick={() => setOpen(false)}
            />

            {/* Palette */}
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Search tools"
                className="fixed inset-x-0 top-[12vh] z-[101] mx-auto w-full max-w-xl px-4 animate-in fade-in-0 slide-in-from-top-4 duration-200"
            >
                <div className="rounded-2xl border border-border/50 bg-card/95 backdrop-blur-2xl shadow-2xl shadow-black/60 overflow-hidden">

                    {/* Animated gradient line */}
                    <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary to-transparent opacity-60 animate-pulse" />

                    {/* Search input */}
                    <div className="flex items-center gap-3.5 px-5 py-4 border-b border-border/40">
                        <Search size={20} strokeWidth={2} className="shrink-0 text-muted-foreground/80" />
                        <input
                            ref={inputRef}
                            className="flex-1 bg-transparent outline-none text-base text-foreground placeholder:text-muted-foreground/80"
                            placeholder="Search tools…"
                            value={query}
                            onChange={e => { setQuery(e.target.value); setSelected(0); }}
                        />
                        <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] text-muted-foreground/80 font-mono bg-secondary/40 rounded-md px-2 py-1">
                            ESC
                        </kbd>
                    </div>

                    {/* Results */}
                    <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-2 px-2">
                        {!query.trim() && history.length > 0 && (
                            <div className="flex items-center gap-1.5 px-3 py-2">
                                <Clock size={11} className="text-muted-foreground/80" />
                                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80">Recent</span>
                            </div>
                        )}

                        {results.length > 0 ? (
                            results.map((tool, i) => {
                                const Ic = tool.icon;
                                return (
                                    <button
                                        key={tool.slug}
                                        onClick={() => go(tool.href)}
                                        onMouseEnter={() => setSelected(i)}
                                        className={cn(
                                            "flex items-center gap-3.5 w-full px-3.5 py-3 rounded-xl text-left transition-colors",
                                            i === selected ? "bg-primary/8" : "hover:bg-secondary/50"
                                        )}
                                    >
                                        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tool.iconBg)}>
                                            <Ic size={15} strokeWidth={1.75} className={tool.iconColor} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-heading font-semibold text-foreground truncate">{tool.name}</p>
                                            <p className="text-[11px] text-muted-foreground/80 truncate">{tool.description}</p>
                                        </div>
                                        {i === selected && <ArrowRight size={13} className="shrink-0 text-primary/60" />}
                                    </button>
                                );
                            })
                        ) : (
                            <div className="py-12 text-center">
                                <p className="text-sm text-muted-foreground/80">No tools found</p>
                            </div>
                        )}
                    </div>

                    {/* Footer hint */}
                    <div className="px-5 py-2.5 border-t border-border/30 flex items-center gap-5">
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/35">
                            <kbd className="font-mono bg-secondary/40 rounded-md px-1.5 py-0.5">↑↓</kbd> navigate
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/35">
                            <kbd className="font-mono bg-secondary/40 rounded-md px-1.5 py-0.5">↵</kbd> open
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/35">
                            <kbd className="font-mono bg-secondary/40 rounded-md px-1.5 py-0.5">esc</kbd> close
                        </span>
                    </div>
                </div>
            </div>
        </>
    );
}
