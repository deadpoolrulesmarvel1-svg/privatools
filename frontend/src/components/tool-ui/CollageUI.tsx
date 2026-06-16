/**
 * CollageUI — arrange multiple images into a grid collage.
 * Workshop: thumbnail row + columns/spacing/bg controls.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, AlertCircle, LayoutGrid, CheckCircle2, RotateCcw, Download, X, Wand2 } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, buildOutputFilename, postFormData } from "@/lib/api";

// Heuristic for a balanced default — square root rounded up keeps proportions
// close to 1:1 for any file count.
const suggestColumns = (n: number) => Math.max(1, Math.min(6, Math.ceil(Math.sqrt(n))));

export function CollageUI() {
    const [files, setFiles] = useState<File[]>([]);
    const [columns, setColumns] = useState(3);
    const [autoColumns, setAutoColumns] = useState(true);
    const [spacing, setSpacing] = useState(10);
    const [bgColor, setBgColor] = useState("#ffffff");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const addFiles = (newFiles: FileList | File[]) => {
        const imgs = Array.from(newFiles).filter(f => f.type.startsWith("image/"));
        if (imgs.length) setFiles(prev => [...prev, ...imgs]);
    };

    // Build thumbnail previews; revoke on file removal / unmount to avoid leaks.
    const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files]);
    useEffect(() => () => { for (const u of previews) URL.revokeObjectURL(u); }, [previews]);

    // Keep columns synced to file count while in auto mode.
    useEffect(() => {
        if (autoColumns && files.length > 0) setColumns(suggestColumns(files.length));
    }, [files.length, autoColumns]);

    const canProcess = files.length >= 2 && status !== "processing";

    const process = useCallback(async () => {
        if (files.length < 2) return;
        setStatus("processing"); setError(null);
        try {
            const res = await postFormData("/make-collage", () => {
                const fd = new FormData();
                for (const f of files) fd.append("files", f);
                fd.append("columns", String(columns));
                fd.append("spacing", String(spacing));
                fd.append("bg_color", bgColor);
                return fd;
            }, { timeoutMs: 300_000 });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, buildOutputFilename(files[0]?.name, "collage", "jpg"));
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't build that collage."));
            setStatus("idle");
        }
    }, [files, columns, spacing, bgColor]);

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
                        <LayoutGrid size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Collage built</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{files.length}</span> images in {columns} columns
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && files[0] && downloadBlob(resultBlob, buildOutputFilename(files[0]?.name, "collage", "jpg"))} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download again
                            </button>
                            <button
                                onClick={() => { setFiles([]); setStatus("idle"); setResultBlob(null); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Create another
                            </button>
                        </div>
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
                onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload images"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={e => { e.target.files && addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <LayoutGrid size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{files.length ? `${files.length} image${files.length !== 1 ? "s" : ""} ready` : "Select images for collage"}</p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">JPG · PNG · WebP · at least 2 images</p>
            </div>

            {files.length > 0 && (
                <>
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Images ({files.length})
                        </div>
                        <div className="p-3 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                            {files.map((f, i) => (
                                <div key={`${f.name}-${i}`} className="relative group rounded-lg border border-border bg-card overflow-hidden">
                                    <img src={previews[i]} alt={f.name} className="w-full aspect-square object-cover" />
                                    <span className="absolute top-1 left-1 h-5 px-1.5 inline-flex items-center font-mono text-[9.5px] tracking-wider uppercase rounded bg-background/85 text-accent">
                                        §{String(i + 1).padStart(2, "0")}
                                    </span>
                                    <button
                                        onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                                        aria-label={`Remove ${f.name}`}
                                        className="absolute top-1 right-1 h-6 w-6 rounded bg-background/85 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center"
                                    >
                                        <X size={11} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> Layout</span>
                            <button
                                onClick={() => { setAutoColumns(true); setColumns(suggestColumns(files.length)); }}
                                aria-pressed={autoColumns}
                                aria-label="Auto-suggest column count"
                                className={cn(
                                    "inline-flex items-center gap-1 h-6 px-2 rounded font-mono text-[10px] tracking-[0.08em] uppercase transition-colors",
                                    autoColumns ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-accent"
                                )}
                            >
                                <Wand2 size={10} /> Auto
                            </button>
                        </div>
                        <div className="p-4 grid grid-cols-3 gap-3">
                            <div>
                                <label htmlFor="collage-cols" className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Columns</label>
                                <input
                                    id="collage-cols"
                                    type="number" inputMode="numeric" min={1} max={10} value={columns}
                                    onChange={e => { setAutoColumns(false); setColumns(+e.target.value); }}
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors text-center"
                                />
                            </div>
                            <div>
                                <label htmlFor="collage-spacing" className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Spacing (px)</label>
                                <input
                                    id="collage-spacing"
                                    type="number" inputMode="numeric" min={0} max={50} value={spacing}
                                    onChange={e => setSpacing(+e.target.value)}
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors text-center"
                                />
                            </div>
                            <div>
                                <label htmlFor="collage-bg" className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Background</label>
                                <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-card px-2 py-2">
                                    <input
                                        id="collage-bg"
                                        type="color" value={bgColor}
                                        onChange={e => setBgColor(e.target.value)}
                                        aria-label="Collage background color"
                                        className="h-6 w-9 rounded border border-border cursor-pointer"
                                    />
                                    <span className="font-mono text-[11px] text-muted-foreground">{bgColor.toUpperCase()}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    {files.length >= 2 && (
                        <div className="flex items-center gap-3 flex-wrap">
                            <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                                {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Composing…</> : <><LayoutGrid size={13} /> Create collage ({files.length} images)</>}
                            </button>
                            {canProcess && (
                                <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                            )}
                        </div>
                    )}
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
