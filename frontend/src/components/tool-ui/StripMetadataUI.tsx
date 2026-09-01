/**
 * StripMetadataUI — strip ALL hidden metadata from one or more PDFs.
 * Workshop: signal-green dropzone, batch queue, privacy receipt readout.
 * Multi-file via useMultiFileProcessor — same scrub applied to every file.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, FileText, DatabaseZap, RotateCcw, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFileSize, MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

const STRIPPED = [
    "Author / Creator",
    "Created / Modified dates",
    "GPS coordinates",
    "Software fingerprint",
    "XMP metadata",
];

export function StripMetadataUI() {
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && phase !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/strip-metadata",
            outputSuffix: "stripped",
            outputExt: "pdf",
        }, retry);
        setPhase("done");
    }, [proc]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_stripped");
        }
    }, [phase, proc]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); void process(false); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (phase === "done") {
        const doneEntries = proc.entries.filter(e => e.status === "done");
        return (
            <div className="space-y-4 animate-fade-up">
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                    <div className="relative p-7 sm:p-9 animate-corner-extend">
                        <CornerMarks />
                        <div className="flex items-start gap-5">
                            <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                                <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="section-mark mb-2">Metadata stripped</p>
                                <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                    <span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount !== 1 && "s"} sanitized{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}
                                </h2>
                                {proc.doneCount > 0 && (
                                    <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                        {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                    </p>
                                )}
                                <div className="mt-5 flex flex-wrap gap-2">
                                    {proc.doneCount > 0 && (
                                        <button
                                            onClick={() => proc.downloadAll("archive_stripped")}
                                            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90"
                                        >
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
                                        onClick={() => { proc.reset(); setPhase("idle"); downloadedRef.current = false; }}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                    >
                                        <RotateCcw size={12} /> Strip more
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Per-file receipt — shows what was stripped from each PDF */}
                {doneEntries.length > 0 && (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Privacy receipt</span>
                            <span>{doneEntries.length} file{doneEntries.length !== 1 && "s"}</span>
                        </div>
                        <div className="divide-y divide-border">
                            {doneEntries.map((f, i) => (
                                <div key={f.id} className="px-4 py-3">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="font-mono text-[10px] tracking-wider text-muted-foreground w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                        <FileText size={13} className="text-accent shrink-0" />
                                        <p className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">{f.name}</p>
                                        <span className="font-mono text-[10px] tracking-wider text-muted-foreground shrink-0">{formatFileSize(f.size)}</span>
                                    </div>
                                    <div className="ml-10 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                                        {STRIPPED.map(s => (
                                            <div key={s} className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground">
                                                <CheckCircle2 size={9} className="text-accent shrink-0" /> {s}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
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
                role="button" tabIndex={0} aria-label="Upload PDFs"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <DatabaseZap size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{proc.entries.length ? "Add more files" : "Select PDFs to scrub"}</p>
                <p className="font-medium text-[11.5px] text-muted-foreground">Author · timestamps · GPS · software · XMP · max {MAX_FILE_SIZE_LABEL}</p>
            </div>

            {proc.entries.length > 0 && (
                <>
                    <MultiFileQueue
                        entries={proc.entries}
                        reorderable={false}
                        onRemove={proc.removeFile}
                        onReorder={proc.reorder}
                        onClearAll={proc.clearAll}
                        onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                        busy={phase === "processing"}
                    />

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Will be removed
                        </div>
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                            {STRIPPED.map(s => (
                                <div key={s} className="flex items-center gap-2 text-[12.5px] text-foreground">
                                    <span className="h-1 w-1 rounded-full bg-accent shrink-0" />
                                    {s}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Stripping… ({proc.doneCount}/{proc.entries.length})</>
                                : <><DatabaseZap size={13} /> Strip {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
