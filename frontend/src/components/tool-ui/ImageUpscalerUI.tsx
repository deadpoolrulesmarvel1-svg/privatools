/**
 * ImageUpscalerUI — Lanczos upscale at 2× or 4×.
 * Workshop: scale pickers, source preview, signal-green dropzone, estimated
 * processing time based on source megapixels × scale.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Scaling, Clock } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const IMAGE_UPSCALER_DEFAULTS: { scale: 2 | 4 } = {
    scale: 2,
};

export function ImageUpscalerUI() {
    const [config, , { setField }] = useToolDefaults("image-upscaler", IMAGE_UPSCALER_DEFAULTS);
    const { scale } = config;
    const setScale = useCallback((v: React.SetStateAction<typeof IMAGE_UPSCALER_DEFAULTS["scale"]>) => setField("scale", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [srcDims, setSrcDims] = useState<{ w: number; h: number } | null>(null);

    // Read natural dims so we can hint at the output resolution + ETA.
    useEffect(() => {
        if (!file) { setSrcDims(null); return; }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { setSrcDims({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
        img.onerror = () => URL.revokeObjectURL(url);
        img.src = url;
    }, [file]);

    const canProcess = !!file && state !== "processing";

    const process = useCallback(async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            const res = await uploadFile("/image-upscaler", file, { scale });
            const blob = await res.blob();
            const stem = file.name.replace(/\.[^.]+$/, "");
            const ext = file.name.split(".").pop()?.toLowerCase() || "png";
            const outExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "png";
            downloadBlob(blob, `${stem}_${scale}x.${outExt}`);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Upscale failed";
            setError(friendlyError(msg, "Couldn't upscale that image."));
            setState("idle");
        }
    }, [file, scale]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
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

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Upscaled</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{scale}×</span> resolution applied
                        </h2>
                        <button
                            onClick={() => { setFile(null); setState("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Upscale another
                        </button>
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
                accept=".jpg,.jpeg,.png,.webp"
                label="Drop image to upscale"
                hint="Lanczos resampling · max ~25 MP after upscale"
            />

            {file && (
                <>
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Scale factor</span>
                            {srcDims && <span className="tabular-nums">{srcDims.w}×{srcDims.h} px source</span>}
                        </div>
                        <div className="p-3 grid grid-cols-2 gap-2">
                            {([2, 4] as const).map(s => {
                                const active = scale === s;
                                const out = outDimsFor(s);
                                const eta = etaFor(s);
                                return (
                                    <button
                                        key={s}
                                        onClick={() => setScale(s)}
                                        aria-pressed={active}
                                        aria-label={`Upscale ${s} times${out ? ` to ${out} pixels` : ""}${eta ? `, estimated ${eta}` : ""}`}
                                        className={cn(
                                            "min-h-[88px] rounded-lg border p-4 text-left transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <p className={cn("font-display text-[28px] font-bold tracking-[-0.02em]", active ? "text-accent" : "text-foreground")}>{s}×</p>
                                        <p className="font-medium text-[11px] text-muted-foreground/85 mt-1">
                                            {out ?? (s === 2 ? "Larger image · safe default" : "Maximum detail · may need memory")}
                                        </p>
                                        {eta && (
                                            <p className="font-medium mt-1.5 inline-flex items-center gap-1 text-[9.5px] text-accent/80">
                                                <Clock size={9} /> {eta}
                                            </p>
                                        )}
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
                            {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Upscaling…</> : <><Scaling size={13} /> Upscale {scale}×</>}
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
