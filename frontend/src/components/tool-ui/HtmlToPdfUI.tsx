import { useState } from "react";
import { Globe, Code2, Download, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { postForm, downloadBlob } from "@/lib/api";

type Mode = "url" | "html";

export function HtmlToPdfUI() {
    const [mode, setMode] = useState<Mode>("url");
    const [url, setUrl] = useState("");
    const [html, setHtml] = useState("");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);

    const canProcess = mode === "url" ? url.trim().length > 0 : html.trim().length > 0;

    const process = async () => {
        if (!canProcess) return;
        setState("processing"); setError(null);
        try {
            const params = mode === "url" ? { url: url.trim() } : { html_content: html };
            const res = await fetch(`/api/html-to-pdf`, { method: "POST", body: new URLSearchParams(params as Record<string, string>) });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ detail: "Conversion failed" }));
                throw new Error(body.detail || `Request failed (${res.status})`);
            }
            const blob = await res.blob();
            setResultBlob(blob);
            setState("done");
            downloadBlob(blob, getOutputName());
        } catch (e: any) { setError(e.message || "Conversion failed"); setState("idle"); }
    };

    // Build a meaningful filename. URL mode → use the hostname (example.com.pdf).
    // HTML-paste mode → "html.pdf".
    const getOutputName = () => {
        if (mode === "html") return "html.pdf";
        try {
            const u = new URL(url.trim());
            const host = u.hostname.replace(/^www\./, "");
            return `${host}.pdf`;
        } catch {
            return "webpage.pdf";
        }
    };

    const handleDownload = () => { if (resultBlob) downloadBlob(resultBlob, getOutputName()); };

    if (state === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="text-lg font-bold text-foreground mb-1">Converted!</h2>
            <p className="text-sm text-muted-foreground mb-6">Your HTML has been converted to PDF.</p>
            <div className="flex justify-center gap-3 flex-wrap">
                <Button className="glow-primary" onClick={handleDownload}><Download size={15} />Download PDF</Button>
                <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setState("idle"); setResultBlob(null); }}>Convert another</Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-2">
                <button onClick={() => setMode("url")}
                    className={cn("flex-1 flex items-center justify-center gap-2 rounded-xl border py-3 text-sm transition-all",
                        mode === "url" ? "border-accent bg-accent/5 text-primary font-semibold" : "border-border text-muted-foreground hover:border-border/70 hover:bg-secondary/40")}>
                    <Globe size={15} /> From URL
                </button>
                <button onClick={() => setMode("html")}
                    className={cn("flex-1 flex items-center justify-center gap-2 rounded-xl border py-3 text-sm transition-all",
                        mode === "html" ? "border-accent bg-accent/5 text-primary font-semibold" : "border-border text-muted-foreground hover:border-border/70 hover:bg-secondary/40")}>
                    <Code2 size={15} /> From HTML
                </button>
            </div>

            {/* Input */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                {mode === "url" ? (
                    <>
                        <label className="text-sm font-semibold text-foreground">Web Page URL</label>
                        <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com"
                            className="w-full rounded-lg border border-border bg-secondary/20 px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent/50" />
                        <p className="text-xs text-muted-foreground">Enter a public URL to convert to PDF.</p>
                    </>
                ) : (
                    <>
                        <label className="text-sm font-semibold text-foreground">HTML Content</label>
                        <textarea value={html} onChange={e => setHtml(e.target.value)} placeholder="<html><body><h1>Hello</h1></body></html>" rows={8}
                            className="w-full rounded-lg border border-border bg-secondary/20 px-3 py-2.5 text-sm text-foreground font-mono outline-none focus:border-accent/50 resize-y" />
                        <p className="text-xs text-muted-foreground">Paste raw HTML code to convert to PDF.</p>
                    </>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            <Button onClick={process} disabled={state === "processing" || !canProcess} className="glow-primary">
                {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Converting…</> : "Convert to PDF"}
            </Button>
        </div>
    );
}
