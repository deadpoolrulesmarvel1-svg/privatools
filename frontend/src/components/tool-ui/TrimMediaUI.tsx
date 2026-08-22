/**
 * TrimMediaUI — cut a video or audio file using HH:MM:SS start/end times.
 *
 * Includes an inline preview so the user can scrub through and find the right
 * timestamps before submitting. The whole file is loaded into an object URL —
 * the bytes never leave the browser until the user clicks "Trim".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Scissors, Play, Pause } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

function formatHms(sec: number): string {
    if (!isFinite(sec) || sec < 0) return "00:00:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseHms(s: string): number {
    const m = s.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/);
    if (!m) return 0;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? Number("0." + m[4]) : 0);
}

export function TrimMediaUI() {
    const [file, setFile] = useState<File | null>(null);
    const [start, setStart] = useState("00:00:00");
    const [end, setEnd] = useState("00:00:10");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [duration, setDuration] = useState(0);
    const [current, setCurrent] = useState(0);
    const [playing, setPlaying] = useState(false);
    const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

    const isAudio = useMemo(() => {
        if (!file) return false;
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        return ["mp3", "wav", "aac", "flac", "ogg", "m4a"].includes(ext);
    }, [file]);

    const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
    useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

    // Whenever the file changes, reset state to a sensible default.
    useEffect(() => {
        setStart("00:00:00");
        setEnd("00:00:10");
        setDuration(0);
        setCurrent(0);
        setPlaying(false);
    }, [file]);

    const startSec = parseHms(start);
    const endSec = parseHms(end);

    const canProcess = !!file && status !== "processing" && startSec < endSec;

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const ext = file.name.split(".").pop() || "mp4";
            await processAndDownload("/trim-media", file, buildOutputFilename(file.name, "trimmed", ext), { start, end });
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't trim that media file."));
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

    const seek = (sec: number) => {
        if (mediaRef.current) mediaRef.current.currentTime = sec;
    };
    const togglePlay = () => {
        if (!mediaRef.current) return;
        if (playing) mediaRef.current.pause();
        else mediaRef.current.play();
    };

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Trimmed</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{start} → {end}</span>
                        </h2>
                        <button
                            onClick={() => { setFile(null); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Trim another
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
                accept=".mp4,.mp3,.webm,.avi,.wav,.mov,.mkv,.aac,.flac,.ogg"
                label="Drop video/audio to trim"
                hint="MP4 · MP3 · WebM · AVI · WAV · MOV · MKV"
            />
            {file && (
                <>
                    {objectUrl && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                                <span>Preview & scrub</span>
                                {duration > 0 && (
                                    <span className="text-accent normal-case tracking-normal">{formatHms(current)} / {formatHms(duration)}</span>
                                )}
                            </div>
                            <div className="bg-black/95">
                                {isAudio ? (
                                    <audio
                                        ref={mediaRef as React.RefObject<HTMLAudioElement>}
                                        src={objectUrl}
                                        className="w-full"
                                        onLoadedMetadata={e => setDuration((e.currentTarget as HTMLAudioElement).duration || 0)}
                                        onTimeUpdate={e => setCurrent((e.currentTarget as HTMLAudioElement).currentTime || 0)}
                                        onPlay={() => setPlaying(true)}
                                        onPause={() => setPlaying(false)}
                                        controls
                                    />
                                ) : (
                                    <video
                                        ref={mediaRef as React.RefObject<HTMLVideoElement>}
                                        src={objectUrl}
                                        className="w-full max-h-[40vh]"
                                        onLoadedMetadata={e => setDuration((e.currentTarget as HTMLVideoElement).duration || 0)}
                                        onTimeUpdate={e => setCurrent((e.currentTarget as HTMLVideoElement).currentTime || 0)}
                                        onPlay={() => setPlaying(true)}
                                        onPause={() => setPlaying(false)}
                                        playsInline
                                    />
                                )}
                            </div>
                            {duration > 0 && (
                                <div className="p-3 space-y-2">
                                    <div className="relative h-7">
                                        {/* Selection overlay */}
                                        {startSec < endSec && endSec <= duration && (
                                            <div
                                                className="absolute top-1/2 -translate-y-1/2 h-2 bg-accent/30 rounded-full pointer-events-none"
                                                style={{
                                                    left: `${(startSec / duration) * 100}%`,
                                                    width: `${((Math.min(endSec, duration) - startSec) / duration) * 100}%`,
                                                }}
                                            />
                                        )}
                                        <input
                                            type="range" min={0} max={duration} step={0.05}
                                            value={current}
                                            onChange={e => seek(parseFloat(e.target.value))}
                                            className="absolute inset-0 w-full accent-accent"
                                            aria-label="Scrub playhead"
                                        />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={togglePlay}
                                            aria-label={playing ? "Pause preview" : "Play preview"}
                                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-[12px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                        >
                                            {playing ? <Pause size={12} /> : <Play size={12} />} {playing ? "Pause" : "Play"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStart(formatHms(current))}
                                            className="font-medium inline-flex items-center gap-1 h-8 px-3 rounded-md border border-border bg-card text-[12px] text-foreground hover:bg-secondary/60 transition-colors"
                                        >
                                            Mark start
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setEnd(formatHms(current))}
                                            className="font-medium inline-flex items-center gap-1 h-8 px-3 rounded-md border border-border bg-card text-[12px] text-foreground hover:bg-secondary/60 transition-colors"
                                        >
                                            Mark end
                                        </button>
                                        <span className="font-medium ml-auto text-[11.5px] text-muted-foreground">
                                            Selection: {(endSec - startSec).toFixed(1)}s
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Time range (HH:MM:SS)
                        </div>
                        <div className="p-4 grid grid-cols-2 gap-3">
                            <div>
                                <label className="font-medium text-[11px] text-muted-foreground">Start</label>
                                <input value={start} onChange={e => setStart(e.target.value)} placeholder="00:00:00"
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors" />
                            </div>
                            <div>
                                <label className="font-medium text-[11px] text-muted-foreground">End</label>
                                <input value={end} onChange={e => setEnd(e.target.value)} placeholder="00:00:10"
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors" />
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
                            {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Trimming…</> : <><Scissors size={13} /> Trim {start} → {end}</>}
                        </button>
                        {canProcess && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                        )}
                        {startSec >= endSec && (
                            <span className="font-medium text-[11.5px] text-destructive">
                                End must be after start
                            </span>
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
