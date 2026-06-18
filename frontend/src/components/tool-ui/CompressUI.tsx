/**
 * CompressUI — shrink one or many PDFs.
 * Workshop: dropzone, intensity meter, level cards with live estimated savings,
 * Cmd+Enter, corner-marked success state with before/after bars.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle, Minimize2, RotateCcw, Undo2, Copy, Sparkles, Info } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize, processFilesAndDownload, MAX_FILE_SIZE_LABEL, buildOutputFilename, formatErrorForClipboard } from "@/lib/api";
import { useFormPersist } from "@/hooks/useFormPersist";
import { loadSamplePdf } from "@/lib/sample-files";
import { emitToolSuccess } from "@/hooks/useFirstSuccess";
import { consumeFileHandoff } from "@/lib/file-handoff";

type Level = "light" | "recommended" | "extreme" | "custom";
type CompressFile = { id: string; name: string; size: string; bytes: number; raw: File };
let fileId = 0;

const levels: { id: Level; label: string; desc: string; saving: string; intensity: number }[] = [
    { id: "light",       label: "Light",       desc: "Minimal quality loss",                              saving: "~20% smaller", intensity: 25 },
    { id: "recommended", label: "Recommended", desc: "Balanced quality & size",                           saving: "~50% smaller", intensity: 55 },
    { id: "extreme",     label: "Extreme",     desc: "Maximum compression",                               saving: "~75% smaller", intensity: 85 },
    { id: "custom",      label: "Custom",      desc: "Set JPEG quality + max image dimension yourself", saving: "Tunable",      intensity: 65 },
];

// Map level → expected fraction saved (rough; tuned to match server behavior)
const SAVINGS_BY_LEVEL: Record<Exclude<Level, "custom">, number> = {
    light: 0.20,
    recommended: 0.50,
    extreme: 0.75,
};

const COMPRESS_DEFAULTS = {
    level: "recommended" as Level,
    customQuality: 75,
    customMaxDim: 1800,
};

export function CompressUI() {
    const [files, setFiles] = useState<CompressFile[]>([]);
    // Form config persists across refreshes (file picks intentionally don't).
    const [config, setConfig, { restored, reset: resetConfig }] = useFormPersist("compress", COMPRESS_DEFAULTS);
    const { level, customQuality, customMaxDim } = config;
    const setLevel = (v: Level) => setConfig(c => ({ ...c, level: v }));
    const setCustomQuality = (v: number) => setConfig(c => ({ ...c, customQuality: v }));
    const setCustomMaxDim = (v: number) => setConfig(c => ({ ...c, customMaxDim: v }));
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorObj, setErrorObj] = useState<unknown>(null);
    const [retryNote, setRetryNote] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [compressedSize, setCompressedSize] = useState<number>(0);
    const ref = useRef<HTMLInputElement>(null);

    // Show "Restored previous settings" toast once on mount if we loaded non-default values.
    useEffect(() => {
        if (restored) {
            toast.message("Restored previous settings", {
                description: "Picked up where you left off.",
                duration: 3000,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addFiles = useCallback((fl: FileList | File[]) => {
        const arr = Array.from(fl);
        const newFiles: CompressFile[] = arr
            .filter(f => f.name.toLowerCase().endsWith(".pdf"))
            .map(f => ({ id: String(++fileId), name: f.name, size: formatFileSize(f.size), bytes: f.size, raw: f }));
        if (newFiles.length) {
            setFiles(prev => [...prev, ...newFiles]);
            setState("idle");
            setError(null);
        }
    }, []);

    /** Load the bundled sample PDF and pre-fill the dropzone. Used by the
     *  "Try with a sample file" button and by the FirstRunWelcome handoff. */
    const [loadingSample, setLoadingSample] = useState(false);
    const trySample = useCallback(async () => {
        if (loadingSample) return;
        setLoadingSample(true);
        try {
            const file = await loadSamplePdf();
            addFiles([file]);
            toast.message("Sample PDF loaded", { description: "1-page demo — process it like any of your own files.", duration: 2400 });
        } catch (e) {
            console.error(e);
            toast.error("Couldn't load the sample PDF.");
        } finally {
            setLoadingSample(false);
        }
    }, [loadingSample, addFiles]);

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff("compress-pdf").then(file => {
            if (!cancelled && file) addFiles([file]);
        });
        return () => { cancelled = true; };
    }, [addFiles]);

    const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
    const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
    const canProcess = files.length > 0 && state !== "processing";

    // Live estimated output size (front-end heuristic, server may differ)
    const estimatedSavingFraction = level === "custom"
        // Linear: q=15→0.85 saved, q=95→0.10 saved
        ? Math.max(0.1, Math.min(0.85, 1 - (customQuality / 100) * 0.95))
        : SAVINGS_BY_LEVEL[level];
    const estimatedOutputBytes = Math.max(1024, Math.round(totalBytes * (1 - estimatedSavingFraction)));

    const process = useCallback(async () => {
        if (!files.length) return;
        setState("processing");
        setError(null);
        setErrorObj(null);
        setRetryNote(null);
        const onRetry = (attempt: number, total: number) => {
            setRetryNote(`Retrying… (attempt ${attempt} of ${total})`);
        };
        try {
            const params: Record<string, string | number> = { level };
            if (level === "custom") {
                params.jpeg_quality = customQuality;
                params.max_image_dim = customMaxDim;
            }
            if (files.length === 1) {
                const res = await uploadFile("/compress", files[0].raw, params, {
                    onRetry,
                    timeoutMs: 120_000,  // compress on large PDFs can be slow; allow 2min
                });
                const blob = await res.blob();
                const cSize = parseInt(res.headers.get("X-Compressed-Size") || "0") || blob.size;
                setCompressedSize(cSize);
                setResultBlob(blob);
                setState("done");
                emitToolSuccess("Compress PDF");
                const base = files[0].name.replace(/\.pdf$/i, "");
                downloadBlob(blob, `${base}_compressed.pdf`);
            } else {
                await processFilesAndDownload(
                    "/compress",
                    files.map(f => f.raw),
                    buildOutputFilename(files[0]?.name, "compressed", "zip"),
                    params,
                    undefined,
                    undefined,
                    { onRetry, timeoutMs: 180_000 },
                );
                setCompressedSize(0);
                setResultBlob(null);
                setState("done");
                emitToolSuccess("Compress PDF");
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Compression failed";
            setError(friendlyError(msg, "Compression failed."));
            setErrorObj(e);
            setState("idle");
        } finally {
            setRetryNote(null);
        }
    }, [files, level, customQuality, customMaxDim]);

    const copyErrorToClipboard = useCallback(() => {
        const blob = formatErrorForClipboard(errorObj ?? error, "Compress PDF");
        navigator.clipboard?.writeText(blob).then(() => {
            toast.success("Error details copied", { duration: 2000 });
        }).catch(() => {
            toast.error("Couldn't access clipboard");
        });
    }, [errorObj, error]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (state === "done") {
        const savings = files.length === 1 && compressedSize > 0 ? Math.round((1 - compressedSize / totalBytes) * 100) : 0;
        const compressedBarWidth = compressedSize > 0 ? Math.max(5, Math.round((compressedSize / totalBytes) * 100)) : 0;

        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Compressed</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {files.length === 1 && compressedSize > 0 ? (
                                    <>Smaller by <span className="italic text-accent">{savings}%</span></>
                                ) : (
                                    <><span className="italic text-accent">{files.length}</span> PDFs compressed</>
                                )}
                            </h2>

                            {files.length === 1 && compressedSize > 0 && (
                                <div className="mt-4 space-y-2.5 max-w-md">
                                    <div>
                                        <div className="flex items-center justify-between font-mono text-[10.5px] tracking-[0.06em] uppercase mb-1">
                                            <span className="text-muted-foreground">Original</span>
                                            <span className="text-muted-foreground tabular-nums">{files[0].size}</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-paper-2 overflow-hidden">
                                            <div className="h-full rounded-full bg-muted-foreground/60" style={{ width: "100%" }} />
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between font-mono text-[10.5px] tracking-[0.06em] uppercase mb-1">
                                            <span className="text-accent">Compressed</span>
                                            <span className="text-accent tabular-nums font-semibold">{formatFileSize(compressedSize)}</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-paper-2 overflow-hidden">
                                            <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${compressedBarWidth}%` }} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="mt-5 flex flex-wrap gap-2">
                                {resultBlob && (
                                    <button
                                        onClick={() => { const base = files[0].name.replace(/\.pdf$/i, ""); downloadBlob(resultBlob, `${base}_compressed.pdf`); }}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-opacity"
                                    >
                                        <Download size={13} /> Download again
                                    </button>
                                )}
                                <button
                                    onClick={() => { setFiles([]); setState("idle"); setResultBlob(null); }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Compress more
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
            {/* Upload zone */}
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload files"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag
                        ? "border-accent bg-accent/[0.06]"
                        : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                )}>
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {files.length ? "Add more PDFs" : "Select PDFs to compress"}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-1">
                    Drag &amp; drop or click · Multi-file OK · Max {MAX_FILE_SIZE_LABEL} each
                </p>
            </div>

            {/* Try with sample affordance — only shows before any file has been picked
                so the dropzone still leads. Loads /samples/sample.pdf and pre-fills. */}
            {files.length === 0 && (
                <div className="flex items-center justify-center">
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); trySample(); }}
                        disabled={loadingSample}
                        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
                    >
                        {loadingSample ? (
                            <><Loader2 size={11} className="animate-spin" /> Loading sample…</>
                        ) : (
                            <><Sparkles size={11} className="text-accent" /> Try with a sample PDF</>
                        )}
                    </button>
                </div>
            )}

            {files.length > 0 && (
                <>
                    {/* File list */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                        {files.map(f => (
                            <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 border border-accent/25">
                                    <FileText size={14} className="text-accent" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-medium text-foreground truncate">{f.name}</p>
                                    <p className="font-mono text-[10.5px] tracking-wide text-muted-foreground">{f.size}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeFile(f.id)}
                                    className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-destructive/10 transition-colors"
                                    aria-label="Remove file"
                                >
                                    <X size={13} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Level picker */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                                <span className="text-accent">§</span> Compression level
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label="What do these levels do?"
                                            className="inline-flex items-center justify-center h-4 w-4 rounded-full text-muted-foreground/70 hover:text-foreground transition-colors"
                                        >
                                            <Info size={11} aria-hidden="true" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[280px] text-[12px] leading-relaxed font-sans normal-case tracking-normal">
                                        <p><span className="font-semibold">Light</span> downsamples big images modestly — quality is nearly indistinguishable.</p>
                                        <p className="mt-1"><span className="font-semibold">Recommended</span> drops JPEG quality to ~75 and caps dimensions at 1800px — the everyday default.</p>
                                        <p className="mt-1"><span className="font-semibold">Extreme</span> goes aggressive: ~q60 and 1200px max — text stays crisp, large photos get noticeably softer.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </span>
                            <span className="text-accent tabular-nums">
                                {formatFileSize(totalBytes)} → ~{formatFileSize(estimatedOutputBytes)}
                            </span>
                        </div>
                        <div className="p-3 space-y-1.5">
                            {/* Intensity bar */}
                            <div className="h-1.5 rounded-full bg-paper-2 overflow-hidden mb-2">
                                <div
                                    className="h-full rounded-full transition-all duration-500 ease-out bg-accent"
                                    style={{ width: `${Math.round(estimatedSavingFraction * 100)}%` }}
                                />
                            </div>
                            {levels.map((l, idx) => {
                                const active = level === l.id;
                                const estBytes = l.id === "custom"
                                    ? estimatedOutputBytes
                                    : Math.round(totalBytes * (1 - SAVINGS_BY_LEVEL[l.id as Exclude<Level, "custom">]));
                                return (
                                    <button
                                        key={l.id}
                                        type="button"
                                        onClick={() => setLevel(l.id)}
                                        className={cn(
                                            "w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                                            active
                                                ? "border-accent bg-accent/[0.06]"
                                                : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <div className={cn(
                                            "h-4 w-4 rounded-full border flex items-center justify-center shrink-0",
                                            active ? "border-accent bg-accent" : "border-border-strong"
                                        )}>
                                            {active && <div className="h-1.5 w-1.5 rounded-full bg-accent-foreground" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <p className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">
                                                    <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent mr-1.5">{String(idx + 1).padStart(2, "0")}</span>
                                                    {l.label}
                                                </p>
                                                <span className={cn("font-mono text-[11px] tracking-wide tabular-nums", active ? "text-accent font-semibold" : "text-muted-foreground")}>
                                                    {l.id === "custom" ? l.saving : `≈ ${formatFileSize(estBytes)}`}
                                                </span>
                                            </div>
                                            <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">{l.desc}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Custom sliders */}
                        {level === "custom" && (
                            <div className="border-t border-border bg-paper-2/30 p-4 space-y-4 animate-fade-in">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label htmlFor="jpeg-q" className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">JPEG quality</label>
                                        <span className="font-mono text-[11px] text-accent">{customQuality}</span>
                                    </div>
                                    <input
                                        id="jpeg-q"
                                        type="range" min={15} max={95} step={1}
                                        value={customQuality}
                                        onChange={e => setCustomQuality(parseInt(e.target.value, 10))}
                                        className="w-full accent-accent"
                                    />
                                    <div className="flex justify-between font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-1">
                                        <span>15 — tiny, lossy</span>
                                        <span>95 — pristine</span>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label htmlFor="max-dim" className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Max image dimension (px)</label>
                                        <span className="font-mono text-[11px] text-accent">{customMaxDim}</span>
                                    </div>
                                    <input
                                        id="max-dim"
                                        type="range" min={300} max={4000} step={100}
                                        value={customMaxDim}
                                        onChange={e => setCustomMaxDim(parseInt(e.target.value, 10))}
                                        className="w-full accent-accent"
                                    />
                                    <div className="flex justify-between font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-1">
                                        <span>300 — heavily downsampled</span>
                                        <span>4000 — preserve detail</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Retry note — shown only while a retry is scheduled */}
                    {retryNote && state === "processing" && (
                        <div className="flex items-center gap-2 rounded-lg border border-copper/30 bg-copper-soft/30 px-3 py-2 text-[12.5px] text-foreground">
                            <Loader2 size={12} className="animate-spin text-copper" />
                            <span className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-copper">{retryNote}</span>
                        </div>
                    )}

                    {/* Error */}
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

                    {/* Action */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={process}
                            disabled={!canProcess}
                            className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {state === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Compressing…</>
                                : <><Minimize2 size={13} /> Compress {files.length > 1 ? `${files.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        <button
                            type="button"
                            onClick={resetConfig}
                            className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground hover:text-foreground transition-colors"
                            title="Restore default settings"
                        >
                            <Undo2 size={10} /> Reset to defaults
                        </button>
                    </div>
                </>
            )}
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
