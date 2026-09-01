/**
 * ImageUpscalerUI — Lanczos upscale at 2× or 4×.
 * Workshop: scale pickers, source preview, signal-green dropzone, estimated
 * processing time based on source megapixels × scale.
 * Multi-file via useMultiFileProcessor — same scale applied to every image.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Scaling, Clock, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const IMAGE_UPSCALER_DEFAULTS: { scale: 2 | 4 } = {
    scale: 2,
};

const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const isImg = (f: File) => IMG_EXTS.some(e => f.name.toLowerCase().endsWith(e));

export function ImageUpscalerUI() {
    const [config, , { setField }] = useToolDefaults("image-upscaler", IMAGE_UPSCALER_DEFAULTS);
    const { scale } = config;
    const setScale = useCallback((v: React.SetStateAction<typeof IMAGE_UPSCALER_DEFAULTS["scale"]>) => setField("scale", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [srcDims, setSrcDims] = useState<{ w: number; h: number } | null>(null);

    // Read natural dims of the first image so we can hint at the output
    // resolution + ETA.
    const firstFile = proc.entries[0]?.file ?? null;
    useEffect(() => {
        if (!firstFile) { setSrcDims(null); return; }
        const url = URL.createObjectURL(firstFile);
        const img = new Image();
        img.onload = () => { setSrcDims({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
        img.onerror = () => URL.revokeObjectURL(url);
        img.src = url;
    }, [firstFile]);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Same naming as the single-file tool: "<stem>_<scale>x.<ext>" keeping each
    // file's own extension (falling back to png for anything unexpected).
    const outNameFor = useCallback((name: string) => {
        const stem = name.replace(/\.[^.]+$/, "");
        const ext = name.split(".").pop()?.toLowerCase() || "png";
        const outExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "png";
        return `${stem}_${scale}x.${outExt}`;
    }, [scale]);

    const downloadResults = useCallback(() => {
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, outNameFor(done[0].name));
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: outNameFor(e.name),
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), "archive_upscaled.zip");
        })();
    }, [proc.entries, outNameFor]);

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/image-upscaler",
            outputSuffix: `${scale}x`,
            outputExt: "png",
            params: { scale },
        }, retry);
        setPhase("done");
    }, [proc, scale]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            downloadResults();
        }
    }, [phase, proc.doneCount, downloadResults]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); void process(false); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    // Very rough ETA: ~0.7s per output megapixel on the Oracle VM Lanczos path.
    const etaFor = (s: 2 | 4) => {
        if (!srcDims) return null;
        const outMp = (srcDims.w * srcDims.h * s * s) / 1_000_000;
        const seconds = Math.max(1, Math.round(outMp * 0.7));
        return seconds < 60 ? `~${seconds}s` : `~${Math.round(seconds / 60)}m`;
    };
    const outDimsFor = (s: 2 | 4) => srcDims ? `${srcDims.w * s}×${srcDims.h * s}` : null;

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
                            <p className="section-mark mb-2">Upscaled</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti || proc.doneCount === 0
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> image{proc.doneCount === 1 ? "" : "s"} upscaled {scale}×{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">{scale}×</span> resolution applied</>}
                            </h2>
                            {proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "Downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={downloadResults} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                    <RotateCcw size={12} /> Upscale another
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
            <FileUploadZone
                file={null}
                multiple
                onFilesSelect={files => proc.addFiles(files, isImg)}
                onFileSelect={f => proc.addFiles([f], isImg)}
                onClear={proc.clearAll}
                accept=".jpg,.jpeg,.png,.webp"
                label={proc.entries.length ? "Add more files" : "Drop images to upscale"}
                hint="Lanczos resampling · max ~25 MP after upscale · several files become a ZIP"
            />

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
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Scale factor</span>
                            {srcDims && <span className="tabular-nums">{srcDims.w}×{srcDims.h} px source{proc.entries.length > 1 ? " · first file" : ""}</span>}
                        </div>
                        <div className="p-3 grid grid-cols-2 gap-2">
                            {([2, 4] as const).map(s => {
                                const active = scale === s;
                                const out = outDimsFor(s);
                                const eta = etaFor(s);
                                return (
                                    <button
                                        key={s}
                                        onClick={() => setScale(s)}
                                        aria-pressed={active}
                                        aria-label={`Upscale ${s} times${out ? ` to ${out} pixels` : ""}${eta ? `, estimated ${eta}` : ""}`}
                                        className={cn(
                                            "min-h-[88px] rounded-lg border p-4 text-left transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <p className={cn("font-display text-[28px] font-bold tracking-[-0.02em]", active ? "text-accent" : "text-foreground")}>{s}×</p>
                                        <p className="font-medium text-[11px] text-muted-foreground mt-1">
                                            {out ?? (s === 2 ? "Larger image · safe default" : "Maximum detail · may need memory")}
                                        </p>
                                        {eta && (
                                            <p className="font-medium mt-1.5 inline-flex items-center gap-1 text-[9.5px] text-accent">
                                                <Clock size={9} /> {eta}
                                            </p>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Upscaling… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Scaling size={13} /> Upscale {proc.entries.length > 1 ? `${proc.entries.length} images ` : ""}{scale}×</>}
                        </button>
                        {canProcess && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
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
