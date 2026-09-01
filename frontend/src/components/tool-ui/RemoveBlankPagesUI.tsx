/**
 * RemoveBlankPagesUI — auto-detect and drop blank pages.
 * Workshop: file upload + sensitivity slider with live label.
 * Multi-file via useMultiFileProcessor — the same sensitivity is applied to every PDF.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, FileX2, CheckCircle2, RotateCcw, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const REMOVE_BLANK_PAGES_DEFAULTS: { sensitivity: number } = {
    sensitivity: 85,
};

export function RemoveBlankPagesUI() {
    const [config, , { setField }] = useToolDefaults("remove-blank-pages", REMOVE_BLANK_PAGES_DEFAULTS);
    const { sensitivity } = config;
    const setSensitivity = useCallback((v: React.SetStateAction<typeof REMOVE_BLANK_PAGES_DEFAULTS["sensitivity"]>) => setField("sensitivity", v), [setField]);
    const proc = useMultiFileProcessor();

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && status !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setStatus("processing");
        await proc.run({
            endpoint: "/remove-blank-pages",
            outputSuffix: "cleaned",
            outputExt: "pdf",
            params: { sensitivity },
        }, retry);
        setStatus("done");
    }, [proc, sensitivity]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (status === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_cleaned");
        }
    }, [status, proc]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (status === "done") {
        const isMulti = proc.entries.length > 1;
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Blanks removed</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} cleaned{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">Cleaned</span> PDF downloaded</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-medium mt-2 text-[12px] text-muted-foreground">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_cleaned")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}
                                    </button>
                                )}
                                {proc.failedCount > 0 && (
                                    <button
                                        onClick={() => { downloadedRef.current = false; void process(true); }}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
                                    >
                                        Retry {proc.failedCount} failed
                                    </button>
                                )}
                                <button
                                    onClick={() => { proc.reset(); setStatus("idle"); downloadedRef.current = false; }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Clean another
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
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isPdfOnly); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDFs"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files?.length) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <FileX2 size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Drop PDFs to clean"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Auto-detects and removes empty pages · several files become a ZIP
                </p>
            </div>

            {proc.entries.length > 0 && (
                <MultiFileQueue
                    entries={proc.entries}
                    reorderable={false}
                    onRemove={proc.removeFile}
                    onReorder={proc.reorder}
                    onClearAll={proc.clearAll}
                    onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                    busy={status === "processing"}
                />
            )}

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Detection sensitivity</span>
                    <span className="text-accent">{sensitivity}%</span>
                </div>
                <div className="p-4 space-y-3">
                    <input
                        type="range"
                        min={50}
                        max={100}
                        step={5}
                        value={sensitivity}
                        onChange={e => setSensitivity(parseInt(e.target.value, 10))}
                        className="w-full accent-accent"
                        aria-label="Blank-page detection sensitivity"
                    />
                    <div className="font-medium flex justify-between text-[11px] text-muted-foreground">
                        <span>50 — strict (only truly blank)</span>
                        <span>100 — loose (drops faint scans)</span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={() => process(false)}
                    disabled={!canProcess}
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {status === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Scanning… ({proc.doneCount}/{proc.entries.length})</>
                        : <><FileX2 size={13} /> Remove blank pages{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</>}
                </button>
                {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
            </div>
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
