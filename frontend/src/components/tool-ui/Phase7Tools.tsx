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
import { useState, useRef } from "react";
import { Upload, Loader2, AlertCircle, X, FileText, CheckCircle2, Copy, RotateCw, FlipHorizontal, FlipVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, uploadFileGetJson, downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";

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
    const process = async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            const res = await uploadFile("/video-speed", file.raw, { speed: speed.toFixed(2) });
            const blob = await res.blob();
            const stem = file.name.replace(/\.[^.]+$/, "");
            downloadBlob(blob, `${stem}_${speed.toFixed(2).replace(/\.00$/, "")}x.mp4`);
            setState("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed");
            setState("idle");
        }
    };

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
                className="cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border hover:border-accent/40 bg-secondary/20 py-12 transition-all">
                <input ref={ref} type="file" accept=".mp4,.mov,.webm,.avi,.mkv" className="hidden" onChange={e => { e.target.files && pick(e.target.files); e.target.value = ""; }} />
                <Upload size={22} className="text-muted-foreground" />
                <p className="text-sm font-semibold">{file ? file.name : "Drop a video here"}</p>
                {file && <p className="text-xs text-muted-foreground">{file.size}</p>}
            </div>
            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
            {file && state !== "processing" && (
                <Button onClick={process} className="glow-primary">Change speed</Button>
            )}
            {state === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Processing…</Button>}
            {state === "done" && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
                    <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-400" />
                    <p className="text-sm font-semibold text-emerald-400 mb-3">Video sped to {speed.toFixed(2)}×</p>
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

    const process = async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/audio-trim", file, { start, end });
            const blob = await res.blob();
            const ext = file.name.split(".").pop() || "mp3";
            downloadBlob(blob, buildOutputFilename(file.name, "trimmed", ext));
            setStatus("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed");
            setStatus("idle");
        }
    };

    return (
        <div className="space-y-4">
            <div onClick={() => ref.current?.click()}
                className="cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border hover:border-accent/40 bg-secondary/20 py-12 transition-all">
                <input ref={ref} type="file" accept=".mp3,.wav,.aac,.flac,.ogg,.m4a" className="hidden" onChange={e => { e.target.files?.[0] && setFile(e.target.files[0]); e.target.value = ""; }} />
                <Upload size={22} className="text-muted-foreground" />
                <p className="text-sm font-semibold">{file ? file.name : "Drop an audio file"}</p>
                {file && <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>}
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
                <Button onClick={process} className="glow-primary">Trim audio</Button>
            )}
            {status === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Trimming…</Button>}
            {status === "done" && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
                    <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-400" />
                    <p className="text-sm font-semibold text-emerald-400 mb-3">Trimmed audio downloaded</p>
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
    const ref = useRef<HTMLInputElement>(null);

    const process = async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const data = await uploadFileGetJson<{ palette: PaletteEntry[] }>("/image-palette", file, { colors });
            setPalette(data.palette);
            setStatus("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed");
            setStatus("idle");
        }
    };

    return (
        <div className="space-y-4">
            <div onClick={() => ref.current?.click()}
                className="cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border hover:border-accent/40 bg-secondary/20 py-12 transition-all">
                <input ref={ref} type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.gif"
                    className="hidden" onChange={e => { e.target.files?.[0] && setFile(e.target.files[0]); e.target.value = ""; }} />
                <Upload size={22} className="text-muted-foreground" />
                <p className="text-sm font-semibold">{file ? file.name : "Drop an image"}</p>
                {file && <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>}
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
                <Button onClick={process} className="glow-primary">Extract palette</Button>
            )}
            {status === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Analyzing…</Button>}
            {palette && (
                <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">Dominant colors</p>
                    <div className="grid gap-2">
                        {palette.map((p, i) => (
                            <div key={i} className="flex items-center gap-3 rounded-lg border border-border/60 p-3">
                                <div className="h-12 w-12 rounded-md shrink-0 border border-border" style={{ background: p.hex }} />
                                <div className="flex-1 min-w-0">
                                    <p className="font-mono text-[13px] text-foreground">{p.hex}</p>
                                    <p className="text-[11px] text-muted-foreground">rgb({p.rgb.join(", ")}) · {p.percentage}%</p>
                                </div>
                                <Button
                                    type="button" size="sm" variant="outline"
                                    onClick={() => navigator.clipboard.writeText(p.hex).catch(() => { })}
                                    className="rounded-full h-8 px-3 border-border"
                                ><Copy size={12} className="mr-1" />Copy</Button>
                            </div>
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

    const process = async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/pixelate-image", file, { mode, strength });
            const blob = await res.blob();
            downloadBlob(blob, buildOutputFilename(file.name, mode === "pixelate" ? "pixelated" : "blurred", file.name.split(".").pop() || "png"));
            setStatus("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed");
            setStatus("idle");
        }
    };

    return (
        <div className="space-y-4">
            <div onClick={() => ref.current?.click()}
                className="cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border hover:border-accent/40 bg-secondary/20 py-12 transition-all">
                <input ref={ref} type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.bmp" className="hidden"
                    onChange={e => { e.target.files?.[0] && setFile(e.target.files[0]); e.target.value = ""; }} />
                <Upload size={22} className="text-muted-foreground" />
                <p className="text-sm font-semibold">{file ? file.name : "Drop an image"}</p>
                {file && <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>}
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
                                    mode === m ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-secondary/40"
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
                <Button onClick={process} className="glow-primary">Apply {mode}</Button>
            )}
            {status === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Applying…</Button>}
            {status === "done" && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
                    <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-400" />
                    <p className="text-sm font-semibold text-emerald-400 mb-3">Image {mode === "pixelate" ? "pixelated" : "blurred"} and downloaded</p>
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

    const process = async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/rotate-image", file, { degrees });
            const blob = await res.blob();
            const ext = file.name.split(".").pop() || "png";
            downloadBlob(blob, buildOutputFilename(file.name, "rotated", ext));
            setStatus("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed");
            setStatus("idle");
        }
    };

    return (
        <div className="space-y-4">
            <div onClick={() => ref.current?.click()}
                className="cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border hover:border-accent/40 bg-secondary/20 py-12 transition-all">
                <input ref={ref} type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); e.target.value = ""; }} />
                <Upload size={22} className="text-muted-foreground" />
                <p className="text-sm font-semibold">{file ? file.name : "Drop an image"}</p>
                {file && <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>}
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
                                        isActive ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-secondary/40"
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
                <Button onClick={process} className="glow-primary"><RotateCw size={14} className="mr-1.5" />Rotate image</Button>
            )}
            {status === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Rotating…</Button>}
            {status === "done" && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
                    <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-400" />
                    <p className="text-sm font-semibold text-emerald-400 mb-3">Image rotated and downloaded</p>
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

    const process = async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/flip-image", file, { direction });
            const blob = await res.blob();
            const ext = file.name.split(".").pop() || "png";
            downloadBlob(blob, buildOutputFilename(file.name, `flipped-${direction[0]}`, ext));
            setStatus("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed");
            setStatus("idle");
        }
    };

    return (
        <div className="space-y-4">
            <div onClick={() => ref.current?.click()}
                className="cursor-pointer flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border hover:border-accent/40 bg-secondary/20 py-12 transition-all">
                <input ref={ref} type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); e.target.value = ""; }} />
                <Upload size={22} className="text-muted-foreground" />
                <p className="text-sm font-semibold">{file ? file.name : "Drop an image"}</p>
                {file && <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>}
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
                                    active ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-secondary/40"
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
                <Button onClick={process} className="glow-primary">{direction === "horizontal" ? <FlipHorizontal size={14} className="mr-1.5" /> : <FlipVertical size={14} className="mr-1.5" />}Flip image</Button>
            )}
            {status === "processing" && <Button disabled><Loader2 size={14} className="animate-spin mr-1.5" />Flipping…</Button>}
            {status === "done" && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
                    <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-400" />
                    <p className="text-sm font-semibold text-emerald-400 mb-3">Image flipped and downloaded</p>
                    <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Try another</Button>
                </div>
            )}
        </div>
    );
}
