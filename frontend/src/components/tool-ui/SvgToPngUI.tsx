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
            const num = (s: string) => parseFloat(s.replace(/[^0-9.]/g, ""));
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

    const process = useCallback(async (retry = false) => {
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

    if (phase === "done") {
        const isMulti = proc.entries.length > 1;
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Rasterized</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti || proc.doneCount === 0
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> SVG{proc.doneCount === 1 ? "" : "s"} rasterized at {scale}×{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <>SVG → <span className="italic text-accent">{scale}× PNG</span></>}
                            </h2>
                            {proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "PNG downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={downloadResults} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download {proc.doneCount > 1 ? "ZIP" : "PNG"}
                                    </button>
                                )}
                                {proc.failedCount > 0 && (
                                    <button
                                        onClick={() => { downloadedRef.current = false; void process(true); }}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
                                    >
                                        Retry {proc.failedCount} failed
                                    </button>
                                )}
                                <button
                                    onClick={() => { proc.reset(); setPhase("idle"); downloadedRef.current = false; }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Convert another
                                </button>
                            </div>
                            {proc.failedCount > 0 && (
                                <div className="mt-4 space-y-1.5">
                                    {proc.entries.filter(e => e.status === "failed").map(e => (
                                        <p key={e.id} className="flex items-center gap-2 text-[12px] text-destructive">
                                            <AlertCircle size={12} className="shrink-0" /> {e.name}: {e.error}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={null}
                multiple
                onFilesSelect={files => proc.addFiles(files, isSvg)}
                onFileSelect={f => proc.addFiles([f], isSvg)}
                onClear={proc.clearAll}
                accept=".svg"
                label={proc.entries.length ? "Add more files" : "Drop SVG files"}
                hint="Rasterize to PNG at chosen scale · several files become a ZIP"
            />

            {proc.entries.length > 0 && (
                <>
                    <MultiFileQueue
                        entries={proc.entries}
                        reorderable={false}
                        onRemove={proc.removeFile}
                        onReorder={proc.reorder}
                        onClearAll={proc.clearAll}
                        onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                        busy={phase === "processing"}
                    />

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Output scale</span>
                            {outW !== null && outH !== null && (
                                <span className="text-accent tabular-nums">{outW}×{outH} px{proc.entries.length > 1 ? " · first file" : ""}</span>
                            )}
                        </div>
                        <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {SCALES.map(s => {
                                const active = scale === s.value;
                                const w = svgDims ? Math.round(svgDims.w * s.value) : null;
                                const h = svgDims ? Math.round(svgDims.h * s.value) : null;
                                return (
                                    <button
                                        key={s.value}
                                        onClick={() => setScale(s.value)}
                                        aria-pressed={active}
                                        aria-label={`Scale ${s.label}${w && h ? ` ${w} by ${h} pixels` : ""}`}
                                        className={cn(
                                            "min-h-[60px] rounded-lg border p-3 text-center transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <p className={cn("font-display text-[20px] font-bold tracking-[-0.02em]", active ? "text-accent" : "text-foreground")}>{s.label}</p>
                                        <p className="font-medium text-[11px] text-muted-foreground mt-0.5">
                                            {w && h ? `${w}×${h}` : s.desc}
                                        </p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Rasterizing… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Scaling size={13} /> Convert {proc.entries.length > 1 ? `${proc.entries.length} SVGs ` : ""}at {scale}×</>}
                        </button>
                        {canProcess && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 right-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" /></span>
        </>
    );
}
