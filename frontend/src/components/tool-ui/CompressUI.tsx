/**
 * CompressUI — shrink one or many PDFs.
 * Workshop: dropzone, intensity meter, level cards with live estimated savings,
 * Cmd+Enter, corner-marked success state with before/after bars.
 * Multi-file via useMultiFileProcessor — same level applied to every PDF, with
 * per-file before/after sizes read off each response's X-Compressed-Size header.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Upload, Download, Loader2, CheckCircle2, Minimize2, RotateCcw, Undo2, Sparkles, Info } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatFileSize, MAX_FILE_SIZE_LABEL, buildOutputFilename } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { loadSamplePdf } from "@/lib/sample-files";
import { emitToolSuccess } from "@/hooks/useFirstSuccess";
import { consumeFileHandoff } from "@/lib/file-handoff";
import { ResultHandoff } from "./ResultHandoff";
import { useMultiFileProcessor, type FileEntry } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

type Level =
    | "light" | "recommended" | "extreme" | "custom"
    // Purpose-named profiles: you know you are emailing something, and
    // shouldn't have to translate that into a quality percentage.
    | "email" | "print" | "archive" | "web"
    // Client-side only — sends level=custom plus target_size_mb.
    | "target";

const levels: { id: Level; label: string; desc: string; saving: string; intensity: number }[] = [
    { id: "light",       label: "Light",       desc: "Minimal quality loss",                              saving: "~20% smaller", intensity: 25 },
    { id: "recommended", label: "Recommended", desc: "Balanced quality & size",                           saving: "~50% smaller", intensity: 55 },
    { id: "extreme",     label: "Extreme",     desc: "Maximum compression",                               saving: "~75% smaller", intensity: 85 },
    { id: "custom",      label: "Custom",      desc: "Set JPEG quality + max image dimension yourself", saving: "Tunable",      intensity: 65 },
    { id: "email",       label: "Email",       desc: "Small enough for a 10 MB attachment limit",       saving: "~70% smaller", intensity: 78 },
    { id: "print",       label: "Print",       desc: "300 DPI equivalent, minimal quality loss",        saving: "~15% smaller", intensity: 18 },
    { id: "archive",     label: "Archive",     desc: "Long-term storage, quality preserved",            saving: "~30% smaller", intensity: 35 },
    { id: "web",         label: "Web",         desc: "Fast to load in a browser",                       saving: "~55% smaller", intensity: 60 },
    { id: "target",      label: "Target size", desc: "Compress until it fits a size you choose",        saving: "You decide",   intensity: 70 },
];

// Map level → expected fraction saved (rough; tuned to match server behavior)
const SAVINGS_BY_LEVEL: Record<Exclude<Level, "custom" | "target">, number> = {
    light: 0.20,
    recommended: 0.50,
    extreme: 0.75,
    email: 0.70,
    print: 0.15,
    archive: 0.30,
    web: 0.55,
};

const COMPRESS_DEFAULTS = {
    level: "recommended" as Level,
    customQuality: 75,
    customMaxDim: 1800,
    targetMb: 10,
};

/** Per-file compressed size: the X-Compressed-Size response header when the
 *  server sent one, otherwise the result blob's own size. */
function compressedBytesOf(e: FileEntry): number {
    return parseInt(e.headers?.["x-compressed-size"] || "0") || e.blob?.size || 0;
}

export function CompressUI() {
    const proc = useMultiFileProcessor();
    // Form config persists across refreshes (file picks intentionally don't).
    const [config, setConfig, { restored, reset: resetConfig }] = useToolDefaults("compress-pdf", COMPRESS_DEFAULTS, { legacyKey: "compress" });
    const { level, customQuality, customMaxDim, targetMb } = config;
    const setLevel = (v: Level) => setConfig(c => ({ ...c, level: v }));
    const setTargetMb = (v: number) => setConfig(c => ({ ...c, targetMb: v }));
    const setCustomQuality = (v: number) => setConfig(c => ({ ...c, customQuality: v }));
    const setCustomMaxDim = (v: number) => setConfig(c => ({ ...c, customMaxDim: v }));
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    // Show "Restored previous settings" toast once on mount if we loaded non-default values.
    useEffect(() => {
        if (restored) {
            toast.message("Restored previous settings", {
                description: "Picked up where you left off.",
                duration: 3000,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Load the bundled sample PDF and pre-fill the dropzone. Used by the
     *  "Try with a sample file" button and by the FirstRunWelcome handoff. */
    const [loadingSample, setLoadingSample] = useState(false);
    const trySample = useCallback(async () => {
        if (loadingSample) return;
        setLoadingSample(true);
        try {
            const file = await loadSamplePdf();
            proc.addFiles([file], isPdfOnly);
            toast.message("Sample PDF loaded", { description: "1-page demo — process it like any of your own files.", duration: 2400 });
        } catch (e) {
            console.error(e);
            toast.error("Couldn't load the sample PDF.");
        } finally {
            setLoadingSample(false);
        }
    }, [loadingSample, proc]);

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff("compress-pdf").then(file => {
            if (!cancelled && file) proc.addFiles([file], isPdfOnly);
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proc.addFiles]);

    const totalBytes = proc.entries.reduce((s, e) => s + e.size, 0);
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Live estimated output size (front-end heuristic, server may differ)
    const estimatedSavingFraction = level === "target" ? 0.5 : level === "custom"
        // Linear: q=15→0.85 saved, q=95→0.10 saved
        ? Math.max(0.1, Math.min(0.85, 1 - (customQuality / 100) * 0.95))
        : SAVINGS_BY_LEVEL[level];
    const estimatedOutputBytes = Math.max(1024, Math.round(totalBytes * (1 - estimatedSavingFraction)));

    const process = useCallback(async (retry = false) => {
        const params: Record<string, string | number> = { level };
        if (level === "custom") {
            params.jpeg_quality = customQuality;
            params.max_image_dim = customMaxDim;
        }
        if (level === "target") {
            // The server searches for the lightest setting that fits, so it
            // takes the target rather than a quality figure.
            params.level = "custom";
            params.target_size_mb = targetMb;
        }
        setPhase("processing");
        await proc.run({
            endpoint: "/compress",
            outputSuffix: "compressed",
            outputExt: "pdf",
            params,
            // Large PDFs can legitimately take minutes; the hook default (60s)
            // would abort them mid-flight.
            uploadOptions: { timeoutMs: 180_000 },
        }, retry);
        setPhase("done");
    }, [proc, level, customQuality, customMaxDim, targetMb]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            emitToolSuccess("Compress PDF");
            proc.downloadAll("archive_compressed");
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
        const doneEntries = proc.entries.filter(e => e.status === "done");
        const first = proc.entries[0];
        const singleDone = !isMulti && first?.status === "done" ? first : null;

        // Single-file before/after — read off the response headers exactly as before.
        const compressedSize = singleDone ? compressedBytesOf(singleDone) : 0;
        const met = singleDone?.headers?.["x-target-met"];
        const targetMet = met === undefined || met === null ? null : met === "true";
        const targetMissed = targetMet === false;
        const origBytes = singleDone?.size ?? 0;
        const savings = compressedSize > 0 && origBytes > 0 ? Math.round((1 - compressedSize / origBytes) * 100) : 0;
        const compressedBarWidth = compressedSize > 0 && origBytes > 0 ? Math.max(5, Math.round((compressedSize / origBytes) * 100)) : 0;

        // Multi-file: per-file deltas + totals.
        const doneOrigTotal = doneEntries.reduce((s, e) => s + e.size, 0);
        const doneOutTotal = doneEntries.reduce((s, e) => s + compressedBytesOf(e), 0);

        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Compressed</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {targetMissed && (
                                    <span className="block font-mono text-[11px] tracking-[0.04em] text-copper mt-1.5">
                                        Couldn&apos;t reach {targetMb} MB — this is the smallest we could make it
                                    </span>
                                )}
                                {singleDone && compressedSize > 0 ? (
                                    <>Smaller by <span className="italic text-accent">{savings}%</span></>
                                ) : (
                                    <><span className="italic text-accent">{proc.doneCount}</span> PDF{proc.doneCount === 1 ? "" : "s"} compressed{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                )}
                            </h2>

                            {singleDone && compressedSize > 0 && (
                                <div className="mt-4 space-y-2.5 max-w-md">
                                    <div>
                                        <div className="font-medium flex items-center justify-between text-[11.5px] mb-1">
                                            <span className="text-muted-foreground">Original</span>
                                            <span className="text-muted-foreground tabular-nums">{formatFileSize(origBytes)}</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-paper-2 overflow-hidden">
                                            <div className="h-full rounded-full bg-muted-foreground/60" style={{ width: "100%" }} />
                                        </div>
                                    </div>
                                    <div>
                                        <div className="font-medium flex items-center justify-between text-[11.5px] mb-1">
                                            <span className="text-accent">Compressed</span>
                                            <span className="text-accent tabular-nums font-semibold">{formatFileSize(compressedSize)}</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-paper-2 overflow-hidden">
                                            <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${compressedBarWidth}%` }} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Per-file before/after — the X-Compressed-Size header
                                each response carried, one row per PDF. */}
                            {isMulti && doneEntries.length > 0 && (
                                <div className="mt-4 max-w-md space-y-1.5">
                                    {doneEntries.map(e => {
                                        const out = compressedBytesOf(e);
                                        const pct = out > 0 && e.size > 0 ? Math.round((1 - out / e.size) * 100) : 0;
                                        const missed = e.headers?.["x-target-met"] === "false";
                                        return (
                                            <div key={e.id} className="flex items-center justify-between gap-3 py-1 border-b border-border/40 last:border-0">
                                                <span className="truncate min-w-0 text-[12px] font-medium text-foreground">{e.name}</span>
                                                <span className="font-mono text-[10.5px] tracking-wide tabular-nums text-muted-foreground shrink-0">
                                                    {formatFileSize(e.size)} → <span className="text-accent font-semibold">{formatFileSize(out)}</span>
                                                    <span className={cn("ml-1.5", pct > 0 ? "text-accent" : "text-muted-foreground")}>−{Math.max(0, pct)}%</span>
                                                    {missed && <span className="ml-1.5 text-copper">target missed</span>}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    {doneOutTotal > 0 && (
                                        <div className="flex items-center justify-between gap-3 pt-1">
                                            <span className="font-medium text-[11.5px] text-muted-foreground">Total</span>
                                            <span className="font-mono text-[10.5px] tracking-wide tabular-nums text-muted-foreground">
                                                {formatFileSize(doneOrigTotal)} → <span className="text-accent font-semibold">{formatFileSize(doneOutTotal)}</span>
                                                {doneOrigTotal > 0 && <span className="ml-1.5 text-accent">−{Math.max(0, Math.round((1 - doneOutTotal / doneOrigTotal) * 100))}%</span>}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button
                                        onClick={() => proc.downloadAll("archive_compressed")}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-opacity"
                                    >
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
                                    <RotateCcw size={12} /> Compress more
                                </button>
                            </div>
                            {singleDone && (
                                <ResultHandoff
                                    blob={singleDone.blob ?? null}
                                    filename={singleDone.outName || buildOutputFilename(singleDone.name, "compressed", "pdf")}
                                    fromSlug="compress-pdf"
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Upload zone */}
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isPdfOnly); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload files"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag
                        ? "border-accent bg-accent/[0.06]"
                        : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                )}>
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more files" : "Select PDFs to compress"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground mt-1">
                    Drag &amp; drop or click · Multi-file OK · Max {MAX_FILE_SIZE_LABEL} each
                </p>
            </div>

            {/* Try with sample affordance — only shows before any file has been picked
                so the dropzone still leads. Loads /samples/sample.pdf and pre-fills. */}
            {proc.entries.length === 0 && (
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
                            <><Sparkles size={11} className="text-accent" /> Try with a sample PDF</>
                        )}
                    </button>
                </div>
            )}

            {proc.entries.length > 0 && (
                <>
                    {/* File queue */}
                    <MultiFileQueue
                        entries={proc.entries}
                        reorderable={false}
                        onRemove={proc.removeFile}
                        onReorder={proc.reorder}
                        onClearAll={proc.clearAll}
                        onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                        busy={phase === "processing"}
                    />

                    {/* Level picker */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                                Compression level
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label="What do these levels do?"
                                            className="inline-flex items-center justify-center h-4 w-4 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <Info size={11} aria-hidden="true" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[280px] text-[12px] leading-relaxed font-sans normal-case tracking-normal">
                                        <p><span className="font-semibold">Light</span> downsamples big images modestly — quality is nearly indistinguishable.</p>
                                        <p className="mt-1"><span className="font-semibold">Recommended</span> drops JPEG quality to ~75 and caps dimensions at 1800px — the everyday default.</p>
                                        <p className="mt-1"><span className="font-semibold">Extreme</span> goes aggressive: ~q60 and 1200px max — text stays crisp, large photos get noticeably softer.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </span>
                            <span className="text-accent tabular-nums">
                                {formatFileSize(totalBytes)} → ~{formatFileSize(estimatedOutputBytes)}
                            </span>
                        </div>
                        <div className="p-3 space-y-1.5">
                            {/* Intensity bar */}
                            <div className="h-1.5 rounded-full bg-paper-2 overflow-hidden mb-2">
                                <div
                                    className="h-full rounded-full transition-all duration-500 ease-out bg-accent"
                                    style={{ width: `${Math.round(estimatedSavingFraction * 100)}%` }}
                                />
                            </div>
                            {levels.map((l, idx) => {
                                const active = level === l.id;
                                const estBytes = l.id === "custom"
                                    ? estimatedOutputBytes
                                    : Math.round(totalBytes * (1 - SAVINGS_BY_LEVEL[l.id as Exclude<Level, "custom">]));
                                return (
                                    <button
                                        key={l.id}
                                        type="button"
                                        onClick={() => setLevel(l.id)}
                                        className={cn(
                                            "w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                                            active
                                                ? "border-accent bg-accent/[0.06]"
                                                : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <div className={cn(
                                            "h-4 w-4 rounded-full border flex items-center justify-center shrink-0",
                                            active ? "border-accent bg-accent" : "border-border-strong"
                                        )}>
                                            {active && <div className="h-1.5 w-1.5 rounded-full bg-accent-foreground" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <p className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">
                                                    <span className="font-medium text-[11.5px] text-accent mr-1.5">{String(idx + 1).padStart(2, "0")}</span>
                                                    {l.label}
                                                </p>
                                                <span className={cn("font-mono text-[11px] tracking-wide tabular-nums", active ? "text-accent font-semibold" : "text-muted-foreground")}>
                                                    {l.id === "custom" ? l.saving : `≈ ${formatFileSize(estBytes)}`}
                                                </span>
                                            </div>
                                            <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">{l.desc}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Target size */}
                        {level === "target" && (
                            <div className="border-t border-border bg-paper-2/30 p-4 animate-fade-in">
                                <label htmlFor="target-mb" className="font-medium text-[11px] text-muted-foreground">
                                    Target size
                                </label>
                                <div className="mt-1.5 flex items-center gap-2">
                                    <input
                                        id="target-mb"
                                        type="number" inputMode="decimal"
                                        min={0.1} max={500} step={0.5}
                                        value={targetMb}
                                        onChange={e => setTargetMb(Math.max(0.1, Math.min(500, parseFloat(e.target.value) || 10)))}
                                        className="w-28 rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                    />
                                    <span className="font-mono text-[12px] text-muted-foreground">MB</span>
                                    <div className="flex gap-1.5 ml-1">
                                        {[5, 10, 25].map(mb => (
                                            <button
                                                key={mb}
                                                type="button"
                                                onClick={() => setTargetMb(mb)}
                                                className={cn(
                                                    "h-7 px-2.5 rounded-md border font-mono text-[11px] transition-colors",
                                                    targetMb === mb
                                                        ? "border-accent bg-accent/10 text-foreground"
                                                        : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                                                )}
                                            >
                                                {mb} MB
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <p className="text-[12px] text-muted-foreground mt-2 leading-relaxed">
                                    We try progressively harder settings and stop at the lightest one
                                    that fits, so the file isn't squeezed more than it needs to be.
                                    If the target can't be reached you'll get the smallest version we
                                    could make, and we'll say so.
                                    {proc.entries.length > 1 && <> Each file is targeted at {targetMb} MB individually.</>}
                                </p>
                            </div>
                        )}

                        {/* Custom sliders */}
                        {level === "custom" && (
                            <div className="border-t border-border bg-paper-2/30 p-4 space-y-4 animate-fade-in">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label htmlFor="jpeg-q" className="font-medium text-[11px] text-muted-foreground">JPEG quality</label>
                                        <span className="font-mono text-[11px] text-accent">{customQuality}</span>
                                    </div>
                                    <input
                                        id="jpeg-q"
                                        type="range" min={15} max={95} step={1}
                                        value={customQuality}
                                        onChange={e => setCustomQuality(parseInt(e.target.value, 10))}
                                        className="w-full accent-accent"
                                    />
                                    <div className="font-medium flex justify-between text-[11px] text-muted-foreground mt-1">
                                        <span>15 — tiny, lossy</span>
                                        <span>95 — pristine</span>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label htmlFor="max-dim" className="font-medium text-[11px] text-muted-foreground">Max image dimension (px)</label>
                                        <span className="font-mono text-[11px] text-accent">{customMaxDim}</span>
                                    </div>
                                    <input
                                        id="max-dim"
                                        type="range" min={300} max={4000} step={100}
                                        value={customMaxDim}
                                        onChange={e => setCustomMaxDim(parseInt(e.target.value, 10))}
                                        className="w-full accent-accent"
                                    />
                                    <div className="font-medium flex justify-between text-[11px] text-muted-foreground mt-1">
                                        <span>300 — heavily downsampled</span>
                                        <span>4000 — preserve detail</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Action */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={() => void process(false)}
                            disabled={!canProcess}
                            className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Compressing… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Minimize2 size={13} /> Compress {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        <button
                            type="button"
                            onClick={resetConfig}
                            className="font-medium ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            title="Restore default settings"
                        >
                            <Undo2 size={10} /> Reset to defaults
                        </button>
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
