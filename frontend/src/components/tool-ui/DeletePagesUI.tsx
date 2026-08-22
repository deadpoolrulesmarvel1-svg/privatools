/**
 * DeletePagesUI — remove specific pages from a PDF.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, Trash2, CheckCircle2, RotateCcw } from "lucide-react";
import { cn, friendlyError, isValidPageRange, pageRangeError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

export function DeletePagesUI() {
    const [file, setFile] = useState<File | null>(null);
    const [pages, setPages] = useState("1,3-5");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);

    const rangeValid = pages.trim().length > 0 && isValidPageRange(pages);
    const canProcess = !!file && rangeValid && status !== "processing";

    const process = useCallback(async () => {
        if (!file || !pages.trim()) return;
        setStatus("processing");
        setError(null);
        try {
            await processAndDownload("/delete-pages", file, buildOutputFilename(file.name, "trimmed", "pdf"), { pages });
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Delete pages failed";
            setError(friendlyError(msg, "Couldn't delete those pages."));
            setStatus("idle");
        }
    }, [file, pages]);

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

    const rangeErr = pageRangeError(pages);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Pages deleted</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{pages}</span> removed
                        </h2>
                        <button
                            onClick={() => { setFile(null); setStatus("idle"); setPages("1,3-5"); }}
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
                onClear={() => setFile(null)}
                accept=".pdf"
                label="Drop PDF to delete pages"
                hint="Use range syntax like 1,3-5,9"
            />
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Pages to delete
                </div>
                <div className="p-4">
                    <input
                        value={pages}
                        onChange={e => setPages(e.target.value)}
                        placeholder="1,3-5,9"
                        spellCheck={false}
                        aria-invalid={!rangeValid}
                        className={cn(
                            "block w-full rounded-md border bg-card px-3 py-2 font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 transition-colors",
                            rangeValid
                                ? "border-border focus:border-accent focus:ring-accent/20"
                                : "border-destructive/60 focus:border-destructive focus:ring-destructive/20"
                        )}
                    />
                    {rangeErr ? (
                        <p className="font-medium text-[11px] text-destructive mt-2">{rangeErr}</p>
                    ) : (
                        <p className="font-medium text-[11px] text-muted-foreground/85 mt-2">
                            Syntax — comma-separated · "1-3" = range · "1,3-5,9" = mixed
                        </p>
                    )}
                </div>
            </div>
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}
            <div className="flex items-center gap-3">
                <button type="button" onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Deleting…</> : <><Trash2 size={13} /> Delete pages</>}
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
            <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent" /><span className="absolute top-0 left-0 w-px h-3 bg-accent" /></span>
            <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent" /><span className="absolute top-0 right-0 w-px h-3 bg-accent" /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent" /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent" /></span>
        </>
    );
}
