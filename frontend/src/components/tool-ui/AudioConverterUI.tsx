/**
 * AudioConverterUI — convert audio file format + bitrate.
 * Workshop: format gallery + bitrate row (disabled when lossless) + inline preview.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Music, Download } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const FORMATS = [
    { v: "mp3",  label: "MP3",  desc: "Universal" },
    { v: "wav",  label: "WAV",  desc: "Lossless" },
    { v: "ogg",  label: "OGG",  desc: "Open" },
    { v: "flac", label: "FLAC", desc: "Lossless cmp." },
    { v: "aac",  label: "AAC",  desc: "Apple" },
];
const BITRATES = ["64k", "128k", "192k", "256k", "320k"];

const AUDIO_CONVERTER_DEFAULTS: { format: string; bitrate: string } = {
    format: "mp3",
    bitrate: "192k",
};

export function AudioConverterUI() {
    const [config, , { setField }] = useToolDefaults("audio-converter", AUDIO_CONVERTER_DEFAULTS);
    const { format, bitrate } = config;
    const setFormat = useCallback((v: React.SetStateAction<typeof AUDIO_CONVERTER_DEFAULTS["format"]>) => setField("format", v), [setField]);
    const setBitrate = useCallback((v: React.SetStateAction<typeof AUDIO_CONVERTER_DEFAULTS["bitrate"]>) => setField("bitrate", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);

    const isLossless = format === "wav" || format === "flac";

    // Object URL for the inline preview — revoked on unmount / file change.
    const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
    useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

    const canProcess = !!file && state !== "processing";

    const process = useCallback(async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            const res = await uploadFile("/audio-converter", file, { format, bitrate });
            const blob = await res.blob();
            const stem = file.name.replace(/\.[^.]+$/, "");
            downloadBlob(blob, `${stem}.${format}`);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Conversion failed";
            setError(friendlyError(msg, "Couldn't convert that audio."));
            setState("idle");
        }
    }, [file, format, bitrate]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <Music size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Converted</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            Saved as <span className="italic text-accent">.{format}</span>{!isLossless && <> @ <span className="italic text-accent">{bitrate}</span></>}
                        </h2>
                        <button
                            onClick={() => { setFile(null); setState("idle"); }}
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
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a,.wma"
                label="Drop audio to convert"
                hint="MP3 · WAV · OGG · FLAC · AAC · M4A · WMA"
            />
            {file && (
                <>
                    {objectUrl && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                                Preview · original audio
                            </div>
                            <div className="p-3">
                                <audio src={objectUrl} controls className="w-full" aria-label={`Preview ${file.name}`} />
                            </div>
                        </div>
                    )}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Output format
                        </div>
                        <div className="p-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
                            {FORMATS.map(f => {
                                const active = format === f.v;
                                return (
                                    <button
                                        key={f.v}
                                        onClick={() => setFormat(f.v)}
                                        className={cn(
                                            "rounded-lg border p-3 text-center transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <p className={cn("font-display text-[14px] font-bold tracking-[-0.015em]", active ? "text-accent" : "text-foreground")}>{f.label}</p>
                                        <p className="font-medium text-[9.5px] text-muted-foreground/85 mt-0.5">{f.desc}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Bitrate</span>
                            {isLossless && <span className="text-muted-foreground/50 normal-case tracking-normal">— lossless, bitrate unused</span>}
                        </div>
                        <div className="p-3 grid grid-cols-5 gap-2">
                            {BITRATES.map(b => {
                                const active = bitrate === b && !isLossless;
                                return (
                                    <button
                                        key={b}
                                        onClick={() => setBitrate(b)}
                                        disabled={isLossless}
                                        className={cn(
                                            "font-medium rounded-lg border py-2.5 text-[12px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                                            active ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                        )}
                                    >
                                        {b}
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
                            {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Converting…</> : <><Download size={13} /> Convert to {format.toUpperCase()}</>}
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
