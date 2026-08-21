/**
 * HeaderFooterUI — drop header/footer text bands onto every page of one or
 * more PDFs. Multi-file processing via useMultiFileProcessor (3-at-a-time,
 * per-file status, retry on failure).
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertCircle, Heading, RotateCcw, Upload, Download, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { MultiFileQueue } from "./MultiFileQueue";

const HEADER_FOOTER_DEFAULTS = {
    headerText: "",
    footerText: "",
    fontSize: 10,
};

export function HeaderFooterUI() {
    const proc = useMultiFileProcessor();
    const [config, setConfig, { restored, reset: resetConfig }] = useToolDefaults("header-footer", HEADER_FOOTER_DEFAULTS);
    const { headerText, footerText, fontSize } = config;
    const setHeaderText = (v: string) => setConfig(c => ({ ...c, headerText: v }));
    const setFooterText = (v: string) => setConfig(c => ({ ...c, footerText: v }));
    const setFontSize = (v: number) => setConfig(c => ({ ...c, fontSize: v }));
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (restored) toast.message("Restored previous settings", { description: "Picked up where you left off.", duration: 3000 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const hasText = headerText.trim().length > 0 || footerText.trim().length > 0;
    const canProcess = proc.entries.length > 0 && hasText && phase !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/header-footer",
            outputSuffix: "header_footer",
            outputExt: "pdf",
            params: { header_text: headerText, footer_text: footerText, font_size: fontSize },
        }, retry);
        setPhase("done");
    }, [proc, headerText, footerText, fontSize]);

    // Auto-download once processing finishes (only the first time).
    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_header_footer");
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
                            <p className="section-mark mb-2">Bands applied</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} stamped{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">Header &amp; footer</span> set</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    <span className="text-accent">§</span> {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_header_footer")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                    <RotateCcw size={12} /> Apply to more
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
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Heading size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Select PDFs for header & footer"}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                    Multi-file OK · same bands applied to all · max {MAX_FILE_SIZE_LABEL} each
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
                            <span className="text-accent">§</span> Text bands
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-5 p-5 items-center">
                            <div className="space-y-3">
                                <div>
                                    <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Header</label>
                                    <input
                                        value={headerText} onChange={e => setHeaderText(e.target.value)}
                                        placeholder="e.g. Company Report 2026"
                                        className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Footer</label>
                                    <input
                                        value={footerText} onChange={e => setFooterText(e.target.value)}
                                        placeholder="e.g. Confidential — page {n}"
                                        className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                    />
                                </div>
                                <div>
                                    <div className="flex items-center justify-between">
                                        <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Font size</label>
                                        <span className="font-mono text-[11px] text-accent">{fontSize} pt</span>
                                    </div>
                                    <input
                                        type="range" min={6} max={32} step={1} value={fontSize}
                                        onChange={e => setFontSize(parseInt(e.target.value))}
                                        aria-label={`Header/footer font size: ${fontSize} points`}
                                        className="mt-2 w-full accent-accent"
                                    />
                                </div>
                            </div>
                            <div className="relative aspect-[3/4] bg-card border border-border rounded-md mx-auto w-full max-w-[180px] overflow-hidden">
                                <div className="absolute inset-x-2 top-2 text-center truncate text-foreground/85" style={{ fontSize: `${Math.max(6, fontSize / 1.6)}px` }}>
                                    {headerText || <span className="text-muted-foreground/40">—</span>}
                                </div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="font-mono text-[8.5px] tracking-wider text-muted-foreground/40">page</span>
                                </div>
                                <div className="absolute inset-x-2 bottom-2 text-center truncate text-foreground/85" style={{ fontSize: `${Math.max(6, fontSize / 1.6)}px` }}>
                                    {footerText || <span className="text-muted-foreground/40">—</span>}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button type="button" onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Applying… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Heading size={13} /> Apply to {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        {!hasText && proc.entries.length > 0 && (
                            <span className="font-mono text-[10.5px] tracking-[0.04em] uppercase text-muted-foreground/85 inline-flex items-center gap-1">
                                <AlertCircle size={11} /> Enter at least one band
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={resetConfig}
                            className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground hover:text-foreground transition-colors"
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
