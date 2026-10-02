import { MediaBatchStudio, MediaField, MediaChoices } from "./media/MediaStudio";
/**
 * ImageConverterUI — convert images between JPEG / PNG / WebP / BMP / TIFF.
 * Format choices, a source preview, and actual downloadable results.
 * Multi-file via useMultiFileProcessor — same target format applied to all.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const formats = ["jpeg", "png", "webp", "bmp", "tiff"];

const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"];
const isImg = (f: File) => IMG_EXTS.some(e => f.name.toLowerCase().endsWith(e));

const IMAGE_CONVERTER_DEFAULTS = {
    target: "png",
};

export function ImageConverterUI() {
    const [config, , { setField }] = useToolDefaults("image-converter", IMAGE_CONVERTER_DEFAULTS);
    const { target } = config;
    const setTarget = useCallback((v: React.SetStateAction<typeof IMAGE_CONVERTER_DEFAULTS["target"]>) => setField("target", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Same naming as the single-file tool: swap the extension for the target.
    // The server sends a generic "converted.<ext>" so we name client-side.
    const outNameFor = useCallback((name: string) => `${name.replace(/\.[^.]+$/, "")}.${target}`, [target]);

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
            downloadBlob(buildZip(items), `archive_${target}.zip`);
        })();
    }, [proc.entries, outNameFor, target]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        const params: Record<string, string | number> = { target_format: target };
        await proc.run({
            endpoint: "/image-converter",
            outputSuffix: null,
            outputExt: target === "jpeg" ? "jpg" : target,
            params,
        }, retry);
        setPhase("done");
    }, [proc, target]);

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

    return <MediaBatchStudio proc={proc} phase={phase} title="Give your image a new format." accepts=".jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif" kind="image"  action="Convert images" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={downloadResults} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }} filter={isImg}   options={<><MediaField label="Save as" detail={target === "jpeg" ? "JPEG is ideal for photos. Transparent areas become opaque." : target === "png" ? "PNG keeps transparency and sharp edges." : "We use the standard encoder settings for this format."}><MediaChoices label="Output format" value={target} onChange={setTarget} options={formats.map(value=>({value,label:value.toUpperCase()}))}/></MediaField></>} />;
}
