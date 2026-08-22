/**
 * PdfaValidatorUI — heuristic PDF/A archive-marker check.
 * Workshop: lab-report verdict panel + per-issue rows.
 */
import { useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, CheckCircle2, XCircle, ShieldCheck, ShieldAlert, RotateCcw, Search, HelpCircle } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

interface PdfaResult {
    valid: boolean;
    standard: string;
    errors: string[];
}

// Map common heuristic notes to plain-English explanations.
// Matches by lowercase substring — order matters (most-specific first).
const NOTE_EXPLANATIONS: { match: string; explain: string }[] = [
    { match: "encrypt", explain: "PDF/A forbids encryption — archival files must remain decryptable indefinitely." },
    { match: "javascript", explain: "Embedded JavaScript can break in future PDF readers and is not allowed in PDF/A." },
    { match: "embedded file", explain: "Generic attachments aren't allowed in PDF/A-1; PDF/A-3 permits them but most archives forbid them." },
    { match: "font", explain: "All fonts must be embedded so the PDF renders identically on any system." },
    { match: "transparen", explain: "Transparency/alpha effects aren't allowed in PDF/A-1 (older archival standard)." },
    { match: "external", explain: "External content (audio/video/links to other files) breaks long-term archival guarantees." },
    { match: "metadata", explain: "PDF/A requires XMP metadata describing the archival profile (e.g. pdfaid:part)." },
    { match: "color", explain: "Color spaces must be device-independent (e.g. ICC-tagged) for PDF/A." },
    { match: "no pdf/a marker", explain: "No /pdfaid:part XMP tag found — the file isn't claiming PDF/A compliance." },
];

function explainNote(note: string): string | null {
    const lc = note.toLowerCase();
    return NOTE_EXPLANATIONS.find(e => lc.includes(e.match))?.explain ?? null;
}

export function PdfaValidatorUI() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PdfaResult | null>(null);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/pdfa-validator", file);
            const data = await res.json();
            setResult(data);
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't validate that PDF."));
            setStatus("idle");
        }
    }, [file]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && status === "idle") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file, status, process]);

    const toggleExpand = (i: number) => setExpanded(prev => {
        const next = new Set(prev);
        next.has(i) ? next.delete(i) : next.add(i);
        return next;
    });

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => { setFile(null); setResult(null); setStatus("idle"); }}
                accept=".pdf"
                label="Drop PDF to validate"
                hint="Heuristic PDF/A archive-marker check"
            />

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {status === "done" && result && (
                <div className="space-y-3 animate-fade-up">
                    <div className={cn(
                        "relative rounded-2xl border overflow-hidden",
                        result.valid ? "border-accent/30 bg-accent/[0.05]" : "border-copper/40 bg-copper-soft/40"
                    )}>
                        <div className="relative p-6 animate-corner-extend">
                            <CornerMarks tone={result.valid ? "accent" : "copper"} />
                            <div className="flex items-start gap-4">
                                <div className={cn(
                                    "h-12 w-12 rounded-xl border flex items-center justify-center shrink-0 animate-success-pop",
                                    result.valid ? "bg-accent/15 border-accent/35" : "bg-copper/15 border-copper/35"
                                )}>
                                    {result.valid
                                        ? <ShieldCheck size={22} className="text-accent" strokeWidth={1.75} />
                                        : <ShieldAlert size={22} className="text-copper" strokeWidth={1.75} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={cn("font-medium text-[11.5px] mb-1.5", result.valid ? "text-accent" : "text-copper")}>
                                        Validation
                                    </p>
                                    <h3 className="font-display text-[20px] font-bold text-foreground tracking-[-0.02em] leading-tight">
                                        {result.valid ? "PDF/A indicators look good" : "Potential PDF/A issues"}
                                    </h3>
                                    {result.standard && (
                                        <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                            Marker: <span className="text-foreground">{result.standard}</span>
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {result.errors?.length > 0 && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                                <span>Notes ({result.errors.length})</span>
                                <span className="text-muted-foreground/70 hidden sm:inline">Click for explanation</span>
                            </div>
                            <div className="divide-y divide-border">
                                {result.errors.map((e, i) => {
                                    const explanation = explainNote(e);
                                    const isOpen = expanded.has(i);
                                    return (
                                        <div key={i} className="px-4 py-2.5">
                                            <button
                                                type="button"
                                                onClick={() => explanation && toggleExpand(i)}
                                                disabled={!explanation}
                                                className={cn(
                                                    "flex items-start gap-2 w-full text-left",
                                                    explanation ? "cursor-pointer hover:opacity-90" : "cursor-default"
                                                )}
                                                aria-expanded={explanation ? isOpen : undefined}
                                                aria-label={explanation ? "Toggle explanation" : undefined}
                                            >
                                                <XCircle size={12} className="text-copper shrink-0 mt-0.5" />
                                                <span className="font-mono text-[12px] text-foreground flex-1">{e}</span>
                                                {explanation && (
                                                    <HelpCircle size={11} className={cn("shrink-0 mt-0.5 transition-colors", isOpen ? "text-accent" : "text-muted-foreground/60")} />
                                                )}
                                            </button>
                                            {explanation && isOpen && (
                                                <div className="mt-2 ml-6 rounded-md border border-accent/20 bg-accent/[0.04] px-3 py-2 text-[12px] text-foreground animate-fade-in">
                                                    <span className="font-medium text-[11px] text-accent mr-1.5">what it means</span>
                                                    {explanation}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <p className="font-medium text-[11px] text-muted-foreground/70">
                        Heuristic check only — not a full ISO PDF/A validator.
                    </p>

                    <button
                        onClick={() => { setFile(null); setStatus("idle"); setResult(null); }}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                    >
                        <RotateCcw size={12} /> Validate another
                    </button>
                </div>
            )}

            {status !== "done" && (
                <div className="flex items-center gap-3">
                    <button onClick={process} disabled={!file || status === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Validating…</> : <><Search size={13} /> Validate PDF/A</>}
                    </button>
                    {file && status === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
                </div>
            )}
        </div>
    );
}

function CornerMarks({ tone = "accent" }: { tone?: "accent" | "copper" }) {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    const c = tone === "copper" ? "bg-copper" : "bg-accent";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}><span className={`absolute top-0 left-0 h-px w-3 ${c}/70`} /><span className={`absolute top-0 left-0 w-px h-3 ${c}/70`} /></span>
            <span className={`${cls} -top-1 -right-1`}><span className={`absolute top-0 right-0 h-px w-3 ${c}/70`} /><span className={`absolute top-0 right-0 w-px h-3 ${c}/70`} /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className={`absolute bottom-0 left-0 h-px w-3 ${c}/70`} /><span className={`absolute bottom-0 left-0 w-px h-3 ${c}/70`} /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className={`absolute bottom-0 right-0 h-px w-3 ${c}/70`} /><span className={`absolute bottom-0 right-0 w-px h-3 ${c}/70`} /></span>
        </>
    );
}
