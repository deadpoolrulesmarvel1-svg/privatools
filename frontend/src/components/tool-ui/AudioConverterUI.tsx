import { MediaBatchStudio, MediaField, MediaChoices, MediaRange, MediaPreview, MediaBusy } from "./media/MediaStudio";
/**
 * AudioConverterUI — convert audio file format + bitrate.
 * Workshop: format gallery + bitrate row (disabled when lossless) + inline preview.
 * Multi-file via useMultiFileProcessor (same format/bitrate applied to every file).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, Music, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const FORMATS = [
    { v: "mp3",  label: "MP3",  desc: "Universal" },
    { v: "wav",  label: "WAV",  desc: "Lossless" },
    { v: "ogg",  label: "OGG",  desc: "Open" },
    { v: "flac", label: "FLAC", desc: "Lossless cmp." },
    { v: "aac",  label: "AAC",  desc: "Apple" },
];
const BITRATES = ["64k", "128k", "192k", "256k", "320k"];

const AUDIO_CONVERTER_DEFAULTS: { format: string; bitrate: string } = {
    format: "mp3",
    bitrate: "192k",
};

export function AudioConverterUI() {
    const [config, , { setField }] = useToolDefaults("audio-converter", AUDIO_CONVERTER_DEFAULTS);
    const { format, bitrate } = config;
    const setFormat = useCallback((v: React.SetStateAction<typeof AUDIO_CONVERTER_DEFAULTS["format"]>) => setField("format", v), [setField]);
    const setBitrate = useCallback((v: React.SetStateAction<typeof AUDIO_CONVERTER_DEFAULTS["bitrate"]>) => setField("bitrate", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");

    const isLossless = format === "wav" || format === "flac";

    // Object URL for the inline preview — only meaningful with exactly one
    // file queued (matches the old single-file behavior). Revoked on change.
    const previewFile = proc.entries.length === 1 ? proc.entries[0].file : null;
    const objectUrl = useMemo(() => (previewFile ? URL.createObjectURL(previewFile) : null), [previewFile]);
    useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/audio-converter",
            outputSuffix: null,
            outputExt: format,
            params: { format, bitrate },
        }, retry);
        setPhase("done");
    }, [proc, format, bitrate]);

    // The old UI named outputs client-side (`stem.format`) and ignored server
    // headers — keep that exact naming. N=1 → direct blob, N>1 → zip.
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

    return <MediaBatchStudio proc={proc} phase={phase} title="Your sound, in the right format." accepts=".mp3,.wav,.aac,.flac,.ogg,.m4a" kind="audio"  action="Convert audio" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={downloadResults} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }}    options={<><MediaField label="Save as"><MediaChoices label="Audio format" value={format} onChange={setFormat} options={FORMATS.map(item=>({value:item.v,label:item.label,detail:item.desc}))}/></MediaField>{!isLossless ? <MediaField label="Bitrate"><MediaChoices label="Audio bitrate" value={bitrate} onChange={setBitrate} options={BITRATES.map(value=>({value,label:`${value.replace("k","")} kbps`}))}/></MediaField>:<p className="ms-caption">This format uses lossless encoding, so a bitrate setting is not needed. Converting a compressed source cannot restore lost detail.</p>}</>} />;
}
