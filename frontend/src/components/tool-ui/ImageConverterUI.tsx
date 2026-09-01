/**
 * ImageConverterUI — convert images between JPEG / PNG / WebP / BMP / TIFF.
 * Workshop: format pills, source preview, success state, quality slider for
 * lossy targets with a heuristic size estimate.
 * Multi-file via useMultiFileProcessor — same target format applied to all.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob, formatFileSize } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const formats = ["jpeg", "png", "webp", "bmp", "tiff"];
const LOSSY = new Set(["jpeg", "webp"]);

const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"];
const isImg = (f: File) => IMG_EXTS.some(e => f.name.toLowerCase().endsWith(e));

const IMAGE_CONVERTER_DEFAULTS = {
    target: "png",
    quality: 85,
};

export function ImageConverterUI() {
    const [config, , { setField }] = useToolDefaults("image-converter", IMAGE_CONVERTER_DEFAULTS);
    const { target, quality } = config;
    const setTarget = useCallback((v: React.SetStateAction<typeof IMAGE_CONVERTER_DEFAULTS["target"]>) => setField("target", v), [setField]);
    const setQuality = useCallback((v: React.SetStateAction<typeof IMAGE_CONVERTER_DEFAULTS["quality"]>) => setField("quality", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [preview, setPreview] = useState("");

    // Build a preview from the first image — revoke as the selection changes.
    const firstFile = proc.entries[0]?.file ?? null;
    useEffect(() => {
        if (!firstFile) { setPreview(""); return; }
        const url = URL.createObjectURL(firstFile);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [firstFile]);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Same naming as the single-file tool: swap the extension for the target.
    // The server sends a generic "converted.<ext>" so we name client-side.
    const outNameFor = useCallback((name: string) => `${name.replace(/\.[^.]+$/, "")}.${target}`, [target]);

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
            downloadBlob(buildZip(items), `archive_${target}.zip`);
        })();
    }, [proc.entries, outNameFor, target]);

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        const params: Record<string, string | number> = { target_format: target };
        if (LOSSY.has(target)) params.quality = quality;
        await proc.run({
            endpoint: "/image-converter",
            outputSuffix: null,
            outputExt: target === "jpeg" ? "jpg" : target,
            params,
        }, retry);
        setPhase("done");
    }, [proc, target, quality]);

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

    // Rough multipliers from source ext → target ext to give the user a sanity
    // check on output size. Not exact, just directional. Summed across the batch.
    const totalSize = proc.entries.reduce((s, e) => s + e.size, 0);
    const estimatedOut = (() => {
        if (!proc.entries.length) return null;
        const baseMult: Record<string, number> = { jpeg: 0.6, png: 2.2, webp: 0.5, bmp: 5, tiff: 4 };
        const tgtMult = baseMult[target] ?? 1;
        let sum = 0;
        for (const e of proc.entries) {
            const src = e.name.split(".").pop()?.toLowerCase() || "";
            const srcMult = baseMult[src === "jpg" ? "jpeg" : src] ?? 1;
            let est = (e.size / srcMult) * tgtMult;
            if (LOSSY.has(target)) est *= 0.4 + 0.012 * (quality - 50);
            sum += Math.max(e.size * 0.05, est);
        }
        return sum;
    })();

    if (phase === "done") {
        const isMulti = proc.entries.length > 1;
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Converted</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti || proc.doneCount === 0
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> image{proc.doneCount === 1 ? "" : "s"} saved as {target.toUpperCase()}{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <>Saved as <span className="italic text-accent">{target.toUpperCase()}</span></>}
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
                                    <RotateCcw size={12} /> Convert another
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
    }

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={null}
                multiple
                onFilesSelect={files => proc.addFiles(files, isImg)}
                onFileSelect={f => proc.addFiles([f], isImg)}
                onClear={proc.clearAll}
                accept=".jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif"
                label={proc.entries.length ? "Add more files" : "Drop images to convert"}
                hint="JPEG · PNG · WebP · BMP · TIFF · several files become a ZIP"
            />
            {proc.entries.length > 0 && (
                <MultiFileQueue
                    entries={proc.entries}
                    reorderable={false}
                    onRemove={proc.removeFile}
                    onReorder={proc.reorder}
                    onClearAll={proc.clearAll}
                    onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                    busy={phase === "processing"}
                />
            )}
            {preview && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                        Preview{proc.entries.length > 1 ? " · first image" : ""}
                    </div>
                    <div className="p-4 flex items-center justify-center bg-paper-2/30">
                        <img src={preview} alt="Preview" className="max-h-48 max-w-full object-contain rounded border border-border" />
                    </div>
                </div>
            )}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Target format
                </div>
                <div className="p-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {formats.map(f => {
                        const active = target === f;
                        return (
                            <button
                                key={f}
                                onClick={() => setTarget(f)}
                                aria-pressed={active}
                                aria-label={`Convert to ${f.toUpperCase()}`}
                                className={cn(
                                    "font-medium min-h-[44px] rounded-lg border py-2.5 px-2 text-[12px] transition-colors",
                                    active ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                )}
                            >
                                {f}
                            </button>
                        );
                    })}
                </div>
                {LOSSY.has(target) && (
                    <div className="px-4 pb-4 pt-1 border-t border-border">
                        <div className="flex items-center justify-between mb-1.5">
                            <label htmlFor="conv-quality" className="font-medium text-[11px] text-muted-foreground">Quality</label>
                            <span className="font-mono text-[12px] text-accent tabular-nums">{quality}%</span>
                        </div>
                        <input
                            id="conv-quality"
                            type="range" min={20} max={100} value={quality}
                            onChange={e => setQuality(+e.target.value)}
                            aria-label="Output quality"
                            className="w-full h-2 accent-[hsl(var(--accent))] touch-manipulation"
                        />
                        <div className="font-medium mt-1 flex justify-between text-[9.5px] text-muted-foreground">
                            <span>← smaller</span><span>balanced</span><span>sharper →</span>
                        </div>
                    </div>
                )}
                {proc.entries.length > 0 && estimatedOut !== null && (
                    <div className="px-4 pb-3 -mt-1 grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-border bg-paper-2/40 p-2 text-center">
                            <p className="font-medium text-[9.5px] text-muted-foreground">Source</p>
                            <p className="font-mono text-[13px] text-foreground tabular-nums">{formatFileSize(totalSize)}</p>
                        </div>
                        <div className="rounded-lg border border-accent/30 bg-accent/[0.06] p-2 text-center">
                            <p className="font-medium text-[9.5px] text-accent">{target.toUpperCase()} (est.)</p>
                            <p className="font-mono text-[13px] text-accent tabular-nums">~{formatFileSize(estimatedOut)}</p>
                        </div>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {phase === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Converting… ({proc.doneCount}/{proc.entries.length})</>
                        : <><Download size={13} /> Convert {proc.entries.length > 1 ? `${proc.entries.length} images ` : ""}to {target.toUpperCase()}</>}
                </button>
                {canProcess && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                )}
            </div>
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
