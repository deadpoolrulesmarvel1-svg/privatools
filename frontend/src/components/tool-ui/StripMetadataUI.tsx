/**
 * StripMetadataUI — strip ALL hidden metadata from one or more PDFs.
 * Multi-file via useMultiFileProcessor — same scrub applied to every file,
 * with a receipt of what was removed.
 */
import { useState, useEffect, useCallback } from "react";
import { Check, DatabaseZap } from "lucide-react";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const STRIPPED = [
    "Author / Creator",
    "Created / Modified dates",
    "GPS coordinates",
    "Software fingerprint",
    "XMP metadata",
];

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

function Stripped() {
    return <ul className="ts-checklist">{STRIPPED.map(item => <li key={item}><Check size={14} aria-hidden="true" />{item}</li>)}</ul>;
}

export function StripMetadataUI() {
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/strip-metadata",
            outputSuffix: "stripped",
            outputExt: "pdf",
        }, retry);
        setPhase("done");
    }, [proc]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_stripped"));

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); void process(false); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (phase === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setPhase("idle");
        };
        return <ProcessorResult proc={proc} verb="stripped" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs stripped.` : "Metadata stripped."}
            detail={downloadStarted(proc.doneCount)}
            receipt={<section className="ts-receipt"><h3>Privacy receipt</h3><Stripped /></section>}
            onDownload={() => proc.downloadAll("archive_stripped")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Strip more" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<div><h2>Will be removed</h2><Stripped /></div>}
        action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
            <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><DatabaseZap size={16} aria-hidden="true" /> Strip {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</button>
        </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Select PDFs to scrub" detail={`Author · timestamps · GPS · software · XMP · max ${MAX_FILE_SIZE_LABEL}`}
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Stripping the metadata" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
