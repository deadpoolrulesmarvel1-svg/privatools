/**
 * ImageCompressorUI — compress JPEG/PNG/WebP with quality slider.
 *
 * Workshop aesthetic: workshop dropzone, image grid with hover affordance,
 * quality slider with "smaller / sharper" labels and visible estimated savings.
 * Multi-file via useMultiFileProcessor — same quality applied to every image;
 * several files download as one ZIP.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, X, Download, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { downloadBlob } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { cn } from "@/lib/utils";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const IMAGE_COMPRESSOR_DEFAULTS = {
    quality: 82,
};

const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const isImg = (f: File) => IMG_EXTS.some(e => f.name.toLowerCase().endsWith(e));

export function ImageCompressorUI() {
    const [config, , { setField }] = useToolDefaults("image-compressor", IMAGE_COMPRESSOR_DEFAULTS);
    const { quality } = config;
    const setQuality = useCallback((v: React.SetStateAction<typeof IMAGE_COMPRESSOR_DEFAULTS["quality"]>) => setField("quality", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);

    // Object-URL previews per queue entry. Created when an entry appears,
    // revoked when it leaves the queue (and all revoked on unmount).
    const [previews, setPreviews] = useState<Record<string, string>>({});
    const previewsRef = useRef<Record<string, string>>({});
    previewsRef.current = previews;
    useEffect(() => {
        const ids = new Set(proc.entries.map(e => e.id));
        const next = { ...previewsRef.current };
        let changed = false;
        for (const e of proc.entries) {
            if (!next[e.id]) { next[e.id] = URL.createObjectURL(e.file); changed = true; }
        }
        for (const id of Object.keys(next)) {
            if (!ids.has(id)) { URL.revokeObjectURL(next[id]); delete next[id]; changed = true; }
        }
        if (changed) setPreviews(next);
    }, [proc.entries]);
    useEffect(() => () => {
        for (const url of Object.values(previewsRef.current)) URL.revokeObjectURL(url);
    }, []);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Same naming as before: "compressed_<original name>". The server
    // normalizes extensions, so we keep naming client-side.
    const outNameFor = useCallback((name: string) => `compressed_${name}`, []);

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
            downloadBlob(buildZip(items), "archive_compressed.zip");
        })();
    }, [proc.entries, outNameFor]);

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/image-compressor",
            outputSuffix: "compressed",
            outputExt: "jpg",
            params: { quality },
        }, retry);
        setPhase("done");
    }, [proc, quality]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            downloadResults();
        }
    }, [phase, proc.doneCount, downloadResults]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); void process(false); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    const totalSize = useMemo(() => proc.entries.reduce((s, e) => s + e.size, 0), [proc.entries]);
    // Heuristic — JPEG/WebP compression curve: 100→1.0×, 82→~0.55×, 50→~0.30×
    const estimatedRatio = useMemo(() => Math.max(0.10, Math.min(1.0, 0.20 + 0.012 * (quality - 50) + 0.005 * (quality - 80))), [quality]);
    const estimatedOut = totalSize * estimatedRatio;
    const savingsPct = totalSize ? Math.round((1 - estimatedRatio) * 100) : 0;

    if (phase === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks accent />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Compressed</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{proc.doneCount}</span> image{proc.doneCount !== 1 ? "s" : ""} compressed{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}
                        </h2>
                        {proc.doneCount > 0 && (
                            <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                {proc.doneCount > 1 ? "ZIP downloaded" : "Downloaded"}
                            </p>
                        )}
                        <div className="mt-5 flex flex-wrap gap-2">
                            {proc.doneCount > 0 && (
                                <button onClick={downloadResults} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                Compress more
                            </button>
                        </div>
                        {proc.failedCount > 0 && (
                            <div className="mt-4 space-y-1.5">
                                {proc.entries.filter(e => e.status === "failed").map(e => (
                                    <p key={e.id} className="flex items-center gap-2 text-[12px] text-destructive">
                                        <AlertCircle size={12} className="shrink-0" /> {e.name}: {e.error}
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Dropzone */}
            <label
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isImg); }}
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-10 sm:py-12 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input type="file" accept=".jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={e => { e.target.files && proc.addFiles(e.target.files, isImg); e.target.value = ""; }} />
                <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                )}>
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{proc.entries.length ? "Add more images" : "Drop images here"}</p>
                <p className="font-medium text-[11.5px] text-muted-foreground">JPEG · PNG · WebP — multi-file OK · several files become a ZIP</p>
            </label>

            {/* Image grid */}
            {proc.entries.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>{proc.entries.length} image{proc.entries.length !== 1 ? "s" : ""}</span>
                        <span>{(totalSize / 1024).toFixed(0)} KB total</span>
                    </div>
                    <div className="p-3 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
                        {proc.entries.map(e => {
                            const origKb = (e.size / 1024).toFixed(0);
                            const estKb = ((e.size * estimatedRatio) / 1024).toFixed(0);
                            return (
                                <div key={e.id} className="group relative rounded-lg overflow-hidden border border-border bg-paper-2/40 aspect-square">
                                    {previews[e.id] && <img src={previews[e.id]} alt={e.name} className="w-full h-full object-cover" />}
                                    {e.status !== "queued" && (
                                        <div
                                            className="absolute top-1.5 left-1.5 h-5 w-5 rounded-full bg-background/85 border border-border flex items-center justify-center"
                                            title={e.status === "failed" ? e.error : undefined}
                                        >
                                            {e.status === "running" && <Loader2 size={11} className="animate-spin text-accent" />}
                                            {e.status === "done" && <CheckCircle2 size={11} className="text-accent" />}
                                            {e.status === "failed" && <AlertCircle size={11} className="text-destructive" />}
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-foreground/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <button
                                            onClick={() => proc.removeFile(e.id)}
                                            disabled={phase === "processing"}
                                            className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-card text-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:opacity-50"
                                            aria-label={`Remove ${e.name}`}
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 bg-background/90 backdrop-blur-sm px-2 py-1">
                                        <p className="font-mono text-[10px] text-foreground truncate">{e.name}</p>
                                        <p className="font-mono text-[9.5px] tracking-wider text-muted-foreground tabular-nums">
                                            {origKb} → <span className="text-accent">{estKb}</span> KB
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Quality */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Quality
                </div>
                <div className="p-5">
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-[11.5px] text-muted-foreground">JPEG quality</span>
                        <span className="font-mono text-[16px] text-accent tabular-nums font-medium">{quality}%</span>
                    </div>
                    <input
                        type="range" min={20} max={100} step={1} value={quality}
                        onChange={e => setQuality(parseInt(e.target.value, 10))}
                        className="w-full accent-[hsl(var(--accent))]"
                        aria-label="JPEG quality"
                    />
                    <div className="font-medium mt-1 flex justify-between text-[9.5px] text-muted-foreground">
                        <span>← smaller</span><span>balanced</span><span>sharper →</span>
                    </div>

                    {/* Savings estimate */}
                    {totalSize > 0 && (
                        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-lg border border-border bg-paper-2/40 p-3">
                                <p className="font-medium text-[9.5px] text-muted-foreground">Before</p>
                                <p className="font-mono text-[15px] text-foreground tabular-nums mt-1">{(totalSize / 1024).toFixed(0)} KB</p>
                            </div>
                            <div className="rounded-lg border border-accent/30 bg-accent/[0.06] p-3">
                                <p className="font-medium text-[9.5px] text-accent">After (est.)</p>
                                <p className="font-mono text-[15px] text-accent tabular-nums mt-1">{(estimatedOut / 1024).toFixed(0)} KB</p>
                            </div>
                            <div className="rounded-lg border border-border bg-paper-2/40 p-3">
                                <p className="font-medium text-[9.5px] text-muted-foreground">Saved</p>
                                <p className="font-mono text-[15px] text-foreground tabular-nums mt-1">−{savingsPct}%</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                <button
                    onClick={() => void process(false)}
                    disabled={!canProcess}
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {phase === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Compressing… ({proc.doneCount}/{proc.entries.length})</>
                        : <><Download size={13} /> Compress {proc.entries.length || ""} image{proc.entries.length !== 1 ? "s" : ""}</>}
                </button>
                {canProcess && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                )}
            </div>
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
