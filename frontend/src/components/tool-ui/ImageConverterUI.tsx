/**
 * ImageConverterUI — convert images between JPEG / PNG / WebP / BMP / TIFF.
 * Workshop: format pills, source preview, success state, quality slider for
 * lossy targets with a heuristic size estimate.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Download } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const formats = ["jpeg", "png", "webp", "bmp", "tiff"];
const LOSSY = new Set(["jpeg", "webp"]);

const IMAGE_CONVERTER_DEFAULTS = {
    target: "png",
    quality: 85,
};

export function ImageConverterUI() {
    const [config, , { setField }] = useToolDefaults("image-converter", IMAGE_CONVERTER_DEFAULTS);
    const { target, quality } = config;
    const setTarget = useCallback((v: React.SetStateAction<typeof IMAGE_CONVERTER_DEFAULTS["target"]>) => setField("target", v), [setField]);
    const setQuality = useCallback((v: React.SetStateAction<typeof IMAGE_CONVERTER_DEFAULTS["quality"]>) => setField("quality", v), [setField]);
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState("");
    // Track the active object URL so we can revoke the previous one when the
    // user picks a different file, and revoke the final one on unmount.
    const previewRef = useRef<string>("");

    useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

    const handleFile = (f: File | null) => {
        setFile(f);
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        if (f) {
            const url = URL.createObjectURL(f);
            previewRef.current = url;
            setPreview(url);
        } else {
            previewRef.current = "";
            setPreview("");
        }
        setError(null);
    };

    const canProcess = !!file && status !== "processing";

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const params: Record<string, string | number> = { target_format: target };
            if (LOSSY.has(target)) params.quality = quality;
            const res = await uploadFile("/image-converter", file, params);
            const blob = await res.blob();
            downloadBlob(blob, `${file.name.replace(/\.[^.]+$/, "")}.${target}`);
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't convert that image."));
            setStatus("idle");
        }
    }, [file, target, quality]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    // Rough multipliers from source ext → target ext to give the user a sanity
    // check on output size. Not exact, just directional.
    const estimatedOut = (() => {
        if (!file) return null;
        const src = file.name.split(".").pop()?.toLowerCase() || "";
        const baseMult: Record<string, number> = { jpeg: 0.6, png: 2.2, webp: 0.5, bmp: 5, tiff: 4 };
        const srcMult = baseMult[src === "jpg" ? "jpeg" : src] ?? 1;
        const tgtMult = baseMult[target] ?? 1;
        let est = (file.size / srcMult) * tgtMult;
        if (LOSSY.has(target)) est *= 0.4 + 0.012 * (quality - 50);
        return Math.max(file.size * 0.05, est);
    })();

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Converted</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            Saved as <span className="italic text-accent">{target.toUpperCase()}</span>
                        </h2>
                        <button
                            onClick={() => { handleFile(null); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Convert another
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
                onFileSelect={handleFile}
                onClear={() => handleFile(null)}
                accept=".jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif"
                label="Drop image to convert"
                hint="JPEG · PNG · WebP · BMP · TIFF"
            />
            {preview && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                        Preview
                    </div>
                    <div className="p-4 flex items-center justify-center bg-paper-2/30">
                        <img src={preview} alt="Preview" className="max-h-48 max-w-full object-contain rounded border border-border" />
                    </div>
                </div>
            )}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Target format
                </div>
                <div className="p-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {formats.map(f => {
                        const active = target === f;
                        return (
                            <button
                                key={f}
                                onClick={() => setTarget(f)}
                                aria-pressed={active}
                                aria-label={`Convert to ${f.toUpperCase()}`}
                                className={cn(
                                    "font-medium min-h-[44px] rounded-lg border py-2.5 px-2 text-[12px] transition-colors",
                                    active ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                )}
                            >
                                {f}
                            </button>
                        );
                    })}
                </div>
                {LOSSY.has(target) && (
                    <div className="px-4 pb-4 pt-1 border-t border-border">
                        <div className="flex items-center justify-between mb-1.5">
                            <label htmlFor="conv-quality" className="font-medium text-[11px] text-muted-foreground">Quality</label>
                            <span className="font-mono text-[12px] text-accent tabular-nums">{quality}%</span>
                        </div>
                        <input
                            id="conv-quality"
                            type="range" min={20} max={100} value={quality}
                            onChange={e => setQuality(+e.target.value)}
                            aria-label="Output quality"
                            className="w-full h-2 accent-[hsl(var(--accent))] touch-manipulation"
                        />
                        <div className="font-medium mt-1 flex justify-between text-[9.5px] text-muted-foreground/85">
                            <span>← smaller</span><span>balanced</span><span>sharper →</span>
                        </div>
                    </div>
                )}
                {file && estimatedOut !== null && (
                    <div className="px-4 pb-3 -mt-1 grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-border bg-paper-2/40 p-2 text-center">
                            <p className="font-medium text-[9.5px] text-muted-foreground">Source</p>
                            <p className="font-mono text-[13px] text-foreground tabular-nums">{formatFileSize(file.size)}</p>
                        </div>
                        <div className="rounded-lg border border-accent/30 bg-accent/[0.06] p-2 text-center">
                            <p className="font-medium text-[9.5px] text-accent">{target.toUpperCase()} (est.)</p>
                            <p className="font-mono text-[13px] text-accent tabular-nums">~{formatFileSize(estimatedOut)}</p>
                        </div>
                    </div>
                )}
            </div>
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}
            <div className="flex items-center gap-3 flex-wrap">
                <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Converting…</> : <><Download size={13} /> Convert to {target.toUpperCase()}</>}
                </button>
                {canProcess && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
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
