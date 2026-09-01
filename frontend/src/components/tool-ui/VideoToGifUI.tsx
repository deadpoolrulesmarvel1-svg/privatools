/**
 * VideoToGifUI — convert video to GIF with FPS + width controls.
 * Multi-file via useMultiFileProcessor (same FPS/width applied to every video).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CheckCircle2, RotateCcw, Film, Download } from "lucide-react";
import { downloadBlob, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { FileUploadZone } from "./FileUploadZone";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
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
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Rough GIF size estimate. GIF is hard to predict but a reasonable rule of
    // thumb is bytes ≈ pixels-per-frame * frames * 0.3 (palette + LZW saves a
    // lot but we want to be conservative). We don't know the duration without
    // probing the video so we cap at "per second" with a heuristic note.
    const estimate = useMemo(() => {
        if (proc.entries.length === 0) return null;
        const height = Math.round(width * 9 / 16); // assume 16:9 — best we can do without metadata
        const pxPerFrame = width * height;
        const bytesPerSec = pxPerFrame * fps * 0.3;
        const mbPerSec = bytesPerSec / (1024 * 1024);
        return mbPerSec;
    }, [proc.entries.length, fps, width]);

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/video-to-gif",
            outputSuffix: null,
            outputExt: "gif",
            params: { fps, width },
        }, retry);
        setPhase("done");
    }, [proc, fps, width]);

    // The backend answers with a generic `output.gif` name; the old UI named
    // downloads after the source file (`stem.gif`). Keep that: build names
    // client-side. N=1 → direct blob, N>1 → zip.
    const downloadResults = useCallback(() => {
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, buildOutputFilename(done[0].name, null, "gif"));
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: buildOutputFilename(e.name, null, "gif"),
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), "archive_gif.zip");
        })();
    }, [proc.entries]);

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
                            <p className="section-mark mb-2">{proc.doneCount === 1 ? "GIF rendered" : "GIFs rendered"}</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> GIF{proc.doneCount === 1 ? "" : "s"} at {fps} fps · {width} px{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">{fps} fps</span> · {width} px wide</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "File downloaded"}
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
                                    <RotateCcw size={12} /> Convert another
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
            <FileUploadZone
                file={null}
                multiple
                onFilesSelect={files => proc.addFiles(files)}
                onFileSelect={f => proc.addFiles([f])}
                onClear={proc.clearAll}
                accept=".mp4,.webm,.avi,.mov"
                label={proc.entries.length ? "Add more files" : "Drop video to convert"}
                hint="MP4 · WebM · AVI · MOV"
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
                                <div className="font-medium flex justify-between text-[9.5px] text-muted-foreground mt-1">
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
                                <div className="font-medium flex justify-between text-[9.5px] text-muted-foreground mt-1">
                                    <span>Tiny</span>
                                    <span>HD</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Rendering… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Film size={13} /> Convert to GIF{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</>}
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
