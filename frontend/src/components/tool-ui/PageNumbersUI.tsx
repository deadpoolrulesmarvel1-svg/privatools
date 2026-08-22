/**
 * PageNumbersUI — stamp visible page numbers on every page of one or many PDFs.
 * Multi-file via useMultiFileProcessor.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertCircle, ListOrdered, RotateCcw, Upload, Download, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { MultiFileQueue } from "./MultiFileQueue";

const PAGE_NUMBERS_DEFAULTS = {
    position: "bottom-center",
    startNumber: 1,
    fontSize: 12,
};

const positions = [
    { id: "top-left",      row: 0, col: 0 },
    { id: "top-center",    row: 0, col: 1 },
    { id: "top-right",     row: 0, col: 2 },
    { id: "bottom-left",   row: 1, col: 0 },
    { id: "bottom-center", row: 1, col: 1 },
    { id: "bottom-right",  row: 1, col: 2 },
];

export function PageNumbersUI() {
    const proc = useMultiFileProcessor();
    const [config, setConfig, { restored, reset: resetConfig }] = useToolDefaults("page-numbers", PAGE_NUMBERS_DEFAULTS);
    const { position, startNumber, fontSize } = config;
    const setPosition = (v: string) => setConfig(c => ({ ...c, position: v }));
    const setStartNumber = (v: number) => setConfig(c => ({ ...c, startNumber: v }));
    const setFontSize = (v: number) => setConfig(c => ({ ...c, fontSize: v }));
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (restored) toast.message("Restored previous settings", { description: "Picked up where you left off.", duration: 3000 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const canProcess = proc.entries.length > 0 && phase !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/page-numbers",
            outputSuffix: "numbered",
            outputExt: "pdf",
            params: { position, start_number: startNumber, font_size: fontSize },
        }, retry);
        setPhase("done");
    }, [proc, position, startNumber, fontSize]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_numbered");
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
                            <p className="section-mark mb-2">Page numbers added</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} numbered{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <>Numbered from <span className="italic text-accent">{startNumber}</span></>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_numbered")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                    <RotateCcw size={12} /> Number more
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
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <ListOrdered size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Select PDFs to number"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Multi-file OK · same settings applied to all · max {MAX_FILE_SIZE_LABEL} each
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
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Number position
                        </div>
                        <div className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-5 items-center">
                            <div className="relative aspect-[3/4] bg-paper-2/40 border border-border rounded-md mx-auto w-full max-w-[200px]">
                                {positions.map(p => {
                                    const active = position === p.id;
                                    const dy = p.row === 0 ? "top-2" : "bottom-2";
                                    const dx = p.col === 0 ? "left-2" : p.col === 1 ? "left-1/2 -translate-x-1/2" : "right-2";
                                    return (
                                        <button
                                            key={p.id}
                                            onClick={() => setPosition(p.id)}
                                            className={cn(
                                                "absolute h-7 min-w-[34px] px-1.5 rounded border font-mono tracking-tight text-[11px] flex items-center justify-center transition-colors",
                                                dy, dx,
                                                active ? "border-accent bg-accent/15 text-accent font-semibold" : "border-border bg-card text-muted-foreground hover:border-accent/55 hover:text-foreground",
                                            )}
                                        >
                                            {startNumber}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <label className="font-medium text-[11px] text-muted-foreground">Start number</label>
                                    <input
                                        type="number" inputMode="numeric" value={startNumber}
                                        onChange={e => setStartNumber(Math.max(1, Math.min(99999, parseInt(e.target.value) || 1)))} min={1} max={99999}
                                        className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                    />
                                </div>
                                <div>
                                    <div className="flex items-center justify-between">
                                        <label className="font-medium text-[11px] text-muted-foreground">Font size</label>
                                        <span className="font-mono text-[11px] text-accent">{fontSize} pt</span>
                                    </div>
                                    <input
                                        type="range" min={6} max={48} step={1} value={fontSize}
                                        onChange={e => setFontSize(parseInt(e.target.value))}
                                        aria-label={`Page-number font size: ${fontSize} points`}
                                        className="mt-2 w-full accent-accent"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button type="button" onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Numbering… ({proc.doneCount}/{proc.entries.length})</>
                                : <><ListOrdered size={13} /> Number {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        <button
                            type="button"
                            onClick={resetConfig}
                            className="font-medium ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            title="Restore default settings"
                        >
                            <Undo2 size={10} /> Reset to defaults
                        </button>
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
