/**
 * VideoToGifUI — convert video to GIF with FPS + width controls.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Film } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const VIDEO_TO_GIF_DEFAULTS: { fps: number; width: number } = {
    fps: 10,
    width: 480,
};

export function VideoToGifUI() {
    const [config, , { setField }] = useToolDefaults("video-to-gif", VIDEO_TO_GIF_DEFAULTS);
    const { fps, width } = config;
    const setFps = useCallback((v: React.SetStateAction<typeof VIDEO_TO_GIF_DEFAULTS["fps"]>) => setField("fps", v), [setField]);
    const setWidth = useCallback((v: React.SetStateAction<typeof VIDEO_TO_GIF_DEFAULTS["width"]>) => setField("width", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const canProcess = !!file && status !== "processing";

    // Rough GIF size estimate. GIF is hard to predict but a reasonable rule of
    // thumb is bytes ≈ pixels-per-frame * frames * 0.3 (palette + LZW saves a
    // lot but we want to be conservative). We don't know the duration without
    // probing the video so we cap at "per second" with a heuristic note.
    const estimate = useMemo(() => {
        if (!file) return null;
        const height = Math.round(width * 9 / 16); // assume 16:9 — best we can do without metadata
        const pxPerFrame = width * height;
        const bytesPerSec = pxPerFrame * fps * 0.3;
        const mbPerSec = bytesPerSec / (1024 * 1024);
        return mbPerSec;
    }, [file, fps, width]);

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            await processAndDownload("/video-to-gif", file, buildOutputFilename(file.name, null, "gif"), { fps, width });
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't convert that video."));
            setStatus("idle");
        }
    }, [file, fps, width]);

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
                        <p className="section-mark mb-2">GIF rendered</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{fps} fps</span> · {width} px wide
                        </h2>
                        <button
                            onClick={() => { setFile(null); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Convert another
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept=".mp4,.webm,.avi,.mov"
                label="Drop video to convert"
                hint="MP4 · WebM · AVI · MOV"
            />
            {file && (
                <>
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>GIF settings</span>
                            {estimate !== null && (
                                <span className="text-accent normal-case tracking-normal">≈ {estimate.toFixed(1)} MB/sec of video</span>
                            )}
                        </div>
                        <div className="p-4 grid grid-cols-2 gap-3">
                            <div>
                                <div className="flex items-center justify-between">
                                    <label className="font-medium text-[11px] text-muted-foreground">FPS</label>
                                    <span className="font-mono text-[11px] text-accent">{fps}</span>
                                </div>
                                <input type="range" min={1} max={30} value={fps}
                                    onChange={e => setFps(parseInt(e.target.value))}
                                    aria-label={`Frames per second: ${fps}`}
                                    className="mt-2 w-full accent-accent" />
                                <div className="font-medium flex justify-between text-[9.5px] text-muted-foreground/85 mt-1">
                                    <span>Choppy (1)</span>
                                    <span>Smooth (30)</span>
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center justify-between">
                                    <label className="font-medium text-[11px] text-muted-foreground">Width</label>
                                    <span className="font-mono text-[11px] text-accent">{width} px</span>
                                </div>
                                <input type="range" min={120} max={1280} step={20} value={width}
                                    onChange={e => setWidth(parseInt(e.target.value))}
                                    aria-label={`GIF width: ${width} pixels`}
                                    className="mt-2 w-full accent-accent" />
                                <div className="font-medium flex justify-between text-[9.5px] text-muted-foreground/85 mt-1">
                                    <span>Tiny</span>
                                    <span>HD</span>
                                </div>
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
                            {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Rendering…</> : <><Film size={13} /> Convert to GIF</>}
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
