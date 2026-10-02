import { MediaBatchStudio, MediaField, MediaChoices, MediaRange, MediaPreview, MediaBusy } from "./media/MediaStudio";
/**
 * ExtractAudioUI — strip audio track from a video.
 * Multi-file via useMultiFileProcessor (same format applied to every video).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CheckCircle2, RotateCcw, Music, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { FileUploadZone } from "./FileUploadZone";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const formats = ["mp3", "wav", "aac", "flac", "ogg"];

const EXTRACT_AUDIO_DEFAULTS: { format: string } = {
    format: "mp3",
};

export function ExtractAudioUI() {
    const [config, , { setField }] = useToolDefaults("extract-audio", EXTRACT_AUDIO_DEFAULTS);
    const { format } = config;
    const setFormat = useCallback((v: React.SetStateAction<typeof EXTRACT_AUDIO_DEFAULTS["format"]>) => setField("format", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Local object URL for inline video preview — only with exactly one file
    // queued (matches the old single-file behavior).
    const previewFile = proc.entries.length === 1 ? proc.entries[0].file : null;
    const objectUrl = useMemo(() => (previewFile ? URL.createObjectURL(previewFile) : null), [previewFile]);
    useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/extract-audio",
            outputSuffix: null,
            outputExt: format,
            params: { format },
        }, retry);
        setPhase("done");
    }, [proc, format]);

    // The backend answers with a generic `audio.{format}` name; the old UI
    // named downloads after the source file (`stem.format`). Keep that:
    // build names client-side. N=1 → direct blob, N>1 → zip.
    const downloadResults = useCallback(() => {
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, buildOutputFilename(done[0].name, null, format));
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: buildOutputFilename(e.name, null, format),
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), "archive_audio.zip");
        })();
    }, [proc.entries, format]);

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

    return <MediaBatchStudio proc={proc} phase={phase} title="Keep the sound you came for." accepts=".mp4,.mov,.webm,.avi,.mkv" kind="video" resultKind="audio" action="Extract audio" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={downloadResults} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }}    options={<><MediaField label="Audio format"><MediaChoices label="Audio format" value={format} onChange={setFormat} options={formats.map(value=>({value,label:value.toUpperCase(),detail:value==="wav"||value==="flac"?"Lossless container":"Compressed audio"}))}/></MediaField><p className="ms-caption">Preview the source video here. Listen to the extracted track before downloading your result.</p></>} />;
}
