/**
 * CompressVideoUI — H.264 CRF compression with quality slider.
 * Multi-file via useMultiFileProcessor (same CRF applied to every video).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, RotateCcw, Video, Download } from "lucide-react";
import { FileUploadZone } from "./FileUploadZone";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const COMPRESS_VIDEO_DEFAULTS: { quality: number } = {
    quality: 28,
};

export function CompressVideoUI() {
    const [config, , { setField }] = useToolDefaults("compress-video", COMPRESS_VIDEO_DEFAULTS);
    const { quality } = config;
    const setQuality = useCallback((v: React.SetStateAction<typeof COMPRESS_VIDEO_DEFAULTS["quality"]>) => setField("quality", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/compress-video",
            outputSuffix: "compressed",
            outputExt: "mp4",
            params: { quality },
        }, retry);
        setPhase("done");
    }, [proc, quality]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_compressed");
        }
    }, [phase, proc]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); void process(false); }
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
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Compressed</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> video{proc.doneCount === 1 ? "" : "s"} compressed{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <>CRF <span className="italic text-accent">{quality}</span> applied</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "File downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_compressed")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                    <RotateCcw size={12} /> Compress another
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Rough CRF→size hint. CRF 28 is the libx264 default; each ±6 ≈ ½×/2× bitrate.
    const totalSize = proc.entries.reduce((s, e) => s + e.size, 0);
    const sizeHint = proc.entries.length > 0
        ? totalSize * Math.pow(2, (28 - quality) / 6) // 28 → 1.0
        : null;
    const formatBytes = (n: number) => {
        if (n < 1024) return `${Math.round(n)} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
        return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const qualityLabel =
        quality <= 22 ? "Visually lossless" :
        quality <= 27 ? "High quality" :
        quality <= 32 ? "Balanced" :
        quality <= 36 ? "Small file" : "Tiny — visible loss";

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={null}
                multiple
                onFilesSelect={files => proc.addFiles(files)}
                onFileSelect={f => proc.addFiles([f])}
                onClear={proc.clearAll}
                accept=".mp4,.webm,.avi,.mov,.mkv"
                label={proc.entries.length ? "Add more files" : "Drop video to compress"}
                hint="H.264 re-encode · MP4 · WebM · AVI · MOV · MKV"
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
                            <span>CRF (constant rate factor)</span>
                            <span className="text-accent normal-case tracking-normal">{qualityLabel}{sizeHint !== null && ` · ≈ ${formatBytes(sizeHint)}`}</span>
                        </div>
                        <div className="p-4">
                            <input type="range" min={18} max={40} step={1} value={quality}
                                onChange={e => setQuality(parseInt(e.target.value))}
                                className="w-full accent-accent"
                                aria-label="Quality" aria-valuetext={`CRF ${quality} — ${qualityLabel}`} />
                            <div className="flex justify-between items-center mt-2">
                                <span className="font-medium text-[11px] text-muted-foreground">Higher quality (18)</span>
                                <span className="font-mono text-[13px] tabular-nums text-accent">CRF {quality}</span>
                                <span className="font-medium text-[11px] text-muted-foreground">Smaller file (40)</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Compressing… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Video size={13} /> Compress video{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</>}
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
