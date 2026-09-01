/**
 * BatesRemoveUI — strip Bates stamps back off a production set.
 *
 * The counterpart to BatesUI. Adobe ships this and nobody else free does.
 *
 * Removal is redaction, not an overlay: the point of taking a production
 * number off a document is that it is no longer in the file, so covering it
 * would defeat the exercise. Matching is confined to the page margins and to
 * text shaped like a Bates number, which is why the prefix/suffix hints matter
 * — supplying them turns a shape match into an exact one.
 *
 * Multi-file via useMultiFileProcessor — the same pattern is applied to every
 * PDF; the per-file X-Bates-Removed header is summed for the summary.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, AlertCircle, CheckCircle2, Eraser, RotateCcw, Info, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

export function BatesRemoveUI() {
    const proc = useMultiFileProcessor();
    const [prefix, setPrefix] = useState("");
    const [suffix, setSuffix] = useState("");
    const [digits, setDigits] = useState(6);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && status !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setStatus("processing");
        await proc.run({
            endpoint: "/bates-remove",
            outputSuffix: "bates_removed",
            outputExt: "pdf",
            params: { prefix, suffix, digits },
        }, retry);
        setStatus("done");
    }, [proc, prefix, suffix, digits]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (status === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_bates_removed");
        }
    }, [status, proc]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess && status === "idle") {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, status, process]);

    const restart = () => { proc.reset(); setStatus("idle"); downloadedRef.current = false; };

    if (status === "done") {
        const isMulti = proc.entries.length > 1;
        // Per-file removal counts come back on the X-Bates-Removed header.
        const removed = proc.entries.reduce((sum, e) => {
            if (e.status !== "done") return sum;
            const n = Number(e.headers?.["x-bates-removed"] ?? "0");
            return sum + (Number.isFinite(n) ? n : 0);
        }, 0);
        const nothingMatched = proc.doneCount > 0 && removed === 0;
        return (
            <div className={cn(
                "rounded-2xl border overflow-hidden animate-fade-up",
                nothingMatched ? "border-copper/40 bg-copper-soft/40" : "border-accent/30 bg-accent/[0.05]",
            )}>
                <div className="p-7">
                    <div className="flex items-start gap-5">
                        <div className={cn(
                            "h-14 w-14 rounded-2xl border flex items-center justify-center shrink-0 animate-success-pop",
                            nothingMatched ? "bg-copper/15 border-copper/35" : "bg-accent/15 border-accent/35",
                        )}>
                            {nothingMatched
                                ? <Info size={24} className="text-copper" strokeWidth={1.75} />
                                : <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">{nothingMatched ? "Nothing matched" : "Bates removed"}</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight">
                                {nothingMatched
                                    ? "No Bates numbers found"
                                    : isMulti
                                        ? <><span className="italic text-accent">{removed}</span> stamp{removed === 1 ? "" : "s"} removed across {proc.doneCount} file{proc.doneCount === 1 ? "" : "s"}{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                        : <><span className="italic text-accent">{removed}</span> stamp{removed === 1 ? "" : "s"} removed</>}
                            </h2>
                            <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1.5">
                                {nothingMatched
                                    ? "Nothing in the page margins matched the pattern. Try giving the prefix or suffix the stamps actually use."
                                    : "Redacted, not covered — the text is gone from the file."}
                                {proc.doneCount > 0 && <> {proc.doneCount > 1 ? "ZIP downloaded." : "PDF downloaded."}</>}
                            </p>
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_bates_removed")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                <button onClick={restart} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                    <RotateCcw size={12} /> Remove from another
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
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Eraser size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Drop PDFs to remove Bates numbers"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Only text in the page margins is touched · up to 500 MB each · several files become a ZIP
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
                    What the stamps look like <span className="text-muted-foreground">— optional</span>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                        <label htmlFor="rm-prefix" className="font-medium text-[11px] text-muted-foreground">Prefix</label>
                        <input
                            id="rm-prefix" value={prefix} onChange={e => setPrefix(e.target.value)}
                            placeholder="DOC-" maxLength={32}
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    </div>
                    <div>
                        <label htmlFor="rm-suffix" className="font-medium text-[11px] text-muted-foreground">Suffix</label>
                        <input
                            id="rm-suffix" value={suffix} onChange={e => setSuffix(e.target.value)}
                            placeholder="-CONF" maxLength={32}
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    </div>
                    <div>
                        <label htmlFor="rm-digits" className="font-medium text-[11px] text-muted-foreground">Digits</label>
                        <input
                            id="rm-digits" type="number" inputMode="numeric" value={digits} min={1} max={10}
                            onChange={e => setDigits(Math.max(1, Math.min(10, parseInt(e.target.value) || 6)))}
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    </div>
                </div>
                <p className="px-4 pb-3 text-[12px] text-muted-foreground leading-relaxed">
                    Leave these blank and anything in the margins shaped like a Bates number is
                    removed. Filling them in makes the match exact, which is safer on documents
                    that carry other numbering in the header or footer.
                </p>
            </div>

            <div className="flex items-center gap-3">
                <button onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {status === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Removing… ({proc.doneCount}/{proc.entries.length})</>
                        : <><Eraser size={13} /> Remove Bates numbers{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</>}
                </button>
                {canProcess && status === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
