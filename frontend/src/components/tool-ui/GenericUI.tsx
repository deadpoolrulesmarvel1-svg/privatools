/**
 * GenericUI — the default tool surface used by ~80 tools.
 *
 * Workshop aesthetic: hairline-dashed drop target with corner registration
 * marks, mono labels, Fraunces success state, signal-green accents.
 *
 * Multi-file: every tool this surface backs is a per-file transform (the
 * batch page has always run them that way), so the queue accepts many files
 * and processes them sequentially — one upload in flight at a time, per-file
 * results, and a client-side ZIP for "download all". One file behaves
 * exactly as it always has, auto-download included.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle, Clock, ArrowRight, RotateCcw, Archive } from "lucide-react";
import { zipSync } from "fflate";
import { cn, friendlyError } from "@/lib/utils";
import {
    buildOutputFilename,
    chooseDownloadFilename,
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
import { consumeFileHandoff } from "@/lib/file-handoff";
import { ResultHandoff } from "./ResultHandoff";

const MAX_QUEUE = 25;

interface GenericUIProps {
    toolName: string;
    outputLabel: string;
    accepts: string;
    actionLabel?: string;
    slug: string;
    apiEndpoint?: string;
    params?: Record<string, string | number | boolean>;
}

type ItemStatus = "queued" | "processing" | "done" | "error";
interface QueueItem {
    id: string;
    name: string;
    size: string;
    bytes: number;
    file: File;
    status: ItemStatus;
    blob?: Blob | null;
    outName?: string;
    errMsg?: string;
}

export function GenericUI({
    toolName, outputLabel, accepts, actionLabel, slug, apiEndpoint, params,
}: GenericUIProps) {
    const [files, setFiles] = useState<QueueItem[]>([]);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [lastError, setLastError] = useState<unknown>(null);
    const [progress, setProgress] = useState<number | undefined>(undefined);
    const [progressLabel, setProgressLabel] = useState("Processing...");
    const [currentName, setCurrentName] = useState<string>("");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const stopRef = useRef(false);
    const elapsed = useElapsed(state === "processing");

    const acceptsLabel = accepts && accepts !== "*" ? accepts.split(",").map(v => v.trim()).filter(Boolean).join(", ") : "Any file";

    const plannedOutputName = useCallback((inputName: string) => {
        const outDot = outputLabel.lastIndexOf(".");
        const labelStem = outDot > 0 ? outputLabel.substring(0, outDot) : "";
        const ext = outDot > 0 ? outputLabel.substring(outDot + 1) : "pdf";
        const GENERIC_TYPES = new Set([
            "image", "audio", "video", "document", "converted",
            "output", "result", "file",
        ]);
        const suffix = labelStem && !GENERIC_TYPES.has(labelStem.toLowerCase()) ? labelStem : null;
        return buildOutputFilename(inputName, suffix, ext);
    }, [outputLabel]);

    const addFiles = useCallback((incoming: File[]) => {
        setError(null);
        setLastError(null);
        setFiles(prev => {
            const base = prev.filter(p => p.status !== "done" && p.status !== "error").length === prev.length
                ? prev
                : prev; // keep everything; new files join the queue
            const existing = new Set(base.map(f => `${f.name}:${f.bytes}`));
            const next = [...base];
            for (const f of incoming) {
                if (next.length >= MAX_QUEUE) {
                    setError(`Queue is limited to ${MAX_QUEUE} files at a time.`);
                    break;
                }
                if (f.size > MAX_FILE_SIZE) {
                    setError(`"${f.name}" is ${formatFileSize(f.size)}. The maximum is ${MAX_FILE_SIZE_LABEL}.`);
                    continue;
                }
                if (existing.has(`${f.name}:${f.size}`)) continue;
                existing.add(`${f.name}:${f.size}`);
                next.push({
                    id: Math.random().toString(36).slice(2),
                    name: f.name,
                    size: formatFileSize(f.size),
                    bytes: f.size,
                    file: f,
                    status: "queued",
                });
            }
            return next;
        });
        setState("idle");
    }, []);

    const add = useCallback((fl: FileList | File[]) => {
        const selected = Array.from(fl);
        if (selected.length) addFiles(selected);
    }, [addFiles]);

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff(slug).then(file => {
            if (!cancelled && file) addFiles([file]);
        });
        return () => { cancelled = true; };
    }, [slug, addFiles]);

    const biggest = files.reduce((m, f) => Math.max(m, f.bytes), 0);
    const sizeWarning = files.length > 0 ? getFileSizeWarning(biggest) : null;
    const timeEstimate = files.length > 0 ? estimateTime(biggest) : null;
    const queued = files.filter(f => f.status === "queued" || f.status === "error");
    const doneItems = files.filter(f => f.status === "done" && f.blob);
    const canProcess = queued.length > 0 && state !== "processing";

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

    const onProgress = useCallback<ProgressCallback>((phase, pct) => {
        if (phase === "upload") {
            setProgress(Math.min(98, Math.max(0, pct * 0.65)));
            setProgressLabel("Uploading file");
        } else {
            setProgress(Math.min(100, Math.max(66, 66 + pct * 0.34)));
            setProgressLabel("Preparing download");
        }
    }, []);

    const setItem = (id: string, patch: Partial<QueueItem>) =>
        setFiles(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)));

    const process = useCallback(async () => {
        const run = files.filter(f => f.status === "queued" || f.status === "error");
        if (!run.length) return;
        const single = files.length === 1;
        stopRef.current = false;
        setState("processing");
        setError(null);
        setLastError(null);
        const endpoint = apiEndpoint || getToolEndpoint(slug);
        let firstFailure: unknown = null;
        for (let i = 0; i < run.length; i++) {
            if (stopRef.current) break;
            const item = run[i];
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setItem(item.id, { status: "processing", errMsg: undefined });
            setCurrentName(run.length > 1 ? `File ${i + 1} of ${run.length} — ${item.name}` : item.name);
            setProgress(undefined);
            setProgressLabel("Starting...");
            try {
                const res = await uploadFileWithProgress(endpoint, item.file, params, onProgress, controller.signal);
                setProgressLabel("Reading result");
                setProgress(96);
                const blob = await res.blob();
                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const outName = chooseDownloadFilename(
                    plannedOutputName(item.name),
                    getFilenameFromContentDisposition(res.headers.get("Content-Disposition")),
                );
                setItem(item.id, { status: "done", blob, outName });
                if (single) downloadBlob(blob, outName);
            } catch (e: unknown) {
                if (isAbortError(e)) {
                    setItem(item.id, { status: "queued" });
                    stopRef.current = true;
                    break;
                }
                const msg = e instanceof Error ? e.message : "Processing failed";
                setItem(item.id, { status: "error", errMsg: friendlyError(msg, "Processing failed") });
                if (!firstFailure) firstFailure = e;
            } finally {
                if (abortRef.current === controller) abortRef.current = null;
            }
        }
        setProgress(undefined);
        setProgressLabel("Processing...");
        setCurrentName("");
        if (stopRef.current) {
            setState("idle");
            return;
        }
        if (firstFailure && single) {
            const msg = firstFailure instanceof Error ? firstFailure.message : "Processing failed";
            setError(friendlyError(msg, "Processing failed"));
            setLastError(firstFailure);
            setState("idle");
            return;
        }
        setLastError(firstFailure);
        setState("done");
    }, [files, apiEndpoint, slug, params, onProgress, plannedOutputName]);
    processRef.current = process;

    const downloadAllZip = useCallback(async () => {
        const entries: Record<string, Uint8Array> = {};
        const used = new Set<string>();
        for (const item of doneItems) {
            let name = item.outName || plannedOutputName(item.name);
            if (used.has(name)) {
                const dot = name.lastIndexOf(".");
                let n = 2;
                const stem = dot > 0 ? name.slice(0, dot) : name;
                const ext = dot > 0 ? name.slice(dot) : "";
                while (used.has(`${stem} (${n})${ext}`)) n++;
                name = `${stem} (${n})${ext}`;
            }
            used.add(name);
            entries[name] = new Uint8Array(await item.blob!.arrayBuffer());
        }
        const zipped = zipSync(entries, { level: 0 });
        // Uint8Array views are BlobPart-compatible; copy to a plain buffer for TS.
        downloadBlob(new Blob([zipped.slice().buffer], { type: "application/zip" }), `${slug}-results.zip`);
    }, [doneItems, plannedOutputName, slug]);

    const handleDownloadOne = (item: QueueItem) => { if (item.blob) downloadBlob(item.blob, item.outName || plannedOutputName(item.name)); };
    const cancelProcessing = () => { stopRef.current = true; abortRef.current?.abort(); };
    const clearFile = () => {
        setFiles([]);
        setError(null);
        setLastError(null);
        setState("idle");
        setProgress(undefined);
        setProgressLabel("Processing...");
    };
    const removeOne = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

    const stepIndex = state === "idle" ? (files.length > 0 ? 1 : 0) : state === "processing" ? 1 : 2;
    const single = files.length === 1;
    const okCount = doneItems.length;
    const failCount = files.filter(f => f.status === "error").length;

    // ── Success state ────────────────────────────────────────────────
    if (state === "done") {
        const singleItem = single ? files[0] : null;
        return (
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
                                {single
                                    ? <>Done — file <span className="italic text-accent">downloaded</span>.</>
                                    : <>Done — <span className="italic text-accent">{okCount} of {files.length}</span> processed.</>}
                            </h2>
                            {single ? (
                                <p className="font-medium mt-2 text-[12px] text-muted-foreground truncate">
                                    {singleItem?.outName}
                                </p>
                            ) : (
                                <div className="mt-4 space-y-2">
                                    {files.map(item => (
                                        <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                                            {item.status === "done"
                                                ? <CheckCircle2 size={14} className="text-accent shrink-0" />
                                                : <AlertCircle size={14} className="text-destructive shrink-0" />}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[12.5px] font-medium text-foreground truncate">{item.status === "done" ? item.outName : item.name}</p>
                                                {item.status === "error" && <p className="text-[11px] text-destructive truncate">{item.errMsg}</p>}
                                            </div>
                                            {item.status === "done" && (
                                                <button onClick={() => handleDownloadOne(item)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-foreground hover:text-accent transition-colors shrink-0">
                                                    <Download size={11} /> Download
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {single ? (
                                    <button onClick={() => singleItem && handleDownloadOne(singleItem)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-opacity">
                                        <Download size={13} /> Download again
                                    </button>
                                ) : okCount > 1 ? (
                                    <button onClick={downloadAllZip} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-opacity">
                                        <Archive size={13} /> Download all ({okCount}) as .zip
                                    </button>
                                ) : null}
                                <button
                                    onClick={() => { clearFile(); setState("idle"); }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Process another
                                </button>
                                {failCount > 0 && (
                                    <button
                                        onClick={process}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-destructive/40 bg-card text-[13px] font-medium text-destructive hover:bg-destructive/[0.06] transition-colors"
                                    >
                                        <RotateCcw size={12} /> Retry {failCount} failed
                                    </button>
                                )}
                            </div>
                            {single && <ResultHandoff blob={singleItem?.blob ?? null} filename={singleItem?.outName || plannedOutputName(singleItem?.name || "")} fromSlug={slug} />}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

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
                aria-label={`Upload files for ${toolName}`}
                className={cn(
                    "dropzone-surface relative cursor-pointer rounded-2xl border-2 border-dashed transition-colors px-6 py-12 sm:py-14 text-center overflow-hidden group",
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

                <input ref={ref} type="file" multiple accept={accepts} className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />

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
                        {drag ? "Drop them" : files.length ? "Add more files" : "Click to select or drop files"}
                    </p>
                    <p className="font-medium text-[11.5px] text-muted-foreground">
                        Accepts {acceptsLabel} · Max {MAX_FILE_SIZE_LABEL} each · up to {MAX_QUEUE} files
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
                            <button onClick={process} disabled={!canProcess} className="font-medium text-[12px] tracking-wider text-destructive hover:underline disabled:opacity-50">
                                Try again
                            </button>
                            <button
                                onClick={() => navigator.clipboard.writeText(formatErrorForClipboard(lastError || error, `${toolName} (${slug})`)).catch(() => {})}
                                className="font-medium text-[12px] tracking-wider text-destructive hover:underline"
                            >
                                Copy report
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* After files selected */}
            {files.length > 0 && (
                <div className="space-y-4">
                    <StepTimeline stepIndex={stepIndex} processing={state === "processing"} />

                    {sizeWarning && (
                        <div className="flex items-center gap-2 rounded-lg border border-copper/30 bg-copper-soft/40 px-3 py-2 text-[12.5px] text-foreground">
                            <AlertCircle size={12} className="text-copper shrink-0" />
                            {sizeWarning}
                        </div>
                    )}

                    {/* File cards */}
                    {files.map(f => (
                        <div
                            key={f.id}
                            className={cn(
                                "flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
                                f.status === "processing" ? "border-accent/40 bg-accent/[0.04]"
                                    : f.status === "error" ? "border-destructive/40 bg-destructive/[0.04]"
                                        : "border-border bg-card"
                            )}
                        >
                            <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                                {f.status === "processing"
                                    ? <Loader2 size={16} className="text-accent animate-spin" />
                                    : f.status === "done"
                                        ? <CheckCircle2 size={16} className="text-accent" />
                                        : <FileText size={16} className="text-accent" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[14px] font-medium text-foreground truncate">{f.name}</p>
                                <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">
                                    {f.status === "error" ? <span className="text-destructive">{f.errMsg}</span> : f.size}
                                </p>
                            </div>
                            {f.status === "done" && (
                                <button onClick={() => handleDownloadOne(f)} className="text-[11.5px] font-semibold text-foreground hover:text-accent transition-colors shrink-0">
                                    <Download size={12} />
                                </button>
                            )}
                            {state !== "processing" && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); removeOne(f.id); }}
                                    className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                                    aria-label={`Remove ${f.name}`}
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    ))}

                    {/* Processing progress */}
                    {state === "processing" && (
                        <div className="rounded-xl border border-accent/30 bg-accent/[0.05] px-4 py-3">
                            <ProcessingBar progress={progress} label={`${progressLabel}: ${currentName}`} />
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
                                {actionLabel || toolName}{queued.length > 1 ? ` — ${queued.length} files` : ""}
                                <ArrowRight size={13} />
                            </button>
                            <button
                                onClick={clearFile}
                                className="font-medium text-[12px] tracking-wider text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                            >
                                Clear
                            </button>
                            <span className="font-medium ml-auto flex items-center gap-3 text-[11.5px] text-muted-foreground">
                                {timeEstimate && <span className="flex items-center gap-1"><Clock size={10} /> {timeEstimate}{files.length > 1 ? " / file" : ""}</span>}
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
                                className="font-medium text-[12px] tracking-wider text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
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
                                "font-medium text-[9.5px]",
                                isDone || isCurrent ? "text-foreground" : "text-muted-foreground"
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
