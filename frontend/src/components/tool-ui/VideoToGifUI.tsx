import { MediaBatchStudio, MediaField, MediaChoices, MediaRange, MediaPreview, MediaBusy } from "./media/MediaStudio";
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

    const process = useCallback(async (retry: boolean | "transient" = false) => {
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

    return <MediaBatchStudio proc={proc} phase={phase} title="A moment that loops." accepts=".mp4,.mov,.webm,.avi,.mkv" kind="video" resultKind="image" action="Make GIFs" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={downloadResults} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }}    options={<><MediaRange label="Frames per second" value={fps} min={5} max={30} onChange={setFps} detail="More frames make motion smoother and files larger."/><MediaField label="Output width"><MediaChoices label="GIF width" value={width} onChange={setWidth} options={[240,320,480,640,800].map(value=>({value,label:`${value} px`}))}/></MediaField><p className="ms-caption">The full clip becomes a GIF. Use Trim Media first if you only want a short moment. The actual file size appears after processing.</p></>} />;
}
