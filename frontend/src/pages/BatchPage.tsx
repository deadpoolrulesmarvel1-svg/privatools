/**
 * Batch — CI-build-style dashboard.
 *
 * Layout:
 *   ┌─ Header: selected tool · progress meter · run button ─┐
 *   ├─ Tool picker (collapsible)                            ┤
 *   ├─ Dropzone                                             ┤
 *   ├─ File queue — each file = a row                       ┤
 *   │    ◯ filename.pdf · 240 KB → ▢ 87 KB · ▣ done        │
 *   └────────────────────────────────────────────────────────┘
 *
 * Per-file retry, file-type validation, parallel-or-serial execution,
 * and a small "recent batches" panel make this feel less like a one-shot
 * upload and more like a queue you actually trust.
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
    Upload, Play, Download, X, CheckCircle, AlertCircle, Loader2, FileText,
    Trash2, ChevronDown, ChevronUp, Search, Layers, RotateCw, Square,
    Zap, History, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { getToolEndpoint, getFilenameFromContentDisposition, guessExtensionFromContentType } from "@/lib/tool-endpoints";
import { setBatchActive, clearBatchActive } from "@/lib/persistence";
import { chooseDownloadFilename, formatErrorForClipboard, postFormData } from "@/lib/api";

const BATCH_TOOL_SLUGS = new Set([
    // PDF — split / page ops
    "split-pdf", "split-by-bookmarks", "split-by-size", "split-in-half", "reverse-pdf", "booklet-pdf",
    "remove-blank-pages", "auto-crop",
    // PDF — optimize / clean
    "compress-pdf", "flatten-pdf", "deskew-pdf", "repair-pdf", "resize-pdf", "rotate-pdf",
    "grayscale-pdf", "crop-pdf", "invert-colors", "transparent-background",
    // PDF — security
    "strip-metadata", "delete-annotations", "sanitize-pdf",
    // PDF — annotate / stamp
    "stamp-pdf", "watermark", "header-footer", "page-numbers", "bates-numbering", "add-hyperlinks",
    "highlight-pdf",
    // PDF — convert from
    "pdf-to-word", "pdf-to-excel", "pdf-to-pptx", "pdf-to-image", "pdf-to-jpg", "pdf-to-png",
    "pdf-to-tiff", "pdf-to-bmp", "pdf-to-gif", "pdf-to-svg", "pdf-to-text", "pdf-to-html",
    "pdf-to-markdown", "pdf-to-epub", "pdf-to-pdfa", "pdf-to-rtf",
    "extract-images", "extract-tables", "pdf-page-counter",
    // PDF — convert to
    "office-to-pdf", "word-to-pdf", "excel-to-pdf", "pptx-to-pdf-convert", "txt-to-pdf",
    "json-to-pdf", "xml-to-pdf", "epub-to-pdf", "rtf-to-pdf", "markdown-to-pdf",
    // PDF — advanced
    "nup", "ocr-pdf",
    // Image
    "image-compressor", "image-converter", "remove-exif", "resize-crop-image",
    "remove-background", "svg-to-png", "image-watermark", "generate-favicon", "heic-to-jpg",
    "heic-to-png", "webp-to-jpg", "webp-to-png", "jpg-to-png", "png-to-jpg",
    "jpg-to-webp", "png-to-webp", "tiff-to-jpg", "tiff-to-png", "bmp-to-jpg", "bmp-to-png",
    "rotate-image", "flip-image", "pixelate-image", "image-upscaler", "image-ocr",
    "image-palette",
    // Video / Audio
    "video-to-gif", "extract-audio", "trim-media", "compress-video", "video-resizer",
    "video-converter", "video-thumbnail", "mute-video", "reverse-video", "video-speed",
    "audio-trim", "audio-converter", "subtitle-converter",
    "gif-to-mp4", "mp4-to-mp3", "m4a-to-mp3", "mov-to-mp4", "avi-to-mp4", "webm-to-mp4", "mp4-to-webm",
    // Archive
    "extract-archive",
]);

const batchableTools = [
    ...tools.filter(t => BATCH_TOOL_SLUGS.has(t.slug)).map(t => ({
        slug: t.slug, endpoint: getToolEndpoint(t.slug), name: t.name, icon: t.icon,
        accepts: t.accepts, outputLabel: t.outputLabel, category: t.category as string, type: "pdf" as const,
    })),
    ...nonPdfTools.filter(t => BATCH_TOOL_SLUGS.has(t.slug)).map(t => ({
        slug: t.slug, endpoint: getToolEndpoint(t.slug), name: t.name, icon: t.icon,
        accepts: t.accepts || "", outputLabel: t.outputLabel, category: t.category as string, type: "nonpdf" as const,
    })),
];

type BatchTool = (typeof batchableTools)[number];

const BATCH_CATEGORY_GROUPS: { id: string; label: string; cats: Set<string> }[] = [
    { id: "organize", label: "PDF — Organize",  cats: new Set(["organize"]) },
    { id: "edit",     label: "PDF — Edit",      cats: new Set(["edit"]) },
    { id: "optimize", label: "PDF — Optimize",  cats: new Set(["optimize"]) },
    { id: "security", label: "PDF — Security",  cats: new Set(["security"]) },
    { id: "to-pdf",   label: "Convert to PDF",  cats: new Set(["to-pdf"]) },
    { id: "from-pdf", label: "Convert from PDF",cats: new Set(["from-pdf"]) },
    { id: "advanced", label: "PDF — Advanced",  cats: new Set(["advanced"]) },
    { id: "image",    label: "Image",           cats: new Set(["image"]) },
    { id: "video",    label: "Video & Audio",   cats: new Set(["video-audio"]) },
    { id: "archive",  label: "Archive",         cats: new Set(["archive"]) },
    { id: "docs",     label: "Documents",       cats: new Set(["document-office"]) },
];

interface BatchFile {
    file: File;
    status: "pending" | "processing" | "done" | "error" | "skipped";
    resultUrl?: string;
    resultSize?: number;
    downloadName?: string;
    error?: string;
    errorReport?: string;
    durationMs?: number;
}

interface BatchHistoryEntry {
    toolSlug: string;
    toolName: string;
    total: number;
    done: number;
    failed: number;
    timestamp: number;
}

const HISTORY_KEY = "privatools_batch_history";
const MAX_HISTORY = 6;

function loadHistory(): BatchHistoryEntry[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.filter((h): h is BatchHistoryEntry =>
            h && typeof h.toolSlug === "string" && typeof h.timestamp === "number"
        );
    } catch { return []; }
}

function saveHistory(entries: BatchHistoryEntry[]) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY))); } catch {}
}

/**
 * Check whether `file` is accepted by an `accepts` spec. Mirrors the
 * native browser `<input accept>` rules: comma-separated list of
 * `.ext` or `mime/type` (mime supports trailing `/*`). Empty spec ⇒ any.
 */
function fileAccepts(file: File, accepts: string): boolean {
    if (!accepts) return true;
    const lowName = file.name.toLowerCase();
    const lowType = (file.type || "").toLowerCase();
    return accepts.split(",").map(s => s.trim().toLowerCase()).some(spec => {
        if (!spec) return false;
        if (spec.startsWith(".")) return lowName.endsWith(spec);
        if (spec.endsWith("/*"))   return lowType.startsWith(spec.slice(0, -1));
        return lowType === spec;
    });
}

export default function BatchPage() {
    const [selectedTool, setSelectedTool] = useState(batchableTools[0]);
    const [files, setFiles] = useState<BatchFile[]>([]);
    const [processing, setProcessing] = useState(false);
    const [toolSearch, setToolSearch] = useState("");
    const [pickerOpen, setPickerOpen] = useState(false);
    const [parallel, setParallel] = useState(false);  // Run files in parallel (default off — server-friendly)
    const [showHistory, setShowHistory] = useState(false);
    const [history, setHistory] = useState<BatchHistoryEntry[]>(loadHistory);
    const [rejectedCount, setRejectedCount] = useState(0);  // Files filtered out by accepts
    const [hideDone, setHideDone] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const rejectedFlashRef = useRef<number | null>(null);

    const filteredTools = useMemo(() =>
        toolSearch.trim()
            ? batchableTools.filter(t => t.name.toLowerCase().includes(toolSearch.toLowerCase()))
            : batchableTools,
    [toolSearch]);

    const clearAllFiles = useCallback(() => {
        setFiles(prev => {
            for (const f of prev) if (f.resultUrl) URL.revokeObjectURL(f.resultUrl);
            return [];
        });
        setRejectedCount(0);
    }, []);

    useEffect(() => clearAllFiles, [clearAllFiles]);

    // Abort any in-flight batch run and clear the rejected-flash timer on
    // unmount so neither keeps the page alive after navigation.
    useEffect(() => () => {
        abortRef.current?.abort();
        if (rejectedFlashRef.current) window.clearTimeout(rejectedFlashRef.current);
    }, []);

    /**
     * Add files to the queue, filtering by the tool's accepts spec.
     * Tracks rejected count separately so the UI can warn instead of
     * silently dropping mismatched files.
     */
    const addFiles = useCallback((newFiles: FileList | null) => {
        if (!newFiles) return;
        const arr = Array.from(newFiles);
        const accepted = arr.filter(f => fileAccepts(f, selectedTool.accepts));
        const rejected = arr.length - accepted.length;
        const added: BatchFile[] = accepted.map(f => ({ file: f, status: "pending" as const }));
        setFiles(prev => [...prev, ...added]);
        if (rejected > 0) {
            setRejectedCount(c => c + rejected);
            // Clear the warning after a few seconds.
            if (rejectedFlashRef.current) window.clearTimeout(rejectedFlashRef.current);
            rejectedFlashRef.current = window.setTimeout(() => setRejectedCount(0), 6000);
        }
    }, [selectedTool.accepts]);

    const removeFile = (idx: number) => {
        setFiles(prev => {
            const target = prev[idx];
            if (target?.resultUrl) URL.revokeObjectURL(target.resultUrl);
            return prev.filter((_, i) => i !== idx);
        });
    };

    /** Remove only the files that already finished — frees the queue for a re-run with new files. */
    const removeDone = () => {
        setFiles(prev => {
            prev.forEach(f => { if (f.status === "done" && f.resultUrl) URL.revokeObjectURL(f.resultUrl); });
            return prev.filter(f => f.status !== "done");
        });
    };

    const buildFallbackFilename = useCallback((file: File, contentType: string | null) => {
        const base = file.name.replace(/\.[^.]+$/, "");
        const outputExt = /\.[a-z0-9]+$/i.test(selectedTool.outputLabel)
            ? selectedTool.outputLabel.match(/\.[a-z0-9]+$/i)?.[0]
            : null;
        const guessedExt = guessExtensionFromContentType(contentType);
        const originalExt = file.name.match(/\.[^.]+$/)?.[0] || "";
        const ext = guessedExt || outputExt || originalExt || ".bin";
        return `${base}_${selectedTool.slug}${ext}`;
    }, [selectedTool.outputLabel, selectedTool.slug]);

    /**
     * Process one file — used by both serial and parallel runners. Mutates
     * the supplied array, but uses the index lookup so a parallel run that
     * resolves out of order still updates the right row. Returns the
     * updated entry so callers can decide what to do next.
     */
    const processOne = useCallback(async (
        targetIdx: number,
        originalFile: File,
        signal: AbortSignal,
        updater: (mutate: (prev: BatchFile[]) => BatchFile[]) => void,
    ): Promise<void> => {
        const startedAt = performance.now();

        // Snapshot the file at the time of call — race-free because
        // setFiles is the only writer.
        updater(prev => {
            if (prev[targetIdx]?.status === "done") return prev;
            const next = [...prev];
            next[targetIdx] = { ...next[targetIdx], status: "processing", error: undefined, errorReport: undefined };
            return next;
        });

        try {
            const resp = await postFormData(selectedTool.endpoint, () => {
                const formData = new FormData();
                formData.append("file", originalFile);
                formData.append("files", originalFile);
                return formData;
            }, {
                signal,
                timeoutMs: 300_000,
            });
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const serverFilename = getFilenameFromContentDisposition(resp.headers.get("content-disposition"));
            const fallbackFilename = buildFallbackFilename(originalFile, resp.headers.get("content-type"));
            const downloadName = chooseDownloadFilename(fallbackFilename, serverFilename);
            const durationMs = Math.round(performance.now() - startedAt);

            updater(prev => {
                const next = [...prev];
                if (next[targetIdx]?.resultUrl) URL.revokeObjectURL(next[targetIdx].resultUrl!);
                next[targetIdx] = {
                    ...next[targetIdx],
                    status: "done",
                    resultUrl: url,
                    resultSize: blob.size,
                    downloadName,
                    durationMs,
                    error: undefined,
                    errorReport: undefined,
                };
                return next;
            });
        } catch (e: unknown) {
            if (signal.aborted) {
                updater(prev => {
                    const next = [...prev];
                    if (next[targetIdx]?.status === "processing") {
                        next[targetIdx] = { ...next[targetIdx], status: "pending" };
                    }
                    return next;
                });
                return;
            }
            const msg = e instanceof Error ? e.message : "Failed";
            const report = formatErrorForClipboard(
                e,
                `Batch ${selectedTool.name} (${selectedTool.slug}) — ${originalFile.name}`,
            );
            updater(prev => {
                const next = [...prev];
                next[targetIdx] = { ...next[targetIdx], status: "error", error: msg, errorReport: report };
                return next;
            });
        }
    }, [selectedTool.endpoint, selectedTool.name, selectedTool.slug, buildFallbackFilename]);

    /**
     * Run the queue. Picks up only files in {pending, error} state — done
     * files are skipped automatically, which makes "Process N" double as
     * "retry failures" for free.
     */
    const processAll = async () => {
        const targets = files.map((f, i) => ({ f, i })).filter(({ f }) =>
            f.status === "pending" || f.status === "error"
        );
        if (targets.length === 0 || processing) return;

        const controller = new AbortController();
        abortRef.current = controller;
        setProcessing(true);
        // Mark a batch-in-progress in localStorage so a tab close/reload
        // surfaces a "you had a batch running" banner on the next visit.
        setBatchActive({
            toolSlug: selectedTool.slug,
            toolName: selectedTool.name,
            fileCount: files.length,
            fileNames: files.map(f => f.file.name).slice(0, 50),
            startedAt: Date.now(),
        });

        const updater = (mutate: (prev: BatchFile[]) => BatchFile[]) => setFiles(mutate);

        if (parallel) {
            // Bounded parallel — 3 at a time is generous without overloading the API.
            const concurrency = 3;
            const queue = [...targets];
            const workers: Promise<void>[] = [];
            for (let w = 0; w < Math.min(concurrency, queue.length); w++) {
                workers.push((async () => {
                    while (queue.length > 0 && !controller.signal.aborted) {
                        const item = queue.shift();
                        if (!item) break;
                        await processOne(item.i, item.f.file, controller.signal, updater);
                    }
                })());
            }
            await Promise.all(workers);
        } else {
            for (const { i } of targets) {
                if (controller.signal.aborted) break;
                await processOne(i, files[i].file, controller.signal, updater);
            }
        }

        setProcessing(false);
        abortRef.current = null;
        // Run completed (or aborted) — clear the in-progress marker so the
        // resume banner doesn't appear on the next visit.
        clearBatchActive();

        // Record history. Read fresh state via the setter to avoid stale closure.
        setFiles(curr => {
            const done = curr.filter(f => f.status === "done").length;
            const failed = curr.filter(f => f.status === "error").length;
            if (done + failed > 0) {
                const entry: BatchHistoryEntry = {
                    toolSlug: selectedTool.slug,
                    toolName: selectedTool.name,
                    total: curr.length,
                    done, failed,
                    timestamp: Date.now(),
                };
                setHistory(prev => {
                    const next = [entry, ...prev].slice(0, MAX_HISTORY);
                    saveHistory(next);
                    return next;
                });
            }
            return curr;
        });
    };

    const cancelRun = () => {
        abortRef.current?.abort();
    };

    const retryFile = (idx: number) => {
        // Reset to pending so the next "Process N" picks it up. Avoid running
        // mid-flight; if not processing, kick off immediately for one file.
        setFiles(prev => {
            if (prev[idx]?.status !== "error") return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], status: "pending", error: undefined, errorReport: undefined };
            return next;
        });
    };

    const retryAllFailures = async () => {
        const failedCount = files.filter(f => f.status === "error").length;
        if (failedCount === 0 || processing) return;
        // Flip errors back to pending, then re-run.
        setFiles(prev => prev.map(f => f.status === "error" ? { ...f, status: "pending", error: undefined, errorReport: undefined } : f));
        // Defer the run by a tick so React commits the state change first.
        setTimeout(() => { void processAll(); }, 0);
    };

    /**
     * Download every completed file. Naive `a.click()` in a tight loop is
     * blocked by browsers, so we stagger with rAF — most browsers permit
     * sequential downloads if they're paced apart.
     */
    const downloadAll = () => {
        const done = files.filter(f => f.status === "done" && f.resultUrl);
        done.forEach((f, idx) => {
            window.setTimeout(() => {
                const a = document.createElement("a");
                a.href = f.resultUrl!;
                a.download = f.downloadName || f.file.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, idx * 120);  // ~8 files/sec
        });
    };

    const clearHistory = () => {
        setHistory([]);
        try { localStorage.removeItem(HISTORY_KEY); } catch {}
    };

    const doneCount    = files.filter(f => f.status === "done").length;
    const errorCount   = files.filter(f => f.status === "error").length;
    const pendingCount = files.filter(f => f.status === "pending").length;
    const totalIn  = files.reduce((s, f) => s + f.file.size, 0);
    const totalOut = files.reduce((s, f) => s + (f.resultSize || 0), 0);
    const progressPct = files.length === 0 ? 0 : Math.round((doneCount / files.length) * 100);

    // ETA — average completed-file duration × remaining count, when processing.
    const avgDurationMs = useMemo(() => {
        const completed = files.filter(f => f.status === "done" && f.durationMs);
        if (completed.length === 0) return 0;
        const sum = completed.reduce((s, f) => s + (f.durationMs || 0), 0);
        return Math.round(sum / completed.length);
    }, [files]);

    const remainingCount = pendingCount + files.filter(f => f.status === "processing").length;
    const etaSeconds = avgDurationMs > 0 && remainingCount > 0 && processing
        ? Math.ceil((remainingCount * avgDurationMs) / (parallel ? 3000 : 1000))
        : 0;

    // Visible files — apply hide-done filter if user toggled it on.
    const visibleFiles = useMemo(() =>
        hideDone ? files.filter(f => f.status !== "done") : files,
    [files, hideDone]);

    const ToolIcon = selectedTool.icon;
    const runnableCount = pendingCount + errorCount;
    const canRun = runnableCount > 0 && !processing;

    return (
        <div className="h-full flex flex-col">
            {/* Header — workspace bar */}
            <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-paper-2/30">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-accent">§ Batch</span>
                        <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">{files.length} file{files.length !== 1 ? "s" : ""}</span>
                        {doneCount > 0 && <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent">{doneCount} done</span>}
                        {errorCount > 0 && <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-destructive">{errorCount} failed</span>}
                        {etaSeconds > 0 && (
                            <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground/85">
                                · ~{etaSeconds < 60 ? `${etaSeconds}s` : `${Math.ceil(etaSeconds / 60)}m`} left
                            </span>
                        )}
                    </div>
                    <h1 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                        Apply <span className="text-accent italic font-medium">{selectedTool.name}</span> to many files
                    </h1>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {history.length > 0 && !processing && (
                        <button
                            onClick={() => setShowHistory(s => !s)}
                            className="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                            title="Recent batch runs"
                            aria-expanded={showHistory}
                        >
                            <History size={12} /> Recent
                        </button>
                    )}
                    {doneCount > 0 && !processing && (
                        <button
                            onClick={downloadAll}
                            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <Download size={12} /> Download all ({doneCount})
                        </button>
                    )}
                    <button
                        onClick={clearAllFiles}
                        disabled={files.length === 0}
                        className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Trash2 size={12} /> Clear
                    </button>
                    {processing ? (
                        <button
                            onClick={cancelRun}
                            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-[13px] font-semibold bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/15 transition-colors"
                        >
                            <Square size={11} className="fill-current" />
                            <span className="hidden sm:inline">Cancel</span>
                            <span className="font-mono text-[11px] opacity-80">{doneCount}/{files.length}</span>
                        </button>
                    ) : (
                        <button
                            onClick={processAll}
                            disabled={!canRun}
                            className={cn(
                                "inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-[13px] font-semibold transition-colors",
                                canRun
                                    ? "bg-accent text-accent-foreground hover:brightness-105 shadow-sm"
                                    : "bg-secondary text-muted-foreground cursor-not-allowed"
                            )}
                            title={errorCount > 0 ? `Retry ${errorCount} failure${errorCount !== 1 ? "s" : ""} and process ${pendingCount} pending` : undefined}
                        >
                            <Play size={13} />
                            Process {runnableCount || files.length}
                            {errorCount > 0 && <span className="font-mono text-[10.5px] opacity-80">({errorCount} retry)</span>}
                        </button>
                    )}
                </div>
            </header>

            {/* Overall progress bar */}
            {files.length > 0 && (
                <div className="h-1 bg-paper-2 relative">
                    <div
                        className={cn("h-full transition-all duration-300", processing ? "bg-accent" : doneCount === files.length ? "bg-accent" : "bg-accent/60")}
                        style={{ width: `${progressPct}%` }}
                    />
                </div>
            )}

            {/* History panel — collapsible, shown above the body when toggled */}
            {showHistory && history.length > 0 && (
                <div className="border-b border-border bg-paper-2/40 px-5 py-3 animate-slide-down">
                    <div className="max-w-5xl mx-auto">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <History size={11} className="text-accent" />
                                <span className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Recent batches · {history.length}</span>
                            </div>
                            <button
                                onClick={clearHistory}
                                className="font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground hover:text-destructive transition-colors"
                            >
                                Clear
                            </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {history.map((h, idx) => {
                                const t = batchableTools.find(bt => bt.slug === h.toolSlug);
                                const HIc = t?.icon;
                                return (
                                    <button
                                        key={`${h.toolSlug}-${h.timestamp}-${idx}`}
                                        onClick={() => {
                                            if (t) {
                                                if (selectedTool.slug !== t.slug) clearAllFiles();
                                                setSelectedTool(t);
                                            }
                                            setShowHistory(false);
                                        }}
                                        className={cn(
                                            "group flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:border-accent/40 transition-colors text-left",
                                            t && `cat-${t.category}`
                                        )}
                                        disabled={!t}
                                    >
                                        {HIc && (
                                            <span className="icon-tile icon-tile-sm shrink-0">
                                                <HIc size={12} strokeWidth={1.75} />
                                            </span>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="font-display text-[12.5px] font-semibold text-foreground tracking-[-0.01em] truncate">{h.toolName}</p>
                                            <p className="font-mono text-[10px] text-muted-foreground truncate">
                                                {h.done}/{h.total} done
                                                {h.failed > 0 && <span className="text-destructive"> · {h.failed} failed</span>}
                                                <span className="text-muted-foreground/70"> · {timeAgo(h.timestamp)}</span>
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Body */}
            <div className="flex-1">
                <div className="mx-auto max-w-5xl px-5 py-6 sm:py-8">

                    {/* Selected tool card with picker */}
                    <section className="mb-6 rounded-xl border border-border bg-card overflow-hidden">
                        <button
                            onClick={() => setPickerOpen(o => !o)}
                            className={cn("w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-secondary/40 transition-colors", `cat-${selectedTool.category}`)}
                            aria-expanded={pickerOpen}
                        >
                            <span className="icon-tile icon-tile-sm shrink-0">
                                <ToolIcon size={15} strokeWidth={1.75} />
                            </span>
                            <div className="flex-1 min-w-0">
                                <p className="font-display text-[15px] font-semibold text-foreground tracking-[-0.015em]">{selectedTool.name}</p>
                                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">
                                    Accepts {selectedTool.accepts || "any"} · outputs {selectedTool.outputLabel}
                                </p>
                            </div>
                            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground hover:text-foreground transition-colors">
                                {pickerOpen ? "Hide tools" : "Change tool"}
                                {pickerOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </span>
                        </button>
                        {pickerOpen && (
                            <div className="border-t border-border p-4 bg-paper-2/30 animate-fade-in">
                                <div className="relative mb-3">
                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                        className="w-full h-9 pl-7 pr-7 rounded-md border border-border bg-card text-[13px] text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                                        placeholder={`Filter ${batchableTools.length} batchable tools…`}
                                        value={toolSearch}
                                        onChange={e => setToolSearch(e.target.value)}
                                        autoFocus
                                    />
                                    {toolSearch && (
                                        <button
                                            onClick={() => setToolSearch("")}
                                            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                                            aria-label="Clear search"
                                        >
                                            <X size={11} />
                                        </button>
                                    )}
                                </div>
                                <div className="max-h-[300px] overflow-y-auto -mx-1 px-1">
                                    {toolSearch.trim() ? (
                                        // Flat list when searching
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                                            {filteredTools.map(t => (
                                                <BatchPickerOption
                                                    key={t.slug}
                                                    tool={t}
                                                    active={selectedTool.slug === t.slug}
                                                    onSelect={t => {
                                                        if (selectedTool.slug !== t.slug) clearAllFiles();
                                                        setSelectedTool(t);
                                                        setPickerOpen(false);
                                                        setToolSearch("");
                                                    }}
                                                />
                                            ))}
                                            {filteredTools.length === 0 && (
                                                <p className="col-span-full text-[12px] text-muted-foreground px-2 py-3 text-center">
                                                    No tools match "{toolSearch}".
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        // Grouped by category
                                        <div className="space-y-3">
                                            {BATCH_CATEGORY_GROUPS.map(group => {
                                                const groupTools = filteredTools.filter(t => group.cats.has(t.category));
                                                if (groupTools.length === 0) return null;
                                                return (
                                                    <div key={group.id}>
                                                        <p className="px-1 mb-1.5 font-mono text-[9.5px] font-medium tracking-[0.10em] uppercase text-muted-foreground/85">
                                                            <span className="text-accent">§</span> {group.label} · {groupTools.length}
                                                        </p>
                                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                                                            {groupTools.map(t => (
                                                                <BatchPickerOption
                                                                    key={t.slug}
                                                                    tool={t}
                                                                    active={selectedTool.slug === t.slug}
                                                                    onSelect={t => {
                                                                        if (selectedTool.slug !== t.slug) clearAllFiles();
                                                                        setSelectedTool(t);
                                                                        setPickerOpen(false);
                                                                    }}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                                <p className="mt-3 font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground/85">
                                    <span className="text-accent">§</span> {batchableTools.length} tools support batching — drag a folder onto the dropzone, every file goes through the chosen tool
                                </p>
                            </div>
                        )}
                    </section>

                    {/* Dropzone */}
                    <Dropzone
                        accepts={selectedTool.accepts}
                        onFiles={addFiles}
                        onClick={() => inputRef.current?.click()}
                    />
                    <input
                        ref={inputRef}
                        type="file"
                        multiple
                        accept={selectedTool.accepts}
                        className="hidden"
                        onChange={e => { addFiles(e.target.files); e.target.value = ""; }}
                    />

                    {/* Rejected-files notice — appears when accepts filter drops files */}
                    {rejectedCount > 0 && (
                        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] text-amber-900 dark:text-amber-200 animate-fade-up">
                            <AlertCircle size={13} className="shrink-0" />
                            <span className="text-[12.5px] flex-1">
                                Skipped <strong>{rejectedCount}</strong> file{rejectedCount !== 1 ? "s" : ""} that {rejectedCount === 1 ? "doesn't" : "don't"} match <span className="font-mono text-[11.5px]">{selectedTool.accepts || "any"}</span>.
                            </span>
                            <button
                                onClick={() => setRejectedCount(0)}
                                className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-amber-500/15"
                                aria-label="Dismiss"
                            >
                                <X size={11} />
                            </button>
                        </div>
                    )}

                    {/* File queue */}
                    {files.length > 0 && (
                        <section className="mt-6">
                            <div className="flex items-center gap-3 mb-3 px-1 flex-wrap">
                                <div className="flex items-baseline gap-2">
                                    <Layers size={11} className="text-accent" />
                                    <span className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                                        Queue
                                    </span>
                                    <span className="font-mono text-[10px] text-muted-foreground/80">
                                        {(totalIn / 1024).toFixed(0)} KB in
                                        {totalOut > 0 && ` · ${(totalOut / 1024).toFixed(0)} KB out (${totalOut < totalIn ? "−" : "+"}${totalIn > 0 ? Math.abs(Math.round(((totalIn - totalOut) / totalIn) * 100)) : 0}%)`}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 ml-auto flex-wrap">
                                    {/* Parallel toggle — small but high-value */}
                                    {!processing && (
                                        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none" title="Run 3 files at a time">
                                            <input
                                                type="checkbox"
                                                checked={parallel}
                                                onChange={e => setParallel(e.target.checked)}
                                                className="sr-only peer"
                                            />
                                            <span className="relative inline-flex h-4 w-7 items-center rounded-full bg-border peer-checked:bg-accent transition-colors">
                                                <span className="inline-block h-3 w-3 rounded-full bg-card translate-x-0.5 peer-checked:translate-x-3.5 transition-transform" />
                                            </span>
                                            <Zap size={10} className={cn("transition-colors", parallel ? "text-accent" : "text-muted-foreground/60")} />
                                            <span className={cn("font-mono text-[10px] tracking-[0.08em] uppercase", parallel ? "text-accent" : "text-muted-foreground")}>
                                                Parallel
                                            </span>
                                        </label>
                                    )}
                                    {errorCount > 0 && !processing && (
                                        <button
                                            onClick={retryAllFailures}
                                            className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase text-destructive hover:underline"
                                        >
                                            <RotateCw size={10} /> Retry {errorCount} failure{errorCount !== 1 ? "s" : ""}
                                        </button>
                                    )}
                                    {doneCount > 0 && !processing && (
                                        <button
                                            onClick={removeDone}
                                            className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground hover:text-foreground transition-colors"
                                            title="Remove done files from queue"
                                        >
                                            <Trash2 size={10} /> Clear done
                                        </button>
                                    )}
                                    {doneCount > 0 && (
                                        <button
                                            onClick={() => setHideDone(v => !v)}
                                            className={cn(
                                                "inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase transition-colors",
                                                hideDone ? "text-accent" : "text-muted-foreground hover:text-foreground"
                                            )}
                                            title={hideDone ? "Show finished files" : "Hide finished files"}
                                        >
                                            <Filter size={10} /> {hideDone ? "Show done" : "Hide done"}
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                                {visibleFiles.length === 0 && hideDone ? (
                                    <p className="text-[12px] text-muted-foreground px-4 py-4 text-center">
                                        All {doneCount} file{doneCount !== 1 ? "s" : ""} done. <button onClick={() => setHideDone(false)} className="text-accent hover:underline">Show them</button>
                                    </p>
                                ) : (
                                    visibleFiles.map((f) => {
                                        // Map visible index back to canonical index for actions.
                                        const realIdx = files.indexOf(f);
                                        return (
                                            <FileRow
                                                key={`${f.file.name}-${realIdx}`}
                                                file={f}
                                                index={realIdx}
                                                processing={processing}
                                                onRemove={removeFile}
                                                onRetry={retryFile}
                                            />
                                        );
                                    })
                                )}
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}

function Dropzone({
    accepts, onFiles, onClick,
}: {
    accepts: string;
    onFiles: (files: FileList | null) => void;
    onClick: () => void;
}) {
    const [dragOver, setDragOver] = useState(false);
    return (
        <button
            type="button"
            onClick={onClick}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onFiles(e.dataTransfer.files);
            }}
            className={cn(
                "relative w-full block border-2 border-dashed rounded-xl px-6 py-10 sm:py-12 text-center transition-colors group",
                dragOver
                    ? "border-accent bg-accent/[0.06]"
                    : "border-border-strong bg-paper-2/40 hover:border-accent/55 hover:bg-accent/[0.04]"
            )}
        >
            {/* Corner registration marks */}
            <CornerMarks />

            <div className="h-12 w-12 rounded-xl bg-accent/12 border border-accent/35 mx-auto mb-3 flex items-center justify-center">
                <Upload size={18} className="text-accent" />
            </div>
            <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em] mb-1">
                Drop files here, or click to browse
            </p>
            <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                Accepts {accepts || "any"} — many files OK
            </p>
        </button>
    );
}

function BatchPickerOption({
    tool, active, onSelect,
}: {
    tool: BatchTool;
    active: boolean;
    onSelect: (t: BatchTool) => void;
}) {
    const Ic = tool.icon;
    return (
        <button
            onClick={() => onSelect(tool)}
            className={cn(
                "group flex items-center gap-2 px-2.5 h-8 rounded-md text-left text-[12.5px] transition-colors border",
                `cat-${tool.category}`,
                active
                    ? "bg-accent/10 border-accent/40 text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:bg-card hover:text-foreground hover:border-border"
            )}
        >
            <Ic
                size={11}
                strokeWidth={1.75}
                style={{ color: "hsl(var(--tile, var(--accent)))" }}
                className="shrink-0 transition-transform group-hover:scale-110"
            />
            <span className="truncate">{tool.name}</span>
        </button>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className="absolute top-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className="absolute top-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 right-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" />
            </span>
        </>
    );
}

function FileRow({
    file: f, index, processing, onRemove, onRetry,
}: {
    file: BatchFile; index: number; processing: boolean;
    onRemove: (i: number) => void;
    onRetry: (i: number) => void;
}) {
    const deltaPct = f.resultSize && f.file.size
        ? Math.round(((f.file.size - f.resultSize) / f.file.size) * 100)
        : 0;
    return (
        <div className={cn(
            "flex items-center gap-3 px-4 py-3 transition-colors",
            f.status === "processing" && "bg-accent/[0.05]",
            f.status === "done"       && "bg-accent/[0.025]",
            f.status === "error"      && "bg-destructive/[0.04]",
        )}>
            {/* Index */}
            <span className="font-mono text-[10.5px] tracking-wider text-muted-foreground/85 shrink-0 w-7">
                {String(index + 1).padStart(2, "0")}
            </span>
            {/* Status dot */}
            <span className={cn(
                "h-2 w-2 rounded-full shrink-0",
                f.status === "pending"    && "bg-muted-foreground/40 ring-2 ring-muted-foreground/10",
                f.status === "processing" && "bg-accent animate-pulse",
                f.status === "done"       && "bg-accent",
                f.status === "error"      && "bg-destructive",
            )} />
            {/* Filename */}
            <FileText size={13} className="text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-foreground truncate">{f.file.name}</p>
                {f.error && <p className="text-[11px] text-destructive truncate mt-0.5" title={f.error}>{f.error}</p>}
            </div>
            {/* Size info */}
            <span className="font-mono text-[10.5px] tracking-wider text-muted-foreground/85 hidden sm:inline shrink-0 tabular-nums">
                {(f.file.size / 1024).toFixed(0)} KB
                {f.resultSize && (
                    <>
                        <span className="mx-1.5 opacity-50">→</span>
                        <span className={cn("text-accent")}>{(f.resultSize / 1024).toFixed(0)} KB</span>
                        {deltaPct !== 0 && (
                            <span className={cn("ml-1.5", deltaPct > 0 ? "text-accent" : "text-muted-foreground/85")}>
                                ({deltaPct > 0 ? "−" : "+"}{Math.abs(deltaPct)}%)
                            </span>
                        )}
                    </>
                )}
                {f.durationMs && f.status === "done" && (
                    <span className="ml-1.5 text-muted-foreground/60">
                        · {f.durationMs < 1000 ? `${f.durationMs}ms` : `${(f.durationMs / 1000).toFixed(1)}s`}
                    </span>
                )}
            </span>
            {/* Status label / actions */}
            <div className="flex items-center gap-1.5 shrink-0">
                {f.status === "pending"    && <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground/85 px-2 h-6 inline-flex items-center rounded bg-paper-2/60 border border-border">Pending</span>}
                {f.status === "processing" && <Loader2 size={13} className="text-accent animate-spin" />}
                {f.status === "done" && f.resultUrl && (
                    <a href={f.resultUrl} download={f.downloadName || f.file.name} className="inline-flex items-center gap-1 font-mono text-[10.5px] tracking-wider uppercase text-accent hover:underline">
                        <Download size={10} /> Download
                    </a>
                )}
                {f.status === "error" && (
                    <>
                        <AlertCircle size={13} className="text-destructive" />
                        {!processing && (
                            <button
                                onClick={() => onRetry(index)}
                                className="inline-flex items-center gap-1 font-mono text-[10.5px] tracking-wider uppercase text-destructive hover:underline"
                                title="Retry this file"
                            >
                                <RotateCw size={10} /> Retry
                            </button>
                        )}
                        {f.errorReport && !processing && (
                            <button
                                onClick={() => navigator.clipboard.writeText(f.errorReport || "").catch(() => {})}
                                className="hidden sm:inline-flex items-center gap-1 font-mono text-[10.5px] tracking-wider uppercase text-muted-foreground hover:text-destructive hover:underline"
                                title="Copy request report"
                            >
                                Copy report
                            </button>
                        )}
                    </>
                )}
                {!processing && (
                    <button onClick={() => onRemove(index)} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60" title="Remove" aria-label="Remove file">
                        <X size={11} />
                    </button>
                )}
            </div>
        </div>
    );
}

/** Small helper — "5m ago", "2h ago", "3d ago". */
function timeAgo(ts: number) {
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60)        return "just now";
    if (seconds < 3600)      return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400)     return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(ts).toLocaleDateString();
}
