/**
 * OrganizeUI — visual page thumbnail grid for reordering / deleting pages.
 *
 * Workshop aesthetic: thumbnails as numbered cards with mono "Page N" labels,
 * hover lift, accent ring on hover, inline reorder controls.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Loader2, CheckCircle2, X, FileText, AlertCircle, ChevronLeft, ChevronRight, Download, Undo2 } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

export function OrganizeUI() {
    const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [thumbnails, setThumbnails] = useState<string[]>([]);
    const [pageOrder, setPageOrder] = useState<number[]>([]);
    const [history, setHistory] = useState<number[][]>([]);
    const [state, setState] = useState<"idle" | "loading" | "editing" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const pushHistory = useCallback((prev: number[]) => {
        setHistory(h => [...h.slice(-19), prev]);
    }, []);

    const pick = async (fl: FileList) => {
        const f = fl[0];
        setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
        setError(null);
        setState("loading");
        try {
            const res = await uploadFile("/organize-pages/thumbnails", f);
            const data = await res.json();
            setThumbnails(data.thumbnails || []);
            setPageOrder((data.thumbnails || []).map((_: string, i: number) => i + 1));
            setHistory([]);
            setState("editing");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed to load thumbnails";
            setError(friendlyError(msg, "Couldn't read this PDF's pages."));
            setState("idle");
        }
    };

    const moveUp = (i: number) => {
        if (i === 0) return;
        setPageOrder(p => {
            pushHistory(p);
            const c = [...p];
            [c[i - 1], c[i]] = [c[i], c[i - 1]];
            return c;
        });
    };
    const moveDown = (i: number) => {
        if (i === pageOrder.length - 1) return;
        setPageOrder(p => {
            pushHistory(p);
            const c = [...p];
            [c[i], c[i + 1]] = [c[i + 1], c[i]];
            return c;
        });
    };
    const removePage = (i: number) => setPageOrder(p => {
        pushHistory(p);
        return p.filter((_, idx) => idx !== i);
    });

    const moveTo = (from: number, to: number) => {
        if (from === to) return;
        setPageOrder(p => {
            pushHistory(p);
            const c = [...p];
            const [moved] = c.splice(from, 1);
            c.splice(to, 0, moved);
            return c;
        });
    };

    const undo = useCallback(() => {
        setHistory(h => {
            if (h.length === 0) return h;
            const last = h[h.length - 1];
            setPageOrder(last);
            return h.slice(0, -1);
        });
    }, []);

    const canProcess = !!file && pageOrder.length > 0 && state !== "processing";

    const process = useCallback(async () => {
        if (!file || pageOrder.length === 0) return;
        setState("processing");
        setError(null);
        try {
            const res = await uploadFile("/organize-pages", file.raw, { page_order: JSON.stringify(pageOrder) });
            const blob = await res.blob();
            downloadBlob(blob, file ? `${file.name.replace(/\.pdf$/i, "")}_organized.pdf` : "organized.pdf");
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't apply this page order."));
            setState("editing");
        }
    }, [file, pageOrder]);

    useEffect(() => {
        if (state !== "editing") return;
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                process();
            } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
                if (history.length > 0) {
                    e.preventDefault();
                    undo();
                }
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process, history, state, undo]);

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks accent />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Pages organized</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">Reordered</span> PDF downloaded.
                        </h2>
                        <button
                            onClick={() => { setFile(null); setState("idle"); setThumbnails([]); setPageOrder([]); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            Organize another
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {state === "idle" && (
                <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) pick(e.dataTransfer.files); }}
                    onClick={() => ref.current?.click()}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload file"
                    className={cn(
                        "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                        drag
                            ? "border-accent bg-accent/[0.06]"
                            : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <CornerMarks />
                    <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => { e.target.files && pick(e.target.files); e.target.value = ""; }} />
                    <div className={cn(
                        "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                        drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                    )}>
                        <Upload size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Select a PDF to organize</p>
                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">Drag &amp; drop or click — we'll render thumbnails for every page</p>
                </div>
            )}

            {state === "loading" && (
                <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center justify-center gap-3">
                    <Loader2 size={20} className="animate-spin text-accent" />
                    <p className="font-display text-[15px] text-foreground">Rendering thumbnails…</p>
                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">First-time pages may take a moment</p>
                </div>
            )}

            {(state === "editing" || state === "processing") && (
                <>
                    {/* File header */}
                    <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                        <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                            <FileText size={16} className="text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-medium text-foreground truncate">{file?.name}</p>
                            <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">
                                {pageOrder.length} page{pageOrder.length !== 1 ? "s" : ""}
                                {pageOrder.length !== thumbnails.length ? <span className="text-accent"> · {thumbnails.length - pageOrder.length} removed</span> : <span> · original order</span>}
                            </p>
                        </div>
                    </div>

                    {/* Pages grid */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground flex items-center justify-between">
                            <span><span className="text-accent">§</span> Pages — drag to reorder, click ✕ to remove</span>
                            <span>{pageOrder.length} / {thumbnails.length}</span>
                        </div>
                        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {pageOrder.map((pageNum, i) => (
                                <div
                                    key={`${pageNum}-${i}`}
                                    draggable
                                    onDragStart={e => {
                                        setDragIdx(i);
                                        e.dataTransfer.effectAllowed = "move";
                                    }}
                                    onDragOver={e => {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = "move";
                                        setDragOverIdx(i);
                                    }}
                                    onDragEnd={() => {
                                        if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
                                            moveTo(dragIdx, dragOverIdx);
                                        }
                                        setDragIdx(null);
                                        setDragOverIdx(null);
                                    }}
                                    onDragLeave={() => {
                                        if (dragOverIdx === i) setDragOverIdx(null);
                                    }}
                                    className={cn(
                                        "group relative rounded-lg border bg-paper-2/30 hover:border-accent/55 hover:bg-paper-2/60 transition-all cursor-grab active:cursor-grabbing overflow-hidden",
                                        dragIdx === i ? "dragging border-accent" : "border-border",
                                        dragOverIdx === i && dragIdx !== i && dragIdx !== null ? "ring-2 ring-accent ring-offset-2 ring-offset-card" : ""
                                    )}
                                >
                                    {/* Slot index (where it'll be in output) */}
                                    <div className="absolute top-1.5 left-1.5 z-10 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-accent text-accent-foreground font-mono text-[10px] font-semibold tabular-nums">
                                        {String(i + 1).padStart(2, "0")}
                                    </div>

                                    {/* Thumbnail */}
                                    <div className="aspect-[3/4] bg-paper border-b border-border flex items-center justify-center overflow-hidden">
                                        {thumbnails[pageNum - 1] ? (
                                            <img
                                                src={thumbnails[pageNum - 1].startsWith("data:") ? thumbnails[pageNum - 1] : `data:image/png;base64,${thumbnails[pageNum - 1]}`}
                                                alt={`Page ${pageNum}`}
                                                className="max-h-full max-w-full object-contain"
                                            />
                                        ) : (
                                            <FileText size={20} className="text-muted-foreground/60" />
                                        )}
                                    </div>

                                    {/* Footer */}
                                    <div className="flex items-center justify-between px-2 py-1.5 bg-card">
                                        <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground">
                                            <span className="text-muted-foreground/70">orig</span>&nbsp;p{String(pageNum).padStart(2, "0")}
                                        </span>
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => moveUp(i)}
                                                disabled={i === 0}
                                                className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                                                aria-label="Move left"
                                            >
                                                <ChevronLeft size={11} />
                                            </button>
                                            <button
                                                onClick={() => removePage(i)}
                                                className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                aria-label="Remove page"
                                            >
                                                <X size={11} />
                                            </button>
                                            <button
                                                onClick={() => moveDown(i)}
                                                disabled={i === pageOrder.length - 1}
                                                className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                                                aria-label="Move right"
                                            >
                                                <ChevronRight size={11} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                        <button type="button" onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {state === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Organizing…</>
                                : <><Download size={13} /> Apply &amp; download</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        <button
                            type="button"
                            onClick={undo}
                            disabled={history.length === 0 || state === "processing"}
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Undo (Cmd/Ctrl + Z)"
                        >
                            <Undo2 size={11} /> Undo
                        </button>
                        <button
                            type="button"
                            onClick={() => { pushHistory(pageOrder); setPageOrder(thumbnails.map((_, i) => i + 1)); }}
                            disabled={state === "processing"}
                            className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                        >
                            Reset order
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
