/**
 * HiddenTextCheckerUI — find text a reader can't see but software still reads.
 *
 * The server checks the PDF in a bounded worker (backend/app/services/
 * _hidden_text_worker.py) and answers with a report. This page lists each
 * finding with its reason and exact words, highlights where it sits on a
 * preview drawn with pdf.js on this device, and saves the report as text or
 * JSON. It never says more than the report does: a clean result means only
 * that none of the checks matched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Braces, FileText, RotateCcw, ScanEye, ShieldAlert, ShieldCheck } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { buildOutputFilename, downloadBlob, getErrorDetail, getErrorStatus, uploadFileGetJson } from "@/lib/api";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { emitToolRun } from "@/lib/toolRun";
import { StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { FileUploadZone } from "./FileUploadZone";
import { PdfPageStage } from "./pdf/PdfPageStage";
import {
    REASON_LABELS, REASON_ORDER, nextSteps, pageList, reportToText, verdict,
    type HiddenReason, type HiddenTextReport,
} from "./hidden-text-report";
import "./hidden-text-checker.css";

const SLUG = "hidden-text-checker";

const CHECKS = [
    "White or same-colour text, and text too faint to see",
    "Text set to be invisible, or fully transparent",
    "Text too small to read",
    "Text off the page or clipped out of view",
    "Text in layers that are switched off",
    "Text under a box, shape or image: failed redactions",
    "Hidden comments and form fields, and redactions never applied",
];

/** How much of a long finding shows before "Show all". */
const EXCERPT = 280;

const plural = (n: number, one: string) => `${n.toLocaleString("en")} ${n === 1 ? one : `${one}s`}`;
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1) + (text.endsWith(".") ? "" : ".");

type Status = "idle" | "uploading" | "checking" | "done";

export function HiddenTextCheckerUI() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<Status>("idle");
    const [progress, setProgress] = useState<number | undefined>();
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<HiddenTextReport | null>(null);
    const [checkedAt, setCheckedAt] = useState<Date>(() => new Date());
    const busy = status === "uploading" || status === "checking";

    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            void consumeFileHandoffs(SLUG).then(files => { if (!cancelled && files[0]) setFile(files[0]); });
        });
        return () => { cancelled = true; };
    }, []);

    const run = useCallback(async () => {
        if (!file || busy) return;
        setStatus("uploading"); setProgress(0); setError(null); setReport(null);
        try {
            const data = await uploadFileGetJson<HiddenTextReport>(`/${SLUG}`, file, undefined, {
                onProgress: (phase, percent) => {
                    if (phase !== "upload") return;
                    setProgress(percent);
                    if (percent >= 100) setStatus("checking");
                },
            });
            setReport(data);
            setCheckedAt(new Date());
            setStatus("done");
            emitToolRun({ outcome: "success", files: 1 });
        } catch (e: unknown) {
            const status = getErrorStatus(e);
            const detail = getErrorDetail(e);
            const message = e instanceof Error ? e.message : "";
            // The route's refusals say what to do (unlock, split, the page
            // count); the server words every 5xx itself, so a timeout gets
            // this page's explanation.
            setError(status === 504
                ? "Checking this PDF took longer than the server allows for one file. Split it into parts with Split PDF and check each part."
                : detail && (status === 400 || status === 413) ? detail : friendlyError(message, "Couldn't check that PDF."));
            setStatus("idle");
            emitToolRun({ outcome: "error", files: 1 }, e);
        }
    }, [file, busy]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && file && status === "idle") {
                event.preventDefault(); void run();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [file, status, run]);

    const reset = () => { setFile(null); setReport(null); setError(null); setStatus("idle"); };

    if (status === "done" && report && file) {
        return <HiddenTextReportView report={report} file={file} checkedAt={checkedAt} onReset={reset} />;
    }

    return <StudioLayout options={<div className="htc-options">
        <p className="ts-eyebrow">What it looks for</p>
        <h3>Text a reader can't see</h3>
        <ul className="htc-checks">{CHECKS.map(check => <li key={check}>{check}</li>)}</ul>
        <p className="htc-where">Your PDF is uploaded over HTTPS to the PrivaTools server, checked in temporary storage and deleted when the check ends. Nothing in it is changed. The page preview is drawn on your device.</p>
        <div className="ts-actions">
            <button type="button" className="ts-primary-button" onClick={() => void run()} disabled={!file || busy}>
                <ScanEye size={16} aria-hidden="true" /> Check for hidden text
            </button>
        </div>
    </div>}>
        <FileUploadZone
            file={file}
            onFileSelect={next => { setFile(next); setError(null); }}
            onClear={() => { setFile(null); setError(null); }}
            accept=".pdf"
            label="Drop a PDF to check for hidden text"
            hint="Up to 500 pages · checked on our server · your file is not changed"
        />
        {busy && <StudioProgress
            label={status === "uploading" ? "Uploading your PDF" : "Looking for hidden text"}
            progress={status === "uploading" ? progress : undefined}
            detail={status === "uploading" ? "Sending it to the server for the check." : "Reading every page's text, colours and layers."}
        />}
        {error && <div className="ts-error" role="alert">{error}</div>}
    </StudioLayout>;
}

function HiddenTextReportView({ report, file, checkedAt, onReset }: {
    report: HiddenTextReport; file: File; checkedAt: Date; onReset: () => void;
}) {
    const [filter, setFilter] = useState<HiddenReason | "all">("all");
    const [selected, setSelected] = useState<number | null>(report.findings.length ? 0 : null);
    const [page, setPage] = useState(report.findings[0]?.page ?? report.ocr[0]?.page ?? 1);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const stage = useRef<HTMLDivElement>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    // The report replaces the form: take focus to its verdict, so it is read out.
    useEffect(() => { heading.current?.focus(); }, []);
    const result = verdict(report);
    const steps = nextSteps(report);
    const reasons = REASON_ORDER.filter(reason => report.summary.byReason[reason] > 0);

    const shown = useMemo(
        () => report.findings.map((finding, index) => ({ finding, index }))
            .filter(({ finding }) => filter === "all" || finding.reason === filter),
        [report, filter],
    );
    // Marks on the page in view, the selected one last so it draws on top.
    const marks = useMemo(
        () => shown.filter(({ finding }) => finding.page === page)
            .sort((a, b) => Number(a.index === selected) - Number(b.index === selected)),
        [shown, page, selected],
    );

    const select = (index: number) => {
        setSelected(index);
        setPage(report.findings[index].page);
        if (window.matchMedia("(max-width: 1000px)").matches) {
            const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            stage.current?.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
        }
    };
    const toggle = (index: number) => setExpanded(current => {
        const next = new Set(current);
        if (next.has(index)) next.delete(index); else next.add(index);
        return next;
    });

    const downloadText = () => downloadBlob(
        new Blob([reportToText(report, file.name, checkedAt)], { type: "text/plain;charset=utf-8" }),
        buildOutputFilename(file.name, "hidden-text-report", "txt"),
    );
    const downloadJson = () => downloadBlob(
        new Blob([JSON.stringify({ tool: SLUG, file: file.name, checkedAt: checkedAt.toISOString(), ...report }, null, 2)], { type: "application/json" }),
        buildOutputFilename(file.name, "hidden-text-report", "json"),
    );

    const showPreview = report.findings.length > 0 || report.ocr.length > 0;
    return <section className="htc-report" aria-labelledby="htc-verdict">
        <header className="htc-verdict" data-found={result.found}>
            <span className="htc-verdict-icon" aria-hidden="true">{result.found ? <ShieldAlert size={26} /> : <ShieldCheck size={26} />}</span>
            <div>
                <p className="ts-eyebrow">Hidden text report · {file.name}</p>
                <h2 id="htc-verdict" ref={heading} tabIndex={-1}>{result.title}</h2>
                <p>{result.detail}</p>
            </div>
        </header>

        {report.notes.length > 0 && <ul className="htc-notes" aria-label="Notes about this check">
            {report.notes.map((note, index) => <li key={index}>{note}</li>)}
        </ul>}

        {reasons.length > 0 && <div className="htc-filters" role="group" aria-label="Show findings by reason">
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                All <span>{report.summary.findings.toLocaleString("en")}</span>
            </button>
            {reasons.map(reason => <button key={reason} type="button" aria-pressed={filter === reason} onClick={() => setFilter(reason)}>
                {REASON_LABELS[reason]} <span>{report.summary.byReason[reason].toLocaleString("en")}</span>
            </button>)}
        </div>}

        {showPreview && <div className="pdf-coordinate-workspace htc-workspace">
            <div className="pdf-stage-context" ref={stage}>
                <PdfPageStage file={file} page={page} onPageChange={setPage} coordinates="shown" overlay={({ width, height }) => <g className="htc-marks">
                    {marks.map(({ finding, index }) => finding.boxes.map((box, part) => {
                        // A little room around the words, so small text shows a mark.
                        const x = box[0] * width - 2, y = box[1] * height - 2;
                        return <rect key={`${index}-${part}`} className="htc-mark" data-selected={index === selected}
                            x={x} y={y} width={Math.max((box[2] - box[0]) * width + 4, 5)} height={Math.max((box[3] - box[1]) * height + 4, 5)}
                            rx={1.5} onClick={() => select(index)}>
                            <title>{`${index + 1}. ${REASON_LABELS[finding.reason]}: ${finding.text.slice(0, 90)}`}</title>
                        </rect>;
                    }))}
                </g>} />
                <p className="pdf-preview-context-note">Marks show where hidden text sits. The words themselves don't show on the page, so the list quotes them.</p>
            </div>
            <div className="pdf-coordinate-controls htc-findings">
                {shown.length === 0 && <p className="htc-empty">No hidden text was found. {report.ocr.length > 0 ? "The OCR text layer is listed below." : ""}</p>}
                {shown.length > 0 && <ol aria-label="Findings">
                    {shown.map(({ finding, index }) => {
                        const long = finding.text.length > EXCERPT;
                        const open = expanded.has(index);
                        return <li key={index} className="htc-finding" data-selected={index === selected}>
                            <button type="button" className="htc-finding-head" aria-pressed={index === selected} onClick={() => select(index)}>
                                <span className="htc-finding-number" aria-hidden="true">{index + 1}</span>
                                <span className="htc-finding-title">
                                    <strong>{REASON_LABELS[finding.reason]}</strong>{" "}
                                    <small>Page {finding.page} · {plural(finding.words, "word")}</small>
                                </span>
                            </button>
                            <p className="htc-finding-detail">{sentence(finding.detail)}</p>
                            <blockquote className="htc-finding-text">{long && !open ? `${finding.text.slice(0, EXCERPT)}…` : finding.text}</blockquote>
                            {long && <button type="button" className="ts-text-button" aria-expanded={open} onClick={() => toggle(index)}>
                                {open ? "Show less" : `Show all ${plural(finding.words, "word")}`}
                            </button>}
                            {open && finding.truncated && <p className="htc-finding-detail">The report quotes the first 2,000 characters.</p>}
                        </li>;
                    })}
                </ol>}
                {report.findingsTruncated && <p className="htc-empty">Only the first {report.findings.length.toLocaleString("en")} findings are listed; the counts include them all.</p>}
            </div>
        </div>}

        {report.ocr.length > 0 && <details className="htc-ocr">
            <summary>OCR text layer on {report.ocr.length === 1 ? "page" : "pages"} {pageList(report.ocr.map(layer => layer.page))}: not counted as hidden text</summary>
            <p>Scanned pages carry invisible text over the page image so they can be searched and copied. That is normal. Check that it says what the page shows.</p>
            <ul>{report.ocr.map(layer => <li key={layer.page}>
                <button type="button" className="ts-text-button" onClick={() => setPage(layer.page)}>Page {layer.page}</button>
                <span>{plural(layer.words, "word")}: “{layer.text.slice(0, 200)}{layer.text.length > 200 || layer.truncated ? "…" : ""}”</span>
            </li>)}</ul>
        </details>}

        {steps.length > 0 && <aside className="htc-next" aria-label="Remove what was found">
            <p className="ts-eyebrow">Remove what was found</p>
            <ul>{steps.map(step => <li key={step.slug}><Link to={`/tool/${step.slug}`}>{step.tool}</Link> {step.why}</li>)}</ul>
        </aside>}

        <div className="ts-actions htc-actions">
            <button type="button" className="ts-primary-button" onClick={downloadText}><FileText size={16} aria-hidden="true" /> Download report</button>
            <button type="button" className="ts-secondary-button" onClick={downloadJson}><Braces size={16} aria-hidden="true" /> Download JSON</button>
            <button type="button" className="ts-text-button" onClick={onReset}><RotateCcw size={14} aria-hidden="true" /> Check another PDF</button>
        </div>

        <p className="htc-caveat">A clean result means none of these checks matched, not that the file is safe in every way. Not checked: attachments, scripts and metadata (<Link to="/tool/sanitize-pdf">Sanitize Document</Link> removes them); letters drawn with a font that shows them as other letters; text hidden by a soft mask or a transparency group's own opacity; pictures of text.</p>
    </section>;
}
