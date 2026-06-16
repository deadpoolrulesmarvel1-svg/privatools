/**
 * Thin wrappers around GenericUI for the new video tools that need a few
 * params surfaced (frame count, target format, resolution preset, timestamp).
 * Add-subtitles needs a custom UI because it takes two file uploads.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Loader2, AlertCircle, FileText, X, CheckCircle2, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, buildOutputFilename, postFormData } from "@/lib/api";
import { GenericUI } from "./GenericUI";

// ─── 1. Video → PDF ─ frame count slider ─────────────────────────────
export function VideoToPdfUI() {
    const [frames, setFrames] = useState(12);
    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card/40 p-5">
                <div className="flex items-center justify-between mb-2">
                    <label htmlFor="vtp-frames" className="text-sm font-semibold text-foreground">Number of frames</label>
                    <span className="text-xs font-mono text-accent">{frames}</span>
                </div>
                <input
                    id="vtp-frames"
                    type="range" min={1} max={60} step={1}
                    value={frames}
                    onChange={e => setFrames(parseInt(e.target.value, 10))}
                    className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>1 — single page</span>
                    <span>60 — frame-by-frame</span>
                </div>
                <p className="text-[11px] text-muted-foreground/80 mt-2">
                    Frames are sampled evenly across the clip — 12 is a good default for a 1-minute video.
                </p>
            </div>
            <GenericUI
                slug="video-to-pdf"
                toolName="Convert video to PDF"
                outputLabel="frames.pdf"
                accepts=".mp4,.mov,.webm,.avi,.mkv"
                params={{ frames }}
            />
        </div>
    );
}

// ─── 2. Video converter ─ format picker ─────────────────────────────
const VIDEO_FORMATS = [
    { id: "mp4",  label: "MP4",  desc: "H.264 + AAC — universal" },
    { id: "mov",  label: "MOV",  desc: "H.264 + AAC — Apple-friendly" },
    { id: "webm", label: "WebM", desc: "VP9 + Opus — small + open" },
    { id: "mkv",  label: "MKV",  desc: "H.264 + AAC — flexible container" },
    { id: "avi",  label: "AVI",  desc: "MPEG-4 + MP3 — legacy" },
];
export function VideoConverterUI() {
    const [target, setTarget] = useState("mp4");
    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card/40 p-5">
                <p className="text-sm font-semibold text-foreground mb-3">Target format</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {VIDEO_FORMATS.map(f => (
                        <button
                            key={f.id}
                            type="button"
                            onClick={() => setTarget(f.id)}
                            aria-pressed={target === f.id}
                            className={cn(
                                "rounded-lg border p-2.5 text-left transition-all",
                                target === f.id ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-paper-2/30"
                            )}
                        >
                            <p className="text-[13px] font-semibold text-foreground">{f.label}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{f.desc}</p>
                        </button>
                    ))}
                </div>
            </div>
            <GenericUI
                slug="video-converter"
                toolName={`Convert to ${target.toUpperCase()}`}
                outputLabel={`converted.${target}`}
                accepts=".mp4,.mov,.webm,.avi,.mkv,.m4v"
                params={{ target_format: target }}
            />
        </div>
    );
}

// ─── 3. Video resizer ─ preset picker ───────────────────────────────
const VIDEO_PRESETS = ["240p", "360p", "480p", "720p", "1080p", "1440p"];
export function VideoResizerUI() {
    const [preset, setPreset] = useState("720p");
    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card/40 p-5">
                <p className="text-sm font-semibold text-foreground mb-3">Output resolution</p>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {VIDEO_PRESETS.map(p => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => setPreset(p)}
                            aria-pressed={preset === p}
                            className={cn(
                                "rounded-lg border h-10 text-[13px] font-medium transition-all",
                                preset === p ? "border-accent bg-accent/5 text-foreground" : "border-border text-muted-foreground hover:bg-paper-2/30 hover:text-foreground"
                            )}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>
            <GenericUI
                slug="video-resizer"
                toolName={`Resize to ${preset}`}
                outputLabel={`video_${preset}.mp4`}
                accepts=".mp4,.mov,.webm,.avi,.mkv"
                params={{ preset }}
            />
        </div>
    );
}

// ─── 4. Video thumbnail ─ timestamp picker ──────────────────────────
export function VideoThumbnailUI() {
    const [ts, setTs] = useState(1);
    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card/40 p-5">
                <div className="flex items-center justify-between mb-2">
                    <label htmlFor="vt-ts" className="text-sm font-semibold text-foreground">Timestamp (seconds)</label>
                    <span className="text-xs font-mono text-accent">{ts}s</span>
                </div>
                <input
                    id="vt-ts"
                    type="number" inputMode="numeric" min={0} max={86400} step={0.1}
                    value={ts}
                    onChange={e => setTs(parseFloat(e.target.value) || 0)}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:border-accent"
                />
                <p className="text-[11px] text-muted-foreground/80 mt-2">
                    Pick the moment in the video — set to 1.0 to skip the very first frame which is often a fade-in.
                </p>
            </div>
            <GenericUI
                slug="video-thumbnail"
                toolName="Extract thumbnail"
                outputLabel="thumbnail.jpg"
                accepts=".mp4,.mov,.webm,.avi,.mkv"
                params={{ time_seconds: ts }}
            />
        </div>
    );
}

// ─── 5. GIF → MP4 (no options needed) ───────────────────────────────
export function GifToMp4UI() {
    return (
        <GenericUI
            slug="gif-to-mp4"
            toolName="Convert GIF to MP4"
            outputLabel="animation.mp4"
            accepts=".gif"
        />
    );
}

// ─── 6. Add subtitles — needs TWO file inputs ───────────────────────
export function AddSubtitlesUI() {
    const [video, setVideo] = useState<File | null>(null);
    const [srt, setSrt] = useState<File | null>(null);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState<"video" | "srt" | null>(null);
    const vidRef = useRef<HTMLInputElement>(null);
    const srtRef = useRef<HTMLInputElement>(null);

    const canProcess = !!video && !!srt && state !== "processing";

    const process = useCallback(async () => {
        if (!video || !srt) return;
        setState("processing");
        setError(null);
        try {
            const res = await postFormData("/add-subtitles", () => {
                const fd = new FormData();
                fd.append("file", video);
                fd.append("srt", srt);
                return fd;
            }, { timeoutMs: 300_000 });
            const blob = await res.blob();
            downloadBlob(blob, buildOutputFilename(video?.name, "subtitled", "mp4"));
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't burn subtitles into that video."));
            setState("idle");
        }
    }, [video, srt]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (state === "done") {
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Subtitled</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                Subtitled <span className="italic text-accent">MP4</span> ready
                            </h2>
                            <p className="mt-2 font-mono text-[11px] tracking-[0.06em] uppercase text-muted-foreground">
                                Downloaded as {buildOutputFilename(video?.name, "subtitled", "mp4")}
                            </p>
                            <button
                                onClick={() => { setVideo(null); setSrt(null); setState("idle"); }}
                                className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Subtitle another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const Slot = ({
        label, file, onPick, accept, slotKey, inputRef,
    }: {
        label: string; file: File | null; onPick: (f: File | null) => void; accept: string;
        slotKey: "video" | "srt"; inputRef: React.RefObject<HTMLInputElement>;
    }) => (
        <div
            onDragOver={e => { e.preventDefault(); setDrag(slotKey); }}
            onDragLeave={() => setDrag(null)}
            onDrop={e => { e.preventDefault(); setDrag(null); if (e.dataTransfer.files[0]) onPick(e.dataTransfer.files[0]); }}
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
            role="button"
            tabIndex={0}
            aria-label={`Upload ${label}`}
            className={cn(
                "flex items-center gap-4 rounded-xl border-2 border-dashed cursor-pointer transition-all px-5 py-4",
                drag === slotKey ? "border-accent bg-accent/5" : file ? "border-accent/30 bg-card" : "border-border hover:border-accent/55 hover:bg-secondary/30 bg-secondary/10"
            )}
        >
            <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={e => { onPick(e.target.files?.[0] || null); e.target.value = ""; }} />
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg shrink-0", file ? "bg-accent/10" : "bg-secondary")}>
                {file ? <FileText size={18} className="text-accent" /> : <Upload size={18} className="text-muted-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                    {label}
                </p>
                {file ? (
                    <p className="text-[12px] text-muted-foreground truncate">{file.name} · {formatFileSize(file.size)}</p>
                ) : (
                    <p className="text-[12px] text-muted-foreground">Drop or click to pick · {accept}</p>
                )}
            </div>
            {file && (
                <button
                    onClick={e => { e.stopPropagation(); onPick(null); }}
                    aria-label={`Remove ${label}`}
                    className="text-muted-foreground hover:text-foreground"
                >
                    <X size={15} />
                </button>
            )}
        </div>
    );

    return (
        <div className="space-y-3">
            <Slot label="Video file"        file={video} onPick={setVideo} accept=".mp4,.mov,.webm,.avi,.mkv" slotKey="video" inputRef={vidRef} />
            <Slot label="Subtitle (.srt or .vtt)" file={srt} onPick={setSrt} accept=".srt,.vtt" slotKey="srt" inputRef={srtRef} />

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3 pt-1 flex-wrap">
                <Button onClick={process} disabled={!canProcess} className="rounded-full h-10 px-5 bg-foreground text-background hover:bg-foreground/90">
                    {state === "processing"
                        ? <><Loader2 size={14} className="animate-spin mr-1.5" />Burning subtitles…</>
                        : <><Play size={14} className="mr-1.5" />Burn subtitles into video</>}
                </Button>
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
