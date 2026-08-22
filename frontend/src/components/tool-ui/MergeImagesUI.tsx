/**
 * MergeImagesUI — concat 2+ images into a strip (horizontal, vertical) or grid.
 * Workshop: thumbnail grid + direction toggle with visual cues, drag-reorder.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, X, AlertCircle, RotateCcw, Combine, MoveHorizontal, MoveVertical, LayoutGrid, GripVertical } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type MergeFile = { id: string; name: string; size: string; raw: File; preview: string };
type Direction = "horizontal" | "vertical" | "grid";
let fileId = 0;

const MERGE_IMAGES_DEFAULTS: { direction: Direction } = {
    direction: "horizontal",
};

export function MergeImagesUI() {
    const [config, , { setField }] = useToolDefaults("merge-images", MERGE_IMAGES_DEFAULTS);
    const { direction } = config;
    const setDirection = useCallback((v: React.SetStateAction<typeof MERGE_IMAGES_DEFAULTS["direction"]>) => setField("direction", v), [setField]);
    const [files, setFiles] = useState<MergeFile[]>([]);

    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const addFiles = (fl: FileList) => {
        const next: MergeFile[] = Array.from(fl)
            .filter(f => /\.(jpe?g|png|webp|bmp)$/i.test(f.name))
            .map(f => ({ id: String(++fileId), name: f.name, size: formatFileSize(f.size), raw: f, preview: URL.createObjectURL(f) }));
        if (next.length) { setFiles(prev => [...prev, ...next]); setState("idle"); setError(null); }
    };
    const removeFile = (id: string) => {
        setFiles(prev => {
            const f = prev.find(x => x.id === id);
            if (f) URL.revokeObjectURL(f.preview);
            return prev.filter(x => x.id !== id);
        });
    };
    const reorder = (from: number, to: number) => {
        if (from === to || from < 0 || to < 0) return;
        setFiles(prev => {
            const next = prev.slice();
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
        });
    };

    // Revoke every object URL still in the batch when the tool unmounts.
    // Mirror `files` into a ref so the unmount cleanup runs against the
    // latest array, not the initial empty one captured by the closure.
    const filesRef = useRef<MergeFile[]>([]);
    filesRef.current = files;
    useEffect(() => () => {
        for (const f of filesRef.current) URL.revokeObjectURL(f.preview);
    }, []);

    const canProcess = files.length >= 2 && state !== "processing";

    const process = useCallback(async () => {
        if (files.length < 2) return;
        setState("processing"); setError(null);
        try {
            const outName = buildOutputFilename(files[0]?.raw.name, "merged", "png");
            // Grid mode posts to the collage endpoint; the backend already
            // accepts the same multi-file payload.
            const endpoint = direction === "grid" ? "/make-collage" : "/merge-images";
            const params: Record<string, string | number> = direction === "grid"
                ? { columns: Math.ceil(Math.sqrt(files.length)) }
                : { direction };
            await processFilesAndDownload(endpoint, files.map(f => f.raw), outName, params);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Merge failed";
            setError(friendlyError(msg, "Couldn't merge those images."));
            setState("idle");
        }
    }, [files, direction]);

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
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Merged</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{files.length}</span> images
                            {direction === "grid" ? " arranged in grid" : ` joined ${direction}ly`}
                        </h2>
                        <button
                            onClick={() => { setFiles([]); setState("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Merge more
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload images"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <Combine size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{files.length ? "Add more images" : "Select images to merge"}</p>
                <p className="font-medium text-[11.5px] text-muted-foreground">JPG · PNG · WebP · BMP · at least 2 images</p>
            </div>

            {files.length > 0 && (
                <>
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Images ({files.length})</span>
                            {files.length > 1 && <span className="text-muted-foreground/70">drag to reorder</span>}
                        </div>
                        <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {files.map((f, i) => (
                                <div
                                    key={f.id}
                                    draggable
                                    onDragStart={() => setDragIdx(i)}
                                    onDragOver={e => { e.preventDefault(); }}
                                    onDrop={e => { e.preventDefault(); if (dragIdx !== null) reorder(dragIdx, i); setDragIdx(null); }}
                                    onDragEnd={() => setDragIdx(null)}
                                    className={cn(
                                        "relative group rounded-lg border bg-card overflow-hidden cursor-grab active:cursor-grabbing transition-opacity",
                                        dragIdx === i ? "dragging border-accent" : "border-border"
                                    )}
                                >
                                    <img src={f.preview} alt={f.name} className="w-full h-24 object-cover" />
                                    <span className="font-medium absolute top-1 left-1 h-5 px-1.5 inline-flex items-center text-[9.5px] tracking-wider rounded bg-background/85 text-accent">
                                        {String(i + 1).padStart(2, "0")}
                                    </span>
                                    <span className="absolute top-1 left-9 h-5 w-5 rounded bg-background/85 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none" aria-hidden="true">
                                        <GripVertical size={11} />
                                    </span>
                                    <div className="px-2 py-1.5">
                                        <p className="font-mono text-[10.5px] text-muted-foreground truncate">{f.name}</p>
                                    </div>
                                    <button
                                        onClick={() => removeFile(f.id)}
                                        aria-label={`Remove ${f.name}`}
                                        className="absolute top-1 right-1 h-6 w-6 rounded bg-background/85 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center"
                                    >
                                        <X size={11} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Arrangement
                        </div>
                        <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {([
                                { id: "horizontal" as const, label: "Side by side", desc: "Wide strip", Icon: MoveHorizontal },
                                { id: "vertical"   as const, label: "Top to bottom", desc: "Tall strip", Icon: MoveVertical },
                                { id: "grid"       as const, label: "Grid",         desc: "Auto rows/cols", Icon: LayoutGrid },
                            ]).map(d => {
                                const active = direction === d.id;
                                return (
                                    <button
                                        key={d.id}
                                        onClick={() => setDirection(d.id)}
                                        aria-pressed={active}
                                        className={cn(
                                            "rounded-lg border p-3 text-left transition-colors flex items-center gap-3 min-h-[44px]",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <d.Icon size={18} className={active ? "text-accent" : "text-muted-foreground"} />
                                        <div>
                                            <p className={cn("font-display text-[13.5px] font-semibold tracking-[-0.015em]", active ? "text-accent" : "text-foreground")}>{d.label}</p>
                                            <p className="font-medium text-[11px] text-muted-foreground/85">{d.desc}</p>
                                        </div>
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
                            {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Merging…</> : <><Combine size={13} /> Merge {files.length} images</>}
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
