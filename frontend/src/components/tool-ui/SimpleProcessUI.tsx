/**
 * SimpleProcessUI — shared workshop UI for any tool that:
 *  - Takes one or many input files (same settings applied to each)
 *  - POSTs each to a single endpoint
 *  - Downloads the result (single file direct, several as a ZIP)
 *
 * Eliminates ~20 boilerplate components. Workshop aesthetic with
 * dropzone, queue rows, success state animations, and error handling.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { Download, type LucideIcon } from "lucide-react";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { FileIntake, StudioActionBar, StudioActions, StudioLayout, StudioFile, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { fileCount, fileNoun } from "@/skins/experience/file-format-label";
import { downloadAgainLabel, failureDetail, retryKinds, studioOutcome } from "@/skins/experience/studio-outcome";
import { downloadBlob, formatFileSize } from "@/lib/api";
import { matchesAccept } from "@/lib/file-acceptance";

interface SimpleProcessUIProps {
    handoffSlug?: string;
    /** API endpoint path (without /api prefix) */
    endpoint: string;
    /** Accept attribute for file input */
    accepts: string;
    /** Suffix for output filename, e.g. "linked" → "input_linked.pdf" */
    outputSuffix: string;
    /** Output extension, e.g. "pdf" */
    outputExt: string;
    /** Headline text in dropzone, e.g. "Add hyperlinks to a PDF" */
    dropTitle: string;
    /** Subline under headline */
    dropSubtitle: string;
    /** Optional icon for dropzone (defaults to Upload) */
    dropIcon?: LucideIcon;
    /** Button label, e.g. "Add hyperlinks" */
    actionLabel: string;
    /** Verb form for processing state, e.g. "Adding hyperlinks…" */
    processingLabel: string;
    /** Done message, e.g. "Hyperlinks added" */
    doneTitle: string;
    /** Optional params sent to endpoint */
    params?: Record<string, string | number | boolean>;
}

export function SimpleProcessUI({
    endpoint, accepts, outputSuffix, outputExt,
    dropTitle, dropSubtitle,
    actionLabel, processingLabel, doneTitle, params, handoffSlug,
}: SimpleProcessUIProps) {
    const proc = useMultiFileProcessor();
    const { addFiles } = proc;
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [returning, setReturning] = useState(false);

    useEffect(() => {
        let cancelled = false;
        if (!handoffSlug) return;
        queueMicrotask(() => {
            if (cancelled) return;
            void consumeFileHandoffs(handoffSlug).then(files => {
                // A handed-over file this tool can't take is named, not sent.
                if (!cancelled && files.length) addFiles(files, file => matchesAccept(file, accepts));
            });
        });
        return () => { cancelled = true; };
    }, [handoffSlug, addFiles, accepts]);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({ endpoint, params, outputExt, outputSuffix }, retry);
        setPhase("done");
    }, [proc, endpoint, params, outputExt, outputSuffix]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll(`archive_${outputSuffix}`);
        }
    }, [phase, proc, outputSuffix]);

    // Cmd+Enter to submit (works for any SimpleProcessUI-backed tool).
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess && phase === "idle") {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, phase, process]);

    const restart = (files?: File[]) => {
        proc.reset(); downloadedRef.current = false;
        if (files) proc.addFiles(files);
        setReturning(true); setPhase("idle");
    };

    if (phase === "done") {
        const tone = studioOutcome(proc.doneCount, proc.failedCount);
        const several = proc.entries.length > 1;
        return <StudioResult tone={tone}
            title={tone === "failure" ? several ? "None of these files could be processed." : "This file couldn’t be processed."
                : tone === "partial" ? `${doneTitle} for ${proc.doneCount} of ${proc.entries.length} files.` : doneTitle}
            detail={tone === "failure" ? failureDetail(proc.failedCount, retryKinds(proc.entries))
                : tone === "partial" ? `${proc.failedCount === 1 ? "One file" : `${proc.failedCount} files`} couldn’t be processed; the reason is below. The rest are ready.` : `${proc.doneCount} completed`}>
            {proc.entries.map(entry => <StudioFile key={entry.id} name={entry.outName || entry.name} detail={entry.error || (entry.blob ? formatFileSize(entry.blob.size) : formatFileSize(entry.size))} status={entry.status === "failed" ? "error" : entry.status} onDownload={entry.blob ? () => entry.blob && downloadBlob(entry.blob, entry.outName || entry.name) : undefined} />)}
            <StudioActions tone={tone} retryCount={proc.retryableCount} onRetry={() => { downloadedRef.current = false; void process("transient"); }}
                choose={{ accepts, multiple: true, label: several ? "Choose different files" : "Choose a different file", onFiles: restart }}
                primary={<button className="ts-primary-button" onClick={() => proc.downloadAll(`archive_${outputSuffix}`)}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(proc.doneCount)}</button>}
                more={tone !== "failure" && <button className="ts-text-button" onClick={() => restart()}>Process another</button>} />
        </StudioResult>;
    }
    return <StudioLayout options={<><div><p className="ts-eyebrow">Your next step</p><h2>{actionLabel}</h2><p>{dropSubtitle}</p></div><div><dl><div><dt>Result</dt><dd>{outputExt.toUpperCase()}</dd></div><div><dt>Selected files</dt><dd>{proc.entries.length}</dd></div></dl></div></>}
        action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, fileNoun(accepts)) : undefined}><button className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}>{actionLabel}</button></StudioActionBar>}>
        <FileIntake accepts={accepts} multiple label="Upload files" title={dropTitle} detail={dropSubtitle} compact={proc.entries.length > 0} disabled={phase === "processing"} autoFocus={returning} onFiles={files => proc.addFiles(files)} />
        {proc.entries.map(entry => <StudioFile key={entry.id} name={entry.name} detail={entry.error || formatFileSize(entry.size)} status={entry.status === "failed" ? "error" : entry.status} onRemove={phase === "processing" ? undefined : () => proc.removeFile(entry.id)} />)}
        {phase === "processing" && <StudioProgress label={processingLabel} detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
