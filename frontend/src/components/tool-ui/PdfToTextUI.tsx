/**
 * PdfToTextUI — extract readable text + word/char/page stats.
 * Workshop: stat tiles (Words / Chars / Pages) + mono output panel.
 */
import { useState, useEffect, useCallback } from "react";
import { Copy, Download, Loader2, AlertCircle, CheckCircle2, Hash, Type, FileText, RotateCcw, ScanText, AlignLeft } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFileGetJson } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

interface ExtractedResult { text: string; pages?: number; }

export function PdfToTextUI() {
    const [file, setFile] = useState<File | null>(null);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ExtractedResult | null>(null);
    const [copied, setCopied] = useState(false);

    const process = useCallback(async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            const data = await uploadFileGetJson<ExtractedResult>("/pdf-to-text", file);
            setResult(data);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Text extraction failed";
            setError(friendlyError(msg, "Couldn't extract text from that PDF."));
            setState("idle");
        }
    }, [file]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && state === "idle") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file, state, process]);

    const handleCopy = async () => {
        if (!result) return;
        await navigator.clipboard.writeText(result.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    const handleDownload = () => {
        if (!result) return;
        const blob = new Blob([result.text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "extracted_text.txt";
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    };

    const wordCount = result?.text ? result.text.split(/\s+/).filter(Boolean).length : 0;
    const charCount = result?.text ? result.text.length : 0;
    const lineCount = result?.text ? result.text.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;

    // Heuristic: empty/whitespace-only extraction → almost certainly an image-only PDF.
    const isLikelyImageOnly = result !== null && wordCount < 5 && (result.pages ?? 0) > 0;

    if (state === "done" && result) return (
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
                        ...(result.pages ? [{ label: "Pages", value: result.pages, icon: FileText }] : []),
                    ].map(s => (
                        <div key={s.label} className="rounded-lg border border-border bg-card p-3 text-center">
                            <s.icon size={13} className="mx-auto mb-1 text-muted-foreground" />
                            <p className="font-display text-[19px] font-bold tracking-[-0.02em] text-foreground">{s.value.toLocaleString()}</p>
                            <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85">{s.label}</p>
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
                                <span className="text-accent">§</span> Try the <a href="/tool/ocr-pdf" className="underline hover:text-accent">OCR PDF</a> tool to extract text from scanned pages.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span><span className="text-accent">§</span> Extracted text</span>
                    <button onClick={handleCopy} className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-accent hover:opacity-80 transition-opacity", copied && "animate-copy-flash")}>
                        {copied ? <><CheckCircle2 size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                    </button>
                </div>
                <textarea
                    readOnly
                    value={result.text}
                    className="w-full h-72 bg-paper-2/30 px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground resize-y outline-none"
                />
            </div>

            <div className="flex flex-wrap gap-2">
                <button onClick={handleDownload} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                    <Download size={13} /> Download .txt
                </button>
                <button onClick={() => { setFile(null); setState("idle"); setResult(null); }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                    <RotateCcw size={12} /> Extract another
                </button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone file={file} onFileSelect={f => { setFile(f); setResult(null); }} onClear={() => { setFile(null); setResult(null); }} accept=".pdf" label="Drop PDF to extract text" hint="All readable text · word & character stats" />
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}
            {file && (
                <div className="flex items-center gap-3">
                    <button onClick={process} disabled={state === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Extracting…</> : <><ScanText size={13} /> Extract text</>}
                    </button>
                    {state === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
