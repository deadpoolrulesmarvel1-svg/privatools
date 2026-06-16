/**
 * WatermarkUI — overlay a text or image watermark on one or many PDFs.
 *
 * Multi-file design: the backend `/watermark` endpoint takes a single PDF plus
 * an optional `watermark_image` field. We loop client-side, one request per
 * PDF, with the same watermark applied to all. Three-at-a-time concurrency.
 *
 * On N=1 we download the watermarked PDF directly. On N>1 we zip the outputs.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
    Upload, Loader2, CheckCircle2, X, FileText, AlertCircle, Image as ImageIcon,
    Droplets, RotateCcw, Download, Undo2, Copy,
} from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import {
    formatFileSize, MAX_FILE_SIZE_LABEL, uploadFile, downloadBlob, buildOutputFilename,
    formatErrorForClipboard, postFormData,
} from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useFormPersist } from "@/hooks/useFormPersist";

const WATERMARK_DEFAULTS = {
    mode: "text" as "text" | "image",
    text: "CONFIDENTIAL",
    opacity: 0.3,
    fontSize: 40,
    imageScale: 0.25,
    position: "center" as "center" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "diagonal" | "tile",
};

const positions = [
    { id: "center",       label: "Center" },
    { id: "top",          label: "Top" },
    { id: "bottom",       label: "Bottom" },
    { id: "top-left",     label: "Top Left" },
    { id: "top-right",    label: "Top Right" },
    { id: "bottom-left",  label: "Bottom Left" },
    { id: "bottom-right", label: "Bottom Right" },
    { id: "diagonal",     label: "Diagonal" },
    { id: "tile",         label: "Tile" },
] as const;

type WatermarkMode = "text" | "image";
type Status = "queued" | "running" | "done" | "failed";
interface PdfEntry {
    id: string;
    file: File;
    status: Status;
    error?: string;
    blob?: Blob;
}
let entryCounter = 0;

export function WatermarkUI() {
    const [files, setFiles] = useState<PdfEntry[]>([]);
    const [config, setConfig, { restored, reset: resetConfig }] = useFormPersist("watermark", WATERMARK_DEFAULTS);
    const { mode, text, opacity, fontSize, imageScale, position } = config;
    const setMode = (v: WatermarkMode) => setConfig(c => ({ ...c, mode: v }));
    const setText = (v: string) => setConfig(c => ({ ...c, text: v }));
    const setOpacity = (v: number) => setConfig(c => ({ ...c, opacity: v }));
    const setFontSize = (v: number) => setConfig(c => ({ ...c, fontSize: v }));
    const setImageScale = (v: number) => setConfig(c => ({ ...c, imageScale: v }));
    const setPosition = (v: typeof config.position) => setConfig(c => ({ ...c, position: v }));
    const [watermarkImage, setWatermarkImage] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [errorObj, setErrorObj] = useState<unknown>(null);
    const [drag, setDrag] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const watermarkInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (restored) toast.message("Restored previous settings", { description: "Picked up where you left off.", duration: 3000 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const copyErrorToClipboard = useCallback(() => {
        const blob = formatErrorForClipboard(errorObj ?? error, "Watermark PDF");
        navigator.clipboard?.writeText(blob).then(() => {
            toast.success("Error details copied", { duration: 2000 });
        }).catch(() => toast.error("Couldn't access clipboard"));
    }, [errorObj, error]);

    const addFiles = (fl: FileList) => {
        const next: PdfEntry[] = Array.from(fl)
            .filter(f => f.name.toLowerCase().endsWith(".pdf"))
            .map(f => ({ id: `${Date.now().toString(36)}-${++entryCounter}`, file: f, status: "queued" as Status }));
        if (!next.length) return;
        setFiles(prev => [...prev, ...next]);
        setState("idle");
        setError(null);
    };

    const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
    const clearAll = () => { setFiles([]); setError(null); };

    const pickWatermarkImage = (fl: FileList) => {
        const f = fl[0];
        if (!f) return;
        setWatermarkImage({ name: f.name, size: formatFileSize(f.size), raw: f });
        setError(null);
    };

    const totalSize = files.reduce((s, f) => s + f.file.size, 0);
    const doneFiles = files.filter(f => f.status === "done");
    const failedFiles = files.filter(f => f.status === "failed");
    const hasInput = files.length > 0
        && (mode === "text" ? text.trim().length > 0 : !!watermarkImage);
    const canProcess = hasInput && state !== "processing";

    /** Process one entry. Returns the resulting blob or throws. */
    const runOne = useCallback(async (file: File): Promise<Blob> => {
        if (mode === "text") {
            const res = await uploadFile("/watermark", file, {
                text: text.trim(), opacity, position, font_size: fontSize,
            });
            return res.blob();
        }
        // Image mode: backend takes a second file field, so use the shared
        // FormData helper instead of uploadFile's single-file wrapper.
        const res = await postFormData("/watermark", () => {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("files", file);
            fd.append("opacity", String(opacity));
            fd.append("position", position);
            if (watermarkImage) {
                fd.append("watermark_image", watermarkImage.raw);
                fd.append("image_scale", String(imageScale));
            }
            return fd;
        }, { timeoutMs: 300_000 });
        return res.blob();
    }, [mode, text, opacity, position, fontSize, watermarkImage, imageScale]);

    /** Drive the queue. If retryOnly, only re-runs failed entries. */
    const runQueue = useCallback(async (retryOnly = false) => {
        // Reset the targeted entries to "queued".
        const ids = files
            .filter(f => retryOnly ? f.status === "failed" : (f.status === "queued" || f.status === "failed"))
            .map(f => f.id);
        if (!ids.length) return;
        setFiles(prev => prev.map(f => ids.includes(f.id) ? { ...f, status: "queued", error: undefined } : f));
        setState("processing");
        setError(null);

        const concurrency = 3;
        let cursor = 0;
        const targetIds = [...ids];

        // Latest snapshot lookup — state is async so we use a local map.
        const fileMap = new Map(files.map(f => [f.id, f.file]));

        const worker = async () => {
            while (cursor < targetIds.length) {
                const idx = cursor++;
                const id = targetIds[idx];
                const f = fileMap.get(id);
                if (!f) continue;
                setFiles(prev => prev.map(x => x.id === id ? { ...x, status: "running" } : x));
                try {
                    const blob = await runOne(f);
                    setFiles(prev => prev.map(x => x.id === id ? { ...x, status: "done", blob } : x));
                } catch (e: unknown) {
                    const raw = e instanceof Error ? e.message : "Watermark failed";
                    setFiles(prev => prev.map(x => x.id === id ? { ...x, status: "failed", error: friendlyError(raw, "Watermark failed") } : x));
                    setErrorObj(e);
                }
            }
        };

        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, targetIds.length); i++) workers.push(worker());
        await Promise.all(workers);
        setState("done");
    }, [files, runOne]);

    /** Build a zip from successful entries and download it. */
    const downloadResults = useCallback(async () => {
        if (doneFiles.length === 0) return;
        if (doneFiles.length === 1 && !failedFiles.length) {
            const e = doneFiles[0];
            downloadBlob(e.blob!, buildOutputFilename(e.file.name, "watermarked", "pdf"));
            return;
        }
        const items = await Promise.all(doneFiles.map(async e => ({
            name: buildOutputFilename(e.file.name, "watermarked", "pdf"),
            data: new Uint8Array(await e.blob!.arrayBuffer()),
        })));
        const zip = buildZip(items);
        downloadBlob(zip, "archive_watermarked.zip");
    }, [doneFiles, failedFiles.length]);

    // On first transition to "done" with any successes, kick off the download.
    const justDownloadedRef = useRef(false);
    useEffect(() => {
        if (state !== "done" || justDownloadedRef.current) return;
        if (doneFiles.length > 0) {
            justDownloadedRef.current = true;
            void downloadResults();
        }
    }, [state, doneFiles.length, downloadResults]);

    // Cmd+Enter to submit.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void runQueue(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, runQueue]);

    if (state === "done") {
        const isMulti = files.length > 1;
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks accent />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Watermark added</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{doneFiles.length}</span> file{doneFiles.length === 1 ? "" : "s"} watermarked{failedFiles.length > 0 ? <> · <span className="text-destructive italic">{failedFiles.length} failed</span></> : null}</>
                                    : <><span className="italic text-accent">Watermarked</span> PDF downloaded.</>}
                            </h2>
                            {isMulti && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    <span className="text-accent">§</span> {doneFiles.length > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {doneFiles.length > 0 && (
                                    <button onClick={downloadResults} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download {doneFiles.length > 1 ? "ZIP" : "again"}
                                    </button>
                                )}
                                {failedFiles.length > 0 && (
                                    <button
                                        onClick={() => { justDownloadedRef.current = false; void runQueue(true); }}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
                                    >
                                        Retry {failedFiles.length} failed
                                    </button>
                                )}
                                <button
                                    onClick={() => { setFiles([]); setWatermarkImage(null); setState("idle"); justDownloadedRef.current = false; }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Watermark more
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Dropzone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDFs"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden"
                    onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15",
                )}>
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {files.length ? "Add more PDFs" : "Select PDFs to watermark"}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                    Drag &amp; drop · multi-file OK · max {MAX_FILE_SIZE_LABEL} each
                </p>
            </div>

            {files.length > 0 && (
                <>
                    {/* File queue */}
                    <FileQueueList
                        files={files}
                        onRemove={removeFile}
                        onClearAll={clearAll}
                        busy={state === "processing"}
                    />

                    {/* Settings + preview */}
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                                <span className="text-accent">§</span> Settings
                            </div>
                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Watermark type</label>
                                    <div role="tablist" aria-label="Watermark type" className="inline-flex rounded-md border border-border bg-paper-2/40 p-0.5 mt-1.5 ml-3">
                                        {(["text", "image"] as const).map((m) => {
                                            const active = mode === m;
                                            return (
                                                <button
                                                    key={m}
                                                    role="tab"
                                                    aria-selected={active}
                                                    onClick={() => setMode(m)}
                                                    className={cn(
                                                        "inline-flex items-center h-7 px-3 text-[12.5px] font-medium rounded transition-colors",
                                                        active ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground",
                                                    )}
                                                >
                                                    {m === "text" ? "Text" : "Image"}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {mode === "text" ? (
                                    <>
                                        <div>
                                            <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Watermark text</label>
                                            <input
                                                value={text}
                                                onChange={(e) => setText(e.target.value)}
                                                placeholder="e.g. CONFIDENTIAL"
                                                aria-label="Watermark text"
                                                className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Font size</label>
                                                <span className="font-mono text-[12px] text-accent tabular-nums">{fontSize}px</span>
                                            </div>
                                            <input
                                                type="range" min={8} max={200} value={fontSize}
                                                onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                                                aria-label="Watermark font size"
                                                className="w-full h-2 accent-[hsl(var(--accent))] touch-manipulation"
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div>
                                        <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Watermark image</label>
                                        <input
                                            ref={watermarkInputRef}
                                            type="file"
                                            accept=".png,.jpg,.jpeg,.webp"
                                            className="hidden"
                                            onChange={(e) => { if (e.target.files) pickWatermarkImage(e.target.files); e.target.value = ""; }}
                                        />
                                        <button
                                            type="button"
                                            className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-left text-[13px] text-foreground hover:bg-paper-2/30 transition-colors"
                                            onClick={() => watermarkInputRef.current?.click()}
                                        >
                                            {watermarkImage
                                                ? <><span className="text-foreground font-medium">{watermarkImage.name}</span> <span className="font-mono text-[10.5px] text-muted-foreground">({watermarkImage.size})</span></>
                                                : "Choose PNG/JPG/WebP file…"}
                                        </button>
                                        <div className="mt-3">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Scale</label>
                                                <span className="font-mono text-[12px] text-accent tabular-nums">{Math.round(imageScale * 100)}%</span>
                                            </div>
                                            <input
                                                type="range" min={5} max={100} value={Math.round(imageScale * 100)}
                                                onChange={(e) => setImageScale(parseInt(e.target.value, 10) / 100)}
                                                aria-label="Watermark image scale percent"
                                                className="w-full h-2 accent-[hsl(var(--accent))] touch-manipulation"
                                            />
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Opacity</label>
                                        <span className="font-mono text-[12px] text-accent tabular-nums">{Math.round(opacity * 100)}%</span>
                                    </div>
                                    <input
                                        type="range" min={0} max={100} value={Math.round(opacity * 100)}
                                        onChange={(e) => setOpacity(parseInt(e.target.value, 10) / 100)}
                                        aria-label="Watermark opacity percent"
                                        className="w-full h-2 accent-[hsl(var(--accent))] touch-manipulation"
                                    />
                                </div>

                                <div>
                                    <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Position</label>
                                    <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                                        {positions.map((p) => {
                                            const active = position === p.id;
                                            return (
                                                <button
                                                    key={p.id}
                                                    onClick={() => setPosition(p.id)}
                                                    aria-pressed={active}
                                                    aria-label={`Watermark position ${p.label}`}
                                                    className={cn(
                                                        "min-h-[40px] rounded-md border py-1.5 px-2 text-[11px] font-medium transition-colors",
                                                        active ? "border-accent bg-accent/[0.06] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-paper-2/30",
                                                    )}
                                                >
                                                    {p.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Preview pane */}
                        <PreviewPane mode={mode} text={text} fontSize={fontSize} opacity={opacity} position={position} hasImage={!!watermarkImage} />
                    </div>

                    {error && (
                        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0 mt-0.5" />
                            <span className="flex-1">{error}</span>
                            <button
                                type="button"
                                onClick={copyErrorToClipboard}
                                className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase text-destructive/80 hover:text-destructive transition-colors px-1.5 h-6 rounded hover:bg-destructive/10 shrink-0"
                                aria-label="Copy error details to clipboard"
                                title="Copy error details for a bug report"
                            >
                                <Copy size={10} /> Copy error
                            </button>
                        </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={() => runQueue(false)}
                            disabled={!canProcess}
                            className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {state === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Watermarking…</>
                                : <><Droplets size={13} /> Watermark {files.length > 1 ? `${files.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        {mode === "image" && !watermarkImage && (
                            <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground flex items-center gap-1">
                                <ImageIcon size={11} /> Pick a PNG/JPG/WebP first
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={resetConfig}
                            className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground hover:text-foreground transition-colors"
                            title="Restore default settings"
                        >
                            <Undo2 size={10} /> Reset to defaults
                        </button>
                    </div>

                    {state === "processing" && (
                        <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground/85">
                            <span className="text-accent">§</span> {files.filter(f => f.status === "done").length} of {files.length} done
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

/** Render the per-file queue. Lives inline because it shares state shape with this UI. */
function FileQueueList({
    files, onRemove, onClearAll, busy,
}: {
    files: PdfEntry[];
    onRemove: (id: string) => void;
    onClearAll: () => void;
    busy: boolean;
}) {
    const totalSize = files.reduce((s, f) => s + f.file.size, 0);
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
                <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span className="text-accent">§</span> {files.length} file{files.length === 1 ? "" : "s"} · {formatFileSize(totalSize)}
                </span>
                {!busy && (
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground hover:text-destructive transition-colors"
                    >
                        Clear all
                    </button>
                )}
            </div>
            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                {files.map((f, i) => (
                    <div
                        key={f.id}
                        className={cn(
                            "group flex items-center gap-3 px-3 py-2.5",
                            f.status === "failed" && "bg-destructive/[0.04]",
                        )}
                    >
                        <span className="font-mono text-[10.5px] tracking-wider text-muted-foreground/85 shrink-0 w-6 text-center">
                            {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="h-8 w-8 rounded-md bg-accent/10 border border-accent/25 flex items-center justify-center shrink-0">
                            <FileText size={14} className="text-accent" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-foreground">{f.file.name}</p>
                            <p className="font-mono text-[10.5px] tracking-wide text-muted-foreground mt-0.5 truncate">
                                {formatFileSize(f.file.size)}
                                {f.status === "failed" && f.error && <> · <span className="text-destructive">{f.error}</span></>}
                            </p>
                        </div>
                        <StatusBadge status={f.status} />
                        <button
                            type="button"
                            onClick={() => onRemove(f.id)}
                            disabled={busy}
                            aria-label={`Remove ${f.file.name}`}
                            className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 transition-colors"
                        >
                            <X size={13} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: Status }) {
    if (status === "queued") return <span className="font-mono text-[9.5px] tracking-[0.08em] uppercase text-muted-foreground/85">Queued</span>;
    if (status === "running") return <span className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] uppercase text-accent"><Loader2 size={10} className="animate-spin" /> Running</span>;
    if (status === "done") return <span className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] uppercase text-accent"><CheckCircle2 size={10} /> Done</span>;
    return <span className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] uppercase text-destructive"><AlertCircle size={10} /> Failed</span>;
}

/** Mini visual preview pane — approximates the watermark on a stylised page. */
function PreviewPane({
    mode, text, fontSize, opacity, position, hasImage,
}: {
    mode: WatermarkMode; text: string; fontSize: number; opacity: number;
    position: (typeof positions)[number]["id"]; hasImage: boolean;
}) {
    const wmStyle: React.CSSProperties = (() => {
        const map: Record<string, React.CSSProperties> = {
            "center":       { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
            "top":          { top: "8%",  left: "50%", transform: "translateX(-50%)" },
            "bottom":       { bottom: "8%", left: "50%", transform: "translateX(-50%)" },
            "top-left":     { top: "8%",  left: "8%" },
            "top-right":    { top: "8%",  right: "8%" },
            "bottom-left":  { bottom: "8%", left: "8%" },
            "bottom-right": { bottom: "8%", right: "8%" },
            "diagonal":     { top: "50%", left: "50%", transform: "translate(-50%, -50%) rotate(-30deg)" },
            "tile":         { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
        };
        return map[position] || map.center;
    })();

    const sampleText = text.trim() || "TEXT";
    const fontPx = Math.max(10, Math.round((fontSize / 40) * 14));

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                <span className="text-accent">§</span> Preview
            </div>
            <div className="p-3 flex items-center justify-center bg-paper-2/30">
                <div className="relative aspect-[3/4] w-full max-w-[180px] bg-paper border border-border rounded-md shadow-sm overflow-hidden">
                    <div className="absolute inset-3 space-y-1 opacity-30 pointer-events-none">
                        {Array.from({ length: 14 }).map((_, i) => (
                            <span key={i} className="block h-px bg-foreground" style={{ width: `${50 + ((i * 13) % 50)}%` }} />
                        ))}
                    </div>
                    {position === "tile" ? (
                        <div className="absolute inset-0 grid grid-cols-2 grid-rows-3 gap-1 place-items-center" style={{ opacity }}>
                            {Array.from({ length: 6 }).map((_, i) => (
                                <span key={i} className="font-mono font-bold text-accent" style={{ fontSize: Math.max(8, fontPx - 4) }}>
                                    {mode === "image" && hasImage ? "IMG" : sampleText}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <span
                            className="absolute font-mono font-bold text-accent select-none"
                            style={{ ...wmStyle, opacity, fontSize: fontPx, whiteSpace: "nowrap" }}
                        >
                            {mode === "image" && hasImage ? "IMG" : sampleText}
                        </span>
                    )}
                </div>
            </div>
            <p className="px-3 pb-2 font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground/85 text-center">approximate placement</p>
        </div>
    );
}

function CornerMarks({ accent }: { accent?: boolean } = {}) {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    const color = accent ? "bg-accent" : "bg-accent/70";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className={`absolute top-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className={`absolute top-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 right-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className={`absolute bottom-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className={`absolute bottom-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 right-0 w-px h-3 ${color}`} />
            </span>
        </>
    );
}
