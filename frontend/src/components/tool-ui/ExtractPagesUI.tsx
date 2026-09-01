/**
 * ExtractPagesUI — extract specific pages from one or many PDFs into new files.
 *
 * Workshop styled: dropzone, mono range input with syntax hint,
 * accent-themed success state. Multi-file via useMultiFileProcessor —
 * the same range is applied to each PDF.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, Download, CheckCircle2, RotateCcw, Upload } from "lucide-react";
import { cn, isValidPageRange, pageRangeError } from "@/lib/utils";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

export function ExtractPagesUI() {
    const proc = useMultiFileProcessor();
    const [pages, setPages] = useState("1,3-5");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const rangeValid = pages.trim().length > 0 && isValidPageRange(pages);
    const canProcess = proc.entries.length > 0 && rangeValid && status !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        if (!pages.trim()) return;
        setStatus("processing");
        await proc.run({
            endpoint: "/extract-pages",
            outputSuffix: "extracted",
            outputExt: "pdf",
            params: { pages },
        }, retry);
        setStatus("done");
    }, [proc, pages]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (status === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_extracted");
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

    const rangeErr = pageRangeError(pages);

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
                            <p className="section-mark mb-2">Pages extracted</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} extracted{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">{pages}</span> downloaded</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-medium mt-2 text-[12px] text-muted-foreground">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_extracted")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                    onClick={() => { proc.reset(); setStatus("idle"); setPages("1,3-5"); downloadedRef.current = false; }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Extract more
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
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Download size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Drop PDFs to extract pages"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Use range syntax like 1,3-5,9 · several files become a ZIP
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
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Pages to extract
                </div>
                <div className="p-4">
                    <input
                        value={pages}
                        onChange={e => setPages(e.target.value)}
                        placeholder="1,3-5,9"
                        spellCheck={false}
                        aria-invalid={!rangeValid}
                        className={cn(
                            "block w-full rounded-md border bg-card px-3 py-2 font-mono text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 transition-colors",
                            rangeValid
                                ? "border-border focus:border-accent focus:ring-accent/20"
                                : "border-destructive/60 focus:border-destructive focus:ring-destructive/20"
                        )}
                    />
                    {rangeErr ? (
                        <p className="font-medium text-[11px] text-destructive mt-2">{rangeErr}</p>
                    ) : (
                        <p className="font-medium text-[11px] text-muted-foreground mt-2">
                            Syntax — comma-separated · "1-3" = range · "1,3-5,9" = mixed
                            {proc.entries.length > 1 && <> · same pages extracted from every PDF</>}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-3">
                <button type="button" onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {status === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Extracting… ({proc.doneCount}/{proc.entries.length})</>
                        : <><Download size={13} /> Extract pages{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</>}
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
            <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent" /><span className="absolute top-0 left-0 w-px h-3 bg-accent" /></span>
            <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent" /><span className="absolute top-0 right-0 w-px h-3 bg-accent" /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent" /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent" /></span>
        </>
    );
}
