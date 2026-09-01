/**
 * NupUI — combine multiple PDF pages onto each sheet (2-up / 4-up / 6-up / 9-up / 16-up).
 * Workshop: option cards with mini layout previews.
 * Multi-file via useMultiFileProcessor — the same layout is applied to every PDF.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, CheckCircle2, AlertCircle, Layout, RotateCcw, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const opts = [
    { id: 2,  label: "2-up",  cols: 2, rows: 1 },
    { id: 4,  label: "4-up",  cols: 2, rows: 2 },
    { id: 6,  label: "6-up",  cols: 2, rows: 3 },
    { id: 9,  label: "9-up",  cols: 3, rows: 3 },
    { id: 16, label: "16-up", cols: 4, rows: 4 },
];

// Orientation only matters for 2-up: side-by-side (2×1) or stacked (1×2)
type Orient = "horizontal" | "vertical";

const NUP_DEFAULTS: { pps: number; orient: Orient } = {
    pps: 2,
    orient: "horizontal",
};

export function NupUI() {
    const [config, , { setField }] = useToolDefaults("nup", NUP_DEFAULTS);
    const { pps, orient } = config;
    const setPps = useCallback((v: React.SetStateAction<typeof NUP_DEFAULTS["pps"]>) => setField("pps", v), [setField]);
    const setOrient = useCallback((v: React.SetStateAction<typeof NUP_DEFAULTS["orient"]>) => setField("orient", v), [setField]);
    const proc = useMultiFileProcessor();

    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && state !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setState("processing");
        const params: Record<string, string | number> = { pages_per_sheet: pps };
        if (pps === 2) params.orientation = orient;
        await proc.run({
            endpoint: "/nup",
            outputSuffix: "nup",
            outputExt: "pdf",
            params,
        }, retry);
        setState("done");
    }, [proc, pps, orient]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (state === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_nup");
        }
    }, [state, proc]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (state === "done") {
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
                            <p className="section-mark mb-2">Layout created</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} laid out {pps}-up{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">{pps}-up</span> sheets ready</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-medium mt-2 text-[12px] text-muted-foreground">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_nup")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                    onClick={() => { proc.reset(); setState("idle"); downloadedRef.current = false; }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Lay out another
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
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Layout size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Drop PDFs to N-up"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Combine multiple pages per sheet — print-ready · several files become a ZIP
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
                        busy={state === "processing"}
                    />

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Pages per sheet
                        </div>
                        <div className="p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
                            {opts.map(o => {
                                const active = pps === o.id;
                                // For 2-up active, swap rows/cols based on orientation
                                const previewCols = (o.id === 2 && active && orient === "vertical") ? 1 : o.cols;
                                const previewRows = (o.id === 2 && active && orient === "vertical") ? 2 : o.rows;
                                return (
                                    <button
                                        key={o.id}
                                        onClick={() => setPps(o.id)}
                                        aria-label={`${o.label} layout`}
                                        aria-pressed={active}
                                        className={cn(
                                            "rounded-lg border p-3 flex flex-col items-center gap-2 transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        {/* Grid mini-preview */}
                                        <div
                                            className={cn(
                                                "aspect-[3/4] w-12 grid gap-0.5 p-1 rounded-sm border",
                                                active ? "border-accent/60 bg-accent/10" : "border-border bg-paper-2/60"
                                            )}
                                            style={{
                                                gridTemplateColumns: `repeat(${previewCols}, 1fr)`,
                                                gridTemplateRows: `repeat(${previewRows}, 1fr)`,
                                            }}
                                        >
                                            {Array.from({ length: o.id }).map((_, i) => (
                                                <div key={i} className={cn("rounded-[1px]", active ? "bg-accent/55" : "bg-muted-foreground/40")} />
                                            ))}
                                        </div>
                                        <p className={cn(
                                            "font-display text-[13px] font-semibold tracking-[-0.015em]",
                                            active ? "text-accent" : "text-foreground"
                                        )}>{o.label}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Orientation toggle — only meaningful for 2-up */}
                    {pps === 2 && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden animate-fade-in">
                            <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                                2-up orientation
                            </div>
                            <div className="p-3 grid grid-cols-2 gap-2">
                                {([
                                    { id: "horizontal" as Orient, label: "Side-by-side", hint: "2 × 1" },
                                    { id: "vertical"   as Orient, label: "Stacked",     hint: "1 × 2" },
                                ]).map(o => {
                                    const active = orient === o.id;
                                    return (
                                        <button
                                            key={o.id}
                                            onClick={() => setOrient(o.id)}
                                            aria-label={`${o.label} orientation`}
                                            aria-pressed={active}
                                            className={cn(
                                                "rounded-lg border p-3 text-left transition-colors flex items-center gap-3",
                                                active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    "aspect-[3/4] w-8 grid gap-0.5 p-0.5 rounded-sm border shrink-0",
                                                    active ? "border-accent/60 bg-accent/10" : "border-border bg-paper-2/60"
                                                )}
                                                style={{
                                                    gridTemplateColumns: o.id === "horizontal" ? "repeat(2, 1fr)" : "1fr",
                                                    gridTemplateRows: o.id === "horizontal" ? "1fr" : "repeat(2, 1fr)",
                                                }}
                                            >
                                                <div className={cn("rounded-[1px]", active ? "bg-accent/55" : "bg-muted-foreground/40")} />
                                                <div className={cn("rounded-[1px]", active ? "bg-accent/55" : "bg-muted-foreground/40")} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className={cn("font-display text-[13px] font-semibold tracking-[-0.015em]", active ? "text-accent" : "text-foreground")}>{o.label}</p>
                                                <p className="font-medium text-[11px] text-muted-foreground mt-0.5">{o.hint}</p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {state === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Composing… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Layout size={13} /> Create {pps}-up layout{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</>}
                        </button>
                        {state === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
