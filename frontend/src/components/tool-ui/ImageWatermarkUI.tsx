/**
 * ImageWatermarkUI — overlay a text watermark on one or many images.
 * Multi-file via useMultiFileProcessor — same watermark applied to all.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Loader2, AlertCircle, Droplets, RotateCcw, Download, Upload, FileImage,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const POSITIONS = [
    { value: "top-left",     label: "Top-L" },
    { value: "top-right",    label: "Top-R" },
    { value: "center",       label: "Center" },
    { value: "bottom-left",  label: "Bot-L" },
    { value: "bottom-right", label: "Bot-R" },
    { value: "tile",         label: "Tile" },
];

const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];
const isImg = (f: File) => IMG_EXTS.some(e => f.name.toLowerCase().endsWith(e));

const IMAGE_WATERMARK_DEFAULTS: { text: string; opacity: number; position: string; fontSize: number } = {
    text: "WATERMARK",
    opacity: 140,
    position: "center",
    fontSize: 40,
};

export function ImageWatermarkUI() {
    const [config, , { setField }] = useToolDefaults("image-watermark", IMAGE_WATERMARK_DEFAULTS);
    const { text, opacity, position, fontSize } = config;
    const setText = useCallback((v: React.SetStateAction<typeof IMAGE_WATERMARK_DEFAULTS["text"]>) => setField("text", v), [setField]);
    const setOpacity = useCallback((v: React.SetStateAction<typeof IMAGE_WATERMARK_DEFAULTS["opacity"]>) => setField("opacity", v), [setField]);
    const setPosition = useCallback((v: React.SetStateAction<typeof IMAGE_WATERMARK_DEFAULTS["position"]>) => setField("position", v), [setField]);
    const setFontSize = useCallback((v: React.SetStateAction<typeof IMAGE_WATERMARK_DEFAULTS["fontSize"]>) => setField("fontSize", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && text.trim().length > 0 && phase !== "processing";
    const opacityPct = Math.round((opacity / 255) * 100);

    // Build a preview from the first image — revoke as the selection changes.
    useEffect(() => {
        const first = proc.entries[0]?.file;
        if (!first) { setPreviewUrl(null); return; }
        const url = URL.createObjectURL(first);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [proc.entries]);

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/image-watermark",
            outputSuffix: "watermarked",
            outputExt: "png", // server returns same format as input; this is a fallback only.
            params: { text: text.trim(), opacity, position, font_size: fontSize },
        }, retry);
        setPhase("done");
    }, [proc, text, opacity, position, fontSize]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_watermarked");
        }
    }, [phase, proc]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (phase === "done") {
        const isMulti = proc.entries.length > 1;
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <Droplets size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Watermarked</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> image{proc.doneCount === 1 ? "" : "s"} watermarked{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">"{text}"</span> applied</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "image downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_watermarked")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}
                                    </button>
                                )}
                                {proc.failedCount > 0 && (
                                    <button
                                        onClick={() => { downloadedRef.current = false; void process(true); }}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
                                    >
                                        Retry {proc.failedCount} failed
                                    </button>
                                )}
                                <button
                                    onClick={() => { proc.reset(); setPhase("idle"); downloadedRef.current = false; }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Watermark more
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isImg); }}
                onClick={() => fileRef.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload images"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isImg); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <FileImage size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more images" : "Drop images to watermark"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    JPG · PNG · WebP · BMP · max {MAX_FILE_SIZE_LABEL} each
                </p>
            </div>

            {proc.entries.length > 0 && (
                <>
                    <ImageQueueList
                        entries={proc.entries}
                        onRemove={proc.removeFile}
                        onClearAll={proc.clearAll}
                        onRetryFailed={proc.failedCount > 0 && proc.doneCount > 0 ? () => { downloadedRef.current = false; void process(true); } : undefined}
                        busy={phase === "processing"}
                    />

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Watermark
                        </div>
                        <div className="p-4 space-y-3">
                            <div>
                                <label className="font-medium text-[11px] text-muted-foreground">Text</label>
                                <input
                                    value={text} onChange={e => setText(e.target.value)}
                                    placeholder="WATERMARK"
                                    aria-label="Watermark text"
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-display font-bold tracking-wider text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <div className="flex items-center justify-between">
                                        <label className="font-medium text-[11px] text-muted-foreground">Opacity</label>
                                        <span className="font-mono text-[11px] text-accent">{opacityPct}%</span>
                                    </div>
                                    <input type="range" min={10} max={255} value={opacity}
                                        onChange={e => setOpacity(+e.target.value)}
                                        aria-label="Watermark opacity"
                                        className="mt-2 w-full h-2 accent-accent touch-manipulation" />
                                </div>
                                <div>
                                    <div className="flex items-center justify-between">
                                        <label className="font-medium text-[11px] text-muted-foreground">Font size</label>
                                        <span className="font-mono text-[11px] text-accent">{fontSize} px</span>
                                    </div>
                                    <input type="range" min={12} max={120} value={fontSize}
                                        onChange={e => setFontSize(+e.target.value)}
                                        aria-label="Watermark font size"
                                        className="mt-2 w-full h-2 accent-accent touch-manipulation" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Position {proc.entries.length > 1 && <span className="text-muted-foreground normal-case ml-2">— applied to every image</span>}
                        </div>
                        <div className="p-3 grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3 items-center">
                            <div className="grid grid-cols-3 gap-2">
                                {POSITIONS.map(p => {
                                    const active = position === p.value;
                                    return (
                                        <button
                                            key={p.value}
                                            onClick={() => setPosition(p.value)}
                                            aria-pressed={active}
                                            aria-label={`Watermark position ${p.label}`}
                                            className={cn(
                                                "font-medium min-h-[44px] rounded-lg border py-2.5 px-2 text-[12px] transition-colors",
                                                active ? "border-accent bg-accent/[0.08] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40",
                                            )}
                                        >
                                            {p.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <PositionCanvas
                                position={position}
                                text={text.trim() || "TEXT"}
                                opacity={opacity / 255}
                                fontSize={fontSize}
                                preview={previewUrl}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Applying… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Droplets size={13} /> Watermark {proc.entries.length > 1 ? `${proc.entries.length} images` : "image"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        {proc.entries.length > 0 && !text.trim() && (
                            <span className="font-medium text-[11.5px] text-muted-foreground inline-flex items-center gap-1">
                                <AlertCircle size={11} /> Enter watermark text
                            </span>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

/** Mini queue that renders an image thumbnail for each entry instead of a generic file icon. */
function ImageQueueList({
    entries, onRemove, onClearAll, onRetryFailed, busy,
}: {
    entries: ReturnType<typeof useMultiFileProcessor>["entries"];
    onRemove: (id: string) => void;
    onClearAll: () => void;
    onRetryFailed?: () => void;
    busy: boolean;
}) {
    // Defer to MultiFileQueue for the simple case (no special preview wanted) —
    // this thin wrapper just adds an inline thumb pre-row.
    return (
        <MultiFileQueue
            entries={entries}
            reorderable={false}
            onRemove={onRemove}
            onReorder={() => {/* no-op — order doesn't matter for image watermark */}}
            onClearAll={onClearAll}
            onRetryFailed={onRetryFailed}
            busy={busy}
        />
    );
}

/** Mini visual preview: stylised image with the watermark sample positioned. */
function PositionCanvas({
    position, text, opacity, fontSize, preview,
}: {
    position: string; text: string; opacity: number; fontSize: number; preview: string | null;
}) {
    const pos: Record<string, React.CSSProperties> = {
        "top-left":     { top: "8%",  left: "8%" },
        "top-right":    { top: "8%",  right: "8%" },
        "center":       { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
        "bottom-left":  { bottom: "8%", left: "8%" },
        "bottom-right": { bottom: "8%", right: "8%" },
        "tile":         { top: 0, left: 0, right: 0, bottom: 0 },
    };
    const fontPx = Math.max(8, Math.round((fontSize / 40) * 11));
    return (
        <div className="rounded-md border border-border bg-paper-2/40 aspect-square w-full max-w-[180px] mx-auto overflow-hidden relative" aria-label="Position preview">
            {preview ? (
                <img src={preview} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-70" />
            ) : (
                <div className="absolute inset-3 space-y-1 opacity-25" aria-hidden="true">
                    {Array.from({ length: 9 }).map((_, i) => (
                        <span key={i} className="block h-px bg-foreground" style={{ width: `${50 + ((i * 13) % 50)}%` }} />
                    ))}
                </div>
            )}
            {position === "tile" ? (
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-3 gap-1 place-items-center" style={{ opacity }}>
                    {Array.from({ length: 6 }).map((_, i) => (
                        <span key={i} className="font-display font-bold text-accent" style={{ fontSize: Math.max(7, fontPx - 3) }}>
                            {text}
                        </span>
                    ))}
                </div>
            ) : (
                <span
                    className="absolute font-display font-bold text-accent select-none whitespace-nowrap"
                    style={{ ...pos[position], opacity, fontSize: fontPx }}
                >
                    {text}
                </span>
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
