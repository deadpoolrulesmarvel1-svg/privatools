/**
 * MergeUI — combine multiple PDFs into one.
 *
 * Workshop aesthetic: drag-to-reorder numbered cards (01, 02, 03 …),
 * page-range per file shown as mono input, output filename preview
 * derived from the first file. Drop zone uses the standard workshop
 * pattern with corner registration marks.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
    FileText, Upload, X, Loader2, CheckCircle2, GripVertical, Plus,
    AlertCircle, ChevronUp, ChevronDown, Download, ArrowRight, Sparkles,
} from "lucide-react";
import { cn, friendlyError, isValidPageRange } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";
import { loadSamplePdf } from "@/lib/sample-files";
import { emitToolSuccess } from "@/hooks/useFirstSuccess";
import { consumeFileHandoff } from "@/lib/file-handoff";

interface MergeFile { id: string; name: string; size: string; file: File; pages: string; }

export function MergeUI() {
    const [files, setFiles] = useState<MergeFile[]>([]);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const add = useCallback((fl: FileList | File[]) => {
        setFiles(p => [
            ...p,
            ...Array.from(fl).map(f => ({
                id: Math.random().toString(36).slice(2),
                name: f.name,
                size: formatFileSize(f.size),
                file: f,
                pages: "",
            })),
        ]);
        setState("idle");
        setError(null);
    }, []);

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff("merge-pdf").then(file => {
            if (!cancelled && file) add([file]);
        });
        return () => { cancelled = true; };
    }, [add]);

    // Try-with-sample affordance — loads the bundled PDF twice so the merge
    // demo actually has at least two inputs to combine.
    const [loadingSample, setLoadingSample] = useState(false);
    const trySample = useCallback(async () => {
        if (loadingSample) return;
        setLoadingSample(true);
        try {
            const a = await loadSamplePdf();
            // Make a second copy with a distinct filename so the file list
            // visually shows two entries to merge.
            const b = new File([await a.arrayBuffer()], "privatools-sample-2.pdf", { type: "application/pdf", lastModified: Date.now() });
            add([a, b]);
            toast.message("Two sample PDFs loaded", { description: "Reorder them and press Merge.", duration: 2400 });
        } catch (e) {
            console.error(e);
            toast.error("Couldn't load sample PDFs.");
        } finally {
            setLoadingSample(false);
        }
    }, [loadingSample, add]);

    const updatePages = (id: string, pages: string) =>
        setFiles(prev => prev.map(f => (f.id === id ? { ...f, pages } : f)));

    const outputName = files[0] ? buildOutputFilename(files[0].file.name, "merged", "pdf") : "merged.pdf";

    const allRangesValid = files.every(f => isValidPageRange(f.pages));
    const canProcess = files.length >= 2 && allRangesValid && state !== "processing";

    const process = useCallback(async () => {
        if (!canProcess) return;
        setState("processing");
        setError(null);
        try {
            const anyRange = files.some(f => f.pages.trim() !== "" && f.pages.trim().toLowerCase() !== "all");
            const params: Record<string, string> | undefined = anyRange
                ? { page_ranges: JSON.stringify(files.map(f => (f.pages.trim() || "all"))) }
                : undefined;
            await processFilesAndDownload("/merge", files.map(f => f.file), outputName, params);
            setState("done");
            emitToolSuccess("Merge PDF");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Merge failed";
            setError(friendlyError(msg, "Couldn't merge those PDFs."));
            setState("idle");
        }
    }, [canProcess, files, outputName]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    const moveFile = (fromIndex: number, toIndex: number) => {
        setFiles(prev => {
            if (toIndex < 0 || toIndex >= prev.length) return prev;
            const next = [...prev];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
    };

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks accent />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Merged</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            {files.length} PDFs <span className="italic text-accent">merged</span>.
                        </h2>
                        <p className="mt-2 font-mono text-[11px] tracking-[0.06em] uppercase text-muted-foreground">
                            {outputName} · downloaded
                        </p>
                        <button
                            onClick={() => { setFiles([]); setState("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            Merge more files
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Dropzone */}
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload file"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 px-6 text-center group",
                    drag
                        ? "border-accent bg-accent/[0.06]"
                        : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { e.target.files && add(e.target.files); e.target.value = ""; }} />
                <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                )}>
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {files.length === 0 ? "Add PDFs to merge" : "Add more PDFs"}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                    Drag &amp; drop, or click — as many files as you need
                </p>
            </div>

            {/* Try with sample affordance — only before any file is added. */}
            {files.length === 0 && (
                <div className="flex items-center justify-center">
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); trySample(); }}
                        disabled={loadingSample}
                        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
                    >
                        {loadingSample ? (
                            <><Loader2 size={11} className="animate-spin" /> Loading sample…</>
                        ) : (
                            <><Sparkles size={11} className="text-accent" /> Try with sample PDFs</>
                        )}
                    </button>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />
                    {error}
                </div>
            )}

            {/* File list */}
            {files.length > 0 && (
                <>
                    <div className="flex items-center justify-between px-1 flex-wrap gap-1">
                        <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Sequence — {files.length} file{files.length !== 1 ? "s" : ""} ·{" "}
                            <span className="text-foreground/85 tabular-nums">{formatFileSize(files.reduce((s, f) => s + f.file.size, 0))}</span>
                        </span>
                        <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground/85">
                            Drag to reorder · leave pages blank for all
                        </span>
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                        {files.map((f, i) => (
                            <div
                                key={f.id}
                                draggable
                                onDragStart={() => setDragIdx(i)}
                                onDragOver={e => { e.preventDefault(); setDragOverIdx(i); }}
                                onDragEnd={() => {
                                    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
                                        moveFile(dragIdx, dragOverIdx);
                                    }
                                    setDragIdx(null); setDragOverIdx(null);
                                }}
                                className={cn(
                                    "group flex items-center gap-2 sm:gap-3 px-3 py-2.5 transition-all animate-queue-row-enter",
                                    dragIdx === i ? "dragging" : "hover:bg-paper-2/30",
                                    dragOverIdx === i && dragIdx !== i ? "border-t-2 border-accent" : ""
                                )}
                            >
                                {/* Drag handle */}
                                <span className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/80 hover:text-foreground hover:bg-secondary/60 cursor-grab active:cursor-grabbing shrink-0">
                                    <GripVertical size={13} />
                                </span>
                                {/* Sequence number */}
                                <span className="font-mono text-[10.5px] tracking-wider text-muted-foreground/85 shrink-0 w-7 text-center">
                                    {String(i + 1).padStart(2, "0")}
                                </span>
                                {/* Icon */}
                                <div className="h-8 w-8 rounded-md bg-accent/10 border border-accent/25 flex items-center justify-center shrink-0">
                                    <FileText size={13} className="text-accent" />
                                </div>
                                {/* Filename */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-medium text-foreground truncate">{f.name}</p>
                                    <p className="font-mono text-[10.5px] tracking-wide text-muted-foreground mt-0.5">{f.size}</p>
                                </div>
                                {/* Pages */}
                                <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                                    <label htmlFor={`pages-${f.id}`} className="font-mono text-[9.5px] tracking-[0.08em] uppercase text-muted-foreground">Pages</label>
                                    <input
                                        id={`pages-${f.id}`}
                                        type="text"
                                        value={f.pages}
                                        onChange={e => updatePages(f.id, e.target.value)}
                                        placeholder="all"
                                        title='Page range: "all", "1-3,5", "2-end"'
                                        spellCheck={false}
                                        aria-invalid={!isValidPageRange(f.pages)}
                                        className={cn(
                                            "w-20 h-7 px-2 rounded-md border bg-paper-2/50 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 transition-colors",
                                            isValidPageRange(f.pages)
                                                ? "border-border focus:border-accent focus:ring-accent/20"
                                                : "border-destructive/60 focus:border-destructive focus:ring-destructive/20"
                                        )}
                                    />
                                </div>
                                {/* Reorder controls */}
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        type="button"
                                        onClick={() => moveFile(i, i - 1)}
                                        disabled={i === 0}
                                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                        aria-label="Move file up"
                                    >
                                        <ChevronUp size={13} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => moveFile(i, i + 1)}
                                        disabled={i === files.length - 1}
                                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                        aria-label="Move file down"
                                    >
                                        <ChevronDown size={13} />
                                    </button>
                                </div>
                                <button
                                    onClick={() => setFiles(p => p.filter(x => x.id !== f.id))}
                                    className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    aria-label="Remove file"
                                >
                                    <X size={13} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Output preview */}
                    <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                        <div className="h-9 w-9 rounded-lg bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0">
                            <Download size={14} className="text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-accent">Output preview</p>
                            <p className="font-mono text-[13px] text-foreground mt-0.5 truncate">{outputName}</p>
                        </div>
                        <ArrowRight size={14} className="text-accent shrink-0" />
                    </div>

                    {/* Action */}
                    <div className="flex items-center gap-3 pt-1 flex-wrap">
                        <button
                            type="button"
                            onClick={process}
                            disabled={!canProcess}
                            className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {state === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Merging…</>
                                : files.length < 2
                                    ? <><Download size={13} /> Add 1 more file</>
                                    : <><Download size={13} /> Merge {files.length} PDFs</>}
                        </button>
                        {canProcess && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                        )}
                        {!allRangesValid && (
                            <span className="font-mono text-[10.5px] tracking-[0.04em] uppercase text-destructive">
                                Invalid page range on one or more files
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => ref.current?.click()}
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <Plus size={11} /> Add more
                        </button>
                        <button
                            type="button"
                            onClick={() => setFiles([])}
                            className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors px-2 py-1 ml-auto"
                        >
                            Clear all
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

function CornerMarks({ accent }: { accent?: boolean }) {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    const color = accent ? "bg-accent" : "bg-accent/70";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className={`absolute top-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className={`absolute top-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 right-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className={`absolute bottom-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className={`absolute bottom-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 right-0 w-px h-3 ${color}`} />
            </span>
        </>
    );
}
