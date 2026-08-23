/**
 * TransparentBackgroundUI — make near-white pixels transparent.
 * Workshop: sliders inside lab-card, signal-green CTA.
 */
import { useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, CheckCircle2, RotateCcw, Eraser, Download } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
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
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            await processAndDownload("/transparent-background", file, buildOutputFilename(file.name, "transparent", "pdf"), { threshold, dpi });
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't make that background transparent."));
            setStatus("idle");
        }
    }, [file, threshold, dpi]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && status === "idle") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file, status, process]);

    if (status === "done") return (
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
                            <span className="italic text-accent">Transparent</span> PDF downloaded
                        </h2>
                        <button
                            onClick={() => { setFile(null); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Process another
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => { setFile(null); setStatus("idle"); }}
                accept=".pdf"
                label="Drop PDF to make background transparent"
                hint="Convert near-white pixels to transparent"
            />

            {file && (
                <>
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

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button onClick={process} disabled={status === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Processing…</> : <><Eraser size={13} /> Remove background <Download size={13} /></>}
                        </button>
                        {status === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
