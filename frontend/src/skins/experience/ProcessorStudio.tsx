import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { formatFileSize } from "@/lib/api";
import type { FileEntry, UseMultiFileProcessorResult } from "@/hooks/useMultiFileProcessor";
import { StudioActions, StudioFile, StudioResult } from "./ToolStudio";
import { downloadAgainLabel, failureDetail, partialLine, retryKinds, studioOutcome } from "./studio-outcome";

/**
 * The shared kit, bound to a useMultiFileProcessor queue: the chosen files'
 * rows and the end of a run. Every tool screen built on that hook uses these,
 * so its results read like every other tool's (DESIGN.md, "Every tool
 * screen"): the same success, partial and failure grammar, the reason for a
 * failed file on its row, a retry only for what another attempt could fix,
 * and the download policy's "Download again".
 */

/** A run's files and counts: a useMultiFileProcessor result, or a tool's own queue of the same shape. */
export type RunQueue = Pick<UseMultiFileProcessorResult, "entries" | "doneCount" | "failedCount" | "retryableCount">;

/** The chosen files, each removable until the run starts. */
export function ProcessorFiles({ proc, busy = false, label = "Selected files" }: { proc: Pick<UseMultiFileProcessorResult, "entries" | "removeFile" | "clearAll">; busy?: boolean; label?: string }) {
    if (!proc.entries.length) return null;
    return <section aria-label={label}>
        {proc.entries.map(entry => <StudioFile key={entry.id} name={entry.name} detail={entry.error || formatFileSize(entry.size)}
            status={entry.status === "failed" ? "error" : entry.status} onRemove={busy ? undefined : () => proc.removeFile(entry.id)} />)}
        {proc.entries.length > 1 && !busy && <button type="button" className="ts-text-button" onClick={proc.clearAll}>Clear selection</button>}
    </section>;
}

/**
 * The end of a run. Success says what was made; a partial run says both
 * parts; a failure shows no receipt, leads with a different file and offers
 * "Try again" only for files another attempt could fix (the caller re-runs
 * with `run(opts, "transient")`). Focus moves to the heading (StudioResult).
 */
export function ProcessorResult({ proc, noun = "PDF", verb, accepts, title, detail, attention = false, receipt, fileDetail, fileError, onDownload, onRetry, onStartOver, more, children }: {
    proc: RunQueue;
    /** What one input is called in the headings: "PDF", "file", "image". */
    noun?: string;
    /** What the tool does to a file, as a past participle: "cropped", "converted". */
    verb: string;
    /** What the tool takes, for "Choose a different file". */
    accepts: string;
    /** The heading when every file worked. */
    title: string;
    /** What was made, under a success heading and before the failed files' line of a partial run. */
    detail?: string;
    /** Every file was made, but the visitor should read the result before using it (stamps left in
     *  place): shown with the partial result's warning badge rather than as plain success. */
    attention?: boolean;
    /** Shown above the files whenever something was made: a receipt, a log, a prompt to save a password. */
    receipt?: ReactNode;
    /** A finished file's row. Default: the result's size. */
    fileDetail?: (entry: FileEntry) => string;
    /** A failed file's row. Default: the reason the run recorded. */
    fileError?: (entry: FileEntry) => string;
    /** Download the results again: the file, or the ZIP of several. */
    onDownload?: () => void;
    /** Run again only the files that failed for a reason another attempt could fix. */
    onRetry: () => void;
    /** Back to the intake, with the files from "Choose a different file" or with none. */
    onStartOver: (files?: File[]) => void;
    /** The text button that starts again with nothing chosen: "Crop more". */
    more: string;
    /** Below the actions: a handoff to another tool, a preview. */
    children?: ReactNode;
}) {
    const outcome = studioOutcome(proc.doneCount, proc.failedCount);
    const tone = outcome === "success" && attention ? "partial" : outcome;
    const total = proc.entries.length;
    const several = total > 1;
    const heading = outcome === "failure" ? several ? `None of these ${noun}s could be ${verb}.` : `This ${noun} couldn’t be ${verb}.`
        : outcome === "partial" ? `${proc.doneCount} of ${total} ${noun}s ${verb}.` : title;
    const line = outcome === "failure" ? failureDetail(proc.failedCount, retryKinds(proc.entries))
        : outcome === "partial" ? [detail, partialLine(proc.failedCount, verb)].filter(Boolean).join(" ") : detail;
    return <StudioResult tone={tone} title={heading} detail={line}>
        {tone !== "failure" && receipt}
        {proc.entries.map(entry => {
            const failed = entry.status === "failed";
            return <StudioFile key={entry.id} name={failed ? entry.name : entry.outName || entry.name} status={failed ? "error" : entry.status}
                detail={failed ? fileError?.(entry) ?? entry.error ?? `Couldn’t be ${verb}` : fileDetail?.(entry) ?? formatFileSize(entry.blob?.size ?? entry.size)} />;
        })}
        <StudioActions tone={tone} retryCount={proc.retryableCount} onRetry={onRetry}
            choose={{ accepts, multiple: true, label: several ? "Choose different files" : "Choose a different file", onFiles: files => onStartOver(files) }}
            primary={onDownload && proc.doneCount > 0 && <button type="button" className="ts-primary-button" onClick={onDownload}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(proc.doneCount)}</button>}
            more={tone !== "failure" && <button type="button" className="ts-text-button" onClick={() => onStartOver()}>{more}</button>} />
        {children}
    </StudioResult>;
}
