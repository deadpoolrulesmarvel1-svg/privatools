/**
 * PdfToWordUI — convert one or many PDFs to .docx.
 * Multi-file via useMultiFileProcessor — sequential conversion at concurrency 3.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
    Loader2, RotateCcw, FileText, Download, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { StudioActions, StudioFile, StudioResult } from "@/skins/experience/ToolStudio";
import { failureDetail, retryKinds, studioOutcome } from "@/skins/experience/studio-outcome";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { MultiFileQueue } from "./MultiFileQueue";

export function PdfToWordUI() {
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const dropzone = useRef<HTMLDivElement>(null);
    // Set when a failed result is left for fresh files, so focus lands on the drop zone, not the page body.
    const [returning, setReturning] = useState(false);
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    useEffect(() => {
        if (returning && phase === "idle") { setReturning(false); focusIfIdle(dropzone.current); }
    }, [returning, phase]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/pdf-to-word",
            outputSuffix: null,
            outputExt: "docx",
        }, retry);
        setPhase("done");
    }, [proc]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_docx");
        }
    }, [phase, proc]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (phase === "done") {
        const isMulti = proc.entries.length > 1;
        const tone = studioOutcome(proc.doneCount, proc.failedCount);
        // A failed or partial run uses the shared result: no "Converted" over a failure, every
        // file's reason in view, and "Try again" only for failures another attempt could fix.
        if (tone !== "success") {
            const startOver = (files?: File[]) => {
                proc.reset(); downloadedRef.current = false;
                if (files) proc.addFiles(files, isPdfOnly);
                setReturning(true); setPhase("idle");
            };
            const title = tone === "failure" ? isMulti ? "None of these PDFs could be converted." : "This PDF couldn’t be converted."
                : `${proc.doneCount} of ${proc.entries.length} PDFs converted.`;
            const detail = tone === "failure" ? failureDetail(proc.failedCount, retryKinds(proc.entries))
                : `The download has started. ${proc.failedCount === 1 ? "One file" : `${proc.failedCount} files`} couldn’t be converted; the reason is below.`;
            return <StudioResult tone={tone} title={title} detail={detail}>
                {proc.entries.map(entry => <StudioFile key={entry.id} name={entry.status === "done" ? entry.outName || entry.name : entry.name}
                    status={entry.status === "failed" ? "error" : entry.status}
                    detail={entry.status === "done" ? "Word document" : entry.error || "Could not convert this file"} />)}
                <StudioActions tone={tone} retryCount={proc.retryableCount} onRetry={() => { downloadedRef.current = false; void process("transient"); }}
                    choose={{ accepts: ".pdf", multiple: true, label: isMulti ? "Choose different files" : "Choose a different file", onFiles: startOver }}
                    primary={<button type="button" className="ts-primary-button" onClick={() => proc.downloadAll("archive_docx")}><Download size={16} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}</button>}
                    more={tone !== "failure" && <button type="button" className="ts-text-button" onClick={() => startOver()}>Convert more</button>} />
            </StudioResult>;
        }
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <FileText size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Converted</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} → <span className="italic text-accent">.docx</span></>
                                    : <>PDF → <span className="italic text-accent">.docx</span></>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "DOCX downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_docx")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}
                                    </button>
                                )}
                                <button onClick={() => { proc.reset(); setPhase("idle"); downloadedRef.current = false; }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                    <RotateCcw size={12} /> Convert more
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
                ref={dropzone}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isPdfOnly); }}
                onClick={() => fileRef.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDFs"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <FileText size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Drop PDFs to convert"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Outputs editable Word documents · multi-file OK · max {MAX_FILE_SIZE_LABEL} each
                </p>
            </div>

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

                    <p className="font-medium text-[11px] text-muted-foreground">
                        Tip — scanned PDFs need OCR first. Try <a href="/tool/ocr-pdf" className="underline hover:text-accent">OCR PDF</a> if text doesn't transfer.
                    </p>
                    <div className="flex items-center gap-3">
                        <button onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Converting… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Download size={13} /> Convert {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "to Word"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
