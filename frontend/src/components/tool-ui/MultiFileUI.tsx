/**
 * Generic multi-file uploader with reorder + remove. Used for batch-compress,
 * audio-merge, video-merge — anything that submits N files to one endpoint.
 */
import { useState, useRef, useCallback } from "react";
import { FileText, Upload, X, Download, Loader2, CheckCircle2, GripVertical, Plus, AlertCircle, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";

interface Item { id: string; name: string; size: string; file: File }

interface Props {
    endpoint: string;
    accepts: string;
    outputFilename: string;
    /** Plural label, e.g. "PDFs", "audio files" */
    fileLabel: string;
    /** Min files required before processing is allowed (default 2) */
    minFiles?: number;
    /** Optional fixed params sent with the upload */
    params?: Record<string, string | number | boolean>;
    /** Whether the order matters (shows reorder controls if true). */
    ordered?: boolean;
    /** Verb on the action button — defaults to "Process" but pass "Compress",
     *  "Merge", etc. for a more discoverable label. */
    actionVerb?: string;
}

export function MultiFileUI({
    endpoint, accepts, outputFilename, fileLabel,
    minFiles = 2, params, ordered = true, actionVerb = "Process",
}: Props) {
    const [files, setFiles] = useState<Item[]>([]);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const add = useCallback((fl: FileList) => {
        setFiles(p => [
            ...p,
            ...Array.from(fl).map(f => ({
                id: Math.random().toString(36).slice(2),
                name: f.name,
                size: formatFileSize(f.size),
                file: f,
            })),
        ]);
        setState("idle");
        setError(null);
    }, []);

    const remove = (id: string) => setFiles(p => p.filter(f => f.id !== id));
    const move = (i: number, delta: number) => {
        setFiles(p => {
            const j = i + delta;
            if (j < 0 || j >= p.length) return p;
            const copy = [...p];
            [copy[i], copy[j]] = [copy[j], copy[i]];
            return copy;
        });
    };

    const process = async () => {
        if (files.length < minFiles) {
            setError(`Add at least ${minFiles} ${fileLabel}.`);
            return;
        }
        setState("processing");
        setError(null);
        try {
            // Preserve the first input's stem so the user can identify the
            // result. Prefer actionVerb when callers passed one (e.g.
            // "Compress" → "MyReport_compressed.pdf"); otherwise extract the
            // stem from outputFilename (e.g. "merged.mp4" → "MyClip_merged.mp4").
            const labelStem = outputFilename.replace(/\.[^.]+$/, "");
            const ext = (outputFilename.match(/\.([^.]+)$/) || [, "zip"])[1];
            const GENERIC = /^(archive|output|result|file|compressed-pdfs?|merged-files?|combined-files?)$/i;
            let suffix: string;
            if (actionVerb && actionVerb.toLowerCase() !== "process") {
                suffix = actionVerb.toLowerCase() + (actionVerb.toLowerCase().endsWith("e") ? "d" : "ed");
            } else if (labelStem && !GENERIC.test(labelStem)) {
                suffix = labelStem;
            } else {
                suffix = "combined";
            }
            const outName = buildOutputFilename(files[0]?.file.name, suffix, ext);
            await processFilesAndDownload(endpoint, files.map(f => f.file), outName, params);
            setState("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Processing failed");
            setState("idle");
        }
    };

    return (
        <div className="space-y-4">
            {/* Dropzone */}
            <button
                type="button"
                onClick={() => ref.current?.click()}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
                className={cn(
                    "w-full rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-colors",
                    drag ? "border-accent bg-accent/5" : "border-border/60 hover:border-accent/40 bg-card/40"
                )}
            >
                <Upload className="mx-auto mb-3 text-muted-foreground" size={28} strokeWidth={1.6} />
                <p className="text-sm font-semibold text-foreground">
                    {files.length === 0 ? `Add ${fileLabel}` : "Add more"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Drag & drop, or click to choose</p>
                <input
                    ref={ref}
                    type="file"
                    accept={accepts}
                    multiple
                    className="hidden"
                    onChange={e => e.target.files && add(e.target.files)}
                />
            </button>

            {/* File list */}
            {files.length > 0 && (
                <ul className="space-y-2">
                    {files.map((f, i) => (
                        <li key={f.id} className="flex items-center gap-2 sm:gap-3 rounded-xl border border-border bg-card p-3">
                            {ordered && (
                                <span className="text-muted-foreground/80 hidden sm:inline">
                                    <GripVertical size={14} />
                                </span>
                            )}
                            <FileText size={16} className="text-muted-foreground shrink-0" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-foreground">{f.name}</p>
                                <p className="text-[11px] text-muted-foreground">{f.size}</p>
                            </div>
                            {ordered && (
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => move(i, -1)}
                                        disabled={i === 0}
                                        aria-label="Move up"
                                        className="rounded-md p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:hover:bg-transparent"
                                    >
                                        <ChevronUp size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => move(i, 1)}
                                        disabled={i === files.length - 1}
                                        aria-label="Move down"
                                        className="rounded-md p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:hover:bg-transparent"
                                    >
                                        <ChevronDown size={14} />
                                    </button>
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={() => remove(f.id)}
                                aria-label="Remove file"
                                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            >
                                <X size={14} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {/* Error */}
            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-[13px] text-rose-700 dark:text-rose-300">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Action */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                    {files.length === 0 ? "No files added" : `${files.length} file${files.length === 1 ? "" : "s"} ready`}
                </p>
                <Button
                    onClick={process}
                    disabled={files.length < minFiles || state === "processing"}
                    className="gap-1.5"
                >
                    {state === "processing" ? <><Loader2 size={14} className="animate-spin" /> {actionVerb}ing…</> :
                     state === "done" ? <><CheckCircle2 size={14} /> Done — re-{actionVerb.toLowerCase()}</> :
                     <><Download size={14} /> {files.length ? `${actionVerb} ${files.length} ${fileLabel}` : `${actionVerb} ${fileLabel}`}</>}
                </Button>
            </div>
        </div>
    );
}
