/**
 * SimpleProcessUI — shared workshop UI for any tool that:
 *  - Takes one or many input files (same settings applied to each)
 *  - POSTs each to a single endpoint
 *  - Downloads the result (single file direct, several as a ZIP)
 *
 * Eliminates ~20 boilerplate components. Workshop aesthetic with
 * dropzone, queue rows, success state animations, and error handling.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import {
    Upload, Download, Loader2, CheckCircle2, AlertCircle,
    RotateCcw, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

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
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({ endpoint, params, outputExt, outputSuffix }, retry);
        setPhase("done");
    }, [proc, endpoint, params, outputExt, outputSuffix]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll(`archive_${outputSuffix}`);
        }
    }, [phase, proc, outputSuffix]);

    // Cmd+Enter to submit (works for any SimpleProcessUI-backed tool).
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess && phase === "idle") {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, phase, process]);

    const restart = () => { proc.reset(); setPhase("idle"); downloadedRef.current = false; };

    if (phase === "done") {
        const isMulti = proc.entries.length > 1;
        return (
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
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> of {proc.entries.length} processed{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <span className="italic text-accent">{proc.entries[0]?.outName || `${outputSuffix}.${outputExt}`}</span>}
                            </h2>
                            <p className="font-medium mt-2 text-[12px] text-muted-foreground">
                                {proc.doneCount > 1 ? "ZIP downloaded" : proc.doneCount === 1 ? "Downloaded" : "Nothing succeeded"}
                            </p>
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button
                                        onClick={() => proc.downloadAll(`archive_${outputSuffix}`)}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-opacity"
                                    >
                                        <Download size={13} /> Download again
                                    </button>
                                )}
                                {proc.failedCount > 0 && (
                                    <button
                                        onClick={() => { setPhase("idle"); void process(true); }}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-destructive/40 bg-card text-[13px] font-medium text-destructive hover:bg-destructive/[0.06] transition-colors"
                                    >
                                        <RotateCcw size={12} /> Retry {proc.failedCount} failed
                                    </button>
                                )}
                                <button
                                    onClick={restart}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Process another
                                </button>
                            </div>
                            {proc.failedCount > 0 && (
                                <div className="mt-4 space-y-1.5">
                                    {proc.entries.filter(e => e.status === "failed").map(e => (
                                        <p key={e.id} className="flex items-center gap-2 text-[12px] text-destructive">
                                            <AlertCircle size={12} className="shrink-0" /> {e.name}: {e.error}
                                        </p>
                                    ))}
                                </div>
                            )}
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
                onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload files"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept={accepts} multiple className="hidden" onChange={(e) => { if (e.target.files?.length) proc.addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                )}>
                    <DropIcon size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{proc.entries.length ? "Add more files" : dropTitle}</p>
                <p className="font-medium text-[11.5px] text-muted-foreground">{dropSubtitle} · several files become a ZIP</p>
            </div>

            {/* Queue */}
            {proc.entries.length > 0 && (
                <MultiFileQueue
                    entries={proc.entries}
                    reorderable={false}
                    onRemove={proc.removeFile}
                    onReorder={proc.reorder}
                    onClearAll={() => { proc.clearAll(); setPhase("idle"); }}
                    busy={phase === "processing"}
                />
            )}

            {/* Action */}
            {proc.entries.length > 0 && (
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => void process(false)}
                        disabled={phase === "processing"}
                        className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {phase === "processing"
                            ? <><Loader2 size={13} className="animate-spin" /> {processingLabel}</>
                            : <><Download size={13} /> {actionLabel}{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</>}
                    </button>
                    {phase === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
