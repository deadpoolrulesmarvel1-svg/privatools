/**
 * Audio Converter — single audio file → choose target format + bitrate.
 */
import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, X, Music, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

const FORMATS = [
    { v: "mp3", label: "MP3", desc: "Universal, small files" },
    { v: "wav", label: "WAV", desc: "Lossless, large" },
    { v: "ogg", label: "OGG", desc: "Open, efficient" },
    { v: "flac", label: "FLAC", desc: "Lossless compressed" },
    { v: "aac", label: "AAC", desc: "Apple-friendly" },
];
const BITRATES = ["64k", "128k", "192k", "256k", "320k"];

export function AudioConverterUI() {
    const [file, setFile] = useState<File | null>(null);
    const [format, setFormat] = useState("mp3");
    const [bitrate, setBitrate] = useState("192k");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const process = async () => {
        if (!file) return;
        setState("processing");
        setError(null);
        try {
            const res = await uploadFile("/api/audio-converter", file, { format, bitrate });
            const blob = await res.blob();
            const stem = file.name.replace(/\.[^.]+$/, "");
            downloadBlob(blob, `${stem}.${format}`);
            setState("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Conversion failed");
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
                    <p className="text-sm font-semibold text-foreground">Choose an audio file</p>
                    <p className="mt-1 text-xs text-muted-foreground">MP3, WAV, OGG, FLAC, AAC, M4A, WMA</p>
                    <input
                        ref={ref}
                        type="file"
                        accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a,.wma"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }}
                    />
                </button>
            ) : (
                <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                    <Music size={18} className="text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                    <button type="button" onClick={() => setFile(null)} aria-label="Remove" className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                        <X size={14} />
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Output format</label>
                    <div className="grid grid-cols-5 gap-1.5">
                        {FORMATS.map(f => (
                            <button
                                key={f.v}
                                type="button"
                                onClick={() => setFormat(f.v)}
                                className={cn(
                                    "rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors",
                                    format === f.v
                                        ? "border-accent bg-accent/10 text-accent"
                                        : "border-border bg-card hover:border-accent/40 text-foreground"
                                )}
                                title={f.desc}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Bitrate</label>
                    <div className="grid grid-cols-5 gap-1.5">
                        {BITRATES.map(b => (
                            <button
                                key={b}
                                type="button"
                                onClick={() => setBitrate(b)}
                                disabled={format === "wav" || format === "flac"}
                                className={cn(
                                    "rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                                    bitrate === b && format !== "wav" && format !== "flac"
                                        ? "border-accent bg-accent/10 text-accent"
                                        : "border-border bg-card hover:border-accent/40 text-foreground"
                                )}
                            >
                                {b}
                            </button>
                        ))}
                    </div>
                    {(format === "wav" || format === "flac") && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">Bitrate not used — {format.toUpperCase()} is lossless.</p>
                    )}
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
                    {state === "processing" ? <><Loader2 size={14} className="animate-spin" /> Converting…</> :
                     state === "done" ? <><CheckCircle2 size={14} /> Re-convert</> :
                     <><Download size={14} /> Convert to {format.toUpperCase()}</>}
                </Button>
            </div>
        </div>
    );
}
