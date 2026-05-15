/**
 * Image Upscaler — choose 2x or 4x; backend uses Lanczos resampling.
 */
import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, X, Image as ImageIcon, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

export function ImageUpscalerUI() {
    const [file, setFile] = useState<File | null>(null);
    const [scale, setScale] = useState<2 | 4>(2);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const process = async () => {
        if (!file) return;
        setState("processing");
        setError(null);
        try {
            const res = await uploadFile("/api/image-upscaler", file, { scale });
            const blob = await res.blob();
            const stem = file.name.replace(/\.[^.]+$/, "");
            const ext = file.name.split(".").pop()?.toLowerCase() || "png";
            const outExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "png";
            downloadBlob(blob, `${stem}_${scale}x.${outExt}`);
            setState("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Upscale failed");
            setState("idle");
        }
    };

    return (
        <div className="space-y-4">
            {!file ? (
                <button
                    type="button"
                    onClick={() => ref.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
                    className={cn(
                        "w-full rounded-2xl border-2 border-dashed p-10 sm:p-14 text-center transition-colors",
                        drag ? "border-accent bg-accent/5" : "border-border/60 hover:border-accent/40 bg-card/40"
                    )}
                >
                    <Upload className="mx-auto mb-3 text-muted-foreground" size={28} strokeWidth={1.6} />
                    <p className="text-sm font-semibold text-foreground">Choose an image</p>
                    <p className="mt-1 text-xs text-muted-foreground">JPG, PNG, WEBP — max ~25MP after upscale</p>
                    <input
                        ref={ref}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/jpg"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }}
                    />
                </button>
            ) : (
                <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                    <ImageIcon size={18} className="text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                    <button type="button" onClick={() => setFile(null)} aria-label="Remove" className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                        <X size={14} />
                    </button>
                </div>
            )}

            <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Scale factor</label>
                <div className="grid grid-cols-2 gap-2">
                    {([2, 4] as const).map(s => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setScale(s)}
                            className={cn(
                                "rounded-xl border px-4 py-4 text-left transition-colors",
                                scale === s
                                    ? "border-accent bg-accent/10"
                                    : "border-border bg-card hover:border-accent/40"
                            )}
                        >
                            <p className="text-2xl font-bold tracking-tight text-foreground">{s}×</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                {s === 2 ? "Larger image, faster, safe for most photos" : "Maximum detail, may exceed memory caps"}
                            </p>
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-[13px] text-rose-700 dark:text-rose-300">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <div className="flex items-center justify-end">
                <Button onClick={process} disabled={!file || state === "processing"} className="gap-1.5">
                    {state === "processing" ? <><Loader2 size={14} className="animate-spin" /> Upscaling…</> :
                     state === "done" ? <><CheckCircle2 size={14} /> Re-upscale</> :
                     <><Download size={14} /> Upscale {scale}×</>}
                </Button>
            </div>
        </div>
    );
}
