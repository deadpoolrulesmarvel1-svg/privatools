/**
 * SplitByBookmarksUI — split PDFs along their top-level bookmarks.
 * Workshop: zero-config tool, just upload + go.
 * Multi-file via useMultiFileProcessor — each PDF's chapters arrive as its own
 * ZIP, and a multi-run wraps those ZIPs in one archive.
 */
import { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { fileCount } from "@/skins/experience/file-format-label";

/** Upgrade the raw "no bookmarks" backend detail to the friendlier phrasing. */
function bookmarksError(error: string | undefined): string {
    if (!error) return "Couldn't split by bookmarks.";
    return /no bookmark/i.test(error) ? "This PDF doesn't have any bookmarks to split on." : error;
}

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function SplitByBookmarksUI() {
    const proc = useMultiFileProcessor();
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const canProcess = proc.entries.length > 0 && status !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setStatus("processing");
        await proc.run({
            endpoint: "/split-by-bookmarks",
            outputSuffix: "split_bookmarks",
            outputExt: "zip",
        }, retry);
        setStatus("done");
    }, [proc]);

    useDownloadOnce(status === "done", proc.doneCount, () => proc.downloadAll("archive_split_bookmarks"));

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (status === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setStatus("idle");
        };
        return <ProcessorResult proc={proc} verb="split" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs split by bookmark.` : "Bookmarked chapters extracted."}
            detail={proc.doneCount > 1 ? "The ZIP download has started: one inner ZIP of chapters per PDF." : "The ZIP download has started."}
            fileError={entry => bookmarksError(entry.error)}
            onDownload={() => proc.downloadAll("archive_split_bookmarks")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Split another" />;
    }

    const busy = status === "processing";
    // Nothing to set: the bookmarks decide the parts.
    return <StudioLayout
        action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
            <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><BookOpen size={16} aria-hidden="true" /> Split by bookmarks{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</button>
        </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs with bookmarks" detail="Top-level chapters/sections become separate PDFs · one ZIP per PDF"
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Splitting along the bookmarks" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
