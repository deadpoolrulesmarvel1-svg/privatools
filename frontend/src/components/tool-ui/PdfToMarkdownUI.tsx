/**
 * PdfToMarkdownUI — PDF to Markdown, for reading and for AI.
 *
 * The server converts each PDF in a bounded worker (backend/app/services/
 * _pdf_markdown_worker.py): headings, paragraphs, lists, ruled tables as
 * GitHub tables, code, links and picture placeholders, in reading order across
 * columns. It answers with the Markdown, or a ZIP of chunks, and an
 * X-Markdown-Report header saying what it found, which this page shows,
 * including any page without a text layer (a scan) that was not converted.
 *
 * A finished run downloads once, as every converter does (DESIGN.md, the
 * download policy); a single Markdown file can also be copied and previewed
 * here. The preview is plain text: the document's Markdown is never rendered
 * as HTML on this page.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, FileCode2, Hash } from "lucide-react";
import { consumeFileHandoffs, storeFileHandoff } from "@/lib/file-handoff";
import { navigateTo } from "@/lib/navigation";
import { useMultiFileProcessor, type FileEntry } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { fileCount } from "@/skins/experience/file-format-label";
import { MAX_PAGES, count, pageList, readReport, reportSummary, type MarkdownReport } from "./pdf-to-markdown-report";
import "./pdf-to-markdown.css";

const SLUG = "pdf-to-markdown";
const CHUNK_SIZES = [2000, 4000, 8000, 16000, 32000];
/** How much of a result the preview shows. */
const PREVIEW_CHARS = 20000;

type Chunking = "none" | "headings" | "size";
type ChunkOutput = "zip" | "single";

const DEFAULTS: { pageMarkers: boolean; removeHeadersFooters: boolean; chunk: Chunking; chunkSize: number; chunkOutput: ChunkOutput } = {
    pageMarkers: true,
    removeHeadersFooters: true,
    chunk: "none",
    chunkSize: 4000,
    chunkOutput: "zip",
};

const CHUNKINGS: { id: Chunking; label: string; desc: string }[] = [
    { id: "none", label: "One file", desc: "The whole document" },
    { id: "headings", label: "By heading", desc: "A part per section" },
    { id: "size", label: "By size", desc: "Parts up to a length" },
];

export function PdfToMarkdownUI() {
    const [config, , { setField }] = useToolDefaults(SLUG, DEFAULTS);
    const { pageMarkers, removeHeadersFooters, chunk, chunkSize, chunkOutput } = config;
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);
    const busy = phase === "processing";
    const canProcess = proc.entries.length > 0 && !busy;
    const zipped = chunk !== "none" && chunkOutput === "zip";

    useEffect(() => {
        let cancelled = false;
        // Defer claiming until the effect survives StrictMode's setup replay.
        queueMicrotask(() => {
            if (cancelled) return;
            void consumeFileHandoffs(SLUG).then(files => {
                // addFiles names any file that isn't a PDF and the tool that takes it.
                if (!cancelled && files.length) proc.addFiles(files, isPdf);
            });
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proc.addFiles]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: `/${SLUG}`,
            outputSuffix: zipped ? "chunks" : null,
            outputExt: zipped ? "zip" : "md",
            params: {
                page_markers: pageMarkers,
                remove_headers_footers: removeHeadersFooters,
                chunk,
                chunk_size: chunkSize,
                chunk_output: chunkOutput,
            },
        }, retry);
        setPhase("done");
    }, [proc, zipped, pageMarkers, removeHeadersFooters, chunk, chunkSize, chunkOutput]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("markdown"));

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [canProcess, process]);

    if (phase === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files, isPdf);
            setReturning(true); setPhase("idle");
        };
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        const reports = done.map(e => ({ entry: e, report: readReport(e) }));
        const single = done.length === 1 ? reports[0] : null;
        const chunks = single?.report?.chunks ?? 1;
        const title = done.length > 1 ? `${done.length} PDFs converted to Markdown.`
            : chunks > 1 ? `Your Markdown, in ${chunks} chunks.` : "Your Markdown is ready.";
        const detail = done.length > 1
            ? `The ZIP download has started: ${zipped ? "a ZIP of chunks" : "one .md file"} per PDF inside.`
            : zipped && chunks > 1 ? "The ZIP download has started: one .md file per chunk." : "The download has started.";
        return <ProcessorResult proc={proc} verb="converted" accepts=".pdf" title={title} detail={detail}
            receipt={<ConversionNotes reports={reports} several={done.length > 1} />}
            fileDetail={entry => reportSummary(readReport(entry), entry.blob?.size ?? entry.size)}
            onDownload={() => proc.downloadAll("markdown")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Convert another PDF">
            {single && single.entry.blob && !single.entry.outName?.toLowerCase().endsWith(".zip") && <>
                <MarkdownPreview blob={single.entry.blob} />
                <CountTokens blob={single.entry.blob} name={single.entry.outName || "document.md"} />
            </>}
        </ProcessorResult>;
    }

    return <StudioLayout options={<>
        <div>
            <h2>For reading and for AI</h2>
            <label className="ts-check"><input type="checkbox" checked={pageMarkers} disabled={busy}
                onChange={e => setField("pageMarkers", e.target.checked)} /> Page markers</label>
            <p className="ts-caption">Puts &lt;!-- page 3 --&gt; before each page: hidden when the Markdown is displayed, there for you or an AI to cite.</p>
            <label className="ts-check"><input type="checkbox" checked={removeHeadersFooters} disabled={busy}
                onChange={e => setField("removeHeadersFooters", e.target.checked)} /> Remove repeated headers and footers</label>
            <p className="ts-caption">Leaves out lines repeated at the top or bottom of most pages, such as running titles and page numbers.</p>
        </div>
        <div>
            <h2>Chunks</h2>
            <div className="ts-choices">{CHUNKINGS.map(c => <button type="button" className="ts-choice" key={c.id} aria-pressed={chunk === c.id}
                disabled={busy} onClick={() => setField("chunk", c.id)}><strong>{c.label}</strong><span>{c.desc}</span></button>)}</div>
            {chunk === "size" && <div className="ts-setting pdf2md-setting">
                <label htmlFor="pdf2md-chunk-size">Chunk size</label>
                <select id="pdf2md-chunk-size" value={chunkSize} disabled={busy} onChange={e => setField("chunkSize", Number(e.target.value))}>
                    {CHUNK_SIZES.map(n => <option key={n} value={n}>Up to about {n.toLocaleString("en")} characters</option>)}
                </select>
            </div>}
            {chunk !== "none" && <div className="ts-choices pdf2md-setting" role="group" aria-label="Chunk files">
                <button type="button" className="ts-choice" aria-pressed={chunkOutput === "zip"} disabled={busy}
                    onClick={() => setField("chunkOutput", "zip")}><strong>ZIP of .md files</strong><span>One file per chunk</span></button>
                <button type="button" className="ts-choice" aria-pressed={chunkOutput === "single"} disabled={busy}
                    onClick={() => setField("chunkOutput", "single")}><strong>One .md file</strong><span>&lt;!-- chunk 2 of 7 --&gt; between parts</span></button>
            </div>}
            <p className="ts-caption">{chunk === "headings" ? "Splits before each heading of the two highest levels in the document."
                : chunk === "size" ? "Splits between paragraphs, list items and table rows, so no chunk ends mid-sentence unless one sentence is longer than a chunk."
                : "Split the Markdown into parts to fit an AI's upload or context limits."}</p>
        </div>
        <div>
            <p className="ts-caption">Up to {MAX_PAGES.toLocaleString("en")} pages per PDF. Pages that are pictures of text (scans) have nothing to convert: run them through <Link to="/tool/ocr-pdf">OCR PDF</Link> first.</p>
        </div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}>
            <FileCode2 size={16} aria-hidden="true" /> Convert {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "to Markdown"}
        </button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to turn into Markdown"
            detail="Headings, lists, tables, code and links come through in reading order, columns included."
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdf)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Converting to Markdown" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}

function isPdf(file: File): boolean {
    return file.name.toLowerCase().endsWith(".pdf");
}

/** What the reports say needs reading: pages left out, and what was removed. */
function ConversionNotes({ reports, several }: { reports: { entry: FileEntry; report: MarkdownReport | null }[]; several: boolean }) {
    const notes: { key: string; text: React.ReactNode }[] = [];
    for (const { entry, report } of reports) {
        if (!report) continue;
        const who = several ? `${entry.name}: ` : "";
        if (report.pagesWithoutTextCount > 0) {
            const one = report.pagesWithoutTextCount === 1;
            notes.push({ key: `${entry.id}-scan`, text: <>{who}{one ? "Page" : "Pages"} {pageList(report.pagesWithoutText, report.pagesWithoutTextCount)} {one ? "has" : "have"} no text layer, as a scan doesn’t, so {one ? "it is" : "they are"} not in the Markdown. Run the PDF through <Link to="/tool/ocr-pdf">OCR PDF</Link>, then convert it again to include {one ? "it" : "them"}.</> });
        }
        if (report.pagesNotReadCount > 0) {
            const one = report.pagesNotReadCount === 1;
            notes.push({ key: `${entry.id}-unread`, text: <>{who}{one ? "Page" : "Pages"} {pageList(report.pagesNotRead, report.pagesNotReadCount)} could not be read, so {one ? "it is" : "they are"} not in the Markdown. <Link to="/tool/repair-pdf">Repair PDF</Link> may fix the file.</> });
        }
        if (report.headersFootersRemoved > 0 && report.removedLines.length > 0) {
            notes.push({ key: `${entry.id}-hf`, text: <>{who}Left out as repeated headers or footers on {count(report.headersFootersRemoved, "page")}: {report.removedLines.map(line => `“${line}”`).join(", ")}{report.removedLines.length >= 3 ? " and others like them" : ""}.</> });
        }
    }
    if (!notes.length) return null;
    return <ul className="pdf2md-notes" aria-label="About this conversion">{notes.map(n => <li key={n.key}>{n.text}</li>)}</ul>;
}

/** Counting tokens is AI Token Counter's job: hand it the Markdown, in this tab. */
function CountTokens({ blob, name }: { blob: Blob; name: string }) {
    const [sending, setSending] = useState(false);
    const send = async () => {
        setSending(true);
        try {
            const file = new File([await blob.arrayBuffer()], name, { type: "text/markdown" });
            await storeFileHandoff(file, "ai-token-counter");
        } catch {
            // The counter still opens; the downloaded file can be chosen there.
        } finally {
            navigateTo("/tools/ai-token-counter");
        }
    };
    return <p className="pdf2md-next">
        <button type="button" className="ts-secondary-button" disabled={sending} onClick={() => void send()}>
            <Hash size={15} aria-hidden="true" /> Count its tokens
        </button>
        <span>AI Token Counter counts it for GPT on this device, and for Claude or Gemini with your own key. The Markdown moves to it in this tab; nothing is uploaded again.</span>
    </p>;
}

/** The Markdown as text, to copy or read before use: never rendered as HTML. */
function MarkdownPreview({ blob }: { blob: Blob }) {
    const [text, setText] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);
    useEffect(() => {
        let live = true;
        void blob.text().then(value => { if (live) setText(value); }).catch(() => { if (live) setText(null); });
        return () => { live = false; };
    }, [blob]);
    if (text === null) return null;
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true); setCopyFailed(false);
            setTimeout(() => setCopied(false), 1800);
        } catch {
            setCopyFailed(true);
        }
    };
    const cut = text.length > PREVIEW_CHARS;
    return <section className="pdf2md-preview" aria-label="Markdown preview">
        <div className="pdf2md-preview-head">
            <h3>Preview</h3>
            <button type="button" className="ts-secondary-button" onClick={() => void copy()}>
                {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? "Copied" : "Copy Markdown"}
            </button>
        </div>
        {copyFailed && <p className="ts-caption" role="alert">This browser didn’t allow copying. Use the downloaded file instead.</p>}
        <pre tabIndex={0} aria-label="The Markdown">{cut ? text.slice(0, PREVIEW_CHARS) : text}</pre>
        {cut && <p className="ts-caption">The preview shows the first {PREVIEW_CHARS.toLocaleString("en")} of {text.length.toLocaleString("en")} characters; Copy Markdown and the download have all of it.</p>}
    </section>;
}
