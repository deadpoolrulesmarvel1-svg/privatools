import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Archive, CheckCircle2, Download, FileText, Loader2, X } from "lucide-react";
import { zipSync } from "fflate";
import { Button } from "@/components/ui/button";
import { cn, friendlyError } from "@/lib/utils";
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
import { FileUploadZone, ProcessingBar } from "./FileUploadZone";
import { consumeFileHandoff } from "@/lib/file-handoff";

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
}

export function SimpleConvertUI({ slug, label, outputExt, outputFilename, acceptFileTypes, description }: SimpleConvertUIProps) {
    const [items, setItems] = useState<QueueItem[]>([]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<number | undefined>(undefined);
    const [progressLabel, setProgressLabel] = useState("Processing…");
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
            const existing = new Set(prev.map(i => `${i.file.name}:${i.file.size}`));
            const next = [...prev];
            for (const f of incoming) {
                if (next.length >= MAX_QUEUE) { setError(`Queue is limited to ${MAX_QUEUE} files at a time.`); break; }
                if (f.size > MAX_FILE_SIZE) { setError(`"${f.name}" is ${formatFileSize(f.size)}. The maximum is ${MAX_FILE_SIZE_LABEL}.`); continue; }
                if (existing.has(`${f.name}:${f.size}`)) continue;
                existing.add(`${f.name}:${f.size}`);
                next.push({ id: Math.random().toString(36).slice(2), file: f, status: "queued" });
            }
            return next;
        });
        setStatus("idle");
        setProgress(undefined);
    }, []);

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff(slug).then(handoffFile => {
            if (cancelled || !handoffFile) return;
            addFiles([handoffFile]);
        });
        return () => { cancelled = true; };
    }, [slug, addFiles]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const setItem = (id: string, patch: Partial<QueueItem>) =>
        setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));

    const process = useCallback(async () => {
        const run = items.filter(i => i.status === "queued" || i.status === "error");
        if (!run.length) return;
        const single = items.length === 1;
        stopRef.current = false;
        setStatus("processing"); setError(null); setProgress(undefined);
        const endpoint = getToolEndpoint(slug);
        let firstFailure: unknown = null;
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
                    if (phase === "upload") { setProgressLabel(`${prefix}Uploading…`); setProgress(pct); }
                    else { setProgressLabel(`${prefix}Downloading…`); setProgress(pct); }
                }, controller.signal);
                const blob = await res.blob();
                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const outName = chooseDownloadFilename(
                    plannedName(item.file.name),
                    getFilenameFromContentDisposition(res.headers.get("Content-Disposition")),
                );
                setItem(item.id, { status: "done", blob, outName });
                if (single) downloadBlob(blob, outName);
            } catch (e: unknown) {
                if (isAbortError(e)) { setItem(item.id, { status: "queued" }); stopRef.current = true; break; }
                const msg = e instanceof Error ? e.message : "Failed";
                setItem(item.id, { status: "error", errMsg: friendlyError(msg, "Couldn't convert that file.") });
                if (!firstFailure) firstFailure = e;
            } finally {
                if (abortRef.current === controller) abortRef.current = null;
            }
        }
        setProgress(undefined);
        if (stopRef.current) { setStatus("idle"); return; }
        if (firstFailure && single) {
            const msg = firstFailure instanceof Error ? firstFailure.message : "Failed";
            setError(friendlyError(msg, "Couldn't convert that file."));
            setStatus("idle");
            return;
        }
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

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/20 bg-accent/5 p-8 text-center">
            <h2 className="text-lg font-bold text-foreground mb-1">
                {single ? "Converted!" : `${doneItems.length} of ${items.length} converted`}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
                {single ? "Your file has been downloaded" : failCount ? "Some files failed — you can retry them below" : "Grab them one by one or all at once"}
            </p>
            {!single && (
                <div className="mb-5 space-y-2 text-left max-w-md mx-auto">
                    {items.map(item => (
                        <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                            {item.status === "done"
                                ? <CheckCircle2 size={14} className="text-accent shrink-0" />
                                : <AlertCircle size={14} className="text-destructive shrink-0" />}
                            <div className="flex-1 min-w-0">
                                <p className="text-[12.5px] font-medium text-foreground truncate">{item.status === "done" ? item.outName : item.file.name}</p>
                                {item.status === "error" && <p className="text-[11px] text-destructive truncate">{item.errMsg}</p>}
                            </div>
                            {item.status === "done" && (
                                <button onClick={() => downloadOne(item)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-foreground hover:text-accent transition-colors shrink-0">
                                    <Download size={11} /> Download
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
            <div className="flex items-center justify-center gap-2 flex-wrap">
                {!single && doneItems.length > 1 && (
                    <Button onClick={downloadAllZip}><Archive size={13} /> Download all ({doneItems.length}) as .zip</Button>
                )}
                {failCount > 0 && !single && (
                    <Button variant="outline" onClick={process}>Retry {failCount} failed</Button>
                )}
                <Button variant="outline" onClick={reset}>Convert another</Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={null}
                multiple
                onFilesSelect={addFiles}
                onFileSelect={(f) => addFiles([f])}
                onClear={reset}
                accept={acceptFileTypes}
                label={items.length ? "Add more files" : "Drop files here"}
                hint={`${description} · up to ${MAX_QUEUE} files`}
            />
            {items.length > 0 && (
                <div className="space-y-2">
                    {items.map(item => (
                        <div
                            key={item.id}
                            className={cn(
                                "flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors",
                                item.status === "processing" ? "border-accent/40 bg-accent/[0.04]"
                                    : item.status === "error" ? "border-destructive/40 bg-destructive/[0.04]"
                                        : "border-border bg-card"
                            )}
                        >
                            {item.status === "processing"
                                ? <Loader2 size={15} className="text-accent animate-spin shrink-0" />
                                : item.status === "done"
                                    ? <CheckCircle2 size={15} className="text-accent shrink-0" />
                                    : <FileText size={15} className="text-muted-foreground shrink-0" />}
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-medium text-foreground truncate">{item.file.name}</p>
                                <p className="text-[11px] text-muted-foreground">
                                    {item.status === "error" ? <span className="text-destructive">{item.errMsg}</span> : formatFileSize(item.file.size)}
                                </p>
                            </div>
                            {item.status === "done" && (
                                <button onClick={() => downloadOne(item)} aria-label={`Download ${item.file.name}`} className="text-muted-foreground hover:text-accent transition-colors shrink-0"><Download size={13} /></button>
                            )}
                            {status !== "processing" && (
                                <button
                                    onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}
                                    aria-label={`Remove ${item.file.name}`}
                                    className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
                                ><X size={12} /></button>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {status === "processing" && <ProcessingBar label={progressLabel} progress={progress} />}
            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
            {items.length > 0 && status !== "processing" && (
                <div className="flex items-center gap-3 flex-wrap">
                    <Button onClick={process} disabled={!canProcess}>
                        {label}{items.filter(i => i.status === "queued" || i.status === "error").length > 1 ? ` — ${items.filter(i => i.status === "queued" || i.status === "error").length} files` : ""}
                    </Button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>Clear</Button>
                </div>
            )}
            {status === "processing" && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { stopRef.current = true; abortRef.current?.abort(); }}>Cancel</Button>
            )}
        </div>
    );
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
