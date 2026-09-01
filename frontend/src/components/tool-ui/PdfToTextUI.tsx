/**
 * PdfToTextUI — extract readable text + word/char/page stats.
 * Workshop: stat tiles (Words / Chars / Pages) + mono output panel.
 *
 * Multi-file via useMultiFileProcessor. The endpoint answers JSON, so the
 * queue's blobs are parsed client-side: one file keeps the interactive text
 * panel exactly as before; several files become a ZIP with one .txt per PDF.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Copy, Download, Loader2, AlertCircle, CheckCircle2, Hash, Type, FileText, RotateCcw, ScanText, AlignLeft, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

interface ExtractedResult { text: string; pages?: number; }

interface ParsedResult {
    id: string;
    name: string;
    text: string;
    pages?: number;
}

export function PdfToTextUI() {
    const proc = useMultiFileProcessor();
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [results, setResults] = useState<ParsedResult[] | null>(null);
    const [copied, setCopied] = useState(false);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && state !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setState("processing");
        setResults(null);
        await proc.run({
            endpoint: "/pdf-to-text",
            outputSuffix: "text",
            outputExt: "txt",
        }, retry);
        setState("done");
    }, [proc]);

    // The endpoint returns JSON ({text, pages}), which the hook stored as a
    // blob per entry — parse them once the run settles.
    useEffect(() => {
        if (state !== "done" || results !== null) return;
        let cancelled = false;
        void (async () => {
            const done = proc.entries.filter(e => e.status === "done" && e.blob);
            const parsed = await Promise.all(done.map(async (e): Promise<ParsedResult> => {
                try {
                    const data = JSON.parse(await e.blob!.text()) as ExtractedResult;
                    return { id: e.id, name: e.name, text: data.text ?? "", pages: data.pages };
                } catch {
                    return { id: e.id, name: e.name, text: "" };
                }
            }));
            if (!cancelled) setResults(parsed);
        })();
        return () => { cancelled = true; };
    }, [state, results, proc.entries]);

    // Multi-file runs download a ZIP with one .txt per PDF. A single file keeps
    // the old behavior: show the text panel, download only on request.
    const downloadZip = useCallback(() => {
        if (!results || results.length === 0) return;
        const enc = new TextEncoder();
        const items = results.map(r => ({
            name: buildOutputFilename(r.name, null, "txt"),
            data: enc.encode(r.text),
        }));
        downloadBlob(buildZip(items), "archive_text.zip");
    }, [results]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (state === "done" && !downloadedRef.current && proc.entries.length > 1 && results && results.length > 0) {
            downloadedRef.current = true;
            downloadZip();
        }
    }, [state, proc.entries.length, results, downloadZip]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess && state === "idle") {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, state, process]);

    const restart = () => { proc.reset(); setState("idle"); setResults(null); downloadedRef.current = false; };

    const single = results && proc.entries.length === 1 && results.length === 1 ? results[0] : null;

    const handleCopy = async () => {
        if (!single) return;
        await navigator.clipboard.writeText(single.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    const handleDownload = () => {
        if (!single) return;
        const blob = new Blob([single.text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "extracted_text.txt";
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    };

    // Single-file result — the interactive stats + text panel.
    if (state === "done" && single) {
        const wordCount = single.text ? single.text.split(/\s+/).filter(Boolean).length : 0;
        const charCount = single.text ? single.text.length : 0;
        const lineCount = single.text ? single.text.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;

        // Heuristic: empty/whitespace-only extraction → almost certainly an image-only PDF.
        const isLikelyImageOnly = wordCount < 5 && (single.pages ?? 0) > 0;

        return (
            <div className="space-y-4 animate-fade-up">
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                    <div className="relative px-5 py-4 border-b border-accent/20 animate-corner-extend">
                        <CornerMarks />
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                                <ScanText size={18} className="text-accent" strokeWidth={1.75} />
                            </div>
                            <div className="flex-1">
                                <p className="section-mark">Text extracted</p>
                                <h2 className="font-display text-[20px] font-bold text-foreground tracking-[-0.02em] leading-tight">
                                    <span className="italic text-accent">{wordCount.toLocaleString()}</span> words
                                </h2>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4">
                        {[
                            { label: "Words", value: wordCount, icon: Type },
                            { label: "Chars", value: charCount, icon: Hash },
                            { label: "Lines", value: lineCount, icon: AlignLeft },
                            ...(single.pages ? [{ label: "Pages", value: single.pages, icon: FileText }] : []),
                        ].map(s => (
                            <div key={s.label} className="rounded-lg border border-border bg-card p-3 text-center">
                                <s.icon size={13} className="mx-auto mb-1 text-muted-foreground" />
                                <p className="font-display text-[19px] font-bold tracking-[-0.02em] text-foreground">{s.value.toLocaleString()}</p>
                                <p className="font-medium text-[11px] text-muted-foreground">{s.label}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Image-only PDF hint — text extraction came back empty */}
                {isLikelyImageOnly && (
                    <div className="rounded-xl border border-copper/30 bg-copper-soft/40 px-4 py-3 text-[13px] text-foreground animate-fade-in">
                        <div className="flex items-start gap-2">
                            <AlertCircle size={13} className="text-copper shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <p className="font-display font-semibold text-[13.5px]">Looks like an image-only PDF</p>
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    Try the <a href="/tool/ocr-pdf" className="underline hover:text-accent">OCR PDF</a> tool to extract text from scanned pages.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Extracted text</span>
                        <button onClick={handleCopy} className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-accent hover:opacity-80 transition-opacity", copied && "animate-copy-flash")}>
                            {copied ? <><CheckCircle2 size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                        </button>
                    </div>
                    <textarea
                        readOnly
                        value={single.text}
                        className="w-full h-72 bg-paper-2/30 px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground resize-y outline-none"
                    />
                </div>

                <div className="flex flex-wrap gap-2">
                    <button onClick={handleDownload} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                        <Download size={13} /> Download .txt
                    </button>
                    <button onClick={restart} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                        <RotateCcw size={12} /> Extract another
                    </button>
                </div>
            </div>
        );
    }

    // Multi-file (or nothing-succeeded) summary.
    if (state === "done" && results && !single) {
        const totalWords = results.reduce((sum, r) => sum + (r.text ? r.text.split(/\s+/).filter(Boolean).length : 0), 0);
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Text extracted</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {proc.doneCount > 0
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} extracted{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <>Nothing succeeded</>}
                            </h2>
                            {proc.doneCount > 0 && (
                                <p className="font-medium mt-2 text-[12px] text-muted-foreground">
                                    {totalWords.toLocaleString()} words · ZIP downloaded — one .txt per PDF
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={downloadZip} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download ZIP
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
                                <button onClick={restart} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                    <RotateCcw size={12} /> Extract another
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
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isPdfOnly); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDFs"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files?.length) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <ScanText size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Drop PDFs to extract text"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    All readable text · word & character stats · several files become a ZIP of .txt
                </p>
            </div>

            {proc.entries.length > 0 && (
                <MultiFileQueue
                    entries={proc.entries}
                    reorderable={false}
                    onRemove={proc.removeFile}
                    onReorder={proc.reorder}
                    onClearAll={proc.clearAll}
                    onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                    busy={state === "processing"}
                />
            )}

            {proc.entries.length > 0 && (
                <div className="flex items-center gap-3">
                    <button onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {state === "processing"
                            ? <><Loader2 size={13} className="animate-spin" /> Extracting… ({proc.doneCount}/{proc.entries.length})</>
                            : <><ScanText size={13} /> Extract text{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</>}
                    </button>
                    {state === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
                </div>
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
