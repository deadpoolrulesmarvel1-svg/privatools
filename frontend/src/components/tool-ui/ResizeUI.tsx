/**
 * ResizeUI — resize one or many PDFs to a standard or custom page size.
 * Multi-file via useMultiFileProcessor — same target size applied to all.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, Maximize2, Download, RotateCcw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const sizes = [
    { id: "a4",     label: "A4",     dims: "210 × 297 mm" },
    { id: "letter", label: "Letter", dims: "8.5 × 11 in"  },
    { id: "a3",     label: "A3",     dims: "297 × 420 mm" },
    { id: "legal",  label: "Legal",  dims: "8.5 × 14 in"  },
    { id: "custom", label: "Custom", dims: "any size"      },
];

const RESIZE_DEFAULTS = {
    pageSize: "a4",
    width: 595,
    height: 842,
};

export function ResizeUI() {
    const [config, , { setField }] = useToolDefaults("resize-pdf", RESIZE_DEFAULTS);
    const { pageSize, width, height } = config;
    const setPageSize = useCallback((v: React.SetStateAction<typeof RESIZE_DEFAULTS["pageSize"]>) => setField("pageSize", v), [setField]);
    const setWidth = useCallback((v: React.SetStateAction<typeof RESIZE_DEFAULTS["width"]>) => setField("width", v), [setField]);
    const setHeight = useCallback((v: React.SetStateAction<typeof RESIZE_DEFAULTS["height"]>) => setField("height", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const customValid = pageSize !== "custom" || (width >= 72 && height >= 72 && width <= 14400 && height <= 14400);
    const canProcess = proc.entries.length > 0 && customValid && phase !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        const params: Record<string, string | number> = { page_size: pageSize };
        if (pageSize === "custom") { params.width = width; params.height = height; }
        await proc.run({
            endpoint: "/resize",
            outputSuffix: "resized",
            outputExt: "pdf",
            params,
        }, retry);
        setPhase("done");
    }, [proc, pageSize, width, height]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_resized");
        }
    }, [phase, proc]);

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

    if (phase === "done") {
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
                            <p className="section-mark mb-2">Resized</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} resized{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <>Resized to <span className="italic text-accent">{pageSize.toUpperCase()}</span></>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    <span className="text-accent">§</span> {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_resized")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                <button onClick={() => { proc.reset(); setPhase("idle"); downloadedRef.current = false; }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                    <RotateCcw size={12} /> Resize more
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
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Maximize2 size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Select PDFs to resize"}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                    A4 · Letter · A3 · Legal · Custom · max {MAX_FILE_SIZE_LABEL} each
                </p>
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
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Page size
                        </div>
                        <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                            {sizes.map(s => {
                                const active = pageSize === s.id;
                                return (
                                    <button
                                        key={s.id}
                                        onClick={() => setPageSize(s.id)}
                                        className={cn(
                                            "rounded-lg border p-3 text-left transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40",
                                        )}
                                    >
                                        <p className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">{s.label}</p>
                                        <p className="font-mono text-[10.5px] tracking-wider text-muted-foreground mt-0.5">{s.dims}</p>
                                    </button>
                                );
                            })}
                        </div>
                        {pageSize === "custom" && (
                            <div className="border-t border-border bg-paper-2/30 p-4 animate-fade-in">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Width (pt)</label>
                                        <input
                                            type="number" inputMode="numeric" value={width} min={72} max={14400}
                                            onChange={e => setWidth(Math.min(14400, Math.max(72, parseInt(e.target.value) || 595)))}
                                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Height (pt)</label>
                                        <input
                                            type="number" inputMode="numeric" value={height} min={72} max={14400}
                                            onChange={e => setHeight(Math.min(14400, Math.max(72, parseInt(e.target.value) || 842)))}
                                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                        />
                                    </div>
                                </div>
                                <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-2">
                                    <span className="text-accent">§</span> Min 72 pt (1 inch) · Max 14400 pt (200 in)
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <button type="button" onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Resizing… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Download size={13} /> Resize {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        {pageSize === "custom" && !customValid && (
                            <span className="font-mono text-[10.5px] tracking-[0.04em] uppercase text-muted-foreground/85 inline-flex items-center gap-1">
                                <AlertCircle size={11} /> Width/height out of range
                            </span>
                        )}
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
