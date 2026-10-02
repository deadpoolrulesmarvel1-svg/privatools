/**
 * RemoveBlankPagesUI — auto-detect and drop blank pages.
 * Workshop: file upload + sensitivity slider with live label.
 * Multi-file via useMultiFileProcessor — the same sensitivity is applied to every PDF.
 */
import { useCallback, useEffect, useState } from "react";
import { FileX2 } from "lucide-react";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const REMOVE_BLANK_PAGES_DEFAULTS: { sensitivity: number } = {
    sensitivity: 85,
};

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function RemoveBlankPagesUI() {
    const [config, , { setField }] = useToolDefaults("remove-blank-pages", REMOVE_BLANK_PAGES_DEFAULTS);
    const { sensitivity } = config;
    const setSensitivity = useCallback((v: React.SetStateAction<typeof REMOVE_BLANK_PAGES_DEFAULTS["sensitivity"]>) => setField("sensitivity", v), [setField]);
    const proc = useMultiFileProcessor();

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const canProcess = proc.entries.length > 0 && status !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setStatus("processing");
        await proc.run({
            endpoint: "/remove-blank-pages",
            outputSuffix: "cleaned",
            outputExt: "pdf",
            params: { sensitivity },
        }, retry);
        setStatus("done");
    }, [proc, sensitivity]);

    useDownloadOnce(status === "done", proc.doneCount, () => proc.downloadAll("archive_cleaned"));

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
        return <ProcessorResult proc={proc} verb="cleaned" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs cleaned.` : "Blank pages removed."}
            detail={downloadStarted(proc.doneCount)}
            onDownload={() => proc.downloadAll("archive_cleaned")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Clean another" />;
    }

    const busy = status === "processing";
    return <StudioLayout options={<div>
        <h2>Detection sensitivity</h2>
        <div className="ts-setting">
            <label htmlFor="blank-sensitivity">Sensitivity · {sensitivity}%</label>
            <input id="blank-sensitivity" type="range" min={50} max={100} step={5} value={sensitivity} disabled={busy}
                onChange={e => setSensitivity(parseInt(e.target.value, 10))} />
        </div>
        <p className="ts-caption">50 — strict (only truly blank) · 100 — loose (drops faint scans)</p>
    </div>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><FileX2 size={16} aria-hidden="true" /> Remove blank pages{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to clean" detail="Auto-detects and removes empty pages · several files become a ZIP"
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Scanning for blank pages" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
