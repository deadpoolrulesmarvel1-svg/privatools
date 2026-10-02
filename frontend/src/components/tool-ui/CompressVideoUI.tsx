import { MediaBatchStudio, MediaField, MediaChoices, MediaRange, MediaPreview, MediaBusy } from "./media/MediaStudio";
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

    const process = useCallback(async (retry: boolean | "transient" = false) => {
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

    return <MediaBatchStudio proc={proc} phase={phase} title="Less weight. More room to share." accepts=".mp4,.mov,.webm,.avi,.mkv" kind="video"  action="Compress videos" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={()=>proc.downloadAll("archive_compressed")} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }}    options={<><MediaRange label="Compression level (CRF)" value={quality} min={18} max={40} onChange={setQuality} detail="18 keeps more detail. 28 balances size and clarity. 40 makes a much smaller file."/><MediaField label="A useful starting point"><MediaChoices label="Compression preset" value={quality} onChange={setQuality} options={[{value:20,label:"Keep detail"},{value:28,label:"Balanced"},{value:35,label:"Small file"}]}/></MediaField></>} />;
}
