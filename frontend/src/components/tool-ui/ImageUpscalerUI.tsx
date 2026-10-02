import { MediaBatchStudio, MediaField, MediaChoices, MediaRange, MediaPreview, MediaBusy } from "./media/MediaStudio";
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

    const process = useCallback(async (retry: boolean | "transient" = false) => {
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

    return <MediaBatchStudio proc={proc} phase={phase} title="A bigger picture." accepts=".jpg,.jpeg,.png,.webp" kind="image"  action="Upscale images" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={downloadResults} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }} filter={isImg}   options={<><MediaField label="Enlarge by"><MediaChoices label="Upscale factor" value={scale} onChange={setScale} options={([2,4] as const).map(value=>({value,label:`${value}×`,detail:outDimsFor(value)||"Original size multiplied"}))}/></MediaField><p className="ms-caption">Lanczos resizing preserves edges as the image grows. It does not invent missing detail or use an AI model.</p></>} />;
}
