/**
 * BackgroundRemoverUI — strip the background from an image.
 *
 * Workshop touches: corner registration marks on dropzone, before/after
 * preview with a checkerboard transparency pattern on the "after" pane, and
 * a drag-handle slider that wipes between source and result for comparison.
 * Multi-file via useMultiFileProcessor — the compare slider shows one result
 * at a time (pick which via the chips); several results download as one ZIP.
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { Download, Loader2, AlertCircle, Eraser, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob, formatFileSize } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];
const isImg = (f: File) => IMG_EXTS.some(e => f.name.toLowerCase().endsWith(e));

export function BackgroundRemoverUI() {
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const [sliderPct, setSliderPct] = useState(50);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Source preview for the first queued image (pre-processing).
    const firstEntry = proc.entries[0] ?? null;
    const firstFile = firstEntry?.file ?? null;
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    useEffect(() => {
        if (!firstFile) { setPreviewSrc(null); return; }
        const url = URL.createObjectURL(firstFile);
        setPreviewSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [firstFile]);

    // Same naming as before: "nobg_<original name>".
    const outNameFor = useCallback((name: string) => `nobg_${name || "image.png"}`, []);

    const downloadResults = useCallback(() => {
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, outNameFor(done[0].name));
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: outNameFor(e.name),
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), "archive_nobg.zip");
        })();
    }, [proc.entries, outNameFor]);

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/remove-background",
            outputSuffix: "nobg",
            outputExt: "png",
        }, retry);
        setPhase("done");
    }, [proc]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); void process(false); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    // The result the compare slider shows — a picked done entry, or the first.
    const doneEntries = proc.entries.filter(e => e.status === "done" && e.blob);
    const selected = phase === "done" ? (doneEntries.find(e => e.id === selectedId) ?? doneEntries[0] ?? null) : null;
    const selectedKey = selected?.id ?? null;
    const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
    const [afterUrl, setAfterUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!selected?.blob) { setBeforeUrl(null); setAfterUrl(null); return; }
        const b = URL.createObjectURL(selected.file);
        const a = URL.createObjectURL(selected.blob);
        setBeforeUrl(b); setAfterUrl(a);
        return () => { URL.revokeObjectURL(b); URL.revokeObjectURL(a); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedKey]);

    const reset = () => {
        proc.reset();
        setPhase("idle");
        setSelectedId(null);
        setSliderPct(50);
    };

    if (phase === "done") {
        const isMulti = proc.entries.length > 1;
        return (
            <div className="space-y-4">
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                    <div className="relative px-4 py-3 border-b border-border bg-paper-2/40 flex items-center justify-between">
                        <CornerMarks />
                        <div className="font-medium flex items-center gap-2 text-[11.5px] text-accent">
                            <CheckCircle2 size={12} />
                            {isMulti
                                ? <>Background removed — {proc.doneCount} of {proc.entries.length}{proc.failedCount > 0 && <span className="text-destructive"> · {proc.failedCount} failed</span>}</>
                                : "Background removed"}
                        </div>
                        <button onClick={reset} className="font-medium text-[11.5px] text-muted-foreground hover:text-foreground transition-colors">
                            Process another
                        </button>
                    </div>
                    {selected && afterUrl ? (
                        <div className="p-5 space-y-3">
                            {doneEntries.length > 1 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {doneEntries.map(e => {
                                        const active = selected.id === e.id;
                                        return (
                                            <button
                                                key={e.id}
                                                onClick={() => setSelectedId(e.id)}
                                                className={cn(
                                                    "font-medium max-w-[180px] truncate rounded-md border px-2.5 py-1 text-[11.5px] transition-colors",
                                                    active ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                                )}
                                                title={e.name}
                                            >
                                                {e.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            <p className="font-medium text-[11.5px] text-muted-foreground">
                                Drag the slider to compare
                            </p>
                            <BeforeAfterSlider
                                before={beforeUrl || ""}
                                after={afterUrl}
                                value={sliderPct}
                                onChange={setSliderPct}
                            />
                        </div>
                    ) : (
                        <div className="p-5">
                            <p className="text-[13px] text-destructive">
                                No image finished — retry the failed file{proc.failedCount === 1 ? "" : "s"} below.
                            </p>
                        </div>
                    )}
                    <div className="px-5 pb-5 flex flex-wrap items-center gap-2">
                        {proc.doneCount > 0 && (
                            <button
                                onClick={downloadResults}
                                className="btn-accent w-full sm:w-auto"
                            >
                                <Download size={13} /> Download {proc.doneCount > 1 ? `ZIP (${proc.doneCount})` : "PNG"}
                            </button>
                        )}
                        {proc.failedCount > 0 && (
                            <button
                                onClick={() => void process(true)}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
                            >
                                Retry {proc.failedCount} failed
                            </button>
                        )}
                    </div>
                    {proc.failedCount > 0 && (
                        <div className="px-5 pb-5 -mt-2 space-y-1.5">
                            {proc.entries.filter(e => e.status === "failed").map(e => (
                                <p key={e.id} className="flex items-center gap-2 text-[12px] text-destructive">
                                    <AlertCircle size={12} className="shrink-0" /> {e.name}: {e.error}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Dropzone */}
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isImg); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload images"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-10 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isImg); e.target.value = ""; }} />
                <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                )}>
                    <Eraser size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more images" : "Drop images to remove background"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    JPEG · PNG · WebP — AI runs on the server (your file is deleted after)
                </p>
            </div>

            {/* Queue */}
            {proc.entries.length > 0 && (
                <MultiFileQueue
                    entries={proc.entries}
                    reorderable={false}
                    onRemove={proc.removeFile}
                    onReorder={proc.reorder}
                    onClearAll={proc.clearAll}
                    onRetryFailed={() => void process(true)}
                    busy={phase === "processing"}
                />
            )}

            {/* Preview before processing */}
            {previewSrc && firstEntry && (
                <div className="rounded-xl border border-accent/30 bg-accent/[0.04] overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Source · {firstEntry.name}{proc.entries.length > 1 ? " · first image" : ""}</span>
                        <span>{formatFileSize(firstEntry.size)}</span>
                    </div>
                    <div className="p-4 flex items-center justify-center bg-paper-2/30">
                        <img src={previewSrc} alt="Preview" className="max-h-60 rounded-md object-contain" />
                    </div>
                    <div className="px-3 py-2 border-t border-border bg-paper-2/40 flex justify-end">
                        <button onClick={() => proc.removeFile(firstEntry.id)} className="font-medium inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors">
                            <X size={11} /> Remove
                        </button>
                    </div>
                </div>
            )}

            {proc.entries.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {phase === "processing"
                            ? <><Loader2 size={13} className="animate-spin" /> Removing background… ({proc.doneCount}/{proc.entries.length})</>
                            : <><Eraser size={13} /> Remove background{proc.entries.length > 1 ? ` — ${proc.entries.length} images` : ""}</>}
                    </button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Wipe-style before/after slider. Pointer events on the wrapper move the
 * divider; the range input is the accessible fallback / keyboard control.
 */
function BeforeAfterSlider({
    before, after, value, onChange,
}: { before: string; after: string; value: number; onChange: (v: number) => void }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const handlePointer = (e: React.PointerEvent) => {
        if (e.buttons !== 1 && e.type !== "pointerdown") return;
        const r = wrapRef.current?.getBoundingClientRect();
        if (!r) return;
        const pct = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
        onChange(pct);
    };
    return (
        <div className="space-y-2">
            <div
                ref={wrapRef}
                onPointerDown={handlePointer}
                onPointerMove={handlePointer}
                className="relative w-full overflow-hidden rounded-lg border border-border bg-paper-2/40 select-none touch-pan-y"
                style={{
                    aspectRatio: "1 / 1",
                    background: "repeating-conic-gradient(hsl(var(--paper-2)) 0% 25%, hsl(var(--card)) 0% 50%) 50% / 16px 16px",
                }}
            >
                {/* After (full) sits underneath */}
                {after && <img src={after} alt="Background removed" className="absolute inset-0 w-full h-full object-contain" />}
                {/* Before is clipped from the right so it only shows on the left side */}
                {before && (
                    <div
                        className="absolute inset-0 overflow-hidden"
                        style={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}
                    >
                        <img src={before} alt="Original" className="absolute inset-0 w-full h-full object-contain bg-paper-2/40" />
                    </div>
                )}
                {/* Divider */}
                <div className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none" style={{ left: `${value}%` }} />
                <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-9 w-9 rounded-full bg-accent text-background flex items-center justify-center pointer-events-none shadow-md"
                    style={{ left: `${value}%` }}
                    aria-hidden="true"
                >
                    <span className="font-mono text-[9.5px] tracking-wider">↔</span>
                </div>
                <span className="font-medium absolute top-2 left-2 text-[9.5px] tracking-wider rounded bg-background/85 text-foreground px-1.5 h-5 inline-flex items-center">Before</span>
                <span className="font-medium absolute top-2 right-2 text-[9.5px] tracking-wider rounded bg-accent/85 text-background px-1.5 h-5 inline-flex items-center">After</span>
            </div>
            <input
                type="range"
                min={0} max={100} value={value}
                onChange={e => onChange(+e.target.value)}
                aria-label="Compare slider position"
                className="w-full h-2 accent-[hsl(var(--accent))] touch-manipulation"
            />
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
