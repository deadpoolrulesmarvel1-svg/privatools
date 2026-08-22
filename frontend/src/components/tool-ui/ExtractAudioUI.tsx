/**
 * ExtractAudioUI — strip audio track from a video.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Music } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const formats = ["mp3", "wav", "aac", "flac", "ogg"];

const EXTRACT_AUDIO_DEFAULTS: { format: string } = {
    format: "mp3",
};

export function ExtractAudioUI() {
    const [config, , { setField }] = useToolDefaults("extract-audio", EXTRACT_AUDIO_DEFAULTS);
    const { format } = config;
    const setFormat = useCallback((v: React.SetStateAction<typeof EXTRACT_AUDIO_DEFAULTS["format"]>) => setField("format", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const canProcess = !!file && status !== "processing";

    // Local object URL for inline video preview.
    const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
    useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            await processAndDownload("/extract-audio", file, buildOutputFilename(file.name, null, format), { format });
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't extract audio from that video."));
            setStatus("idle");
        }
    }, [file, format]);

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
                        <p className="section-mark mb-2">Audio extracted</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            Saved as <span className="italic text-accent">.{format}</span>
                        </h2>
                        <button
                            onClick={() => { setFile(null); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Extract another
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
                accept=".mp4,.webm,.avi,.mov,.mkv"
                label="Drop video to extract audio"
                hint="MP4 · WebM · AVI · MOV · MKV"
            />
            {file && (
                <>
                    {objectUrl && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                                Preview · original video
                            </div>
                            <div className="bg-black/95">
                                <video src={objectUrl} controls playsInline className="w-full max-h-[40vh]" aria-label={`Preview ${file.name}`} />
                            </div>
                        </div>
                    )}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Output format
                        </div>
                        <div className="p-3 grid grid-cols-3 sm:grid-cols-5 gap-2" role="group" aria-label="Audio format">
                            {formats.map(f => {
                                const active = format === f;
                                return (
                                    <button
                                        key={f}
                                        onClick={() => setFormat(f)}
                                        aria-pressed={active}
                                        className={cn(
                                            "font-medium rounded-lg border py-2.5 px-2 text-[12px] transition-colors",
                                            active ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                        )}
                                    >
                                        {f}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Extracting…</> : <><Music size={13} /> Extract audio as {format.toUpperCase()}</>}
                        </button>
                        {canProcess && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
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
