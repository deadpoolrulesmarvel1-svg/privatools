/**
 * GenericUI — the default tool surface used by ~80 tools.
 *
 * Workshop aesthetic: hairline-dashed drop target with corner registration
 * marks, mono labels, Fraunces success state, signal-green accents.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle, Clock, ArrowRight, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import {
    buildOutputFilename,
    downloadBlob,
    formatErrorForClipboard,
    formatFileSize,
    isAbortError,
    MAX_FILE_SIZE,
    MAX_FILE_SIZE_LABEL,
    uploadFileWithProgress,
    type ProgressCallback,
} from "@/lib/api";
import { getFilenameFromContentDisposition, getToolEndpoint } from "@/lib/tool-endpoints";
import { getFileSizeWarning, estimateTime } from "@/hooks/useUxHelpers";
import { useElapsed } from "@/hooks/useElapsed";
import { ProcessingBar } from "./FileUploadZone";

interface GenericUIProps {
    toolName: string;
    outputLabel: string;
    accepts: string;
    actionLabel?: string;
    slug: string;
    apiEndpoint?: string;
    params?: Record<string, string | number | boolean>;
}

export function GenericUI({
    toolName, outputLabel, accepts, actionLabel, slug, apiEndpoint, params,
}: GenericUIProps) {
    const [files, setFiles] = useState<{ id: string; name: string; size: string; file: File }[]>([]);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [lastError, setLastError] = useState<unknown>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [resultFilename, setResultFilename] = useState<string | null>(null);
    const [progress, setProgress] = useState<number | undefined>(undefined);
    const [progressLabel, setProgressLabel] = useState("Processing...");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    // Elapsed-time read-out for the disabled "Processing…" button. Gives
    // users a confirmation that work's still in flight on slow operations
    // (PDF OCR, video transcode) where the spinner alone can feel frozen.
    const elapsed = useElapsed(state === "processing");

    const acceptsLabel = accepts && accepts !== "*" ? accepts.split(",").map(v => v.trim()).filter(Boolean).join(", ") : "Any file";

    const resetResult = () => {
        setResultBlob(null);
        setResultFilename(null);
        setProgress(undefined);
        setProgressLabel("Processing...");
    };

    const add = (fl: FileList) => {
        const selected = fl[0];
        if (!selected) return;
        resetResult();
        setError(null);
        setLastError(null);
        if (selected.size > MAX_FILE_SIZE) {
            setFiles([]);
            setState("idle");
            setError(`"${selected.name}" is ${formatFileSize(selected.size)}. The maximum is ${MAX_FILE_SIZE_LABEL}.`);
            return;
        }
        setFiles([{
            id: Math.random().toString(36).slice(2),
            name: selected.name,
            size: formatFileSize(selected.size),
            file: selected,
        }]);
        setState("idle");
    };

    const sizeWarning = files.length > 0 ? getFileSizeWarning(files[0].file.size) : null;
    const timeEstimate = files.length > 0 ? estimateTime(files[0].file.size) : null;
    const canProcess = files.length > 0 && state !== "processing";

    const processRef = useRef<() => void>();
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                processRef.current?.();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const getPlannedOutputFilename = useCallback(() => {
        if (!files.length) return outputLabel;
        const outDot = outputLabel.lastIndexOf(".");
        const labelStem = outDot > 0 ? outputLabel.substring(0, outDot) : "";
        const ext = outDot > 0 ? outputLabel.substring(outDot + 1) : "pdf";
        const GENERIC_TYPES = new Set([
            "image", "audio", "video", "document", "converted",
            "output", "result", "file",
        ]);
        const suffix = labelStem && !GENERIC_TYPES.has(labelStem.toLowerCase()) ? labelStem : null;
        return buildOutputFilename(files[0].name, suffix, ext);
    }, [files, outputLabel]);
    const getOutputFilename = () => resultFilename || getPlannedOutputFilename();

    const onProgress = useCallback<ProgressCallback>((phase, pct) => {
        if (phase === "upload") {
            setProgress(Math.min(98, Math.max(0, pct * 0.65)));
            setProgressLabel("Uploading file");
        } else {
            setProgress(Math.min(100, Math.max(66, 66 + pct * 0.34)));
            setProgressLabel("Preparing download");
        }
    }, []);

    const process = useCallback(async () => {
        if (!files.length) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setState("processing");
        setError(null);
        setLastError(null);
        setProgress(undefined);
        setProgressLabel("Starting...");
        try {
            const endpoint = apiEndpoint || getToolEndpoint(slug);
            const res = await uploadFileWithProgress(endpoint, files[0].file, params, onProgress, controller.signal);
            setProgressLabel("Reading result");
            setProgress(96);
            const blob = await res.blob();
            if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
            const finalName = getFilenameFromContentDisposition(res.headers.get("Content-Disposition")) || getPlannedOutputFilename();
            setResultBlob(blob);
            setResultFilename(finalName);
            setProgress(100);
            setState("done");
            downloadBlob(blob, finalName);
        } catch (e: unknown) {
            if (isAbortError(e)) {
                setState("idle");
                setProgress(undefined);
                setProgressLabel("Processing...");
                return;
            }
            const msg = e instanceof Error ? e.message : "Processing failed";
            setError(friendlyError(msg, "Processing failed"));
            setLastError(e);
            setState("idle");
            setProgress(undefined);
            setProgressLabel("Processing...");
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [files, apiEndpoint, slug, params, onProgress, getPlannedOutputFilename]);
    processRef.current = process;

    const handleDownload = () => { if (resultBlob) downloadBlob(resultBlob, getOutputFilename()); };
    const cancelProcessing = () => abortRef.current?.abort();
    const clearFile = () => {
        setFiles([]);
        setError(null);
        setLastError(null);
        resetResult();
    };

    const stepIndex = state === "idle" ? (files.length > 0 ? 1 : 0) : state === "processing" ? 1 : 2;

    // ── Success state ────────────────────────────────────────────────
    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks accent />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Pipeline complete</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            Done — file <span className="italic text-accent">downloaded</span>.
                        </h2>
                        <p className="mt-2 font-mono text-[11px] tracking-[0.06em] uppercase text-muted-foreground truncate">
                            {getOutputFilename()}
                        </p>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={handleDownload} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-opacity">
                                <Download size={13} /> Download again
                            </button>
                            <button
                                onClick={() => { clearFile(); setState("idle"); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Process another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    // ── Main UI ──────────────────────────────────────────────────────
    return (
        <div className="space-y-5">
            {/* Upload zone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        ref.current?.click();
                    }
                }}
                role="button"
                tabIndex={0}
                aria-label={`Upload file for ${toolName}`}
                className={cn(
                    "relative cursor-pointer rounded-2xl border-2 border-dashed transition-colors px-6 py-12 sm:py-14 text-center overflow-hidden group",
                    drag
                        ? "border-accent bg-accent/[0.06]"
                        : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />

                {/* Subtle grid */}
                <div
                    aria-hidden="true"
                    className="absolute inset-0 pointer-events-none opacity-[0.40]"
                    style={{
                        backgroundImage: "radial-gradient(circle at 1px 1px, hsl(var(--foreground) / 0.05) 1px, transparent 0)",
                        backgroundSize: "22px 22px",
                        maskImage: "radial-gradient(ellipse 60% 60% at 50% 50%, black 40%, transparent 80%)",
                        WebkitMaskImage: "radial-gradient(ellipse 60% 60% at 50% 50%, black 40%, transparent 80%)",
                    }}
                />

                <input ref={ref} type="file" accept={accepts} className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />

                <div className="relative">
                    <div className={cn(
                        "h-14 w-14 rounded-2xl mx-auto mb-4 flex items-center justify-center transition-all duration-200",
                        drag
                            ? "bg-accent/20 border border-accent/45 scale-105"
                            : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                    )}>
                        <Upload size={22} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[20px] font-semibold text-foreground tracking-[-0.02em] mb-1.5">
                        {drag ? "Drop it" : "Click to select or drop a file"}
                    </p>
                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                        Accepts {acceptsLabel} · Max {MAX_FILE_SIZE_LABEL}
                    </p>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3 text-[13px] text-destructive animate-fade-in">
                    <AlertCircle size={14} className="shrink-0 mt-px" />
                    <div className="flex-1 min-w-0">
                        <p className="font-medium">Something went wrong</p>
                        <p className="text-[12px] opacity-80 mt-0.5 break-words font-mono">{error}</p>
                        <div className="mt-2 flex items-center gap-3">
                            <button onClick={process} disabled={!canProcess} className="font-mono text-[11px] tracking-wider uppercase text-destructive hover:underline disabled:opacity-50">
                                Try again
                            </button>
                            <button
                                onClick={() => navigator.clipboard.writeText(formatErrorForClipboard(lastError || error, `${toolName} (${slug})`)).catch(() => {})}
                                className="font-mono text-[11px] tracking-wider uppercase text-destructive/80 hover:underline"
                            >
                                Copy report
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* After file selected */}
            {files.length > 0 && (
                <div className="space-y-4">
                    <StepTimeline stepIndex={stepIndex} processing={state === "processing"} />

                    {sizeWarning && (
                        <div className="flex items-center gap-2 rounded-lg border border-copper/30 bg-copper-soft/40 px-3 py-2 text-[12.5px] text-foreground">
                            <AlertCircle size={12} className="text-copper shrink-0" />
                            {sizeWarning}
                        </div>
                    )}

                    {/* File card */}
                    {files.map(f => (
                        <div
                            key={f.id}
                            className={cn(
                                "flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
                                state === "processing" ? "border-accent/40 bg-accent/[0.04]" : "border-border bg-card"
                            )}
                        >
                            <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                                <FileText size={16} className="text-accent" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[14px] font-medium text-foreground truncate">{f.name}</p>
                                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">{f.size}</p>
                            </div>
                            {state !== "processing" && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); clearFile(); }}
                                    className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                                    aria-label="Remove file"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    ))}

                    {/* Processing progress */}
                    {state === "processing" && (
                        <div className="rounded-xl border border-accent/30 bg-accent/[0.05] px-4 py-3">
                            <ProcessingBar progress={progress} label={`${progressLabel}: ${files[0].name}`} />
                        </div>
                    )}

                    {/* Action row */}
                    {state !== "processing" ? (
                        <div className="flex items-center gap-3 flex-wrap">
                            <button
                                onClick={process}
                                disabled={!canProcess}
                                className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {actionLabel || toolName}
                                <ArrowRight size={13} />
                            </button>
                            <button
                                onClick={clearFile}
                                className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                            >
                                Clear
                            </button>
                            <span className="ml-auto flex items-center gap-3 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground/85">
                                {timeEstimate && <span className="flex items-center gap-1"><Clock size={10} /> {timeEstimate}</span>}
                                <kbd className="hidden sm:inline-flex items-center gap-0.5 bg-secondary border border-border rounded px-1.5 py-0.5 text-[10px]">⌘ ↵</kbd>
                            </span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 flex-wrap">
                            <button disabled className="btn-accent opacity-70 cursor-wait">
                                <Loader2 size={13} className="animate-spin" />
                                Processing<span className="hidden sm:inline">...</span>
                                <span className="font-mono tabular-nums text-[12px] ml-1 opacity-90">{elapsed}</span>
                            </button>
                            <button
                                onClick={cancelProcessing}
                                className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Step timeline — three labelled dots: 01 Upload → 02 Process → 03 Download
function StepTimeline({ stepIndex, processing }: { stepIndex: number; processing: boolean }) {
    const steps = [
        { num: "01", label: "Upload" },
        { num: "02", label: "Process" },
        { num: "03", label: "Download" },
    ];
    return (
        <div className="flex items-center justify-center gap-1 mb-2">
            {steps.map((step, i) => {
                const isDone = i < stepIndex;
                const isCurrent = i === stepIndex;
                const isProcessing = isCurrent && processing;
                return (
                    <div key={step.num} className="flex items-center">
                        <div className="flex flex-col items-center gap-1.5">
                            <div className={cn(
                                "h-8 w-8 rounded-lg font-mono text-[11px] font-semibold flex items-center justify-center transition-colors",
                                isDone
                                    ? "bg-accent text-accent-foreground"
                                    : isCurrent
                                        ? "bg-accent/15 text-accent ring-2 ring-accent/30"
                                        : "bg-secondary text-muted-foreground border border-border"
                            )}>
                                {isProcessing ? <Loader2 size={13} className="animate-spin" /> : isDone ? <CheckCircle2 size={13} strokeWidth={2.4} /> : step.num}
                            </div>
                            <span className={cn(
                                "font-mono text-[9.5px] tracking-[0.08em] uppercase",
                                isDone || isCurrent ? "text-foreground" : "text-muted-foreground/85"
                            )}>
                                {step.label}
                            </span>
                        </div>
                        {i < 2 && (
                            <div className="w-10 sm:w-16 h-px mx-2 mb-5 bg-border relative">
                                <div className={cn(
                                    "absolute inset-0 transition-all duration-500",
                                    isDone ? "bg-accent" : "bg-transparent"
                                )} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function CornerMarks({ accent }: { accent?: boolean }) {
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
