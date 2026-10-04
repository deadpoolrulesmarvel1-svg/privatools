import { normalizeWebpageUrl } from "./webpage-url";
/**
 * UrlToPdfUI — fetch a URL & render it to PDF via WeasyPrint, on the shared
 * kit: the address in the intake's card (StudioSource, which says that only
 * the address is sent), the run button in the action bar, and the kit's
 * result. One request makes one PDF, which downloads by itself once.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Download, Globe } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, postFormData } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult, StudioSource } from "@/skins/experience/ToolStudio";
import { downloadAgainLabel, downloadStarted, runFailure, runFailureDetail, type RunFailure } from "@/skins/experience/studio-outcome";
import { focusIfIdle } from "@/skins/experience/focus-result";

/** The download's name: the page's host, as "example_com.pdf". */
function pdfNameFor(url: string): string {
    try {
        const domain = new URL(normalizeWebpageUrl(url) || "").hostname;
        return `${domain.replace(/\./g, "_")}.pdf`;
    } catch { return "webpage.pdf"; }
}

export function UrlToPdfUI() {
    const [url, setUrl] = useState("");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    // An address the page cannot send: said beside the field, before any request.
    const [error, setError] = useState<string | null>(null);
    const [failure, setFailure] = useState<RunFailure | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    // Back from a result: focus the address again.
    const [returning, setReturning] = useState(false);
    const field = useRef<HTMLInputElement>(null);

    const convert = useCallback(async () => {
        if (status === "processing") return;
        const trimmed = url.trim();
        if (!trimmed) { setError("Please enter a URL"); return; }
        const finalUrl = normalizeWebpageUrl(trimmed);
        if (!finalUrl) { setError("Please enter a valid URL (e.g. https://example.com)"); return; }

        setStatus("processing"); setError(null); setFailure(null);
        try {
            const res = await postFormData("/url-to-pdf", () => {
                const fd = new FormData();
                fd.append("url", finalUrl);
                return fd;
            });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            // The download policy: the finished PDF downloads by itself, once; the result offers it again.
            downloadBlob(blob, pdfNameFor(trimmed));
            emitToolRun({ outcome: "success" });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Conversion failed";
            setResultBlob(null);
            setFailure(runFailure(e, friendlyError(msg, "Couldn't fetch that URL as a PDF.")));
            setStatus("done");
            emitToolRun({ outcome: "error" }, e);
        }
    }, [url, status]);

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

    useEffect(() => { if (returning && status === "idle") focusIfIdle(field.current); }, [returning, status]);

    // Use shared downloadBlob (handles URL revoke + toast) instead of bespoke download function.
    const download = () => {
        if (!resultBlob) return;
        downloadBlob(resultBlob, pdfNameFor(url));
    };

    const reset = () => { setUrl(""); setError(null); setFailure(null); setResultBlob(null); setReturning(true); setStatus("idle"); };
    // After a failure the address stays, to change it.
    const back = () => { setFailure(null); setResultBlob(null); setReturning(true); setStatus("idle"); };

    if (status === "done" && failure) {
        return <StudioResult tone="failure" title="This page couldn’t be converted." detail={runFailureDetail(failure)}>
            <StudioFile name={url.trim()} status="error" detail={failure.message} />
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void convert()}
                back={{ label: "Change the address", onBack: back }} />
        </StudioResult>;
    }

    if (status === "done" && resultBlob) {
        return <StudioResult title="Your PDF is ready." detail={`From ${url.trim()}. ${downloadStarted(1)}`}>
            <StudioFile name={pdfNameFor(url)} status="done" detail={formatFileSize(resultBlob.size)} />
            <StudioActions tone="success"
                primary={<button type="button" className="ts-primary-button" onClick={download}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(1)}</button>}
                more={<button type="button" className="ts-text-button" onClick={reset}>Convert another</button>} />
        </StudioResult>;
    }

    const busy = status === "processing";
    return <StudioLayout action={<StudioActionBar ready={!!url.trim()}>
        <button type="button" className="ts-primary-button" onClick={convert} disabled={!url.trim() || busy}><Globe size={16} aria-hidden="true" /> Convert to PDF</button>
    </StudioActionBar>}>
        <StudioSource>
            <h2><label htmlFor="url-to-pdf-address">Webpage URL</label></h2>
            <input id="url-to-pdf-address" ref={field} disabled={busy} type="text" value={url}
                onChange={e => { setUrl(e.target.value); setError(null); }}
                onKeyDown={e => { if (e.key === "Enter" && url.trim()) convert(); }}
                placeholder="https://example.com" spellCheck={false} autoComplete="url"
                aria-invalid={!!error} aria-describedby={error ? "url-to-pdf-error" : "url-to-pdf-hint"} />
            {error
                ? <p className="ts-error" id="url-to-pdf-error" role="alert">{error}</p>
                : <p className="ts-caption" id="url-to-pdf-hint">Full URL with https:// — page rendered & flattened to PDF</p>}
            <p className="ts-caption">Note — WeasyPrint renders server-side. Best for content-heavy pages; JS-rendered SPAs may not capture fully.</p>
        </StudioSource>
        {busy && <StudioProgress label="Capturing the page" />}
    </StudioLayout>;
}
