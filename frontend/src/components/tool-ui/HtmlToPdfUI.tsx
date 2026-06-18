/**
 * HtmlToPdfUI — convert URL or raw HTML to a PDF.
 * Workshop: mode toggle, mono URL input or code-styled HTML textarea.
 */
import { useState, useEffect, useCallback } from "react";
import { Globe, Code2, Download, Loader2, CheckCircle2, AlertCircle, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, postFormData } from "@/lib/api";

type Mode = "url" | "html";

export function HtmlToPdfUI() {
    const [mode, setMode] = useState<Mode>("url");
    const [url, setUrl] = useState("");
    const [html, setHtml] = useState("");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);

    const canProcess = mode === "url" ? url.trim().length > 0 : html.trim().length > 0;

    const getOutputName = useCallback(() => {
        if (mode === "html") return "html.pdf";
        try {
            const u = new URL(url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`);
            const host = u.hostname.replace(/^www\./, "");
            return `${host}.pdf`;
        } catch { return "webpage.pdf"; }
    }, [mode, url]);

    const process = useCallback(async () => {
        if (!canProcess) return;
        setState("processing"); setError(null);
        try {
            const res = await postFormData("/html-to-pdf", () => {
                const fd = new FormData();
                if (mode === "url") fd.append("url", url.trim());
                else fd.append("html_content", html);
                return fd;
            }, { timeoutMs: 120_000 });
            const blob = await res.blob();
            setResultBlob(blob);
            setState("done");
            downloadBlob(blob, getOutputName());
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Conversion failed";
            setError(friendlyError(msg, "Couldn't render that HTML to PDF."));
            setState("idle");
        }
    }, [canProcess, mode, url, html, getOutputName]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess && state !== "processing") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, state, process]);

    const htmlSize = mode === "html" && html ? formatFileSize(new Blob([html]).size) : null;

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Converted</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            {mode === "url" ? "Page" : "HTML"} → <span className="italic text-accent">PDF</span>
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && downloadBlob(resultBlob, getOutputName())} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download PDF
                            </button>
                            <button onClick={() => { setState("idle"); setResultBlob(null); }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                <RotateCcw size={12} /> Convert another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-md border border-border bg-paper-2/40">
                {([
                    { v: "url" as Mode, label: "From URL", Icon: Globe },
                    { v: "html" as Mode, label: "From HTML", Icon: Code2 },
                ]).map(m => {
                    const active = mode === m.v;
                    return (
                        <button
                            key={m.v}
                            onClick={() => setMode(m.v)}
                            className={cn(
                                "rounded h-9 inline-flex items-center justify-center gap-1.5 text-[12.5px] font-medium transition-colors",
                                active ? "bg-card border border-accent text-accent" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                            )}
                        >
                            <m.Icon size={12} /> {m.label}
                        </button>
                    );
                })}
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span><span className="text-accent">§</span> {mode === "url" ? "Web page URL" : "HTML content"}</span>
                    {htmlSize && <span className="text-muted-foreground/70">{htmlSize}</span>}
                </div>
                <div className="p-4">
                    {mode === "url" ? (
                        <input
                            type="url" value={url} onChange={e => setUrl(e.target.value)}
                            placeholder="https://example.com"
                            aria-label="Web page URL"
                            spellCheck={false}
                            className="w-full rounded-md border border-border bg-card px-3 py-2.5 font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    ) : (
                        <textarea
                            value={html} onChange={e => setHtml(e.target.value)} rows={10}
                            placeholder="<html>&#10;  <body>&#10;    <h1>Hello</h1>&#10;  </body>&#10;</html>"
                            aria-label="HTML content"
                            spellCheck={false}
                            wrap="off"
                            className="w-full rounded-md border border-border bg-paper-2/40 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors resize-y overflow-x-auto whitespace-pre tab-size-2"
                            style={{ tabSize: 2 }}
                        />
                    )}
                </div>
                {mode === "url" && url.trim() && (
                    <div className="px-4 pb-3 font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85">
                        <span className="text-accent">§</span> Output: <span className="text-foreground">{getOutputName()}</span>
                    </div>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3">
                <button onClick={process} disabled={state === "processing" || !canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Converting…</> : <><Download size={13} /> Convert to PDF</>}
                </button>
                {canProcess && state === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
