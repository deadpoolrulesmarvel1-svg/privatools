/**
 * PdfToTextUI — extract readable text + word/char/page stats.
 *
 * Multi-file via useMultiFileProcessor. The endpoint answers JSON, so the
 * queue's blobs are parsed client-side: one file shows the text on the page
 * to read and copy, with a download on request; several files become a ZIP
 * with one .txt per PDF, which downloads by itself once.
 */
import { useState, useEffect, useCallback } from "react";
import { Check, Copy, Download, ScanText } from "lucide-react";
import { downloadBlob, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

interface ExtractedResult { text: string; pages?: number | { page: number; text: string }[]; }

interface ParsedResult {
    id: string;
    name: string;
    text: string;
    pages?: number;
}

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");
const words = (text: string) => text ? text.split(/\s+/).filter(Boolean).length : 0;

export function PdfToTextUI() {
    const proc = useMultiFileProcessor();
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [results, setResults] = useState<ParsedResult[] | null>(null);
    const [copied, setCopied] = useState(false);
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const canProcess = proc.entries.length > 0 && state !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
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
                    return { id: e.id, name: e.name, text: data.text ?? "", pages: Array.isArray(data.pages) ? data.pages.length : data.pages };
                } catch {
                    return { id: e.id, name: e.name, text: "" };
                }
            }));
            if (!cancelled) setResults(parsed);
        })();
        return () => { cancelled = true; };
    }, [state, results, proc.entries]);

    // Multi-file runs download a ZIP with one .txt per PDF. A single file keeps
    // its text on the page and downloads only on request.
    const downloadZip = useCallback(() => {
        if (!results || results.length === 0) return;
        const enc = new TextEncoder();
        const items = results.map(r => ({
            name: buildOutputFilename(r.name, null, "txt"),
            data: enc.encode(r.text),
        }));
        downloadBlob(buildZip(items), "archive_text.zip");
    }, [results]);

    useDownloadOnce(state === "done" && proc.entries.length > 1 && results !== null, results?.length ?? 0, downloadZip);

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

    const startOver = (files?: File[]) => {
        proc.reset(); setResults(null);
        if (files) proc.addFiles(files, isPdfOnly);
        setReturning(true); setState("idle");
    };
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

    // One file: the text to read and copy, and its stats.
    if (state === "done" && single) {
        const wordCount = words(single.text);
        const charCount = single.text ? single.text.length : 0;
        const lineCount = single.text ? single.text.split(/\r?\n/).filter(l => l.trim().length > 0).length : 0;
        // Heuristic: empty/whitespace-only extraction → almost certainly an image-only PDF.
        const isLikelyImageOnly = wordCount < 5 && (single.pages ?? 0) > 0;
        const stats = [
            { label: "Words", value: wordCount },
            { label: "Chars", value: charCount },
            { label: "Lines", value: lineCount },
            ...(single.pages ? [{ label: "Pages", value: single.pages }] : []),
        ];
        return <StudioResult title={`${wordCount.toLocaleString()} words extracted.`} detail={single.name}>
            <dl className="ts-stats">{stats.map(s => <div key={s.label}><dt>{s.label}</dt><dd>{s.value.toLocaleString()}</dd></div>)}</dl>
            {isLikelyImageOnly && <p className="ts-note"><strong>Looks like an image-only PDF.</strong> Try the <a href="/tool/ocr-pdf">OCR PDF</a> tool to extract text from scanned pages.</p>}
            <div className="ts-text-output">
                <div className="ts-text-output-bar"><label htmlFor="extracted-text">Extracted text</label>
                    <button type="button" className="ts-text-button" onClick={handleCopy}>{copied ? <><Check size={14} aria-hidden="true" /> Copied</> : <><Copy size={14} aria-hidden="true" /> Copy</>}</button></div>
                <textarea id="extracted-text" readOnly value={single.text} />
            </div>
            <div className="ts-actions">
                <button type="button" className="ts-primary-button" onClick={handleDownload}><Download size={16} aria-hidden="true" /> Download .txt</button>
                <button type="button" className="ts-text-button" onClick={() => startOver()}>Extract another</button>
            </div>
        </StudioResult>;
    }

    // Several files, or nothing that worked.
    if (state === "done" && results && !single) {
        const totalWords = results.reduce((sum, r) => sum + words(r.text), 0);
        return <ProcessorResult proc={proc} verb="extracted" accepts=".pdf"
            title={`${proc.doneCount} PDFs extracted.`}
            detail={`${totalWords.toLocaleString()} words. ${downloadStarted(proc.doneCount)} One .txt per PDF.`}
            fileDetail={entry => `${words(results.find(r => r.id === entry.id)?.text ?? "").toLocaleString()} words`}
            onDownload={downloadZip} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Extract another" />;
    }

    const busy = state === "processing" || (state === "done" && results === null);
    return <StudioLayout action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><ScanText size={16} aria-hidden="true" /> Extract text{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to extract text" detail="All readable text · word & character stats · several files become a ZIP of .txt"
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Reading the text" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
