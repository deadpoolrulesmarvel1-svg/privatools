/**
 * ImageCompressorUI — compress JPEG/PNG/WebP with quality slider.
 *
 * Workshop aesthetic: workshop dropzone, image grid with hover affordance,
 * quality slider with "smaller / sharper" labels and visible estimated savings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, X, Download, Loader2, AlertCircle, CheckCircle2, ImageIcon } from "lucide-react";
import { uploadFile, downloadBlob } from "@/lib/api";
import { cn, friendlyError } from "@/lib/utils";
import { useToolDefaults } from "@/hooks/useToolDefaults";

interface ImgFile { file: File; preview: string; }

const IMAGE_COMPRESSOR_DEFAULTS = {
    quality: 82,
};

export function ImageCompressorUI() {
    const [config, , { setField }] = useToolDefaults("image-compressor", IMAGE_COMPRESSOR_DEFAULTS);
    const { quality } = config;
    const setQuality = useCallback((v: React.SetStateAction<typeof IMAGE_COMPRESSOR_DEFAULTS["quality"]>) => setField("quality", v), [setField]);
    const [files, setFiles] = useState<ImgFile[]>([]);

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);

    const handleFiles = (newFiles: FileList) => {
        const items = Array.from(newFiles).map(f => ({ file: f, preview: URL.createObjectURL(f) }));
        setFiles(p => [...p, ...items]);
        setStatus("idle");
        setError(null);
    };

    // Revoke the removed preview's blob URL so memory doesn't leak when the
    // user trims items from the batch.
    const remove = (i: number) => setFiles(f => {
        const dropped = f[i];
        if (dropped) URL.revokeObjectURL(dropped.preview);
        return f.filter((_, idx) => idx !== i);
    });

    // On unmount, revoke any object URLs still in the batch. Mirror `files`
    // into a ref so the cleanup reads the latest array, not the initial one
    // captured by the closure.
    const filesRef = useRef<ImgFile[]>([]);
    filesRef.current = files;
    useEffect(() => () => {
        for (const f of filesRef.current) URL.revokeObjectURL(f.preview);
    }, []);

    const canProcess = files.length > 0 && status !== "processing";

    const process = useCallback(async () => {
        setStatus("processing");
        setError(null);
        try {
            for (const f of files) {
                const res = await uploadFile("/image-compressor", f.file, { quality });
                const blob = await res.blob();
                downloadBlob(blob, `compressed_${f.file.name}`);
            }
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't compress these images."));
            setStatus("idle");
        }
    }, [files, quality]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    const totalSize = useMemo(() => files.reduce((s, f) => s + f.file.size, 0), [files]);
    // Heuristic — JPEG/WebP compression curve: 100→1.0×, 82→~0.55×, 50→~0.30×
    const estimatedRatio = useMemo(() => Math.max(0.10, Math.min(1.0, 0.20 + 0.012 * (quality - 50) + 0.005 * (quality - 80))), [quality]);
    const estimatedOut = totalSize * estimatedRatio;
    const savingsPct = totalSize ? Math.round((1 - estimatedRatio) * 100) : 0;

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks accent />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Compressed</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            {files.length} image{files.length !== 1 ? "s" : ""} <span className="italic text-accent">downloaded</span>.
                        </h2>
                        <button
                            onClick={() => { setFiles([]); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            Compress more
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Dropzone */}
            <label
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-10 sm:py-12 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input type="file" accept=".jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={e => { e.target.files && handleFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                )}>
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Drop images here</p>
                <p className="font-medium text-[11.5px] text-muted-foreground">JPEG · PNG · WebP — multi-file OK</p>
            </label>

            {/* Image grid */}
            {files.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>{files.length} image{files.length !== 1 ? "s" : ""}</span>
                        <span>{(totalSize / 1024).toFixed(0)} KB total</span>
                    </div>
                    <div className="p-3 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
                        {files.map((f, i) => {
                            const origKb = (f.file.size / 1024).toFixed(0);
                            const estKb = ((f.file.size * estimatedRatio) / 1024).toFixed(0);
                            return (
                                <div key={i} className="group relative rounded-lg overflow-hidden border border-border bg-paper-2/40 aspect-square">
                                    <img src={f.preview} alt={f.file.name} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-foreground/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <button
                                            onClick={() => remove(i)}
                                            className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-card text-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
                                            aria-label={`Remove ${f.file.name}`}
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 bg-background/90 backdrop-blur-sm px-2 py-1">
                                        <p className="font-mono text-[10px] text-foreground truncate">{f.file.name}</p>
                                        <p className="font-mono text-[9.5px] tracking-wider text-muted-foreground tabular-nums">
                                            {origKb} → <span className="text-accent">{estKb}</span> KB
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Quality */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Quality
                </div>
                <div className="p-5">
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-[11.5px] text-muted-foreground">JPEG quality</span>
                        <span className="font-mono text-[16px] text-accent tabular-nums font-medium">{quality}%</span>
                    </div>
                    <input
                        type="range" min={20} max={100} step={1} value={quality}
                        onChange={e => setQuality(parseInt(e.target.value, 10))}
                        className="w-full accent-[hsl(var(--accent))]"
                        aria-label="JPEG quality"
                    />
                    <div className="font-medium mt-1 flex justify-between text-[9.5px] text-muted-foreground/85">
                        <span>← smaller</span><span>balanced</span><span>sharper →</span>
                    </div>

                    {/* Savings estimate */}
                    {totalSize > 0 && (
                        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-lg border border-border bg-paper-2/40 p-3">
                                <p className="font-medium text-[9.5px] text-muted-foreground">Before</p>
                                <p className="font-mono text-[15px] text-foreground tabular-nums mt-1">{(totalSize / 1024).toFixed(0)} KB</p>
                            </div>
                            <div className="rounded-lg border border-accent/30 bg-accent/[0.06] p-3">
                                <p className="font-medium text-[9.5px] text-accent">After (est.)</p>
                                <p className="font-mono text-[15px] text-accent tabular-nums mt-1">{(estimatedOut / 1024).toFixed(0)} KB</p>
                            </div>
                            <div className="rounded-lg border border-border bg-paper-2/40 p-3">
                                <p className="font-medium text-[9.5px] text-muted-foreground">Saved</p>
                                <p className="font-mono text-[15px] text-foreground tabular-nums mt-1">−{savingsPct}%</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
                <button
                    onClick={process}
                    disabled={!canProcess}
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {status === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Compressing…</>
                        : <><Download size={13} /> Compress {files.length || ""} image{files.length !== 1 ? "s" : ""}</>}
                </button>
                {canProcess && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                )}
            </div>
        </div>
    );
}

function CornerMarks({ accent }: { accent?: boolean }) {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    const color = accent ? "bg-accent" : "bg-accent/70";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className={`absolute top-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className={`absolute top-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 right-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className={`absolute bottom-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className={`absolute bottom-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 right-0 w-px h-3 ${color}`} />
            </span>
        </>
    );
}
