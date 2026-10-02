import { MediaBatchStudio, MediaField, MediaChoices, MediaRange, MediaPreview, MediaBusy } from "./media/MediaStudio";
/**
 * HeicToJpgUI — convert Apple HEIC/HEIF to universal JPG.
 * Workshop: quality preset cards + signal-green dropzone.
 * Multi-file via useMultiFileProcessor — same quality applied to every file.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Download, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const QUALITIES = [
    { value: 95, label: "High",       desc: "Best quality" },
    { value: 85, label: "Standard",   desc: "Good balance" },
    { value: 70, label: "Compressed", desc: "Smaller size" },
];

const HEIC_TO_JPG_DEFAULTS: { quality: number } = {
    quality: 85,
};

const isHeic = (f: File) => /\.(heic|heif)$/i.test(f.name);

export function HeicToJpgUI() {
    const [config, , { setField }] = useToolDefaults("heic-to-jpg", HEIC_TO_JPG_DEFAULTS);
    const { quality } = config;
    const setQuality = useCallback((v: React.SetStateAction<typeof HEIC_TO_JPG_DEFAULTS["quality"]>) => setField("quality", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Same naming as the single-file tool: swap the .heic/.heif extension for
    // .jpg. The server sends a generic "converted.jpg" so we name client-side.
    const outNameFor = useCallback((name: string) => name.replace(/\.(heic|heif)$/i, ".jpg") || "converted.jpg", []);

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
            downloadBlob(buildZip(items), "archive_jpg.zip");
        })();
    }, [proc.entries, outNameFor]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/heic-to-jpg",
            outputSuffix: null,
            outputExt: "jpg",
            params: { quality },
        }, retry);
        setPhase("done");
    }, [proc, quality]);

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

    return <MediaBatchStudio proc={proc} phase={phase} title="Open your photos anywhere." accepts=".heic,.heif" kind="image"  action="Convert to JPG" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={downloadResults} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }} filter={isHeic}   options={<><MediaField label="Photo quality"><MediaChoices label="JPG quality" value={quality} onChange={setQuality} options={QUALITIES.map(item=>({value:item.value,label:item.label,detail:item.desc}))}/></MediaField><p className="ms-caption">HEIC previews depend on your browser. The finished JPG will appear here after conversion.</p></>} />;
}
