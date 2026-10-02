import { MediaBatchStudio, MediaField, MediaChoices, MediaRange, MediaPreview, MediaBusy } from "./media/MediaStudio";
/**
 * ImageCompressorUI — compress JPEG/PNG/WebP with quality slider.
 *
 * Workshop aesthetic: workshop dropzone, image grid with hover affordance,
 * quality slider with "smaller / sharper" labels and visible estimated savings.
 * Multi-file via useMultiFileProcessor — same quality applied to every image;
 * several files download as one ZIP.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, X, Download, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { downloadBlob } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { cn } from "@/lib/utils";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const IMAGE_COMPRESSOR_DEFAULTS = {
    quality: 82,
};

const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const isImg = (f: File) => IMG_EXTS.some(e => f.name.toLowerCase().endsWith(e));

export function ImageCompressorUI() {
    const [config, , { setField }] = useToolDefaults("image-compressor", IMAGE_COMPRESSOR_DEFAULTS);
    const { quality } = config;
    const setQuality = useCallback((v: React.SetStateAction<typeof IMAGE_COMPRESSOR_DEFAULTS["quality"]>) => setField("quality", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);

    // Object-URL previews per queue entry. Created when an entry appears,
    // revoked when it leaves the queue (and all revoked on unmount).
    const [previews, setPreviews] = useState<Record<string, string>>({});
    const previewsRef = useRef<Record<string, string>>({});
    previewsRef.current = previews;
    useEffect(() => {
        const ids = new Set(proc.entries.map(e => e.id));
        const next = { ...previewsRef.current };
        let changed = false;
        for (const e of proc.entries) {
            if (!next[e.id]) { next[e.id] = URL.createObjectURL(e.file); changed = true; }
        }
        for (const id of Object.keys(next)) {
            if (!ids.has(id)) { URL.revokeObjectURL(next[id]); delete next[id]; changed = true; }
        }
        if (changed) setPreviews(next);
    }, [proc.entries]);
    useEffect(() => () => {
        for (const url of Object.values(previewsRef.current)) URL.revokeObjectURL(url);
    }, []);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Same naming as before: "compressed_<original name>". The server
    // normalizes extensions, so we keep naming client-side.
    const outNameFor = useCallback((name: string) => `compressed_${name}`, []);

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
            downloadBlob(buildZip(items), "archive_compressed.zip");
        })();
    }, [proc.entries, outNameFor]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/image-compressor",
            outputSuffix: "compressed",
            outputExt: "jpg",
            params: { quality: Math.min(quality, 95) },
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

    const totalSize = useMemo(() => proc.entries.reduce((s, e) => s + e.size, 0), [proc.entries]);
    // Heuristic — JPEG/WebP compression curve: 100→1.0×, 82→~0.55×, 50→~0.30×
    const estimatedRatio = useMemo(() => Math.max(0.10, Math.min(1.0, 0.20 + 0.012 * (quality - 50) + 0.005 * (quality - 80))), [quality]);
    const estimatedOut = totalSize * estimatedRatio;
    const savingsPct = totalSize ? Math.round((1 - estimatedRatio) * 100) : 0;

    return <MediaBatchStudio proc={proc} phase={phase} title="A lighter image, still yours." accepts=".jpg,.jpeg,.png,.webp" kind="image"  action="Compress images" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={downloadResults} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }} filter={isImg}   options={<><MediaRange label="JPEG & WebP quality" min={20} max={95} value={Math.min(quality,95)} unit="%" onChange={setQuality} detail="Smaller files or finer detail. PNG is optimized losslessly; this quality setting does not change PNG pixels." /></>} />;
}
