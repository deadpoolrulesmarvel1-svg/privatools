/**
 * RemoveBlankPagesUI — auto-detect and drop blank pages.
 * Workshop: file upload + sensitivity slider with live label.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, FileX2, CheckCircle2, RotateCcw } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const REMOVE_BLANK_PAGES_DEFAULTS: { sensitivity: number } = {
    sensitivity: 85,
};

export function RemoveBlankPagesUI() {
    const [config, , { setField }] = useToolDefaults("remove-blank-pages", REMOVE_BLANK_PAGES_DEFAULTS);
    const { sensitivity } = config;
    const setSensitivity = useCallback((v: React.SetStateAction<typeof REMOVE_BLANK_PAGES_DEFAULTS["sensitivity"]>) => setField("sensitivity", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);

    const canProcess = !!file && status !== "processing";

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing");
        setError(null);
        try {
            await processAndDownload(
                "/remove-blank-pages",
                file,
                buildOutputFilename(file.name, "cleaned", "pdf"),
                { sensitivity }
            );
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Couldn't remove blank pages";
            setError(friendlyError(msg, "Couldn't remove blank pages."));
            setStatus("idle");
        }
    }, [file, sensitivity]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Blanks removed</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">Cleaned</span> PDF downloaded
                        </h2>
                        <button
                            onClick={() => { setFile(null); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Clean another
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
                onClear={() => setFile(null)}
                accept=".pdf"
                label="Drop PDF to clean"
                hint="Auto-detects and removes empty pages"
            />

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Detection sensitivity</span>
                    <span className="text-accent">{sensitivity}%</span>
                </div>
                <div className="p-4 space-y-3">
                    <input
                        type="range"
                        min={50}
                        max={100}
                        step={5}
                        value={sensitivity}
                        onChange={e => setSensitivity(parseInt(e.target.value, 10))}
                        className="w-full accent-accent"
                        aria-label="Blank-page detection sensitivity"
                    />
                    <div className="font-medium flex justify-between text-[11px] text-muted-foreground/85">
                        <span>50 — strict (only truly blank)</span>
                        <span>100 — loose (drops faint scans)</span>
                    </div>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={process}
                    disabled={!canProcess}
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {status === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Scanning…</>
                        : <><FileX2 size={13} /> Remove blank pages</>}
                </button>
                {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
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
