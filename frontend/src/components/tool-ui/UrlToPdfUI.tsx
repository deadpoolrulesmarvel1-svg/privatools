import { useState } from "react";
import { Globe, Download, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_BASE = "/api";

export function UrlToPdfUI() {
    const [url, setUrl] = useState("");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);

    const isValidUrl = (s: string) => {
        try { new URL(s); return s.startsWith("http://") || s.startsWith("https://"); }
        catch { return false; }
    };

    const convert = async () => {
        const trimmed = url.trim();
        if (!trimmed) {
            setError("Please enter a URL");
            return;
        }
        // Auto-add https:// if missing
        const finalUrl = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
        if (!isValidUrl(finalUrl)) {
            setError("Please enter a valid URL (e.g. https://example.com)");
            return;
        }

        setStatus("processing");
        setError(null);
        try {
            const fd = new FormData();
            fd.append("url", finalUrl);
            const res = await fetch(`${API_BASE}/url-to-pdf`, { method: "POST", body: fd });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ detail: "Conversion failed" }));
                throw new Error(body.detail || `Request failed (${res.status})`);
            }
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) {
            setError(e.message || "Conversion failed");
            setStatus("idle");
        }
    };

    const download = () => {
        if (!resultBlob) return;
        const blobUrl = URL.createObjectURL(resultBlob);
        const a = document.createElement("a");
        a.href = blobUrl;
        // Create filename from URL domain
        try {
            const domain = new URL(url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`).hostname;
            a.download = `${domain.replace(/\./g, "_")}.pdf`;
        } catch {
            a.download = "webpage.pdf";
        }
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
    };

    const reset = () => {
        setUrl("");
        setStatus("idle");
        setError(null);
        setResultBlob(null);
    };

    if (status === "done") {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
                <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
                    <Globe size={24} className="text-emerald-400" />
                </div>
                <h2 className="text-lg font-bold text-foreground mb-1">PDF Ready!</h2>
                <p className="text-sm text-muted-foreground mb-1">
                    Webpage captured successfully
                </p>
                <p className="text-xs text-muted-foreground/80 mb-6 flex items-center justify-center gap-1">
                    <ExternalLink size={10} /> {url.trim()}
                </p>
                <div className="flex justify-center gap-3 flex-wrap">
                    <Button className="glow-primary" onClick={download}>
                        <Download size={15} /> Download PDF
                    </Button>
                    <Button variant="outline" className="border-border text-muted-foreground" onClick={reset}>
                        Convert another
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* URL Input */}
            <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Webpage URL</label>
                <div className="relative">
                    <Globe size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/80" />
                    <input
                        type="text"
                        value={url}
                        onChange={e => { setUrl(e.target.value); setError(null); }}
                        onKeyDown={e => { if (e.key === "Enter" && url.trim()) convert(); }}
                        placeholder="https://example.com"
                        className="w-full rounded-xl border border-border bg-secondary/30 pl-10 pr-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/80 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                    />
                </div>
                <p className="text-xs text-muted-foreground">
                    Enter a full URL including https://. The page will be rendered and converted to a PDF document.
                </p>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />
                    {error}
                </div>
            )}

            {/* Info box */}
            <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                    💡 <span className="text-foreground font-medium">Tip:</span> This uses WeasyPrint to render the page on your server.
                    Works best with content-heavy pages. JavaScript-rendered single-page apps may not capture fully.
                </p>
            </div>

            {/* Convert button */}
            <Button
                className="w-full glow-primary"
                disabled={!url.trim() || status === "processing"}
                onClick={convert}
            >
                {status === "processing" ? (
                    <><Loader2 size={15} className="animate-spin" /> Converting webpage…</>
                ) : (
                    <>Convert to PDF</>
                )}
            </Button>

            <p className="text-[11px] text-center text-muted-foreground/80">
                Free · No sign-up · Rendered on your self-hosted server
            </p>
        </div>
    );
}
