/**
 * ResizeCropImageUI — resize or crop an image to social-media presets or custom px.
 * Workshop: mode toggle, preset gallery, width/height inputs, live visual
 * preview of the crop frame overlaid on the source.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Crop, Maximize2 } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processAndDownload } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const presets = [
    { label: "WhatsApp DP",       w: 500,  h: 500 },
    { label: "IG Post",           w: 1080, h: 1080 },
    { label: "IG Story",          w: 1080, h: 1920 },
    { label: "FB Cover",          w: 820,  h: 312 },
    { label: "Twitter Header",    w: 1500, h: 500 },
    { label: "LinkedIn Banner",   w: 1584, h: 396 },
    { label: "YT Thumbnail",      w: 1280, h: 720 },
    { label: "Passport",          w: 413,  h: 531 },
    { label: "HD 1920×1080",      w: 1920, h: 1080 },
    { label: "4K 3840×2160",      w: 3840, h: 2160 },
];

const RESIZE_CROP_IMAGE_DEFAULTS: { width: number; height: number; mode: "resize" | "crop" } = {
    width: 800,
    height: 600,
    mode: "resize",
};

export function ResizeCropImageUI() {
    const [config, , { setField }] = useToolDefaults("resize-crop-image", RESIZE_CROP_IMAGE_DEFAULTS);
    const { width, height, mode } = config;
    const setWidth = useCallback((v: React.SetStateAction<typeof RESIZE_CROP_IMAGE_DEFAULTS["width"]>) => setField("width", v), [setField]);
    const setHeight = useCallback((v: React.SetStateAction<typeof RESIZE_CROP_IMAGE_DEFAULTS["height"]>) => setField("height", v), [setField]);
    const setMode = useCallback((v: React.SetStateAction<typeof RESIZE_CROP_IMAGE_DEFAULTS["mode"]>) => setField("mode", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [srcDims, setSrcDims] = useState<{ w: number; h: number } | null>(null);

    // Build & revoke a preview URL whenever the file changes; also probe natural
    // dimensions so we can render the crop frame on the source.
    useEffect(() => {
        if (!file) { setPreview(null); setSrcDims(null); return; }
        const url = URL.createObjectURL(file);
        setPreview(url);
        const img = new Image();
        img.onload = () => setSrcDims({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = url;
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const applyPreset = (w: number, h: number) => { setWidth(w); setHeight(h); };

    const canProcess = !!file && status !== "processing";

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            await processAndDownload("/resize-crop-image", file, `${mode}_${file.name}`, { width, height, mode });
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't resize that image."));
            setStatus("idle");
        }
    }, [file, mode, width, height]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">{mode === "resize" ? "Resized" : "Cropped"}</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{width}×{height}</span> ready
                        </h2>
                        <button
                            onClick={() => { setFile(null); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Process another
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
                label="Drop image to resize or crop"
                hint="JPG · PNG · WebP"
            />

            {file && (
                <>
                    {preview && srcDims && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                                <span><span className="text-accent">§</span> Preview</span>
                                <span>{srcDims.w}×{srcDims.h} px source</span>
                            </div>
                            <div className="p-4 flex items-center justify-center bg-paper-2/30">
                                <CropPreview preview={preview} srcDims={srcDims} targetW={width} targetH={height} mode={mode} />
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-1 p-1 rounded-md border border-border bg-paper-2/40">
                        {(["resize", "crop"] as const).map(m => (
                            <button
                                key={m}
                                onClick={() => setMode(m)}
                                aria-pressed={mode === m}
                                className={cn(
                                    "min-h-[44px] rounded h-9 text-[12.5px] font-medium transition-colors inline-flex items-center justify-center gap-1.5 capitalize",
                                    mode === m ? "bg-card border border-accent text-accent" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                )}
                            >
                                {m === "resize" ? <><Maximize2 size={12} /> Resize</> : <><Crop size={12} /> Crop</>}
                            </button>
                        ))}
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Quick presets
                        </div>
                        <div className="p-3 flex flex-wrap gap-1.5">
                            {presets.map(p => {
                                const active = width === p.w && height === p.h;
                                return (
                                    <button
                                        key={p.label}
                                        onClick={() => applyPreset(p.w, p.h)}
                                        className={cn(
                                            "rounded-md border px-2.5 py-1.5 font-mono text-[10.5px] tracking-[0.04em] uppercase transition-colors",
                                            active ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                        )}
                                    >
                                        {p.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> Dimensions</span>
                            <span className="text-accent">{width}×{height} px</span>
                        </div>
                        <div className="p-4 grid grid-cols-2 gap-3">
                            <div>
                                <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Width (px)</label>
                                <input
                                    type="number" inputMode="numeric" value={width}
                                    onChange={e => setWidth(parseInt(e.target.value) || 800)} min={1}
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                            </div>
                            <div>
                                <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Height (px)</label>
                                <input
                                    type="number" inputMode="numeric" value={height}
                                    onChange={e => setHeight(parseInt(e.target.value) || 600)} min={1}
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Processing…</> : mode === "resize" ? <><Maximize2 size={13} /> Resize to {width}×{height}</> : <><Crop size={13} /> Crop to {width}×{height}</>}
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

/** Live overlay showing how the target box maps onto the source. */
function CropPreview({
    preview, srcDims, targetW, targetH, mode,
}: { preview: string; srcDims: { w: number; h: number }; targetW: number; targetH: number; mode: "resize" | "crop" }) {
    if (targetW <= 0 || targetH <= 0) return null;
    const srcAspect = srcDims.w / srcDims.h;
    const tgtAspect = targetW / targetH;
    // For crop: render a center-cropped frame on the source. For resize: render
    // a tinted box at the new aspect to communicate the output shape.
    const frame: React.CSSProperties = (() => {
        if (srcAspect > tgtAspect) {
            const w = (tgtAspect / srcAspect) * 100;
            return { top: 0, bottom: 0, left: `${(100 - w) / 2}%`, width: `${w}%` };
        }
        const h = (srcAspect / tgtAspect) * 100;
        return { left: 0, right: 0, top: `${(100 - h) / 2}%`, height: `${h}%` };
    })();
    return (
        <div className="relative max-w-full" style={{ maxWidth: "min(420px, 100%)" }}>
            <img src={preview} alt="Source preview" className="block max-h-56 max-w-full object-contain rounded border border-border" />
            <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
                {mode === "crop" ? (
                    <>
                        <div className="absolute inset-0 bg-foreground/60" />
                        <div
                            className="absolute outline outline-2 outline-accent shadow-[0_0_0_9999px_hsl(var(--foreground)/0.6)]"
                            style={frame}
                        />
                    </>
                ) : (
                    <div
                        className="absolute border-2 border-accent bg-accent/[0.08]"
                        style={frame}
                    />
                )}
            </div>
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
