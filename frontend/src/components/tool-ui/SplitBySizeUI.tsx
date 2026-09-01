/**
 * SplitBySizeUI — chunk a PDF into ZIP parts each capped at a target MB.
 * Workshop: file upload + numeric input with quick presets + Cmd+Enter.
 * Multi-file via useMultiFileProcessor — the same cap is applied to every PDF;
 * each PDF's parts arrive as its own ZIP, and a multi-run wraps those ZIPs in one archive.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, Maximize2, CheckCircle2, RotateCcw, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const PRESETS = [5, 10, 25, 50];

const SPLIT_BY_SIZE_DEFAULTS: { maxSizeMb: number } = {
    maxSizeMb: 10,
};

export function SplitBySizeUI() {
    const [config, , { setField }] = useToolDefaults("split-by-size", SPLIT_BY_SIZE_DEFAULTS);
    const { maxSizeMb } = config;
    const setMaxSizeMb = useCallback((v: React.SetStateAction<typeof SPLIT_BY_SIZE_DEFAULTS["maxSizeMb"]>) => setField("maxSizeMb", v), [setField]);
    const proc = useMultiFileProcessor();

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && maxSizeMb > 0 && status !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        if (maxSizeMb <= 0) return;
        setStatus("processing");
        await proc.run({
            endpoint: "/split-by-size",
            outputSuffix: "split",
            outputExt: "zip",
            params: { max_size_mb: maxSizeMb },
        }, retry);
        setStatus("done");
    }, [proc, maxSizeMb]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (status === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_split");
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
                            <p className="section-mark mb-2">Split complete</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} split into parts up to <span className="italic text-accent">{maxSizeMb} MB</span>{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <>Parts up to <span className="italic text-accent">{maxSizeMb} MB</span></>}
                            </h2>
                            {proc.doneCount > 0 && (
                                <p className="font-medium mt-2 text-[12px] text-muted-foreground">
                                    {proc.doneCount > 1 ? "ZIP downloaded — one inner ZIP of parts per PDF" : "ZIP archive downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_split")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download again
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
                                    <RotateCcw size={12} /> Split another
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
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Maximize2 size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Drop PDFs to split by size"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Creates ZIP parts capped at your max size · one ZIP per PDF
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
                    <span>Max part size</span>
                    <span className="text-accent">{maxSizeMb} MB</span>
                </div>
                <div className="p-4 space-y-3">
                    <div className="relative">
                        <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={1024}
                            value={maxSizeMb}
                            onChange={e => {
                                const n = parseInt(e.target.value || "1", 10);
                                setMaxSizeMb(Math.min(1024, Math.max(1, isNaN(n) ? 1 : n)));
                            }}
                            className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors pr-12"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground tracking-wider">MB</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-[11px] text-muted-foreground">Quick</span>
                        {PRESETS.map(p => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => setMaxSizeMb(p)}
                                className={cn(
                                    "h-7 px-2.5 rounded border font-mono text-[11px] tracking-wide transition-colors",
                                    maxSizeMb === p ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                )}
                            >
                                {p} MB
                            </button>
                        ))}
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
                        ? <><Loader2 size={13} className="animate-spin" /> Splitting… ({proc.doneCount}/{proc.entries.length})</>
                        : <><Maximize2 size={13} /> Split by size{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</>}
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
