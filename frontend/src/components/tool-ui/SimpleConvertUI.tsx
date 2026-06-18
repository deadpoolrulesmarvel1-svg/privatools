import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { getToolEndpoint } from "@/lib/tool-endpoints";
import { FileUploadZone, ProcessingBar } from "./FileUploadZone";
import { consumeFileHandoff } from "@/lib/file-handoff";

/* Shared "upload PDF → convert" UI for simpler conversion tools. */
interface SimpleConvertUIProps {
    slug: string;
    label: string;
    outputExt: string;
    outputFilename: string;
    acceptFileTypes: string;
    description: string;
}

export function SimpleConvertUI({ slug, label, outputExt, outputFilename, acceptFileTypes, description }: SimpleConvertUIProps) {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<number | undefined>(undefined);
    const [progressLabel, setProgressLabel] = useState("Processing…");

    const canProcess = !!file && status !== "processing";

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff(slug).then(handoffFile => {
            if (cancelled || !handoffFile) return;
            setFile(handoffFile);
            setStatus("idle");
            setError(null);
            setProgress(undefined);
        });
        return () => { cancelled = true; };
    }, [slug]);

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null); setProgress(undefined);
        try {
            // Derive a filename that keeps the user's original stem so they
            // can identify the result. `outputFilename` is a per-tool template
            // like "compressed.pdf" — we treat its stem as the action suffix
            // unless it's a generic placeholder ("converted", "document", …).
            const GENERIC = new Set(["converted", "document", "output", "result", "file", "archive"]);
            const labelStem = outputFilename.replace(/\.[^.]+$/, "");
            const suffix = labelStem && !GENERIC.has(labelStem.toLowerCase()) ? labelStem : null;
            const outName = buildOutputFilename(file.name, suffix, outputExt);
            await processAndDownload(getToolEndpoint(slug), file, outName, undefined, (phase, pct) => {
                if (phase === "upload") {
                    setProgressLabel("Uploading…");
                    setProgress(pct);
                } else {
                    setProgressLabel("Downloading…");
                    setProgress(pct);
                }
            });
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't convert that file."));
            setStatus("idle");
        }
    }, [file, slug, outputExt, outputFilename]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/20 bg-accent/5 p-8 text-center">
            <h2 className="text-lg font-bold text-foreground mb-1">Converted!</h2>
            <p className="text-sm text-muted-foreground mb-4">Your file has been downloaded</p>
            <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Convert another</Button>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept={acceptFileTypes}
                label="Drop file here"
                hint={description}
            />
            {status === "processing" && <ProcessingBar label={progressLabel} progress={progress} />}
            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
            {file && status !== "processing" && (
                <div className="flex items-center gap-3 flex-wrap">
                    <Button onClick={process} className="">{label}</Button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFile(null)}>Clear</Button>
                </div>
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
