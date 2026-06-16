/**
 * UrlToPdfUI — fetch a URL & render to PDF via WeasyPrint.
 * Workshop: monospaced URL input with globe prefix, lab note about JS-rendering caveat.
 */
import { useState, useEffect, useCallback } from "react";
import { Globe, Download, Loader2, AlertCircle, ExternalLink, RotateCcw } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { downloadBlob, postFormData } from "@/lib/api";

export function UrlToPdfUI() {
    const [url, setUrl] = useState("");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);

    const isValidUrl = (s: string) => {
        try { new URL(s); return s.startsWith("http://") || s.startsWith("https://"); }
        catch { return false; }
    };

    const convert = useCallback(async () => {
        const trimmed = url.trim();
        if (!trimmed) { setError("Please enter a URL"); return; }
        const finalUrl = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
        if (!isValidUrl(finalUrl)) { setError("Please enter a valid URL (e.g. https://example.com)"); return; }

        setStatus("processing"); setError(null);
        try {
            const res = await postFormData("/url-to-pdf", () => {
                const fd = new FormData();
                fd.append("url", finalUrl);
                return fd;
            }, { timeoutMs: 120_000 });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Conversion failed";
            setError(friendlyError(msg, "Couldn't fetch that URL as a PDF."));
            setStatus("idle");
        }
    }, [url]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && url.trim() && status !== "processing") {
                e.preventDefault(); convert();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [url, status, convert]);

    // Use shared downloadBlob (handles URL revoke + toast) instead of bespoke download function.
    const download = () => {
        if (!resultBlob) return;
        let filename = "webpage.pdf";
        try {
            const domain = new URL(url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`).hostname;
            filename = `${domain.replace(/\./g, "_")}.pdf`;
        } catch { /* keep default */ }
        downloadBlob(resultBlob, filename);
    };

    const reset = () => { setUrl(""); setStatus("idle"); setError(null); setResultBlob(null); };

    if (status === "done") {
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <Globe size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Page captured</p>
                            <h2 className="font-display text-[22px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                <span className="italic text-accent break-all">{url.trim()}</span>
                            </h2>
                            <p className="font-mono text-[10.5px] tracking-[0.04em] uppercase text-muted-foreground mt-1 flex items-center gap-1">
                                <ExternalLink size={10} /> Rendered to PDF
                            </p>
                            <div className="mt-5 flex flex-wrap gap-2">
                                <button onClick={download} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                    <Download size={13} /> Download PDF
                                </button>
                                <button onClick={reset} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                    <RotateCcw size={12} /> Convert another
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
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span className="text-accent">§</span> Webpage URL
                </div>
                <div className="p-4">
                    <div className="relative">
                        <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
                        <input
                            type="text" value={url}
                            onChange={e => { setUrl(e.target.value); setError(null); }}
                            onKeyDown={e => { if (e.key === "Enter" && url.trim()) convert(); }}
                            placeholder="https://example.com"
                            aria-label="Webpage URL"
                            spellCheck={false}
                            autoComplete="url"
                            className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2.5 font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    </div>
                    <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-2">
                        <span className="text-accent">§</span> Full URL with https:// — page rendered & flattened to PDF
                    </p>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="rounded-xl border border-border bg-card p-4">
                <p className="font-mono text-[10.5px] tracking-[0.04em] uppercase text-muted-foreground/85">
                    <span className="text-accent">§</span> Note — WeasyPrint renders server-side. Best for content-heavy pages; JS-rendered SPAs may not capture fully.
                </p>
            </div>

            <div className="flex items-center gap-3">
                <button onClick={convert} disabled={!url.trim() || status === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Capturing…</> : <><Globe size={13} /> Convert to PDF</>}
                </button>
                {url.trim() && status === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
