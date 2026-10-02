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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Braces, FileText, RotateCcw, ScanEye, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { buildOutputFilename, downloadBlob, getErrorDetail, getErrorStatus, uploadFileGetJson } from "@/lib/api";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { emitToolRun, isTransientFailure, toolErrorKind, type ToolErrorKind } from "@/lib/toolRun";
import { retryLine } from "@/skins/experience/studio-outcome";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { takeAccepted } from "@/lib/report-rejected-files";
import { StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { fileCount } from "@/skins/experience/file-format-label";
import { FileUploadZone } from "./FileUploadZone";
import { PdfPageStage } from "./pdf/PdfPageStage";
import {
    REASON_LABELS, REASON_ORDER, SHARING_WARNING, nextSteps, pageList, reportToJson, reportToText, verdict,
    type HiddenReason, type HiddenTextReport,
} from "./hidden-text-report";
import "./hidden-text-checker.css";

const SLUG = "hidden-text-checker";

const CHECKS = [
    "White or same-colour text, and text too faint to see",
    "Text set to be invisible, fully transparent, or in a font that draws nothing",
    "Unicode tag characters, which show as nothing",
    "Text too small or too squeezed to read",
    "Text off the page or clipped out of view",
    "Text in layers that are switched off or hidden",
    "Text under a box, image, marker scribble or █ characters: failed redactions",
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
    // Whether another attempt at the same file could work (connection, time limit, rate limit, server fault).
    const [retryable, setRetryable] = useState(false);
    const [failureKind, setFailureKind] = useState<ToolErrorKind | undefined>();
    // After "Choose a different PDF", focus waits on the button that checks it.
    const [returning, setReturning] = useState(false);
    const runButton = useRef<HTMLButtonElement>(null);
    useEffect(() => { if (returning && !error) { setReturning(false); focusIfIdle(runButton.current); } }, [returning, error]);
    const [report, setReport] = useState<HiddenTextReport | null>(null);
    const [checkedAt, setCheckedAt] = useState<Date>(() => new Date());
    const busy = status === "uploading" || status === "checking";

    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            // A handed-over file that isn't a PDF is named, not checked.
            void consumeFileHandoffs(SLUG).then(files => { const [pdf] = cancelled ? [] : takeAccepted(files, ".pdf"); if (pdf) setFile(pdf); });
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
            setRetryable(isTransientFailure(e));
            const kind = toolErrorKind(e);
            setFailureKind(kind === "cancelled" ? undefined : kind);
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

    // The shared failure grammar: the reason, a different PDF first, and
    // "Try again" only when another attempt could work.
    if (error && file && status === "idle") {
        return <StudioResult tone="failure" title="This PDF couldn’t be checked."
            detail={retryable ? `The check didn’t finish. ${retryLine([failureKind])}` : "The check didn’t finish. The reason is below."}>
            <StudioFile name={file.name} status="error" detail={error} />
            <StudioActions tone="failure" retryCount={retryable ? 1 : 0} onRetry={() => void run()}
                choose={{ accepts: ".pdf", label: "Choose a different PDF", onFiles: files => { setFile(files[0]); setError(null); setReturning(true); } }} />
        </StudioResult>;
    }

    return <StudioLayout options={<div className="htc-options">
        <p className="ts-eyebrow">What it looks for</p>
        <h2>Text a reader can't see</h2>
        <ul className="htc-checks">{CHECKS.map(check => <li key={check}>{check}</li>)}</ul>
        <p className="htc-where">Your PDF is uploaded over HTTPS to the PrivaTools server, checked in temporary storage and deleted when the check ends. Nothing in it is changed. The page preview is drawn on your device.</p>
        <p className="htc-where">A check reads up to 500 pages and stops after 20 seconds plus 12 for each MB of the file, 90 at most. Split a larger PDF with Split PDF first.</p>
    </div>} action={<StudioActionBar ready={!!file} count={file ? fileCount(1, "PDF") : undefined}>
        <button ref={runButton} type="button" className="ts-primary-button" onClick={() => void run()} disabled={!file || busy}>
            <ScanEye size={16} aria-hidden="true" /> Check for hidden text
        </button>
    </StudioActionBar>}>
        <FileUploadZone
            file={file}
            onFileSelect={next => { setFile(next); setError(null); }}
            onClear={() => { setFile(null); setError(null); }}
            accept=".pdf"
            label="Drop a PDF to check for hidden text"
            hint="Up to 500 pages · checked on our server in 90 seconds at most · your file is not changed"
        />
        {busy && <StudioProgress
            label={status === "uploading" ? "Uploading your PDF" : "Looking for hidden text"}
            progress={status === "uploading" ? progress : undefined}
            detail={status === "uploading" ? "Sending it to the server for the check." : "Reading every page's text, colours and layers."}
        />}
    </StudioLayout>;
}

/** A finding's number beside its first mark on the page, as in the list. */
function MarkNumber({ n, box, width, height, onClick }: {
    n: number; box: [number, number, number, number]; width: number; height: number; onClick: () => void;
}) {
    const label = String(n);
    const ref = useRef<SVGGElement>(null);
    // Page units per screen pixel: the preview scales the page to fit, and the
    // number keeps the same size on a phone as on a desktop.
    const [unit, setUnit] = useState(1);
    useLayoutEffect(() => {
        const measure = () => {
            const ctm = ref.current?.ownerSVGElement?.getScreenCTM?.();
            if (ctm && ctm.a > 0) setUnit(1 / ctm.a);
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [width, height]);
    const h = 16 * unit;
    const w = h * (0.6 + 0.45 * label.length);
    // Above the mark's left end, or below it when the mark touches the top.
    const x = Math.min(Math.max(box[0] * width - 2, 0), width - w);
    const top = box[1] * height - 2 - h - 1;
    const y = top >= 0 ? top : box[3] * height + 3;
    return <g ref={ref} className="htc-mark-number" onClick={onClick} aria-hidden="true">
        <rect x={x} y={y} width={w} height={h} rx={h / 2} />
        <text x={x + w / 2} y={y + h / 2} fontSize={h * 0.68} dominantBaseline="central" textAnchor="middle">{label}</text>
    </g>;
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
    useEffect(() => { focusIfIdle(heading.current); }, []);
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
        new Blob([reportToJson(report, file.name, checkedAt, SLUG)], { type: "application/json" }),
        buildOutputFilename(file.name, "hidden-text-report", "json"),
    );

    const ocrBoxes = report.ocr.filter(layer => layer.page === page).flatMap(layer => layer.boxes);
    const showPreview = report.findings.length > 0 || report.ocr.length > 0;
    const Icon = { found: ShieldAlert, clean: ShieldCheck, incomplete: ShieldQuestion }[result.state];
    return <section className="htc-report" aria-labelledby="htc-verdict">
        <header className="htc-verdict" data-state={result.state}>
            <span className="htc-verdict-icon" aria-hidden="true"><Icon size={26} /></span>
            <div>
                <p className="ts-eyebrow">Hidden text report · {file.name}</p>
                {/* The detail is read out with the title when focus lands on it. */}
                <h2 id="htc-verdict" ref={heading} tabIndex={-1} aria-describedby="htc-verdict-detail">{result.title}</h2>
                <p id="htc-verdict-detail">{result.detail}</p>
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
                    {/* Where an OCR layer lies, outlined apart: not hidden text, but invisible all the same. */}
                    {ocrBoxes.map((box, part) => <rect key={`ocr-${part}`} className="htc-ocr-mark"
                        x={box[0] * width} y={box[1] * height} width={(box[2] - box[0]) * width} height={(box[3] - box[1]) * height}>
                        <title>OCR text layer: invisible text that makes a scan searchable</title>
                    </rect>)}
                    {marks.map(({ finding, index }) => <g key={index} className="htc-mark-group" data-selected={index === selected}>
                        {finding.boxes.map((box, part) => {
                            // A little room around the words, so small text shows a mark.
                            const x = box[0] * width - 2, y = box[1] * height - 2;
                            return <rect key={part} className="htc-mark" data-selected={index === selected}
                                x={x} y={y} width={Math.max((box[2] - box[0]) * width + 4, 5)} height={Math.max((box[3] - box[1]) * height + 4, 5)}
                                rx={1.5} onClick={() => select(index)}>
                                <title>{`${index + 1}. ${REASON_LABELS[finding.reason]}: ${finding.text.slice(0, 90)}`}</title>
                            </rect>;
                        })}
                        {finding.boxes[0] && <MarkNumber n={index + 1} box={finding.boxes[0]} width={width} height={height} onClick={() => select(index)} />}
                    </g>)}
                </g>} />
                <p className="pdf-preview-context-note">Numbered marks show where hidden text sits, matching the list. The words themselves don't show on the page, so the list quotes them.{ocrBoxes.length > 0 ? " A grey dashed outline shows an OCR text layer." : ""}</p>
            </div>
            <div className="pdf-coordinate-controls htc-findings">
                {shown.length === 0 && <p className="htc-empty">No hidden text was found{result.state === "incomplete" ? " where the checks ran" : ""}. {report.ocr.length > 0 ? "The OCR text layer is listed below." : ""}</p>}
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
            <button type="button" className="ts-primary-button" onClick={downloadText} aria-describedby="htc-sharing"><FileText size={16} aria-hidden="true" /> Download report</button>
            <button type="button" className="ts-secondary-button" onClick={downloadJson} aria-describedby="htc-sharing"><Braces size={16} aria-hidden="true" /> Download JSON</button>
            <button type="button" className="ts-text-button" onClick={onReset}><RotateCcw size={14} aria-hidden="true" /> Check another PDF</button>
        </div>
        {report.findings.length > 0 && <p className="htc-sharing" id="htc-sharing">{SHARING_WARNING}</p>}

        <p className="htc-caveat">A clean result means none of these checks matched, not that the file is safe in every way. Not checked: attachments, scripts and metadata (<Link to="/tool/sanitize-pdf">Sanitize Document</Link> removes them); letters drawn with a font that shows them as other letters; text hidden by a soft mask whose shape is never painted; text under a shape that only partly covers each letter; pictures of text.</p>
    </section>;
}
