/**
 * SplitBySizeUI — chunk a PDF into ZIP parts each capped at a target MB.
 * Workshop: file upload + numeric input with quick presets + Cmd+Enter.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, Maximize2, CheckCircle2, RotateCcw, Download } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const PRESETS = [5, 10, 25, 50];

const SPLIT_BY_SIZE_DEFAULTS: { maxSizeMb: number } = {
    maxSizeMb: 10,
};

export function SplitBySizeUI() {
    const [config, , { setField }] = useToolDefaults("split-by-size", SPLIT_BY_SIZE_DEFAULTS);
    const { maxSizeMb } = config;
    const setMaxSizeMb = useCallback((v: React.SetStateAction<typeof SPLIT_BY_SIZE_DEFAULTS["maxSizeMb"]>) => setField("maxSizeMb", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);

    const canProcess = !!file && maxSizeMb > 0 && status !== "processing";

    const process = useCallback(async () => {
        if (!file || maxSizeMb <= 0) return;
        setStatus("processing");
        setError(null);
        try {
            await processAndDownload(
                "/split-by-size",
                file,
                buildOutputFilename(file.name, "split", "zip"),
                { max_size_mb: maxSizeMb }
            );
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Split by size failed";
            setError(friendlyError(msg, "Couldn't split by size."));
            setStatus("idle");
        }
    }, [file, maxSizeMb]);

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
                        <p className="section-mark mb-2">Split complete</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            Parts up to <span className="italic text-accent">{maxSizeMb} MB</span>
                        </h2>
                        <p className="mt-2 font-mono text-[11px] tracking-[0.06em] uppercase text-muted-foreground">
                            ZIP archive downloaded
                        </p>
                        <button
                            onClick={() => { setFile(null); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Split another
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
                label="Drop PDF to split by size"
                hint="Creates ZIP parts capped at your max size"
            />

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span><span className="text-accent">§</span> Max part size</span>
                    <span className="text-accent">{maxSizeMb} MB</span>
                </div>
                <div className="p-4 space-y-3">
                    <div className="relative">
                        <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={1024}
                            value={maxSizeMb}
                            onChange={e => {
                                const n = parseInt(e.target.value || "1", 10);
                                setMaxSizeMb(Math.min(1024, Math.max(1, isNaN(n) ? 1 : n)));
                            }}
                            className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors pr-12"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground tracking-wider">MB</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground/85">Quick</span>
                        {PRESETS.map(p => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => setMaxSizeMb(p)}
                                className={cn(
                                    "h-7 px-2.5 rounded border font-mono text-[11px] tracking-wide transition-colors",
                                    maxSizeMb === p ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                )}
                            >
                                {p} MB
                            </button>
                        ))}
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
                        ? <><Loader2 size={13} className="animate-spin" /> Splitting…</>
                        : <><Maximize2 size={13} /> Split by size</>}
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
