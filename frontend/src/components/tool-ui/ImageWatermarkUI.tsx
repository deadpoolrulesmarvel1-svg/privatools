import { WatermarkCanvas } from "./media/MediaCanvases";
import { MediaBatchStudio, MediaField, MediaChoices, MediaRange, MediaPreview, MediaBusy } from "./media/MediaStudio";
/**
 * ImageWatermarkUI — overlay a text watermark on one or many images.
 * Multi-file via useMultiFileProcessor — same watermark applied to all.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Loader2, AlertCircle, Droplets, RotateCcw, Download, Upload, FileImage,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const POSITIONS = [
    { value: "top-left",     label: "Top-L" },
    { value: "top-right",    label: "Top-R" },
    { value: "center",       label: "Center" },
    { value: "bottom-left",  label: "Bot-L" },
    { value: "bottom-right", label: "Bot-R" },
    { value: "tile",         label: "Tile" },
];

const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];
const isImg = (f: File) => IMG_EXTS.some(e => f.name.toLowerCase().endsWith(e));

const IMAGE_WATERMARK_DEFAULTS: { text: string; opacity: number; position: string; fontSize: number } = {
    text: "WATERMARK",
    opacity: 140,
    position: "center",
    fontSize: 40,
};

export function ImageWatermarkUI() {
    const [config, , { setField }] = useToolDefaults("image-watermark", IMAGE_WATERMARK_DEFAULTS);
    const { text, opacity, position, fontSize } = config;
    const setText = useCallback((v: React.SetStateAction<typeof IMAGE_WATERMARK_DEFAULTS["text"]>) => setField("text", v), [setField]);
    const setOpacity = useCallback((v: React.SetStateAction<typeof IMAGE_WATERMARK_DEFAULTS["opacity"]>) => setField("opacity", v), [setField]);
    const setPosition = useCallback((v: React.SetStateAction<typeof IMAGE_WATERMARK_DEFAULTS["position"]>) => setField("position", v), [setField]);
    const setFontSize = useCallback((v: React.SetStateAction<typeof IMAGE_WATERMARK_DEFAULTS["fontSize"]>) => setField("fontSize", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && text.trim().length > 0 && phase !== "processing";
    const opacityPct = Math.round((opacity / 255) * 100);

    // Build a preview from the first image — revoke as the selection changes.
    useEffect(() => {
        const first = proc.entries[0]?.file;
        if (!first) { setPreviewUrl(null); return; }
        const url = URL.createObjectURL(first);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [proc.entries]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/image-watermark",
            outputSuffix: "watermarked",
            outputExt: "png", // server returns same format as input; this is a fallback only.
            params: { text: text.trim(), opacity: Math.round(opacity / 255 * 100), position, font_size: fontSize },
        }, retry);
        setPhase("done");
    }, [proc, text, opacity, position, fontSize]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_watermarked");
        }
    }, [phase, proc]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    return <MediaBatchStudio proc={proc} phase={phase} title="Make it unmistakably yours." accepts=".jpg,.jpeg,.png,.webp,.bmp" kind="image"  action="Watermark images" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={()=>proc.downloadAll("archive_watermarked")} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }} filter={isImg} preview={file=><WatermarkCanvas file={file} text={text} position={position} opacity={opacity} fontSize={fontSize}/>}  options={<><MediaField label="Your watermark"><label className="sr-only" htmlFor="media-watermark-text">Watermark text</label><input id="media-watermark-text" value={text} onChange={e=>setText(e.target.value)} maxLength={120} placeholder="Your name or message" /></MediaField><MediaRange label="Opacity" value={opacityPct} min={0} max={100} unit="%" onChange={value=>setOpacity(Math.round(value/100*255))} detail="0% is invisible. 100% is solid."/><MediaRange label="Font size" value={fontSize} min={10} max={200} unit=" px" onChange={setFontSize}/><MediaField label="Placement"><MediaChoices label="Watermark position" value={position} onChange={setPosition} options={POSITIONS.map(item=>({value:item.value,label:({"top-left":"Top left","top-right":"Top right","center":"Centre","bottom-left":"Bottom left","bottom-right":"Bottom right","tile":"Repeat"} as Record<string,string>)[item.value]}))}/></MediaField></>} />;
}
