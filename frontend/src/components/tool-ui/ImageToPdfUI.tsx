/**
 * ImageToPdfUI — batch images → single PDF, with page-size choice.
 * Workshop: numbered file rows + page-size cards.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Download, Loader2, CheckCircle2, X, Image as ImageIcon, AlertCircle, RotateCcw, ChevronUp, ChevronDown, Sparkles } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";
import { loadSampleJpg } from "@/lib/sample-files";
import { emitToolSuccess } from "@/hooks/useFirstSuccess";
import { consumeFileHandoff } from "@/lib/file-handoff";

type PageSize = "auto" | "a4" | "letter";
const sizes: { id: PageSize; label: string; desc: string }[] = [
    { id: "auto",   label: "Auto",   desc: "Match image dimensions" },
    { id: "a4",     label: "A4",     desc: "210 × 297 mm" },
    { id: "letter", label: "Letter", desc: "8.5 × 11 in" },
];

interface ImageToPdfUIProps {
    accept?: string;
    formatsLabel?: string;
    nounLabel?: string;
    handoffSlug?: string;
}

export function ImageToPdfUI({
    accept = "image/*",
    formatsLabel = "JPEG · PNG · WebP · BMP · TIFF · HEIC — multiple allowed",
    nounLabel = "image",
    handoffSlug = "image-to-pdf",
}: ImageToPdfUIProps = {}) {
    const [files, setFiles] = useState<{ id: string; name: string; size: string; raw: File }[]>([]);
    const [pageSize, setPageSize] = useState<PageSize>("auto");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const add = useCallback((fl: FileList | File[]) => {
        setFiles(p => [...p, ...Array.from(fl).map(f => ({ id: Math.random().toString(36).slice(2), name: f.name, size: formatFileSize(f.size), raw: f }))]);
        setState("idle"); setError(null);
    }, []);

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff(handoffSlug).then(file => {
            if (!cancelled && file) add([file]);
        });
        return () => { cancelled = true; };
    }, [handoffSlug, add]);

    // Try with sample — loads the bundled JPEG so the user can try the flow
    // without leaving the page. Only available when accept includes JPEG-ish
    // formats (the wrappers in NamedImageToPdfVariants may narrow accept).
    const [loadingSample, setLoadingSample] = useState(false);
    const sampleSupported = !accept || accept === "image/*" || /jpe?g/i.test(accept);
    const trySample = useCallback(async () => {
        if (loadingSample || !sampleSupported) return;
        setLoadingSample(true);
        try {
            const f = await loadSampleJpg();
            add([f]);
            toast.message("Sample image loaded", { description: "Bound into a single-page PDF.", duration: 2400 });
        } catch (e) {
            console.error(e);
            toast.error("Couldn't load the sample image.");
        } finally {
            setLoadingSample(false);
        }
    }, [loadingSample, sampleSupported, add]);

    const moveFile = (from: number, to: number) => {
        if (to < 0 || to >= files.length || from === to) return;
        setFiles(p => {
            const next = [...p];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
        });
    };

    const process = useCallback(async () => {
        if (!files.length) return;
        setState("processing"); setError(null);
        try {
            const outName = buildOutputFilename(files[0]?.name, null, "pdf");
            await processFilesAndDownload("/image-to-pdf", files.map(f => f.raw), outName, { page_size: pageSize });
            setState("done");
            emitToolSuccess("Image to PDF");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Conversion failed";
            setError(friendlyError(msg, "Couldn't pack those images into a PDF."));
            setState("idle");
        }
    }, [files, pageSize]);

    // Cmd+Enter
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && files.length && state !== "processing") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [files, state, process]);

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Bound</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{files.length}</span> {nounLabel}{files.length > 1 ? "s" : ""} → PDF
                        </h2>
                        <button
                            onClick={() => { setFiles([]); setState("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Convert more
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
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload images"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept={accept} multiple className="hidden" onChange={e => { e.target.files && add(e.target.files); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <ImageIcon size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{files.length ? `Add more ${nounLabel}s` : `Select ${nounLabel}s to bind into a PDF`}</p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">{formatsLabel}</p>
            </div>

            {/* Try with sample — JPEG fallback. Hidden if the wrapper restricts
                accept to a non-JPEG format (e.g. heic-to-jpg). */}
            {files.length === 0 && sampleSupported && (
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
                            <><Sparkles size={11} className="text-accent" /> Try with a sample image</>
                        )}
                    </button>
                </div>
            )}

            {files.length > 0 && (
                <>
                    <div className="flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span><span className="text-accent">§</span> Page order — drag or use arrows</span>
                        <span>{files.length} {nounLabel}{files.length > 1 ? "s" : ""} → {files.length} page{files.length > 1 ? "s" : ""}</span>
                    </div>
                    <div className="space-y-2">
                        {files.map((f, i) => (
                            <div
                                key={f.id}
                                draggable
                                onDragStart={() => setDragIdx(i)}
                                onDragOver={e => { e.preventDefault(); }}
                                onDrop={e => {
                                    e.preventDefault();
                                    if (dragIdx !== null && dragIdx !== i) moveFile(dragIdx, i);
                                    setDragIdx(null);
                                }}
                                onDragEnd={() => setDragIdx(null)}
                                className={cn(
                                    "flex items-center gap-3 rounded-xl border bg-accent/[0.04] px-4 py-3 cursor-grab active:cursor-grabbing transition-colors animate-queue-row-enter",
                                    dragIdx === i ? "dragging border-accent" : "border-accent/30"
                                )}
                            >
                                <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70 w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                                    <ImageIcon size={15} className="text-accent" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[14px] font-medium text-foreground truncate">{f.name}</p>
                                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">{f.size}</p>
                                </div>
                                <div className="flex items-center gap-0.5">
                                    <button
                                        onClick={() => moveFile(i, i - 1)}
                                        disabled={i === 0}
                                        aria-label="Move up"
                                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:cursor-not-allowed"
                                    ><ChevronUp size={13} /></button>
                                    <button
                                        onClick={() => moveFile(i, i + 1)}
                                        disabled={i === files.length - 1}
                                        aria-label="Move down"
                                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:cursor-not-allowed"
                                    ><ChevronDown size={13} /></button>
                                    <button
                                        onClick={() => setFiles(p => p.filter(x => x.id !== f.id))}
                                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                                        aria-label="Remove"
                                    ><X size={13} /></button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Page size
                        </div>
                        <div className="p-3 grid grid-cols-3 gap-2">
                            {sizes.map(s => {
                                const active = pageSize === s.id;
                                return (
                                    <button
                                        key={s.id}
                                        onClick={() => setPageSize(s.id)}
                                        className={cn(
                                            "rounded-lg border p-3 text-left transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <p className={cn("font-display text-[14px] font-semibold tracking-[-0.015em]", active ? "text-accent" : "text-foreground")}>{s.label}</p>
                                        <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-0.5">{s.desc}</p>
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

                    <div className="flex items-center gap-3">
                        <button onClick={process} disabled={state === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Binding…</> : <><Download size={13} /> Convert {files.length} {nounLabel}{files.length > 1 ? "s" : ""} → PDF</>}
                        </button>
                        {state === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
                        <button onClick={() => setFiles([])} aria-label="Clear all images" className="h-9 px-3 inline-flex items-center rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-secondary/60">Clear</button>
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
