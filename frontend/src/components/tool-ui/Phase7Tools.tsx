/**
 * Phase 7 — five new tools shipped to close gaps competitors had:
 *   VideoSpeedUI       — change playback speed 0.25× to 4×
 *   AudioTrimUI        — standalone audio cutter (separate from video trim)
 *   ImagePaletteUI     — extract dominant color palette from any image
 *   PixelateImageUI    — pixelate or Gaussian-blur an entire image (privacy)
 *   RotateImageUI      — rotate by 90/180/270 or arbitrary angle
 *   FlipImageUI        — horizontal or vertical mirror
 * Plus simple wrappers for mute-video and reverse-video via GenericUI.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Loader2, AlertCircle, CheckCircle2, Copy, Check, RotateCw, FlipHorizontal, FlipVertical, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, uploadFileGetJson, downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";
import { friendlyError } from "@/lib/utils";

// ─── Video Speed ────────────────────────────────────────────────────────
export function VideoSpeedUI() {
    const [speed, setSpeed] = useState(1.5);
    const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const pick = (fl: FileList) => {
        const f = fl[0];
        if (f) setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
        setState("idle"); setError(null);
    };
    const canProcess = !!file && state !== "processing";
    const process = useCallback(async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            const res = await uploadFile("/video-speed", file.raw, { speed: speed.toFixed(2) });
            const blob = await res.blob();
            const stem = file.name.replace(/\.[^.]+$/, "");
            downloadBlob(blob, `${stem}_${speed.toFixed(2).replace(/\.00$/, "")}x.mp4`);
            setState("done");
        } catch (e) {
            setError(friendlyError(e instanceof Error ? e.message : "Failed", "Something went wrong"));
            setState("idle");
        }
    }, [file, speed]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card/40 p-5">
                <div className="flex items-center justify-between mb-2">
                    <label htmlFor="vs-speed" className="text-sm font-semibold text-foreground">Playback speed</label>
                    <span className="text-xs font-mono text-accent">{speed.toFixed(2)}×</span>
                </div>
                <input
                    id="vs-speed"
                    type="range" min={0.25} max={4} step={0.05}
                    value={speed}
                    onChange={e => setSpeed(parseFloat(e.target.value))}
                    className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>0.25× — slow-mo</span>
                    <span>4× — hyperlapse</span>
                </div>
            </div>
            <div onClick={() => ref.current?.click()}
                className="dropzone-surface relative cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong hover:border-accent/55 hover:bg-accent/[0.04] bg-paper-2/30 py-12 transition-colors group">
                <input ref={ref} type="file" accept=".mp4,.mov,.webm,.avi,.mkv" className="hidden" onChange={e => { e.target.files && pick(e.target.files); e.target.value = ""; }} />
                <CornerMarks />
                <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-accent/10 border border-accent/30 group-hover:bg-accent/15 transition-colors">
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[17px] font-semibold text-foreground tracking-[-0.02em]">{file ? file.name : "Drop a video here"}</p>
                {file && <p className="font-medium text-[11.5px] text-muted-foreground">{file.size}</p>}
            </div>
            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
            {file && state !== "processing" && (
                <div className="flex items-center gap-3 flex-wrap">
                    <Button onClick={process} className="">Change speed</Button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}
            {state === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Processing…</Button>}
            {state === "done" && (
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] p-6 text-center animate-fade-up">
                    <div className="h-12 w-12 mx-auto rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center animate-success-pop mb-3">
                        <CheckCircle2 size={22} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="text-sm font-semibold text-accent mb-3">Video sped to {speed.toFixed(2)}×</p>
                    <Button variant="outline" onClick={() => { setFile(null); setState("idle"); }}>Try another</Button>
                </div>
            )}
        </div>
    );
}

// ─── Audio Trim ─────────────────────────────────────────────────────────
export function AudioTrimUI() {
    const [file, setFile] = useState<File | null>(null);
    const [start, setStart] = useState("00:00:00");
    const [end, setEnd] = useState("00:00:30");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = !!file && status !== "processing";
    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/audio-trim", file, { start, end });
            const blob = await res.blob();
            const ext = file.name.split(".").pop() || "mp3";
            downloadBlob(blob, buildOutputFilename(file.name, "trimmed", ext));
            setStatus("done");
        } catch (e) {
            setError(friendlyError(e instanceof Error ? e.message : "Failed", "Something went wrong"));
            setStatus("idle");
        }
    }, [file, start, end]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    return (
        <div className="space-y-4">
            <div onClick={() => ref.current?.click()}
                className="dropzone-surface relative cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong hover:border-accent/55 hover:bg-accent/[0.04] bg-paper-2/30 py-12 transition-colors group">
                <input ref={ref} type="file" accept=".mp3,.wav,.aac,.flac,.ogg,.m4a" className="hidden" onChange={e => { e.target.files?.[0] && setFile(e.target.files[0]); e.target.value = ""; }} />
                <CornerMarks />
                <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-accent/10 border border-accent/30 group-hover:bg-accent/15 transition-colors">
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[17px] font-semibold text-foreground tracking-[-0.02em]">{file ? file.name : "Drop an audio file"}</p>
                {file && <p className="font-medium text-[11.5px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label htmlFor="at-start" className="text-xs font-medium text-muted-foreground">Start (HH:MM:SS)</label>
                    <input id="at-start" value={start} onChange={e => setStart(e.target.value)}
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-secondary/30 font-mono text-sm" />
                </div>
                <div>
                    <label htmlFor="at-end" className="text-xs font-medium text-muted-foreground">End (HH:MM:SS)</label>
                    <input id="at-end" value={end} onChange={e => setEnd(e.target.value)}
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-secondary/30 font-mono text-sm" />
                </div>
            </div>
            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
            {file && status !== "processing" && (
                <div className="flex items-center gap-3 flex-wrap">
                    <Button onClick={process} className="">Trim audio</Button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}
            {status === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Trimming…</Button>}
            {status === "done" && (
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] p-6 text-center animate-fade-up">
                    <div className="h-12 w-12 mx-auto rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center animate-success-pop mb-3">
                        <CheckCircle2 size={22} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="text-sm font-semibold text-accent mb-3">Trimmed audio downloaded</p>
                    <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Try another</Button>
                </div>
            )}
        </div>
    );
}

// ─── Image Palette ──────────────────────────────────────────────────────
type PaletteEntry = { hex: string; rgb: [number, number, number]; percentage: number };

export function ImagePaletteUI() {
    const [file, setFile] = useState<File | null>(null);
    const [colors, setColors] = useState(6);
    const [palette, setPalette] = useState<PaletteEntry[] | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [copiedHex, setCopiedHex] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const copyHex = (hex: string) => {
        navigator.clipboard.writeText(hex).catch(() => {});
        setCopiedHex(hex);
        setTimeout(() => setCopiedHex(null), 1200);
    };

    const canProcess = !!file && status !== "processing";
    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const data = await uploadFileGetJson<{ palette: PaletteEntry[] }>("/image-palette", file, { colors });
            setPalette(data.palette);
            setStatus("done");
        } catch (e) {
            setError(friendlyError(e instanceof Error ? e.message : "Failed", "Something went wrong"));
            setStatus("idle");
        }
    }, [file, colors]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    return (
        <div className="space-y-4">
            <div onClick={() => ref.current?.click()}
                className="dropzone-surface relative cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong hover:border-accent/55 hover:bg-accent/[0.04] bg-paper-2/30 py-12 transition-colors group">
                <input ref={ref} type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.gif"
                    className="hidden" onChange={e => { e.target.files?.[0] && setFile(e.target.files[0]); e.target.value = ""; }} />
                <CornerMarks />
                <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-accent/10 border border-accent/30 group-hover:bg-accent/15 transition-colors">
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[17px] font-semibold text-foreground tracking-[-0.02em]">{file ? file.name : "Drop an image"}</p>
                {file && <p className="font-medium text-[11.5px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>}
            </div>
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label htmlFor="palette-n" className="text-sm font-semibold">Number of colors</label>
                    <span className="text-xs font-mono text-accent">{colors}</span>
                </div>
                <input id="palette-n" type="range" min={2} max={24} step={1} value={colors}
                    onChange={e => setColors(parseInt(e.target.value, 10))} className="w-full" />
            </div>
            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
            {file && status !== "processing" && (
                <div className="flex items-center gap-3 flex-wrap">
                    <Button onClick={process} className="">Extract palette</Button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}
            {status === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Analyzing…</Button>}
            {palette && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Dominant colors · {palette.length}</span>
                        <Palette size={11} className="text-accent" />
                    </div>
                    {/* Click-to-copy swatch row */}
                    <div className="flex h-16 border-b border-border" role="group" aria-label="Color palette swatches">
                        {palette.map((p, i) => {
                            const isCopied = copiedHex === p.hex;
                            return (
                                <button
                                    key={i}
                                    type="button"
                                    aria-label={`Copy hex ${p.hex}`}
                                    title={`${p.hex} — click to copy`}
                                    onClick={() => copyHex(p.hex)}
                                    className="relative group focus:outline-none focus:ring-2 focus:ring-accent ring-inset"
                                    style={{ background: p.hex, flexGrow: p.percentage || 1 }}
                                >
                                    <span className={cn(
                                        "font-medium absolute inset-0 flex items-center justify-center text-[11px] transition-opacity",
                                        isCopied ? "opacity-100 bg-black/40 text-white" : "opacity-0 group-hover:opacity-100 bg-black/30 text-white"
                                    )}>
                                        {isCopied ? <><Check size={11} className="mr-1" /> Copied</> : p.hex}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    {/* Detail list */}
                    <div className="divide-y divide-border">
                        {palette.map((p, i) => (
                            <button
                                type="button"
                                key={i}
                                onClick={() => copyHex(p.hex)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-secondary/40 transition-colors",
                                    copiedHex === p.hex && "animate-copy-flash"
                                )}
                            >
                                <div className="h-8 w-8 rounded-md shrink-0 border border-border" style={{ background: p.hex }} />
                                <div className="flex-1 min-w-0">
                                    <p className="font-mono text-[13px] text-foreground">{p.hex}</p>
                                    <p className="font-medium text-[11.5px] text-muted-foreground">rgb({p.rgb.join(", ")}) · {p.percentage}%</p>
                                </div>
                                <span className="font-medium text-[11px] text-muted-foreground inline-flex items-center gap-1">
                                    {copiedHex === p.hex ? <><Check size={11} className="text-accent" /> Copied</> : <><Copy size={11} /> Copy</>}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Pixelate / Blur Image ──────────────────────────────────────────────
export function PixelateImageUI() {
    const [file, setFile] = useState<File | null>(null);
    const [mode, setMode] = useState<"pixelate" | "blur">("pixelate");
    const [strength, setStrength] = useState(20);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = !!file && status !== "processing";
    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/pixelate-image", file, { mode, strength });
            const blob = await res.blob();
            downloadBlob(blob, buildOutputFilename(file.name, mode === "pixelate" ? "pixelated" : "blurred", file.name.split(".").pop() || "png"));
            setStatus("done");
        } catch (e) {
            setError(friendlyError(e instanceof Error ? e.message : "Failed", "Something went wrong"));
            setStatus("idle");
        }
    }, [file, mode, strength]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    return (
        <div className="space-y-4">
            <div onClick={() => ref.current?.click()}
                className="dropzone-surface relative cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong hover:border-accent/55 hover:bg-accent/[0.04] bg-paper-2/30 py-12 transition-colors group">
                <input ref={ref} type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.bmp" className="hidden"
                    onChange={e => { e.target.files?.[0] && setFile(e.target.files[0]); e.target.value = ""; }} />
                <CornerMarks />
                <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-accent/10 border border-accent/30 group-hover:bg-accent/15 transition-colors">
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[17px] font-semibold text-foreground tracking-[-0.02em]">{file ? file.name : "Drop an image"}</p>
                {file && <p className="font-medium text-[11.5px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>}
            </div>
            <div className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
                <div>
                    <p className="text-sm font-semibold mb-2">Effect</p>
                    <div className="grid grid-cols-2 gap-2">
                        {(["pixelate", "blur"] as const).map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMode(m)}
                                aria-pressed={mode === m}
                                className={cn(
                                    "rounded-lg border p-3 text-left transition-all",
                                    mode === m ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-accent/[0.04]"
                                )}
                            >
                                <p className="text-[13px] font-semibold text-foreground capitalize">{m}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                                    {m === "pixelate" ? "Block mosaic — readable censoring" : "Gaussian blur — smooth obfuscation"}
                                </p>
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label htmlFor="px-strength" className="text-sm font-semibold">Strength</label>
                        <span className="text-xs font-mono text-accent">{strength}</span>
                    </div>
                    <input id="px-strength" type="range" min={1} max={100} step={1} value={strength}
                        onChange={e => setStrength(parseInt(e.target.value, 10))} className="w-full" />
                </div>
            </div>
            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
            {file && status !== "processing" && (
                <div className="flex items-center gap-3 flex-wrap">
                    <Button onClick={process} className="">Apply {mode}</Button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}
            {status === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Applying…</Button>}
            {status === "done" && (
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] p-6 text-center animate-fade-up">
                    <div className="h-12 w-12 mx-auto rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center animate-success-pop mb-3">
                        <CheckCircle2 size={22} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="text-sm font-semibold text-accent mb-3">Image {mode === "pixelate" ? "pixelated" : "blurred"} and downloaded</p>
                    <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Try another</Button>
                </div>
            )}
        </div>
    );
}

// ─── Rotate Image ───────────────────────────────────────────────────────
export function RotateImageUI() {
    const [file, setFile] = useState<File | null>(null);
    const [degrees, setDegrees] = useState<number>(90);
    const [customMode, setCustomMode] = useState(false);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = !!file && status !== "processing";
    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/rotate-image", file, { degrees });
            const blob = await res.blob();
            const ext = file.name.split(".").pop() || "png";
            downloadBlob(blob, buildOutputFilename(file.name, "rotated", ext));
            setStatus("done");
        } catch (e) {
            setError(friendlyError(e instanceof Error ? e.message : "Failed", "Something went wrong"));
            setStatus("idle");
        }
    }, [file, degrees]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    return (
        <div className="space-y-4">
            <div onClick={() => ref.current?.click()}
                className="dropzone-surface relative cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong hover:border-accent/55 hover:bg-accent/[0.04] bg-paper-2/30 py-12 transition-colors group">
                <input ref={ref} type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); e.target.value = ""; }} />
                <CornerMarks />
                <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-accent/10 border border-accent/30 group-hover:bg-accent/15 transition-colors">
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[17px] font-semibold text-foreground tracking-[-0.02em]">{file ? file.name : "Drop an image"}</p>
                {file && <p className="font-medium text-[11.5px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>}
            </div>

            <div className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
                <div>
                    <p className="text-sm font-semibold mb-2">Rotation</p>
                    <div className="grid grid-cols-4 gap-2">
                        {[90, 180, 270, "custom"].map(opt => {
                            const isCustom = opt === "custom";
                            const isActive = isCustom ? customMode : (!customMode && degrees === opt);
                            return (
                                <button
                                    key={String(opt)}
                                    type="button"
                                    onClick={() => {
                                        if (isCustom) { setCustomMode(true); }
                                        else { setCustomMode(false); setDegrees(opt as number); }
                                    }}
                                    aria-pressed={isActive}
                                    className={cn(
                                        "rounded-lg border p-3 text-center transition-all",
                                        isActive ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-accent/[0.04]"
                                    )}
                                >
                                    <p className="text-[13px] font-semibold text-foreground">{isCustom ? "Custom" : `${opt}°`}</p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                        {opt === 90 ? "Right" : opt === 180 ? "Upside-down" : opt === 270 ? "Left" : "Any angle"}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>
                {customMode && (
                    <div>
                        <label htmlFor="rot-deg" className="text-sm font-semibold flex justify-between mb-2">
                            <span>Custom angle</span><span className="text-xs font-mono text-accent">{degrees}°</span>
                        </label>
                        <input id="rot-deg" type="range" min={-180} max={180} step={1} value={degrees}
                            onChange={e => setDegrees(parseInt(e.target.value, 10))} className="w-full" />
                        <p className="text-[11px] text-muted-foreground mt-1">Counter-clockwise. Canvas auto-expands so no cropping.</p>
                    </div>
                )}
            </div>

            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
            {file && status !== "processing" && (
                <div className="flex items-center gap-3 flex-wrap">
                    <Button onClick={process} className=""><RotateCw size={14} className="mr-1.5" />Rotate image</Button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}
            {status === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Rotating…</Button>}
            {status === "done" && (
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] p-6 text-center animate-fade-up">
                    <div className="h-12 w-12 mx-auto rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center animate-success-pop mb-3">
                        <CheckCircle2 size={22} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="text-sm font-semibold text-accent mb-3">Image rotated and downloaded</p>
                    <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Try another</Button>
                </div>
            )}
        </div>
    );
}

// ─── Flip Image ─────────────────────────────────────────────────────────
export function FlipImageUI() {
    const [file, setFile] = useState<File | null>(null);
    const [direction, setDirection] = useState<"horizontal" | "vertical">("horizontal");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = !!file && status !== "processing";
    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/flip-image", file, { direction });
            const blob = await res.blob();
            const ext = file.name.split(".").pop() || "png";
            downloadBlob(blob, buildOutputFilename(file.name, `flipped-${direction[0]}`, ext));
            setStatus("done");
        } catch (e) {
            setError(friendlyError(e instanceof Error ? e.message : "Failed", "Something went wrong"));
            setStatus("idle");
        }
    }, [file, direction]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    return (
        <div className="space-y-4">
            <div onClick={() => ref.current?.click()}
                className="dropzone-surface relative cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong hover:border-accent/55 hover:bg-accent/[0.04] bg-paper-2/30 py-12 transition-colors group">
                <input ref={ref} type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); e.target.value = ""; }} />
                <CornerMarks />
                <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-accent/10 border border-accent/30 group-hover:bg-accent/15 transition-colors">
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[17px] font-semibold text-foreground tracking-[-0.02em]">{file ? file.name : "Drop an image"}</p>
                {file && <p className="font-medium text-[11.5px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>}
            </div>

            <div className="rounded-xl border border-border bg-card/40 p-5">
                <p className="text-sm font-semibold mb-2">Direction</p>
                <div className="grid grid-cols-2 gap-2">
                    {([
                        { value: "horizontal", label: "Horizontal", hint: "Mirror left ↔ right", icon: FlipHorizontal },
                        { value: "vertical",   label: "Vertical",   hint: "Mirror top ↔ bottom", icon: FlipVertical },
                    ] as const).map(opt => {
                        const Icon = opt.icon;
                        const active = direction === opt.value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setDirection(opt.value)}
                                aria-pressed={active}
                                className={cn(
                                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-all",
                                    active ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-accent/[0.04]"
                                )}
                            >
                                <Icon size={18} className="text-muted-foreground shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-[13px] font-semibold text-foreground">{opt.label}</p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">{opt.hint}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
            {file && status !== "processing" && (
                <div className="flex items-center gap-3 flex-wrap">
                    <Button onClick={process} className="">{direction === "horizontal" ? <FlipHorizontal size={14} className="mr-1.5" /> : <FlipVertical size={14} className="mr-1.5" />}Flip image</Button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}
            {status === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Flipping…</Button>}
            {status === "done" && (
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] p-6 text-center animate-fade-up">
                    <div className="h-12 w-12 mx-auto rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center animate-success-pop mb-3">
                        <CheckCircle2 size={22} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="text-sm font-semibold text-accent mb-3">Image flipped and downloaded</p>
                    <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Try another</Button>
                </div>
            )}
        </div>
    );
}

// ─── Shared CornerMarks ─────────────────────────────────────────────────
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
