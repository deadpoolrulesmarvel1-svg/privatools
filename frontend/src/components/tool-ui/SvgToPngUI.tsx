import { MediaBatchStudio, MediaField, MediaChoices, MediaRange, MediaPreview, MediaBusy } from "./media/MediaStudio";
/**
 * SvgToPngUI — rasterize SVG to PNG at 1x / 2x / 3x / 4x scale.
 * Workshop: scale picker with px hint, download CTA. Shows output pixel
 * dimensions by parsing the SVG viewBox / width / height.
 * Multi-file via useMultiFileProcessor — same scale applied to every SVG.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Download, Scaling } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const SCALES = [
    { value: 1, label: "1×", desc: "Original" },
    { value: 2, label: "2×", desc: "Default" },
    { value: 3, label: "3×", desc: "High DPI" },
    { value: 4, label: "4×", desc: "Ultra HD" },
];

const SVG_TO_PNG_DEFAULTS: { scale: number } = {
    scale: 2,
};

const isSvg = (f: File) => f.name.toLowerCase().endsWith(".svg");

export function SvgToPngUI() {
    const [config, , { setField }] = useToolDefaults("svg-to-png", SVG_TO_PNG_DEFAULTS);
    const { scale } = config;
    const setScale = useCallback((v: React.SetStateAction<typeof SVG_TO_PNG_DEFAULTS["scale"]>) => setField("scale", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [svgDims, setSvgDims] = useState<{ w: number; h: number } | null>(null);

    // Read the first SVG, parse width/height (or fall back to the viewBox) so
    // we can tell the user what the rasterized output will measure.
    const firstFile = proc.entries[0]?.file ?? null;
    useEffect(() => {
        if (!firstFile) { setSvgDims(null); return; }
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result || "");
            const m = text.match(/<svg[^>]*>/i)?.[0] || "";
            const num = (s: string) => /^\d+(\.\d+)?(px)?$/.test(s.trim()) ? parseFloat(s) : NaN;
            const w = num(m.match(/\swidth=["']([^"']+)["']/i)?.[1] || "");
            const h = num(m.match(/\sheight=["']([^"']+)["']/i)?.[1] || "");
            if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
                setSvgDims({ w, h }); return;
            }
            const vb = m.match(/viewBox=["']([^"']+)["']/i)?.[1] || "";
            const parts = vb.split(/[\s,]+/).map(Number);
            if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
                setSvgDims({ w: parts[2], h: parts[3] });
            } else {
                setSvgDims(null);
            }
        };
        reader.readAsText(firstFile);
    }, [firstFile]);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Same naming as the single-file tool: swap .svg for .png. The server
    // sends a generic "converted.png" so we name client-side.
    const outNameFor = useCallback((name: string) => name.replace(/\.svg$/i, ".png") || "converted.png", []);

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
            downloadBlob(buildZip(items), "archive_png.zip");
        })();
    }, [proc.entries, outNameFor]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/svg-to-png",
            outputSuffix: null,
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

    const outW = svgDims ? Math.round(svgDims.w * scale) : null;
    const outH = svgDims ? Math.round(svgDims.h * scale) : null;

    return <MediaBatchStudio proc={proc} phase={phase} title="From vector to picture." accepts=".svg" kind="image"  action="Create PNGs" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={downloadResults} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }} filter={isSvg}   options={<><MediaField label="Resolution"><MediaChoices label="Rasterization scale" value={scale} onChange={setScale} options={SCALES.map(item=>({value:item.value,label:item.label,detail:item.desc}))}/></MediaField><MediaField label="Output dimensions" detail={outW && outH ? `${outW} × ${outH} pixels from the first SVG` : "Load an SVG to see the output dimensions."}/></>} />;
}
