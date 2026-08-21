/**
 * FaviconUI — generate multi-size favicon .ico from a source image.
 * Workshop: multi-select size grid + source preview.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Download, Image as ImageIcon, Check, Sparkles } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const SIZES = [
    { value: 16,  label: "16",  desc: "Classic" },
    { value: 32,  label: "32",  desc: "Standard" },
    { value: 48,  label: "48",  desc: "Windows" },
    { value: 64,  label: "64",  desc: "High DPI" },
    { value: 128, label: "128", desc: "Touch" },
    { value: 180, label: "180", desc: "Apple" },
    { value: 192, label: "192", desc: "Android" },
    { value: 512, label: "512", desc: "PWA" },
];

const FAVICON_DEFAULTS = {
    selectedSizes: [16, 32, 48, 180],
};

export function FaviconUI() {
    const [config, , { setField }] = useToolDefaults("generate-favicon", FAVICON_DEFAULTS);
    const { selectedSizes } = config;
    const setSelectedSizes = useCallback((v: React.SetStateAction<typeof FAVICON_DEFAULTS["selectedSizes"]>) => setField("selectedSizes", v), [setField]);
    const [file, setFile] = useState<File | null>(null);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);

    const handleFile = (f: File | null) => {
        setFile(f);
        if (f) {
            const reader = new FileReader();
            reader.onload = () => setPreviewSrc(reader.result as string);
            reader.readAsDataURL(f);
        } else {
            setPreviewSrc(null);
        }
    };

    const toggleSize = (size: number) => {
        setSelectedSizes(prev =>
            prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size].sort((a, b) => a - b)
        );
    };

    const canProcess = !!file && selectedSizes.length > 0 && status !== "processing";

    const process = useCallback(async () => {
        if (!file || selectedSizes.length === 0) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/generate-favicon", file, { sizes: selectedSizes.join(",") });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, buildOutputFilename(file?.name, "favicon", "ico"));
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Generation failed";
            setError(friendlyError(msg, "Couldn't generate the favicon."));
            setStatus("idle");
        }
    }, [file, selectedSizes]);

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
                        <p className="section-mark mb-2">Favicon generated</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{selectedSizes.length}</span> size{selectedSizes.length !== 1 && "s"} packed
                        </h2>
                        <p className="font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground mt-1">
                            <span className="text-accent">§</span> {selectedSizes.map(s => `${s}×${s}`).join(" · ")}
                        </p>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && file && downloadBlob(resultBlob, buildOutputFilename(file?.name, "favicon", "ico"))} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download .ico
                            </button>
                            <button
                                onClick={() => { handleFile(null); setStatus("idle"); setResultBlob(null); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Generate another
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
                onFileSelect={handleFile}
                onClear={() => handleFile(null)}
                accept=".png,.jpg,.jpeg,.svg,.webp"
                label="Drop source image"
                hint="PNG · JPG · SVG · WebP · square images work best"
            />

            {previewSrc && (
                <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-4">
                    <img src={previewSrc} alt="Preview" className="h-16 w-16 rounded-lg object-contain border border-border bg-paper-2/40" />
                    <div>
                        <p className="text-[14px] font-medium text-foreground">Source image</p>
                        <p className="font-mono text-[10.5px] tracking-[0.04em] uppercase text-muted-foreground mt-0.5">Will be resized to selected sizes</p>
                    </div>
                </div>
            )}

            {file && (
                <>
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> Output sizes</span>
                            <span className="text-accent">{selectedSizes.length} selected</span>
                        </div>
                        <div className="p-3 grid grid-cols-4 gap-2">
                            {SIZES.map(s => {
                                const active = selectedSizes.includes(s.value);
                                // Cap on-screen size to 56px so the larger entries
                                // (192, 512) don't blow up the card; we still
                                // communicate the true size via the label.
                                const renderPx = Math.min(56, Math.max(14, Math.round(s.value / 4)));
                                return (
                                    <button
                                        key={s.value}
                                        onClick={() => toggleSize(s.value)}
                                        aria-pressed={active}
                                        aria-label={`${s.value} by ${s.value} pixels favicon`}
                                        className={cn(
                                            "relative min-h-[88px] rounded-lg border p-3 flex flex-col items-center justify-center gap-1 transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        {active && <Check size={9} strokeWidth={3} className="absolute top-1.5 right-1.5 text-accent" />}
                                        {previewSrc && (
                                            <img
                                                src={previewSrc}
                                                alt=""
                                                aria-hidden="true"
                                                style={{ width: renderPx, height: renderPx, imageRendering: s.value <= 32 ? "pixelated" : "auto" }}
                                                className="rounded-sm object-cover border border-border bg-paper-2/40"
                                            />
                                        )}
                                        <p className={cn("font-mono text-[10.5px] tracking-[0.04em] font-semibold", active ? "text-accent" : "text-foreground")}>{s.label}</p>
                                        <p className="font-mono text-[9px] tracking-[0.04em] uppercase text-muted-foreground/85">{s.desc}</p>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="px-3 pb-3 flex flex-wrap gap-2">
                            <button onClick={() => setSelectedSizes([16, 32, 48, 180])} aria-label="Select web essentials sizes" className="font-mono text-[10px] tracking-[0.06em] uppercase text-accent hover:opacity-80">Web essentials</button>
                            <span className="text-muted-foreground/40">·</span>
                            <button onClick={() => setSelectedSizes(SIZES.map(s => s.value))} aria-label="Select all sizes" className="font-mono text-[10px] tracking-[0.06em] uppercase text-accent hover:opacity-80">All</button>
                            <span className="text-muted-foreground/40">·</span>
                            <button onClick={() => setSelectedSizes([])} aria-label="Clear selection" className="font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground hover:text-foreground">Clear</button>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Generating…</> : <><Sparkles size={13} /> Generate {selectedSizes.length} favicon{selectedSizes.length !== 1 && "s"}</>}
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
