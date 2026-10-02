/**
 * Batch — a consumer workspace with task setup and a readable file queue.
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
import "@/skins/experience/workflows.css";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { getToolEndpoint, getFilenameFromContentDisposition, guessExtensionFromContentType } from "@/lib/tool-endpoints";
import { setBatchActive, clearBatchActive } from "@/lib/persistence";
import { chooseDownloadFilename, formatErrorForClipboard, postFormData, withErrorKind } from "@/lib/api";
import { batchConfigError, buildBatchForm } from "@/lib/batch-request";
import { emitToolRun, runOutcome } from "@/lib/toolRun";
import { adviseRejection, type RejectionAdvice } from "@/lib/file-acceptance";
import { IntakeNotice } from "@/skins/experience/ToolStudio";

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
    const [highlightQuery, setHighlightQuery] = useState("");
    const [subtitleTarget, setSubtitleTarget] = useState<"srt" | "vtt">("vtt");
    const [files, setFiles] = useState<BatchFile[]>([]);
    const [processing, setProcessing] = useState(false);
    const [toolSearch, setToolSearch] = useState("");
    const [pickerOpen, setPickerOpen] = useState(false);
    const [parallel, setParallel] = useState(false);  // Run files in parallel (default off — server-friendly)
    const [showHistory, setShowHistory] = useState(false);
    const [history, setHistory] = useState<BatchHistoryEntry[]>(loadHistory);
    // Files the selected tool can't take: named, with the tool that takes them.
    const [rejection, setRejection] = useState<RejectionAdvice | null>(null);
    const [hideDone, setHideDone] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);

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
        setRejection(null);
    }, []);

    useEffect(() => clearAllFiles, [clearAllFiles]);

    // Abort any in-flight batch run on unmount so it doesn't keep the page
    // alive after navigation.
    useEffect(() => () => {
        abortRef.current?.abort();
    }, []);

    /**
     * Add files to the queue, filtering by the tool's accepts spec.
     * Tracks rejected count separately so the UI can warn instead of
     * silently dropping mismatched files.
     */
    const addFiles = useCallback((newFiles: FileList | null) => {
        if (!newFiles || processing) return;
        const arr = Array.from(newFiles);
        const accepted = arr.filter(f => fileAccepts(f, selectedTool.accepts));
        const rejected = arr.filter(f => !accepted.includes(f));
        const added: BatchFile[] = accepted.map(f => ({ file: f, status: "pending" as const }));
        setFiles(prev => [...prev, ...added]);
        // The notice stays until the next selection or a dismissal: a warning
        // that times out can vanish before it is read.
        setRejection(adviseRejection(rejected, { accepts: selectedTool.accepts, fromSlug: selectedTool.slug }));
    }, [selectedTool.accepts, selectedTool.slug, processing]);

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
        onFailure?: (cause: unknown) => void,
    ): Promise<"done" | "error" | "aborted"> => {
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
            const configError = batchConfigError(selectedTool.slug, highlightQuery);
            if (configError) throw configError;
            let resp: Pick<Response, "blob" | "headers">;
            if (selectedTool.slug === "subtitle-converter") {
                const { convertSubtitles } = await import("@/components/tool-ui/subtitle-conversion");
                const converted = convertSubtitles(await originalFile.text(), subtitleTarget);
                if (!converted.ok) throw withErrorKind(new Error(converted.error), "bad_input");
                if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
                const blob = new Blob([converted.output], { type: subtitleTarget === "vtt" ? "text/vtt" : "application/x-subrip" });
                const filename = `${originalFile.name.replace(/\.[^.]+$/, "")}.${subtitleTarget}`;
                resp = { blob: async () => blob, headers: new Headers({ "content-type": blob.type,
                    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }) };
            } else {
                resp = await postFormData(selectedTool.endpoint,
                    () => buildBatchForm(selectedTool.slug, originalFile, highlightQuery),
                    { signal });
            }
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const serverFilename = getFilenameFromContentDisposition(resp.headers.get("content-disposition"));
            const fallbackFilename = buildFallbackFilename(originalFile, resp.headers.get("content-type"));
            const downloadName = selectedTool.slug === "subtitle-converter" && serverFilename
                ? serverFilename : chooseDownloadFilename(fallbackFilename, serverFilename);
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
            return "done";
        } catch (e: unknown) {
            if (signal.aborted) {
                updater(prev => {
                    const next = [...prev];
                    if (next[targetIdx]?.status === "processing") {
                        next[targetIdx] = { ...next[targetIdx], status: "pending" };
                    }
                    return next;
                });
                return "aborted";
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
            onFailure?.(e);
            return "error";
        }
    }, [selectedTool.endpoint, selectedTool.name, selectedTool.slug, buildFallbackFilename, highlightQuery, subtitleTarget]);

    /**
     * Run the queue. Picks up only files in {pending, error} state — done
     * files are skipped automatically, which makes "Process N" double as
     * "retry failures" for free.
     */
    const processAll = async () => {
        const targets = files.map((f, i) => ({ f, i })).filter(({ f }) =>
            f.status === "pending" || f.status === "error"
        );
        if (targets.length === 0 || processing || batchConfigError(selectedTool.slug, highlightQuery)) return;

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
        // Tally terminal results as they return so the usage signal never reads React state.
        const tally: { done: number; failed: number; firstFailure: unknown } = { done: 0, failed: 0, firstFailure: null };
        const record = (result: "done" | "error" | "aborted") => { if (result === "done") tally.done++; else if (result === "error") tally.failed++; };
        const onFailure = (cause: unknown) => { tally.firstFailure ??= cause; };

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
                        record(await processOne(item.i, item.f.file, controller.signal, updater, onFailure));
                    }
                })());
            }
            await Promise.all(workers);
        } else {
            for (const { i } of targets) {
                if (controller.signal.aborted) break;
                record(await processOne(i, files[i].file, controller.signal, updater, onFailure));
            }
        }

        setProcessing(false);
        abortRef.current = null;
        // Run completed (or aborted) — clear the in-progress marker so the
        // resume banner doesn't appear on the next visit.
        clearBatchActive();
        const outcome = runOutcome(tally.done, tally.failed);
        if (outcome) emitToolRun({ slug: selectedTool.slug, mode: "batch", outcome, files: tally.done + tally.failed }, tally.firstFailure);

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
    const canRun = runnableCount > 0 && !processing && (selectedTool.slug !== "highlight-pdf" || !!highlightQuery.trim());

    return (
        <div className="pt-studio-page pt-workflow-page pt-batch-page" data-running={processing}>
            <header className="pt-workflow-header pt-studio-header">
                <div className="pt-workflow-heading"><p className="pt-studio-kicker">BATCH / MORE DONE IN ONE GO</p><h1><span className="wf-air-copy">Make room for more.</span><span className="wf-play-copy">A whole pile. One click.</span></h1><p>Choose a tool, bring your files, and give every one the same treatment.</p></div>
                <div className="wf-header-actions"><button className="wf-button" onClick={clearAllFiles} disabled={processing || !files.length}><Trash2 size={15} /> Clear</button>{processing ? <button className="wf-button wf-button-danger" onClick={cancelRun}><Square size={14} /> Cancel <span>{doneCount}/{files.length}</span></button> : <button className="wf-button wf-button-primary" onClick={processAll} disabled={!canRun}><Play size={15} /> Process {runnableCount || files.length}{errorCount > 0 && <span>({errorCount} retry)</span>}</button>}</div>
            </header>
            <div className="wf-batch-layout">
                <aside className="wf-batch-setup wf-work-sheet">
                    <div className="wf-rail-heading"><div><p className="wf-section-label">01 / SET THE TASK</p><h2>What are we doing?</h2></div><Layers size={23} /></div>
                    <section className="pt-batch-tool-picker">
                        <button disabled={processing} onClick={() => setPickerOpen(open => !open)} aria-expanded={pickerOpen} className="wf-selected-tool"><span className="wf-tool-icon"><ToolIcon size={25} /></span><span><strong>{selectedTool.name}</strong><small>Change tool {pickerOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</small></span></button>
                        {pickerOpen && <div className="wf-batch-picker-options"><div className="wf-search"><Search size={16} /><input autoFocus aria-label="Search batch tools" placeholder={`Filter ${batchableTools.length} batchable tools…`} value={toolSearch} onChange={event => setToolSearch(event.target.value)} />{toolSearch && <button aria-label="Clear search" onClick={() => setToolSearch("")}><X size={14} /></button>}</div>
                            <div className="wf-picker-scroll">{toolSearch.trim() ? <div className="wf-picker-grid">{filteredTools.map(tool => <BatchPickerOption key={tool.slug} tool={tool} active={selectedTool.slug === tool.slug} disabled={processing} onSelect={next => { if (selectedTool.slug !== next.slug) clearAllFiles(); setSelectedTool(next); setPickerOpen(false); setToolSearch(""); }} />)}{!filteredTools.length && <p>No matching tools. Try a different search.</p>}</div> : BATCH_CATEGORY_GROUPS.map(group => { const items = filteredTools.filter(tool => group.cats.has(tool.category)); return items.length > 0 && <div className="wf-picker-group" key={group.id}><h3>{group.label}</h3><div className="wf-picker-grid">{items.map(tool => <BatchPickerOption key={tool.slug} tool={tool} active={selectedTool.slug === tool.slug} disabled={processing} onSelect={next => { if (selectedTool.slug !== next.slug) clearAllFiles(); setSelectedTool(next); setPickerOpen(false); }} />)}</div></div>; })}</div>
                        </div>}
                    </section>
                    <dl className="wf-task-details"><div><dt>Bring</dt><dd>{selectedTool.accepts || "Any supported file"}</dd></div><div><dt>Take away</dt><dd>{selectedTool.outputLabel}</dd></div></dl>
                    {selectedTool.slug === "highlight-pdf" && <label className="wf-field">Text to highlight in every PDF<input value={highlightQuery} onChange={event => setHighlightQuery(event.target.value)} disabled={processing} maxLength={500} placeholder="Enter a word or phrase" /></label>}
                    {selectedTool.slug === "subtitle-converter" && <div className="wf-subtitle-settings"><label className="wf-field">Output format<select value={subtitleTarget} onChange={event => setSubtitleTarget(event.target.value as "srt" | "vtt")} disabled={processing}><option value="vtt">WebVTT (.vtt)</option><option value="srt">SubRip (.srt)</option></select></label><p>Subtitle conversion runs on this device. Files are not uploaded.</p></div>}
                    <label className="wf-parallel-choice"><span><Zap size={19} /><span><strong>A little faster</strong><small>Process up to 3 files at once</small></span></span><input type="checkbox" aria-label="Parallel" checked={parallel} disabled={processing} onChange={event => setParallel(event.target.checked)} /></label>
                    <p className="wf-device-note">{selectedTool.slug === "subtitle-converter" ? "The work happens here in your browser." : "Files are uploaded when you press Process. Each one is handled as a separate job."}</p>
                    {history.length > 0 && <div className="wf-batch-history"><button className="wf-text-button" onClick={() => setShowHistory(value => !value)} aria-expanded={showHistory}><History size={16} /> Recent batches <span>{history.length}</span></button>{showHistory && <div><div className="wf-subheading"><p>Run a familiar task again</p><button className="wf-text-button" disabled={processing} onClick={clearHistory}>Clear history</button></div>{history.map((item, index) => { const tool = batchableTools.find(candidate => candidate.slug === item.toolSlug); return <button className="wf-history-item" key={`${item.timestamp}-${index}`} disabled={!tool || processing} onClick={() => { if (tool) { if (selectedTool.slug !== tool.slug) clearAllFiles(); setSelectedTool(tool); } setShowHistory(false); }}><strong>{item.toolName}</strong><small>{item.done}/{item.total} finished{item.failed ? ` · ${item.failed} need attention` : ""} · {timeAgo(item.timestamp)}</small></button>; })}</div>}</div>}
                </aside>
                <section className="wf-batch-main wf-work-sheet" aria-label="Batch files">
                    <div className="wf-sheet-heading"><div><p className="wf-section-label">02 / BRING YOUR FILES</p><h2>A place for the whole pile.</h2></div><span className="wf-status-pill">{files.length} file{files.length !== 1 ? "s" : ""}</span></div>
                    <div className="wf-batch-drop-area"><Dropzone disabled={processing} accepts={selectedTool.accepts} onFiles={addFiles} onClick={() => inputRef.current?.click()} /><input ref={inputRef} disabled={processing} type="file" multiple accept={selectedTool.accepts} className="hidden" onChange={event => { addFiles(event.target.files); event.target.value = ""; }} /></div>
                    <IntakeNotice advice={rejection} onDismiss={() => setRejection(null)} />
                    <section className="pt-batch-queue">
                        <div className="wf-queue-heading"><div><h3>{files.length ? "Your files" : "Your queue starts here"}</h3><p>{files.length ? `${(totalIn / 1024).toFixed(0)} KB in${totalOut ? ` · ${(totalOut / 1024).toFixed(0)} KB finished` : ""}` : "Add files above. We’ll keep each job easy to follow."}</p></div>{doneCount > 0 && <button className="wf-text-button" disabled={processing} onClick={downloadAll}><Download size={15} /> Download all ({doneCount})</button>}</div>
                        {files.length > 0 && <div className="wf-queue-progress"><div className="wf-progress-label"><span>{doneCount} of {files.length} finished{errorCount > 0 ? ` · ${errorCount} need attention` : ""}</span><span>{etaSeconds > 0 ? `About ${etaSeconds < 60 ? `${etaSeconds}s` : `${Math.ceil(etaSeconds / 60)}m`} left` : `${progressPct}%`}</span></div><div className="pt-batch-progress" role="progressbar" aria-label="Completed batch files" aria-valuemin={0} aria-valuemax={files.length} aria-valuenow={doneCount} aria-valuetext={`${doneCount} of ${files.length} files completed${errorCount ? `; ${errorCount} failed` : ""}`}><div style={{ width: `${progressPct}%` }} /></div></div>}
                        <div className="wf-queue-actions">{errorCount > 0 && !processing && <button onClick={retryAllFailures}><RotateCw size={14} /> Retry {errorCount} failure{errorCount !== 1 ? "s" : ""}</button>}{doneCount > 0 && !processing && <button onClick={removeDone}><Trash2 size={14} /> Clear done</button>}{doneCount > 0 && <button onClick={() => setHideDone(value => !value)}><Filter size={14} /> {hideDone ? "Show done" : "Hide done"}</button>}</div>
                        {files.length ? <div className="pt-batch-files">{!visibleFiles.length && hideDone ? <div className="wf-queue-finished"><CheckCircle size={28} /><p>Every file is finished.</p><button className="wf-text-button" onClick={() => setHideDone(false)}>Show your downloads</button></div> : visibleFiles.map(item => { const index = files.indexOf(item); return <FileRow key={`${item.file.name}-${index}`} file={item} index={index} processing={processing} onRemove={removeFile} onRetry={retryFile} />; })}</div> : <div className="wf-empty-queue" aria-hidden="true"><span><FileText size={23} /></span><div><i /><i /></div><CheckCircle size={21} /></div>}
                    </section>
                </section>
            </div>
        </div>
    );
}

function Dropzone({
    accepts, onFiles, onClick, disabled = false,
}: {
    accepts: string;
    disabled?: boolean;
    onFiles: (files: FileList | null) => void;
    onClick: () => void;
}) {
    const [dragOver, setDragOver] = useState(false);
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!disabled) onFiles(e.dataTransfer.files);
            }}
            className={cn(
                "pt-batch-dropzone relative w-full block border-2 border-dashed rounded-xl px-6 py-10 sm:py-12 text-center transition-colors group",
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
            <p className="font-medium text-[11.5px] text-muted-foreground">
                Accepts {accepts || "any"} — many files OK
            </p>
        </button>
    );
}

function BatchPickerOption({
    tool, active, onSelect, disabled = false,
}: {
    tool: BatchTool;
    active: boolean;
    disabled?: boolean;
    onSelect: (t: BatchTool) => void;
}) {
    const Ic = tool.icon;
    return (
        <button
            disabled={disabled}
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
            "pt-batch-file flex items-center gap-3 px-4 py-3 transition-colors",
            f.status === "processing" && "bg-accent/[0.05]",
            f.status === "done"       && "bg-accent/[0.025]",
            f.status === "error"      && "bg-destructive/[0.04]",
        )} data-file-status={f.status}>
            {/* Index */}
            <span className="pt-batch-number font-mono text-[10.5px] tracking-wider text-muted-foreground shrink-0 w-7">
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
            <span className="font-mono text-[10.5px] tracking-wider text-muted-foreground hidden sm:inline shrink-0 tabular-nums">
                {(f.file.size / 1024).toFixed(0)} KB
                {f.resultSize && (
                    <>
                        <span className="mx-1.5 opacity-50">→</span>
                        <span className={cn("text-accent")}>{(f.resultSize / 1024).toFixed(0)} KB</span>
                        {deltaPct !== 0 && (
                            <span className={cn("ml-1.5", deltaPct > 0 ? "text-accent" : "text-muted-foreground")}>
                                ({deltaPct > 0 ? "−" : "+"}{Math.abs(deltaPct)}%)
                            </span>
                        )}
                    </>
                )}
                {f.durationMs && f.status === "done" && (
                    <span className="ml-1.5 text-muted-foreground">
                        · {f.durationMs < 1000 ? `${f.durationMs}ms` : `${(f.durationMs / 1000).toFixed(1)}s`}
                    </span>
                )}
            </span>
            {/* Status label / actions */}
            <div className="flex items-center gap-1.5 shrink-0">
                {f.status === "pending"    && <span className="font-medium text-[11px] tracking-wider text-muted-foreground px-2 h-6 inline-flex items-center rounded bg-paper-2/60 border border-border">Pending</span>}
                {f.status === "processing" && <Loader2 size={13} className="text-accent animate-spin" />}
                {f.status === "done" && f.resultUrl && (
                    <a href={f.resultUrl} download={f.downloadName || f.file.name} className="font-medium inline-flex items-center gap-1 text-[11.5px] tracking-wider text-accent hover:underline">
                        <Download size={10} /> Download
                    </a>
                )}
                {f.status === "error" && (
                    <>
                        <AlertCircle size={13} className="text-destructive" />
                        {!processing && (
                            <button
                                onClick={() => onRetry(index)}
                                className="font-medium inline-flex items-center gap-1 text-[11.5px] tracking-wider text-destructive hover:underline"
                                title="Retry this file"
                            >
                                <RotateCw size={10} /> Retry
                            </button>
                        )}
                        {f.errorReport && !processing && (
                            <button
                                onClick={() => navigator.clipboard.writeText(f.errorReport || "").catch(() => {})}
                                className="font-medium hidden sm:inline-flex items-center gap-1 text-[11.5px] tracking-wider text-muted-foreground hover:text-destructive hover:underline"
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
