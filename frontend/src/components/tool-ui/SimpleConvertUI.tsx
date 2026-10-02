import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Download } from "lucide-react";
import { zipSync } from "fflate";
import { friendlyError } from "@/lib/utils";
import {
    buildOutputFilename,
    chooseDownloadFilename,
    downloadBlob,
    formatFileSize,
    isAbortError,
    MAX_FILE_SIZE,
    MAX_FILE_SIZE_LABEL,
    uploadFileWithProgress,
} from "@/lib/api";
import { getFilenameFromContentDisposition, getToolEndpoint } from "@/lib/tool-endpoints";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { takeAccepted } from "@/lib/report-rejected-files";
import { emitToolRun, isTransientFailure, runOutcome, toolErrorKind, type ToolErrorKind } from "@/lib/toolRun";
import { ConversionPath, FileIntake, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { fileCount } from "@/skins/experience/file-format-label";
import { failureDetail, retryKinds, studioOutcome } from "@/skins/experience/studio-outcome";
import { fileFormatLabel } from "../../skins/experience/file-format-label";

/* Shared "upload → convert" UI for simpler conversion tools. Accepts a
 * queue of files and converts them sequentially; a single file keeps the
 * classic auto-download flow. */
interface SimpleConvertUIProps {
    slug: string;
    label: string;
    outputExt: string;
    outputFilename: string;
    acceptFileTypes: string;
    description: string;
}

const MAX_QUEUE = 25;

type ItemStatus = "queued" | "processing" | "done" | "error";
interface QueueItem {
    id: string;
    file: File;
    status: ItemStatus;
    blob?: Blob | null;
    outName?: string;
    errMsg?: string;
    /** The failure could pass on another attempt (connection, time limit, rate limit, server fault). */
    retryable?: boolean;
    /** Why it failed, so the result can name the cause of a failure worth retrying. */
    errorKind?: ToolErrorKind;
}

export function SimpleConvertUI({ slug, label, outputExt, outputFilename, acceptFileTypes, description }: SimpleConvertUIProps) {
    const [items, setItems] = useState<QueueItem[]>([]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<number | undefined>(undefined);
    const [progressLabel, setProgressLabel] = useState("Processing…");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const stopRef = useRef(false);

    const canProcess = items.some(i => i.status === "queued" || i.status === "error") && status !== "processing";

    const plannedName = useCallback((inputName: string) => {
        // Derive a filename that keeps the user's original stem so they
        // can identify the result. `outputFilename` is a per-tool template
        // like "compressed.pdf" — we treat its stem as the action suffix
        // unless it's a generic placeholder ("converted", "document", …).
        const GENERIC = new Set(["converted", "document", "output", "result", "file", "archive", "book", "clean"]);
        const labelStem = outputFilename.replace(/\.[^.]+$/, "");
        const suffix = labelStem && !GENERIC.has(labelStem.toLowerCase()) ? labelStem : null;
        return buildOutputFilename(inputName, suffix, outputExt);
    }, [outputFilename, outputExt]);

    const addFiles = useCallback((incoming: File[]) => {
        setError(null);
        setItems(prev => {
            const next = [...prev];
            const omissions: string[] = [];
            let overflow = 0;
            for (const f of incoming) {
                if (next.length >= MAX_QUEUE) { overflow++; continue; }
                if (f.size > MAX_FILE_SIZE) { omissions.push(`"${f.name}" was not added: ${formatFileSize(f.size)} exceeds the ${MAX_FILE_SIZE_LABEL} maximum.`); continue; }
                // A matching filename/size can still contain different bytes.
                next.push({ id: Math.random().toString(36).slice(2), file: f, status: "queued" });
            }
            if (overflow) omissions.push(`${overflow} file${overflow === 1 ? " was" : "s were"} not added because the queue holds ${MAX_QUEUE} files. Process or remove files, then add the remaining selection.`);
            if (omissions.length) setError(omissions.join(" "));
            return next;
        });
        setStatus("idle");
        setProgress(undefined);
    }, []);

    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            void consumeFileHandoffs(slug).then(files => {
                const taken = cancelled ? [] : takeAccepted(files, acceptFileTypes);
                if (taken.length) addFiles(taken);
            });
        });
        return () => { cancelled = true; };
    }, [slug, addFiles, acceptFileTypes]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const setItem = (id: string, patch: Partial<QueueItem>) =>
        setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));

    // `onlyRetryable`: "Try again" after a run, for failures another attempt could fix.
    const process = useCallback(async (onlyRetryable = false) => {
        const run = items.filter(i => i.status === "queued" || (i.status === "error" && (!onlyRetryable || i.retryable)));
        if (!run.length) return;
        const single = items.length === 1;
        stopRef.current = false;
        setStatus("processing"); setError(null); setProgress(undefined);
        const endpoint = getToolEndpoint(slug);
        let firstFailure: unknown = null;
        let done = 0, failed = 0;
        for (let n = 0; n < run.length; n++) {
            if (stopRef.current) break;
            const item = run[n];
            const controller = new AbortController();
            abortRef.current = controller;
            setItem(item.id, { status: "processing", errMsg: undefined });
            const prefix = run.length > 1 ? `File ${n + 1} of ${run.length} — ` : "";
            setProgress(undefined);
            try {
                const res = await uploadFileWithProgress(endpoint, item.file, undefined, (phase, pct) => {
                    if (phase === "upload") { setProgressLabel(`${prefix}${pct < 100 ? "Uploading…" : "Processing your file…"}`); setProgress(pct < 100 ? pct : undefined); }
                    else { setProgressLabel(`${prefix}Downloading…`); setProgress(pct); }
                }, controller.signal);
                const blob = await res.blob();
                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const outName = chooseDownloadFilename(
                    plannedName(item.file.name),
                    getFilenameFromContentDisposition(res.headers.get("Content-Disposition")),
                );
                setItem(item.id, { status: "done", blob, outName });
                done++;
                if (single) downloadBlob(blob, outName);
            } catch (e: unknown) {
                if (isAbortError(e)) { setItem(item.id, { status: "queued" }); stopRef.current = true; break; }
                const msg = e instanceof Error ? e.message : "Failed";
                const kind = toolErrorKind(e);
                setItem(item.id, { status: "error", errMsg: friendlyError(msg, "Couldn't convert that file."), retryable: isTransientFailure(e), errorKind: kind === "cancelled" ? undefined : kind });
                failed++;
                if (!firstFailure) firstFailure = e;
            } finally {
                if (abortRef.current === controller) abortRef.current = null;
            }
        }
        setProgress(undefined);
        const outcome = runOutcome(done, failed);
        if (outcome) emitToolRun({ mode: "single", outcome, files: done + failed }, firstFailure);
        if (stopRef.current) { setStatus("idle"); return; }
        // A failure, even of the only file, ends on the result with its reason.
        setStatus("done");
    }, [items, slug, plannedName]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    const doneItems = items.filter(i => i.status === "done" && i.blob);
    const failCount = items.filter(i => i.status === "error").length;
    const single = items.length === 1;

    const downloadOne = (item: QueueItem) => { if (item.blob) downloadBlob(item.blob, item.outName || plannedName(item.file.name)); };
    const downloadAllZip = useCallback(async () => {
        const entries: Record<string, Uint8Array> = {};
        const used = new Set<string>();
        for (const item of doneItems) {
            let name = item.outName || plannedName(item.file.name);
            if (used.has(name)) {
                const dot = name.lastIndexOf(".");
                const stem = dot > 0 ? name.slice(0, dot) : name;
                const ext = dot > 0 ? name.slice(dot) : "";
                let n = 2;
                while (used.has(`${stem} (${n})${ext}`)) n++;
                name = `${stem} (${n})${ext}`;
            }
            used.add(name);
            entries[name] = new Uint8Array(await item.blob!.arrayBuffer());
        }
        const zipped = zipSync(entries, { level: 0 });
        downloadBlob(new Blob([zipped.slice().buffer], { type: "application/zip" }), `${slug}-results.zip`);
    }, [doneItems, plannedName, slug]);

    const reset = () => { setItems([]); setStatus("idle"); setError(null); setProgress(undefined); };
    const retryCount = items.filter(i => i.status === "error" && i.retryable).length;

    if (status === "done") {
        const tone = studioOutcome(doneItems.length, failCount);
        const startOver = (incoming?: File[]) => { reset(); if (incoming) addFiles(incoming); setReturning(true); };
        return <StudioResult tone={tone}
            // This UI also runs tools that do not convert (Flatten, Repair, Reverse…), so failures say "processed".
            title={tone === "failure" ? single ? "This file couldn’t be processed." : "None of these files could be processed."
                : tone === "partial" ? `${doneItems.length} of ${items.length} files ready.` : single ? "Your conversion is ready." : `${doneItems.length} files, freshly converted.`}
            detail={tone === "failure" ? failureDetail(failCount, retryKinds(items))
                : tone === "partial" ? `${failCount === 1 ? "One file" : `${failCount} files`} couldn’t be processed; the reason is below. The completed results are ready.`
                : single ? "The download has started. A copy is ready here whenever you need it." : "Save them separately, or download one ZIP."}>
            {items.map(item => <StudioFile key={item.id} name={item.outName || item.file.name} detail={item.errMsg || (item.blob ? formatFileSize(item.blob.size) : formatFileSize(item.file.size))}
                status={item.status} onDownload={item.status === "done" ? () => downloadOne(item) : undefined} />)}
            <StudioActions tone={tone} retryCount={retryCount} onRetry={() => void process(true)}
                choose={{ accepts: acceptFileTypes, multiple: true, label: single ? "Choose a different file" : "Choose different files", onFiles: startOver }}
                primary={doneItems.length > 1 ? <button className="ts-primary-button" onClick={downloadAllZip}><Archive size={16} /> Download all ({doneItems.length}) as .zip</button>
                    : doneItems[0] && <button className="ts-primary-button" onClick={() => downloadOne(doneItems[0])}><Download size={16} /> {single ? "Download again" : "Download"}</button>}
                more={tone !== "failure" && <button className="ts-text-button" onClick={() => startOver()}>Convert another</button>} />
        </StudioResult>;
    }
    return <StudioLayout options={<>
        <ConversionPath accepts={acceptFileTypes} output={outputExt} />
        <div><p className="ts-eyebrow">A useful new format</p><h2>Ready for {outputExt.toUpperCase()}</h2><p>{description}</p></div>
        <div><dl><div><dt>Bring</dt><dd>{acceptFileTypes.replace(/,/g, " · ")}</dd></div><div><dt>Take away</dt><dd>{outputExt.toUpperCase()} {items.length > 1 ? "files" : "file"}</dd></div></dl></div>
    </>} action={<StudioActionBar ready={items.length > 0} count={items.length ? fileCount(items.length) : undefined}>
        <button className="ts-primary-button" onClick={() => void process()} disabled={!canProcess}>{label}{items.filter(i => i.status === "queued" || i.status === "error").length > 1 ? ` — ${items.filter(i => i.status === "queued" || i.status === "error").length} files` : ""}</button>
    </StudioActionBar>}>
        <FileIntake accepts={acceptFileTypes} multiple onFiles={addFiles} label={items.length ? "Add more files" : "Drop files here"} title={fileFormatLabel(acceptFileTypes) === "FILE" ? "Your files" : `Your ${fileFormatLabel(acceptFileTypes)} files`}
            detail={`${description} · up to ${MAX_QUEUE} files`} compact={items.length > 0} disabled={status === "processing"} autoFocus={returning} />
        {items.length > 0 && <section aria-label="Selected files">{items.map(item => <StudioFile key={item.id} name={item.file.name}
            detail={item.errMsg || formatFileSize(item.file.size)} status={item.status} onDownload={item.status === "done" ? () => downloadOne(item) : undefined}
            onRemove={status !== "processing" ? () => setItems(prev => prev.filter(i => i.id !== item.id)) : undefined} />)}</section>}
        {items.length > 0 && status !== "processing" && <button className="ts-text-button" onClick={reset}>Clear</button>}
        {status === "processing" && <StudioProgress label={progressLabel} progress={progress} onCancel={() => { stopRef.current = true; abortRef.current?.abort(); }} />}
        {error && <div className="ts-error" role="alert">{error}</div>}
    </StudioLayout>;
}

// Pre-built components for each conversion tool
export function PdfToMarkdownUI2() { return <SimpleConvertUI slug="pdf-to-markdown" label="Convert to Markdown" outputExt="md" outputFilename="document.md" acceptFileTypes=".pdf" description="Extract content as clean Markdown format" />; }
export function ExtractImagesUI() { return <SimpleConvertUI slug="extract-images" label="Extract Images" outputExt="zip" outputFilename="images.zip" acceptFileTypes=".pdf" description="Download all embedded images as a ZIP archive" />; }
export function ExtractTablesUI() { return <SimpleConvertUI slug="extract-tables" label="Extract Tables" outputExt="csv" outputFilename="tables.csv" acceptFileTypes=".pdf" description="Detect and extract tables into CSV format" />; }
export function PdfToPdfaUI() { return <SimpleConvertUI slug="pdf-to-pdfa" label="Convert to PDF/A" outputExt="pdf" outputFilename="archive.pdf" acceptFileTypes=".pdf" description="Convert to ISO-standard PDF/A for long-term archiving" />; }
export function WordToPdfUI() { return <SimpleConvertUI slug="word-to-pdf" label="Convert to PDF" outputExt="pdf" outputFilename="converted.pdf" acceptFileTypes=".docx" description="Convert Word documents to PDF format" />; }
export function ExcelToPdfUI() { return <SimpleConvertUI slug="excel-to-pdf" label="Convert to PDF" outputExt="pdf" outputFilename="converted.pdf" acceptFileTypes=".xlsx" description="Convert Excel spreadsheets to PDF with formatting" />; }
export function PptxToPdfUI() { return <SimpleConvertUI slug="pptx-to-pdf-convert" label="Convert to PDF" outputExt="pdf" outputFilename="converted.pdf" acceptFileTypes=".pptx" description="Convert PowerPoint presentations to PDF" />; }
export function TxtToPdfUI() { return <SimpleConvertUI slug="txt-to-pdf" label="Convert to PDF" outputExt="pdf" outputFilename="converted.pdf" acceptFileTypes=".txt" description="Convert plain text files to formatted PDF" />; }
export function JsonToPdfUI() { return <SimpleConvertUI slug="json-to-pdf" label="Convert to PDF" outputExt="pdf" outputFilename="document.pdf" acceptFileTypes=".json" description="Render JSON with syntax highlighting as PDF" />; }
export function XmlToPdfUI() { return <SimpleConvertUI slug="xml-to-pdf" label="Convert to PDF" outputExt="pdf" outputFilename="document.pdf" acceptFileTypes=".xml" description="Render XML with tag coloring as PDF" />; }
export function EpubToPdfUI() { return <SimpleConvertUI slug="epub-to-pdf" label="Convert to PDF" outputExt="pdf" outputFilename="book.pdf" acceptFileTypes=".epub" description="Convert EPUB e-books to paginated PDF" />; }
export function RtfToPdfUI() { return <SimpleConvertUI slug="rtf-to-pdf" label="Convert to PDF" outputExt="pdf" outputFilename="document.pdf" acceptFileTypes=".rtf" description="Convert Rich Text Format files to PDF" />; }

// Simple PDF tools that just need better UI than GenericUI
export function FlattenUI() { return <SimpleConvertUI slug="flatten-pdf" label="Flatten PDF" outputExt="pdf" outputFilename="flattened.pdf" acceptFileTypes=".pdf" description="Merge all annotations and form fields into page content" />; }
export function DeskewUI() { return <SimpleConvertUI slug="deskew-pdf" label="Deskew PDF" outputExt="pdf" outputFilename="deskewed.pdf" acceptFileTypes=".pdf" description="Straighten scanned pages that are slightly tilted" />; }
export function RepairUI() { return <SimpleConvertUI slug="repair-pdf" label="Repair PDF" outputExt="pdf" outputFilename="repaired.pdf" acceptFileTypes=".pdf" description="Attempt to fix corrupted or damaged PDF files" />; }
export function GrayscaleUI() { return <SimpleConvertUI slug="grayscale-pdf" label="Convert to Grayscale" outputExt="pdf" outputFilename="grayscale.pdf" acceptFileTypes=".pdf" description="Convert all color content to black and white" />; }
export function DeleteAnnotationsUI() { return <SimpleConvertUI slug="delete-annotations" label="Delete Annotations" outputExt="pdf" outputFilename="clean.pdf" acceptFileTypes=".pdf" description="Remove all comments, highlights, and annotations" />; }
export function OfficeToPdfUI() { return <SimpleConvertUI slug="office-to-pdf" label="Convert to PDF" outputExt="pdf" outputFilename="document.pdf" acceptFileTypes=".doc,.docx,.xls,.xlsx,.ppt,.pptx" description="Convert any Microsoft Office document to PDF" />; }
export function ReversePdfUI() { return <SimpleConvertUI slug="reverse-pdf" label="Reverse Pages" outputExt="pdf" outputFilename="reversed.pdf" acceptFileTypes=".pdf" description="Reverse the page order of your PDF document" />; }
export function BookletUI() { return <SimpleConvertUI slug="booklet-pdf" label="Make Booklet" outputExt="pdf" outputFilename="booklet.pdf" acceptFileTypes=".pdf" description="Rearrange pages for booklet/saddle-stitch printing" />; }
