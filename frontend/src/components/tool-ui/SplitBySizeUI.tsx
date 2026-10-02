/**
 * SplitBySizeUI — chunk a PDF into ZIP parts each capped at a target MB.
 * Workshop: file upload + numeric input with quick presets + Cmd+Enter.
 * Multi-file via useMultiFileProcessor — the same cap is applied to every PDF;
 * each PDF's parts arrive as its own ZIP, and a multi-run wraps those ZIPs in one archive.
 */
import { useCallback, useEffect, useState } from "react";
import { Maximize2 } from "lucide-react";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { fileCount } from "@/skins/experience/file-format-label";

const PRESETS = [5, 10, 25, 50];

const SPLIT_BY_SIZE_DEFAULTS: { maxSizeMb: number } = {
    maxSizeMb: 10,
};

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function SplitBySizeUI() {
    const [config, , { setField }] = useToolDefaults("split-by-size", SPLIT_BY_SIZE_DEFAULTS);
    const { maxSizeMb } = config;
    const setMaxSizeMb = useCallback((v: React.SetStateAction<typeof SPLIT_BY_SIZE_DEFAULTS["maxSizeMb"]>) => setField("maxSizeMb", v), [setField]);
    const proc = useMultiFileProcessor();

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const canProcess = proc.entries.length > 0 && maxSizeMb > 0 && status !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        if (maxSizeMb <= 0) return;
        setStatus("processing");
        await proc.run({
            endpoint: "/split-by-size",
            outputSuffix: "split",
            outputExt: "zip",
            params: { max_size_mb: maxSizeMb },
        }, retry);
        setStatus("done");
    }, [proc, maxSizeMb]);

    useDownloadOnce(status === "done", proc.doneCount, () => proc.downloadAll("archive_split"));

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
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs split into parts up to ${maxSizeMb} MB.` : `Parts up to ${maxSizeMb} MB.`}
            detail={proc.doneCount > 1 ? "The ZIP download has started: one inner ZIP of parts per PDF." : "The ZIP download has started."}
            onDownload={() => proc.downloadAll("archive_split")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Split another" />;
    }

    const busy = status === "processing";
    return <StudioLayout options={<div>
        <h2>Max part size</h2>
        <div className="ts-setting">
            <label htmlFor="split-max-size">Each part up to (MB)</label>
            <input id="split-max-size" type="number" inputMode="numeric" min={1} max={1024} value={maxSizeMb} disabled={busy}
                onChange={e => {
                    const n = parseInt(e.target.value || "1", 10);
                    setMaxSizeMb(Math.min(1024, Math.max(1, isNaN(n) ? 1 : n)));
                }} />
        </div>
        <div className="ts-choices" role="group" aria-label="Quick sizes">
            {PRESETS.map(p => <button type="button" className="ts-choice" key={p} aria-pressed={maxSizeMb === p} disabled={busy} onClick={() => setMaxSizeMb(p)}><strong>{p} MB</strong></button>)}
        </div>
    </div>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Maximize2 size={16} aria-hidden="true" /> Split by size{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to split by size" detail="Creates ZIP parts capped at your max size · one ZIP per PDF"
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Cutting it into parts" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
