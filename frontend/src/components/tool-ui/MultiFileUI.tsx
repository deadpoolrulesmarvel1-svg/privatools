/**
 * MultiFileUI — multi-file uploader with reorder + remove.
 * Workshop aesthetic: hairline dropzone, numbered rows, mono metadata.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import {
    FileText, Upload, X, Download, Loader2, CheckCircle2, GripVertical,
    AlertCircle, ChevronUp, ChevronDown,
} from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";
import { consumeFileHandoff } from "@/lib/file-handoff";

interface Item { id: string; name: string; size: string; file: File }

interface Props {
    endpoint: string;
    accepts: string;
    outputFilename: string;
    fileLabel: string;
    minFiles?: number;
    params?: Record<string, string | number | boolean>;
    ordered?: boolean;
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

    const add = useCallback((fl: FileList | File[]) => {
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

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff(endpoint.replace(/^\//, "")).then(file => {
            if (!cancelled && file) add([file]);
        });
        return () => { cancelled = true; };
    }, [endpoint, add]);

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

    const canProcess = files.length >= minFiles && state !== "processing";

    const process = useCallback(async () => {
        if (files.length < minFiles) {
            setError(`Add at least ${minFiles} ${fileLabel}.`);
            return;
        }
        setState("processing");
        setError(null);
        try {
            const labelStem = outputFilename.replace(/\.[^.]+$/, "");
            const extMatch = outputFilename.match(/\.([^.]+)$/);
            const ext = extMatch ? extMatch[1] : "zip";
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
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Processing failed";
            setError(friendlyError(msg, "Couldn't process those files."));
            setState("idle");
        }
    }, [files, minFiles, fileLabel, outputFilename, actionVerb, endpoint, params]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    const totalSize = files.reduce((s, f) => s + f.file.size, 0);

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
                    "relative w-full rounded-2xl border-2 border-dashed py-10 sm:py-12 px-6 text-center transition-colors group",
                    drag
                        ? "border-accent bg-accent/[0.06]"
                        : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <div className={cn(
                    "mx-auto mb-3 h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                )}>
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {files.length === 0 ? `Add ${fileLabel}` : "Add more"}
                </p>
                <p className="mt-1 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                    Drag &amp; drop, or click — multi-select OK
                </p>
                <input
                    ref={ref}
                    type="file"
                    accept={accepts}
                    multiple
                    className="hidden"
                    onChange={e => { e.target.files && add(e.target.files); e.target.value = ""; }}
                />
            </button>

            {/* File list */}
            {files.length > 0 && (
                <>
                    <div className="flex items-center justify-between px-1">
                        <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> {files.length} {fileLabel} · {formatFileSize(totalSize)} total
                        </span>
                        {ordered && (
                            <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground/85">
                                Order matters — drag or use ↑↓
                            </span>
                        )}
                    </div>
                    <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                        {files.map((f, i) => (
                            <div key={f.id} className="group flex items-center gap-2 sm:gap-3 px-3 py-2.5 hover:bg-secondary/30 transition-colors">
                                {ordered && (
                                    <span className="text-muted-foreground/85 hidden sm:inline-flex items-center justify-center h-7 w-7 coarse:h-11 coarse:w-11 rounded">
                                        <GripVertical size={14} />
                                    </span>
                                )}
                                <span className="font-mono text-[10.5px] tracking-wider text-muted-foreground/85 shrink-0 w-7 text-center">
                                    {String(i + 1).padStart(2, "0")}
                                </span>
                                <div className="h-8 w-8 rounded-md bg-accent/10 border border-accent/25 flex items-center justify-center shrink-0">
                                    <FileText size={14} className="text-accent" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-[13px] font-medium text-foreground">{f.name}</p>
                                    <p className="font-mono text-[10.5px] tracking-wide text-muted-foreground mt-0.5">{f.size}</p>
                                </div>
                                {ordered && (
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            type="button"
                                            onClick={() => move(i, -1)}
                                            disabled={i === 0}
                                            aria-label="Move up"
                                            className="h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                        >
                                            <ChevronUp size={13} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => move(i, 1)}
                                            disabled={i === files.length - 1}
                                            aria-label="Move down"
                                            className="h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                        >
                                            <ChevronDown size={13} />
                                        </button>
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => remove(f.id)}
                                    aria-label="Remove file"
                                    className="h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                    <X size={13} />
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Error */}
            {error && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Action */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                    {files.length === 0 ? "No files added" : `${files.length} file${files.length === 1 ? "" : "s"} ready`}
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                    <button
                        onClick={process}
                        disabled={files.length < minFiles || state === "processing"}
                        className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {state === "processing" ? (
                            <><Loader2 size={13} className="animate-spin" /> {actionVerb}ing…</>
                        ) : state === "done" ? (
                            <><CheckCircle2 size={13} /> Done — re-{actionVerb.toLowerCase()}</>
                        ) : (
                            <><Download size={13} /> {files.length ? `${actionVerb} ${files.length} ${fileLabel}` : `${actionVerb} ${fileLabel}`}</>
                        )}
                    </button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            </div>
        </div>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className="absolute top-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className="absolute top-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 right-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" />
            </span>
        </>
    );
}
