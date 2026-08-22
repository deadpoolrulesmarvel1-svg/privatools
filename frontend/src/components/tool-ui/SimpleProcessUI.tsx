/**
 * SimpleProcessUI — shared workshop UI for any tool that:
 *  - Takes one input file
 *  - POSTs to a single endpoint
 *  - Downloads the result
 *
 * Eliminates ~20 boilerplate components. Workshop aesthetic with
 * dropzone, file card, success state animations, and error handling.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import {
    Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle,
    RotateCcw, type LucideIcon,
} from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";

interface SimpleProcessUIProps {
    /** API endpoint path (without /api prefix) */
    endpoint: string;
    /** Accept attribute for file input */
    accepts: string;
    /** Suffix for output filename, e.g. "linked" → "input_linked.pdf" */
    outputSuffix: string;
    /** Output extension, e.g. "pdf" */
    outputExt: string;
    /** Headline text in dropzone, e.g. "Add hyperlinks to a PDF" */
    dropTitle: string;
    /** Subline under headline */
    dropSubtitle: string;
    /** Optional icon for dropzone (defaults to Upload) */
    dropIcon?: LucideIcon;
    /** Button label, e.g. "Add hyperlinks" */
    actionLabel: string;
    /** Verb form for processing state, e.g. "Adding hyperlinks…" */
    processingLabel: string;
    /** Done message, e.g. "Hyperlinks added" */
    doneTitle: string;
    /** Optional params sent to endpoint */
    params?: Record<string, string | number | boolean>;
}

export function SimpleProcessUI({
    endpoint, accepts, outputSuffix, outputExt,
    dropTitle, dropSubtitle, dropIcon: DropIcon = Upload,
    actionLabel, processingLabel, doneTitle, params,
}: SimpleProcessUIProps) {
    const [file, setFile] = useState<File | null>(null);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const outputName = file ? buildOutputFilename(file.name, outputSuffix, outputExt) : `${outputSuffix}.${outputExt}`;

    const process = useCallback(async () => {
        if (!file) return;
        setState("processing");
        setError(null);
        try {
            const res = await uploadFile(endpoint, file, params);
            const blob = await res.blob();
            setResultBlob(blob);
            downloadBlob(blob, outputName);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Processing failed";
            setError(friendlyError(msg, "Processing failed"));
            setState("idle");
        }
    }, [file, endpoint, params, outputName]);

    // Cmd+Enter to submit (works for any SimpleProcessUI-backed tool).
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && state === "idle") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file, state, process]);

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks accent />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">{doneTitle}</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{outputName}</span>
                        </h2>
                        <p className="font-medium mt-2 text-[12px] text-muted-foreground">
                            Downloaded · {resultBlob ? formatFileSize(resultBlob.size) : ""}
                        </p>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button
                                onClick={() => resultBlob && downloadBlob(resultBlob, outputName)}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-opacity"
                            >
                                <Download size={13} /> Download again
                            </button>
                            <button
                                onClick={() => { setFile(null); setState("idle"); setResultBlob(null); }}
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

    return (
        <div className="space-y-4">
            {/* Dropzone */}
            {!file ? (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
                    onClick={() => ref.current?.click()}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload file"
                    className={cn(
                        "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                        drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <CornerMarks />
                    <input ref={ref} type="file" accept={accepts} className="hidden" onChange={(e) => { e.target.files?.[0] && setFile(e.target.files[0]); e.target.value = ""; }} />
                    <div className={cn(
                        "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                        drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                    )}>
                        <DropIcon size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{dropTitle}</p>
                    <p className="font-medium text-[11.5px] text-muted-foreground">{dropSubtitle}</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                    <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                        <FileText size={16} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                        <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">{formatFileSize(file.size)}</p>
                    </div>
                    {state !== "processing" && (
                        <button
                            onClick={() => setFile(null)}
                            className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                            aria-label="Remove file"
                        >
                            <X size={13} />
                        </button>
                    )}
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />
                    {error}
                </div>
            )}

            {/* Action */}
            {file && (
                <div className="flex items-center gap-3">
                    <button
                        onClick={process}
                        disabled={state === "processing"}
                        className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {state === "processing"
                            ? <><Loader2 size={13} className="animate-spin" /> {processingLabel}</>
                            : <><Download size={13} /> {actionLabel}</>}
                    </button>
                    {state === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
                </div>
            )}
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
