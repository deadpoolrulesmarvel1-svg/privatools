/**
 * SvgToPngUI — rasterize SVG to PNG at 1x / 2x / 3x / 4x scale.
 * Workshop: scale picker with px hint, download CTA. Shows output pixel
 * dimensions by parsing the SVG viewBox / width / height.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Download, Scaling } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
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

export function SvgToPngUI() {
    const [config, , { setField }] = useToolDefaults("svg-to-png", SVG_TO_PNG_DEFAULTS);
    const { scale } = config;
    const setScale = useCallback((v: React.SetStateAction<typeof SVG_TO_PNG_DEFAULTS["scale"]>) => setField("scale", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [svgDims, setSvgDims] = useState<{ w: number; h: number } | null>(null);

    // Read the SVG, parse width/height (or fall back to the viewBox) so we can
    // tell the user what the rasterized output will measure.
    useEffect(() => {
        if (!file) { setSvgDims(null); return; }
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
        reader.readAsText(file);
    }, [file]);

    const canProcess = !!file && status !== "processing";

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/svg-to-png", file, { scale });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, file.name.replace(/\.svg$/i, ".png") || "converted.png");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't rasterize that SVG."));
            setStatus("idle");
        }
    }, [file, scale]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    const outW = svgDims ? Math.round(svgDims.w * scale) : null;
    const outH = svgDims ? Math.round(svgDims.h * scale) : null;

    if (status === "done") return (
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
                            SVG → <span className="italic text-accent">{scale}× PNG</span>
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && file && downloadBlob(resultBlob, file.name.replace(/\.svg$/i, ".png"))} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download PNG
                            </button>
                            <button
                                onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Convert another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept=".svg"
                label="Drop SVG file"
                hint="Rasterize to PNG at chosen scale"
            />

            {file && (
                <>
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> Output scale</span>
                            {outW !== null && outH !== null && (
                                <span className="text-accent tabular-nums">{outW}×{outH} px</span>
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
                                        <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-0.5">
                                            {w && h ? `${w}×${h}` : s.desc}
                                        </p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Rasterizing…</> : <><Scaling size={13} /> Convert at {scale}×</>}
                        </button>
                        {canProcess && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
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
