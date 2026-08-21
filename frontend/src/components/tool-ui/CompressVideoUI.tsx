/**
 * CompressVideoUI — H.264 CRF compression with quality slider.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Video } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { processAndDownload } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const COMPRESS_VIDEO_DEFAULTS: { quality: number } = {
    quality: 28,
};

export function CompressVideoUI() {
    const [config, , { setField }] = useToolDefaults("compress-video", COMPRESS_VIDEO_DEFAULTS);
    const { quality } = config;
    const setQuality = useCallback((v: React.SetStateAction<typeof COMPRESS_VIDEO_DEFAULTS["quality"]>) => setField("quality", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const canProcess = !!file && status !== "processing";

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            await processAndDownload("/compress-video", file, `compressed_${file.name}`, { quality });
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't compress that video."));
            setStatus("idle");
        }
    }, [file, quality]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (status === "done") return (
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
                            CRF <span className="italic text-accent">{quality}</span> applied
                        </h2>
                        <button
                            onClick={() => { setFile(null); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Compress another
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    // Rough CRF→size hint. CRF 28 is the libx264 default; each ±6 ≈ ½×/2× bitrate.
    const sizeHint = (() => {
        if (!file) return null;
        const factor = Math.pow(2, (28 - quality) / 6); // 28 → 1.0
        const estimated = file.size * factor;
        return estimated;
    })();
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
                file={file}
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept=".mp4,.webm,.avi,.mov,.mkv"
                label="Drop video to compress"
                hint="H.264 re-encode · MP4 · WebM · AVI · MOV · MKV"
            />
            {file && (
                <>
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> CRF (constant rate factor)</span>
                            <span className="text-accent normal-case tracking-normal">{qualityLabel}{sizeHint !== null && ` · ≈ ${formatBytes(sizeHint)}`}</span>
                        </div>
                        <div className="p-4">
                            <input type="range" min={18} max={40} step={1} value={quality}
                                onChange={e => setQuality(parseInt(e.target.value))}
                                className="w-full accent-accent"
                                aria-label="Quality" aria-valuetext={`CRF ${quality} — ${qualityLabel}`} />
                            <div className="flex justify-between items-center mt-2">
                                <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground/85">Higher quality (18)</span>
                                <span className="font-mono text-[13px] tabular-nums text-accent">CRF {quality}</span>
                                <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground/85">Smaller file (40)</span>
                            </div>
                        </div>
                    </div>
                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Compressing…</> : <><Video size={13} /> Compress video</>}
                        </button>
                        {canProcess && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
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
