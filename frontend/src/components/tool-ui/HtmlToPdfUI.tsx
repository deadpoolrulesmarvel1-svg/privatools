/**
 * HtmlToPdfUI — convert a web address or pasted HTML to a PDF, on the shared
 * kit: its own fields in the intake's card (StudioSource, which says what is
 * sent), the run button in the action bar, and the kit's result. One request
 * makes one PDF, which downloads by itself once.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Code2, Download, Globe } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, postFormData } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult, StudioSource } from "@/skins/experience/ToolStudio";
import { downloadAgainLabel, downloadStarted, runFailure, runFailureDetail, type RunFailure } from "@/skins/experience/studio-outcome";
import { focusIfIdle } from "@/skins/experience/focus-result";

type Mode = "url" | "html";

const HTML_TO_PDF_DEFAULTS: { mode: Mode } = {
    mode: "url",
};

export function HtmlToPdfUI() {
    const [config, , { setField }] = useToolDefaults("html-to-pdf", HTML_TO_PDF_DEFAULTS);
    const { mode } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof HTML_TO_PDF_DEFAULTS["mode"]>) => setField("mode", v), [setField]);

    const [url, setUrl] = useState("");
    const [html, setHtml] = useState("");
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [failure, setFailure] = useState<RunFailure | null>(null);
    // Back from a result: focus the address or the HTML again.
    const [returning, setReturning] = useState(false);
    const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

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
        setPhase("processing"); setFailure(null);
        try {
            const res = await postFormData("/html-to-pdf", () => {
                const fd = new FormData();
                if (mode === "url") fd.append("url", url.trim());
                else fd.append("html_content", html);
                return fd;
            });
            const blob = await res.blob();
            setResultBlob(blob);
            setPhase("done");
            // The download policy: the result downloads by itself, once per run.
            downloadBlob(blob, getOutputName());
            emitToolRun({ outcome: "success" });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Conversion failed";
            setResultBlob(null);
            setFailure(runFailure(e, friendlyError(msg, "Couldn't render that HTML to PDF.")));
            setPhase("done");
            emitToolRun({ outcome: "error" }, e);
        }
    }, [canProcess, mode, url, html, getOutputName]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess && phase !== "processing") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, phase, process]);

    useEffect(() => { if (returning && phase === "idle") focusIfIdle(field.current); }, [returning, phase]);

    // "Convert another" and "Change the address" keep what was entered, to change it.
    const back = () => { setResultBlob(null); setFailure(null); setReturning(true); setPhase("idle"); };

    const htmlSize = mode === "html" && html ? formatFileSize(new Blob([html]).size) : null;

    if (phase === "done" && failure) {
        return <StudioResult tone="failure" title={mode === "url" ? "This page couldn’t be converted." : "This HTML couldn’t be converted."} detail={runFailureDetail(failure)}>
            <StudioFile name={mode === "url" ? url.trim() : `Your HTML · ${formatFileSize(new Blob([html]).size)}`} status="error" detail={failure.message} />
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void process()}
                back={{ label: mode === "url" ? "Change the address" : "Edit the HTML", onBack: back }} />
        </StudioResult>;
    }

    if (phase === "done" && resultBlob) {
        return <StudioResult title="Your PDF is ready." detail={`${mode === "url" ? `From ${url.trim()}.` : "From your HTML."} ${downloadStarted(1)}`}>
            <StudioFile name={getOutputName()} status="done" detail={formatFileSize(resultBlob.size)} />
            <StudioActions tone="success"
                primary={<button type="button" className="ts-primary-button" onClick={() => downloadBlob(resultBlob, getOutputName())}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(1)}</button>}
                more={<button type="button" className="ts-text-button" onClick={back}>Convert another</button>} />
        </StudioResult>;
    }

    const busy = phase === "processing";
    return <StudioLayout action={<StudioActionBar ready={canProcess}>
        <button type="button" className="ts-primary-button" onClick={process} disabled={busy || !canProcess}><Download size={16} aria-hidden="true" /> Convert to PDF</button>
    </StudioActionBar>}>
        <StudioSource>
            <div className="ts-mode-switch" role="group" aria-label="Convert from">
                {([
                    { v: "url" as Mode, label: "From URL", Icon: Globe },
                    { v: "html" as Mode, label: "From HTML", Icon: Code2 },
                ]).map(m => <button type="button" key={m.v} aria-pressed={mode === m.v} disabled={busy} onClick={() => setMode(m.v)}>
                    <m.Icon size={14} aria-hidden="true" /> {m.label}
                </button>)}
            </div>
            {mode === "url" ? <>
                <h2><label htmlFor="html-to-pdf-url">Web page URL</label></h2>
                <input id="html-to-pdf-url" ref={field} type="url" value={url} onChange={e => setUrl(e.target.value)} disabled={busy}
                    placeholder="https://example.com" spellCheck={false} />
                {url.trim() && <p className="ts-caption">Output: {getOutputName()}</p>}
            </> : <>
                <div className="ts-source-head">
                    <h2><label htmlFor="html-to-pdf-html">HTML content</label></h2>
                    {htmlSize && <span className="ts-caption">{htmlSize}</span>}
                </div>
                <textarea id="html-to-pdf-html" ref={field} value={html} onChange={e => setHtml(e.target.value)} rows={10} disabled={busy}
                    placeholder={"<html>\n  <body>\n    <h1>Hello</h1>\n  </body>\n</html>"} spellCheck={false} wrap="off" />
            </>}
        </StudioSource>
        {busy && <StudioProgress label="Converting to PDF" />}
    </StudioLayout>;
}
