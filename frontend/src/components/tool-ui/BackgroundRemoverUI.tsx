/**
 * BackgroundRemoverUI — strip the background from an image.
 *
 * Workshop touches: corner registration marks on dropzone, before/after
 * preview with a checkerboard transparency pattern on the "after" pane, and
 * a drag-handle slider that wipes between source and result for comparison.
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { Download, Loader2, AlertCircle, Eraser, CheckCircle2, X } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

export function BackgroundRemoverUI() {
    const [file, setFile] = useState<File | null>(null);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [resultUrl, setResultUrl] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const [sliderPct, setSliderPct] = useState(50);
    const ref = useRef<HTMLInputElement>(null);

    // Defensive cleanup — if the user navigates away while a result blob is
    // still live, revoke it so we don't leak the rendered URL.
    useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

    const handleFile = (f: File) => {
        setFile(f);
        const reader = new FileReader();
        reader.onload = () => setPreviewSrc(reader.result as string);
        reader.readAsDataURL(f);
    };

    const canProcess = !!file && status !== "processing";

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing");
        setError(null);
        try {
            const res = await uploadFile("/remove-background", file);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            setResultBlob(blob);
            setResultUrl(url);
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't remove the background."));
            setStatus("idle");
        }
    }, [file]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    const reset = () => {
        setFile(null); setPreviewSrc(null);
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultBlob(null); setResultUrl(null); setStatus("idle");
    };

    if (status === "done" && resultUrl) return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative px-4 py-3 border-b border-border bg-paper-2/40 flex items-center justify-between">
                    <CornerMarks />
                    <div className="font-medium flex items-center gap-2 text-[11.5px] text-accent">
                        <CheckCircle2 size={12} />
                        Background removed
                    </div>
                    <button onClick={reset} className="font-medium text-[11.5px] text-muted-foreground hover:text-foreground transition-colors">
                        Process another
                    </button>
                </div>
                <div className="p-5 space-y-3">
                    <p className="font-medium text-[11.5px] text-muted-foreground">
                        Drag the slider to compare
                    </p>
                    <BeforeAfterSlider
                        before={previewSrc || ""}
                        after={resultUrl}
                        value={sliderPct}
                        onChange={setSliderPct}
                    />
                </div>
                <div className="px-5 pb-5">
                    <button
                        onClick={() => resultBlob && downloadBlob(resultBlob, `nobg_${file?.name || "image.png"}`)}
                        className="btn-accent w-full sm:w-auto"
                    >
                        <Download size={13} /> Download PNG
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Dropzone */}
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload image"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-10 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" className="hidden" onChange={e => { e.target.files?.[0] && handleFile(e.target.files[0]); e.target.value = ""; }} />
                <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                )}>
                    <Eraser size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {file ? "Replace image" : "Drop image to remove background"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    JPEG · PNG · WebP — AI runs on the server (your file is deleted after)
                </p>
            </div>

            {/* Preview before processing */}
            {previewSrc && file && (
                <div className="rounded-xl border border-accent/30 bg-accent/[0.04] overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Source · {file.name}</span>
                        <span>{formatFileSize(file.size)}</span>
                    </div>
                    <div className="p-4 flex items-center justify-center bg-paper-2/30">
                        <img src={previewSrc} alt="Preview" className="max-h-60 rounded-md object-contain" />
                    </div>
                    <div className="px-3 py-2 border-t border-border bg-paper-2/40 flex justify-end">
                        <button onClick={reset} className="font-medium inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors">
                            <X size={11} /> Remove
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {file && (
                <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {status === "processing"
                            ? <><Loader2 size={13} className="animate-spin" /> Removing background…</>
                            : <><Eraser size={13} /> Remove background</>}
                    </button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Wipe-style before/after slider. Pointer events on the wrapper move the
 * divider; the range input is the accessible fallback / keyboard control.
 */
function BeforeAfterSlider({
    before, after, value, onChange,
}: { before: string; after: string; value: number; onChange: (v: number) => void }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const handlePointer = (e: React.PointerEvent) => {
        if (e.buttons !== 1 && e.type !== "pointerdown") return;
        const r = wrapRef.current?.getBoundingClientRect();
        if (!r) return;
        const pct = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
        onChange(pct);
    };
    return (
        <div className="space-y-2">
            <div
                ref={wrapRef}
                onPointerDown={handlePointer}
                onPointerMove={handlePointer}
                className="relative w-full overflow-hidden rounded-lg border border-border bg-paper-2/40 select-none touch-pan-y"
                style={{
                    aspectRatio: "1 / 1",
                    background: "repeating-conic-gradient(hsl(var(--paper-2)) 0% 25%, hsl(var(--card)) 0% 50%) 50% / 16px 16px",
                }}
            >
                {/* After (full) sits underneath */}
                {after && <img src={after} alt="Background removed" className="absolute inset-0 w-full h-full object-contain" />}
                {/* Before is clipped from the right so it only shows on the left side */}
                {before && (
                    <div
                        className="absolute inset-0 overflow-hidden"
                        style={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}
                    >
                        <img src={before} alt="Original" className="absolute inset-0 w-full h-full object-contain bg-paper-2/40" />
                    </div>
                )}
                {/* Divider */}
                <div className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none" style={{ left: `${value}%` }} />
                <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-9 w-9 rounded-full bg-accent text-background flex items-center justify-center pointer-events-none shadow-md"
                    style={{ left: `${value}%` }}
                    aria-hidden="true"
                >
                    <span className="font-mono text-[9.5px] tracking-wider">↔</span>
                </div>
                <span className="font-medium absolute top-2 left-2 text-[9.5px] tracking-wider rounded bg-background/85 text-foreground px-1.5 h-5 inline-flex items-center">Before</span>
                <span className="font-medium absolute top-2 right-2 text-[9.5px] tracking-wider rounded bg-accent/85 text-background px-1.5 h-5 inline-flex items-center">After</span>
            </div>
            <input
                type="range"
                min={0} max={100} value={value}
                onChange={e => onChange(+e.target.value)}
                aria-label="Compare slider position"
                className="w-full h-2 accent-[hsl(var(--accent))] touch-manipulation"
            />
        </div>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className="absolute top-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className="absolute top-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 right-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" />
            </span>
        </>
    );
}
