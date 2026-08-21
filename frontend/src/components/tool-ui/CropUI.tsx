/**
 * CropUI — trim margins (top/right/bottom/left) from one or many PDFs in points.
 * Multi-file via useMultiFileProcessor — same margins applied to every input.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, Crop, RotateCcw, Upload, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const MAX_PT = 500;
const clamp = (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 0) return "0";
    if (n > MAX_PT) return String(MAX_PT);
    return String(n);
};

const CROP_DEFAULTS = {
    top: "50",
    bottom: "50",
    left: "30",
    right: "30",
};

export function CropUI() {
    const [config, setConfig] = useToolDefaults("crop-pdf", CROP_DEFAULTS);
    const { top, bottom, left, right } = config;
    const setTop = (v: typeof CROP_DEFAULTS["top"]) => setConfig(c => ({ ...c, top: v }));
    const setBottom = (v: typeof CROP_DEFAULTS["bottom"]) => setConfig(c => ({ ...c, bottom: v }));
    const setLeft = (v: typeof CROP_DEFAULTS["left"]) => setConfig(c => ({ ...c, left: v }));
    const setRight = (v: typeof CROP_DEFAULTS["right"]) => setConfig(c => ({ ...c, right: v }));
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && phase !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/crop",
            outputSuffix: "cropped",
            outputExt: "pdf",
            params: { top, bottom, left, right },
        }, retry);
        setPhase("done");
    }, [proc, top, bottom, left, right]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_cropped");
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
                            <p className="section-mark mb-2">Cropped</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} cropped{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">Margins</span> trimmed</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    <span className="text-accent">§</span> {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_cropped")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                    <RotateCcw size={12} /> Crop more
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
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Crop size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Select PDFs to crop"}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                    Multi-file OK · same margins applied to all · max {MAX_FILE_SIZE_LABEL} each
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
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> Crop margins</span>
                            <span>1 pt = 1/72 inch</span>
                        </div>
                        <div className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5 items-center">
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { label: "Top",    value: top,    set: setTop },
                                    { label: "Bottom", value: bottom, set: setBottom },
                                    { label: "Left",   value: left,   set: setLeft },
                                    { label: "Right",  value: right,  set: setRight },
                                ].map(m => (
                                    <div key={m.label} className="space-y-1">
                                        <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">{m.label}</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                min={0} max={MAX_PT}
                                                value={m.value}
                                                onChange={e => m.set(clamp(e.target.value))}
                                                onBlur={e => m.set(clamp(e.target.value || "0"))}
                                                className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors pr-9"
                                            />
                                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground">pt</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="relative aspect-[3/4] bg-paper-2/40 border border-border rounded-md mx-auto w-full max-w-[180px]">
                                <div
                                    className="absolute border-2 border-accent bg-card transition-all duration-150"
                                    style={{
                                        top: `${Math.min(45, (parseInt(top) || 0) / MAX_PT * 100)}%`,
                                        bottom: `${Math.min(45, (parseInt(bottom) || 0) / MAX_PT * 100)}%`,
                                        left: `${Math.min(45, (parseInt(left) || 0) / MAX_PT * 100)}%`,
                                        right: `${Math.min(45, (parseInt(right) || 0) / MAX_PT * 100)}%`,
                                    }}
                                />
                                <span className="absolute top-1 left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-wider text-accent">crop area</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button type="button" onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Cropping… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Crop size={13} /> Crop {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        <button
                            type="button"
                            onClick={() => { setTop("50"); setBottom("50"); setLeft("30"); setRight("30"); }}
                            className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors px-2 py-1 ml-auto"
                        >
                            Reset to defaults
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
