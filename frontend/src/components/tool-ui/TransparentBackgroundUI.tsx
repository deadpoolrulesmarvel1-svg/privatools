/**
 * TransparentBackgroundUI — make near-white pixels transparent.
 * Workshop: sliders inside lab-card, signal-green CTA.
 * Multi-file via useMultiFileProcessor (same threshold/DPI applied to every PDF).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, CheckCircle2, RotateCcw, Eraser, Download } from "lucide-react";
import { downloadBlob, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { FileUploadZone } from "./FileUploadZone";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const TRANSPARENT_BACKGROUND_DEFAULTS: { threshold: number; dpi: number } = {
    threshold: 245,
    dpi: 144,
};

export function TransparentBackgroundUI() {
    const [config, , { setField }] = useToolDefaults("transparent-background", TRANSPARENT_BACKGROUND_DEFAULTS);
    const { threshold, dpi } = config;
    const setThreshold = useCallback((v: React.SetStateAction<typeof TRANSPARENT_BACKGROUND_DEFAULTS["threshold"]>) => setField("threshold", v), [setField]);
    const setDpi = useCallback((v: React.SetStateAction<typeof TRANSPARENT_BACKGROUND_DEFAULTS["dpi"]>) => setField("dpi", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/transparent-background",
            outputSuffix: "transparent",
            outputExt: "pdf",
            params: { threshold, dpi },
        }, retry);
        setPhase("done");
    }, [proc, threshold, dpi]);

    // The backend answers with a generic `transparent.pdf` name; the old UI
    // named downloads after the source file (`stem_transparent.pdf`). Keep
    // that: build names client-side. N=1 → direct blob, N>1 → zip.
    const downloadResults = useCallback(() => {
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, buildOutputFilename(done[0].name, "transparent", "pdf"));
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: buildOutputFilename(e.name, "transparent", "pdf"),
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), "archive_transparent.zip");
        })();
    }, [proc.entries]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            downloadResults();
        }
    }, [phase, proc.doneCount, downloadResults]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && proc.entries.length > 0 && phase === "idle") {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [proc.entries.length, phase, process]);

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
                            <p className="section-mark mb-2">Background removed</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> transparent PDF{proc.doneCount === 1 ? "" : "s"}{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">Transparent</span> PDF downloaded</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
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
                                    <RotateCcw size={12} /> Process another
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
            <FileUploadZone
                file={null}
                multiple
                onFilesSelect={files => proc.addFiles(files)}
                onFileSelect={f => proc.addFiles([f])}
                onClear={proc.clearAll}
                accept=".pdf"
                label={proc.entries.length ? "Add more files" : "Drop PDF to make background transparent"}
                hint="Convert near-white pixels to transparent"
            />

            {proc.entries.length > 0 && (
                <>
                    <MultiFileQueue
                        entries={proc.entries}
                        reorderable={false}
                        onRemove={proc.removeFile}
                        onReorder={proc.reorder}
                        onClearAll={proc.clearAll}
                        onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                        busy={phase === "processing"}
                    />
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Options
                        </div>
                        <div className="p-5 space-y-5">
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label htmlFor="threshold-range" className="font-medium text-[11.5px] text-muted-foreground">White threshold</label>
                                    <span className="font-mono text-[11px] text-accent">{threshold}</span>
                                </div>
                                <input
                                    id="threshold-range"
                                    type="range" min={180} max={255}
                                    value={threshold} onChange={e => setThreshold(parseInt(e.target.value, 10))}
                                    aria-label="White threshold"
                                    className="w-full accent-foreground"
                                />
                                <p className="font-medium text-[11px] text-muted-foreground mt-1">
                                    Higher → only bright whites removed · Lower → also clears light backgrounds
                                </p>
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label htmlFor="dpi-range" className="font-medium text-[11.5px] text-muted-foreground">Render DPI</label>
                                    <span className="font-mono text-[11px] text-accent">{dpi}</span>
                                </div>
                                <input
                                    id="dpi-range"
                                    type="range" min={72} max={300}
                                    value={dpi} onChange={e => setDpi(parseInt(e.target.value, 10))}
                                    aria-label="Render DPI"
                                    className="w-full accent-foreground"
                                />
                                <p className="font-medium text-[11px] text-muted-foreground mt-1">
                                    Rasterizes pages — higher DPI = sharper but larger file
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={() => void process(false)} disabled={phase === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Processing… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Eraser size={13} /> Remove background{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""} <Download size={13} /></>}
                        </button>
                        {phase === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
