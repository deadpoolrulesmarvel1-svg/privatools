/**
 * PdfToPptxUI — convert each PDF page to a PowerPoint slide (one or many PDFs).
 * Multi-file via useMultiFileProcessor.
 */
import { useState, useEffect, useCallback } from "react";
import { Presentation } from "lucide-react";
import { MAX_FILE_SIZE_LABEL, formatFileSize } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { ConversionPath, FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function PdfToPptxUI() {
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/pdf-to-pptx",
            outputSuffix: null,
            outputExt: "pptx",
        }, retry);
        setPhase("done");
    }, [proc]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_pptx"));

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (phase === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setPhase("idle");
        };
        return <ProcessorResult proc={proc} verb="converted" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs converted to slides.` : "Your slides are ready."}
            detail={downloadStarted(proc.doneCount)} fileDetail={entry => `PowerPoint deck · ${formatFileSize(entry.blob?.size ?? 0)}`}
            onDownload={() => proc.downloadAll("archive_pptx")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Convert more" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<>
        <ConversionPath accepts=".pdf" output="pptx" />
        <div><p>Each page becomes one slide.</p></div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Presentation size={16} aria-hidden="true" /> Convert {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "to PowerPoint"}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to convert" detail={`Each page → one slide · multi-file OK · max ${MAX_FILE_SIZE_LABEL} each`}
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Turning pages into slides" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
