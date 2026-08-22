/**
 * PdfToImageUI — rasterize each PDF page to JPEG/PNG at chosen DPI.
 *
 * The backend returns a ZIP per PDF containing the page images. For N=1 we
 * download that ZIP directly. For N>1 we wrap the per-file ZIPs inside one
 * outer archive (nested ZIPs, but at STORE compression so unzip is fast).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
    Loader2, RotateCcw, Download, Image as ImageIcon, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL, formatFileSize } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type Fmt = "jpeg" | "png";
const formats: { id: Fmt; label: string; desc: string }[] = [
    { id: "jpeg", label: "JPEG", desc: "Smaller · lossy" },
    { id: "png",  label: "PNG",  desc: "Lossless · larger" },
];
const dpiOptions = [72, 150, 300];

// Rough output zip-size estimator (per file).
function estimateOutputSize(srcBytes: number, fmt: Fmt, dpi: number): number {
    const dpiScale = (dpi / 150) ** 2;
    const fmtScale = fmt === "png" ? 3.0 : 0.9;
    return Math.round(srcBytes * dpiScale * fmtScale);
}

const PDF_TO_IMAGE_DEFAULTS: { format: Fmt; dpi: number } = {
    format: "jpeg",
    dpi: 150,
};

export function PdfToImageUI() {
    const [config, , { setField }] = useToolDefaults("pdf-to-image", PDF_TO_IMAGE_DEFAULTS);
    const { format, dpi } = config;
    const setFormat = useCallback((v: React.SetStateAction<typeof PDF_TO_IMAGE_DEFAULTS["format"]>) => setField("format", v), [setField]);
    const setDpi = useCallback((v: React.SetStateAction<typeof PDF_TO_IMAGE_DEFAULTS["dpi"]>) => setField("dpi", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    const totalBytes = proc.entries.reduce((s, e) => s + e.size, 0);
    const estTotal = totalBytes ? estimateOutputSize(totalBytes, format, dpi) : 0;

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/pdf-to-image",
            outputSuffix: "images",
            outputExt: "zip",
            params: { format, dpi },
        }, retry);
        setPhase("done");
    }, [proc, format, dpi]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_images");
        }
    }, [phase, proc]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (phase === "done") {
        const isMulti = proc.entries.length > 1;
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <ImageIcon size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Rasterized</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} → <span className="italic text-accent">{format.toUpperCase()}</span> @ {dpi} dpi{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">{format.toUpperCase()}</span> @ {dpi} dpi</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "Outer ZIP with per-PDF ZIPs inside" : "ZIP downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_images")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download {proc.doneCount > 1 ? "outer ZIP" : ".zip"}
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
                                    <RotateCcw size={12} /> Convert more
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
                onClick={() => fileRef.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDFs"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <ImageIcon size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Drop PDFs to rasterize"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Each page → image · zipped output · max {MAX_FILE_SIZE_LABEL} each
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
                            Output format
                        </div>
                        <div className="p-3 grid grid-cols-2 gap-2">
                            {formats.map(f => {
                                const active = format === f.id;
                                return (
                                    <button key={f.id} onClick={() => setFormat(f.id)}
                                        className={cn("rounded-lg border p-3 text-left transition-colors", active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40")}>
                                        <p className={cn("font-display text-[14px] font-semibold tracking-[-0.015em]", active ? "text-accent" : "text-foreground")}>{f.label}</p>
                                        <p className="font-medium text-[11px] text-muted-foreground/85 mt-0.5">{f.desc}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Resolution</span>
                            <span className="text-accent">{dpi} dpi</span>
                        </div>
                        <div className="p-3 grid grid-cols-3 gap-2">
                            {dpiOptions.map(d => {
                                const active = dpi === d;
                                return (
                                    <button key={d} onClick={() => setDpi(d)}
                                        className={cn("font-medium rounded-lg border py-2.5 text-[12px] transition-colors", active ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40")}>
                                        {d} dpi
                                    </button>
                                );
                            })}
                        </div>
                        <p className="font-medium px-4 pb-3 text-[11px] text-muted-foreground/85 flex items-center justify-between">
                            <span>{dpi <= 72 ? "Screen · fast" : dpi <= 150 ? "Balanced" : "Print · larger files"}</span>
                            {totalBytes > 0 && <span className="text-muted-foreground/70">Est. ~ {formatFileSize(estTotal)} total</span>}
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Rasterizing… ({proc.doneCount}/{proc.entries.length})</>
                                : <><ImageIcon size={13} /> Convert {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : `to ${format.toUpperCase()}`}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
