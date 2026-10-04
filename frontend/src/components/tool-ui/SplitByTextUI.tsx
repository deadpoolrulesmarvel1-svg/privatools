/**
 * SplitByTextUI — split a PDF every time a page contains a search string, on
 * the shared kit. The intake refuses a file that isn't a PDF by name, with the
 * tool that can help (FileIntake, through lib/file-acceptance): drag and drop
 * and "All files" in the system dialog pass the picker's filter. One request
 * makes one ZIP, which downloads by itself once.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Scissors } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, IntakeNotice, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { useFileAcceptance } from "@/skins/experience/useFileAcceptance";
import { downloadAgainLabel, downloadStarted, runFailure, runFailureDetail, type RunFailure } from "@/skins/experience/studio-outcome";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { fileCount } from "@/skins/experience/file-format-label";

const SPLIT_BY_TEXT_DEFAULTS: { caseSensitive: boolean } = {
    caseSensitive: false,
};

export function SplitByTextUI() {
    const [config, , { setField }] = useToolDefaults("split-by-text", SPLIT_BY_TEXT_DEFAULTS);
    const { caseSensitive } = config;
    const setCaseSensitive = useCallback((v: React.SetStateAction<typeof SPLIT_BY_TEXT_DEFAULTS["caseSensitive"]>) => setField("caseSensitive", v), [setField]);
    const [file, setFile] = useState<File | null>(null);
    const [search, setSearch] = useState("");

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // What the run downloaded, for "Download again" (the download policy), or why it failed.
    const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
    const [failure, setFailure] = useState<RunFailure | null>(null);
    // Back from a result: to the intake, to the search text, or, with a different file, to the run button.
    const [returning, setReturning] = useState<"intake" | "search" | "run" | null>(null);
    const searchField = useRef<HTMLInputElement>(null);
    const runButton = useRef<HTMLButtonElement>(null);

    const canProcess = !!file && search.trim().length > 0 && phase !== "processing";

    // Drag and drop, and "All files" in the system dialog, pass the picker's
    // filter: a file that isn't a PDF is named beside the intake, with the
    // tool that can help (lib/file-acceptance), and never becomes the file.
    // The notice stays beside the chosen file's row after a mixed drop.
    const acceptance = useFileAcceptance(".pdf", files => {
        setFile(files[0]);
        setPhase("idle");
        setFailure(null);
    });

    const process = useCallback(async () => {
        if (!file || !search.trim()) return;
        setPhase("processing");
        setFailure(null);
        try {
            const res = await uploadFile("/split-by-text", file, {
                search: search.trim(),
                case_sensitive: caseSensitive,
            });
            const blob = await res.blob();
            const name = `${file.name.replace(/\.pdf$/i, "")}_split.zip`;
            // The download policy: the ZIP downloads by itself, once per run.
            downloadBlob(blob, name);
            setResult({ blob, name });
            setPhase("done");
            emitToolRun({ outcome: "success", files: 1 });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Split failed";
            setResult(null);
            setFailure(runFailure(e, friendlyError(msg, "Couldn't split this PDF.")));
            setPhase("done");
            emitToolRun({ outcome: "error", files: 1 }, e);
        }
    }, [file, search, caseSensitive]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    // Back with a file: focus the search text that may need changing, or the run button.
    useEffect(() => {
        if (phase !== "idle") return;
        if (returning === "search") focusIfIdle(searchField.current);
        if (returning === "run") focusIfIdle(runButton.current);
    }, [phase, returning]);

    // The next split starts at a fresh intake: no notice about a file from the last one.
    const startOver = (files?: File[]) => {
        setResult(null); setFailure(null); acceptance.dismiss();
        setFile(files?.[0] ?? null);
        setReturning(files?.length ? "run" : "intake"); setPhase("idle");
    };
    const backToSearch = () => { setResult(null); setFailure(null); setReturning("search"); setPhase("idle"); };

    if (phase === "done" && failure && file) {
        return <StudioResult tone="failure" title="This PDF couldn’t be split." detail={runFailureDetail(failure)}>
            <StudioFile name={file.name} status="error" detail={failure.message} />
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void process()}
                choose={{ accepts: ".pdf", onFiles: files => startOver(files) }}
                more={<button type="button" className="ts-text-button" onClick={backToSearch}>Change the search text</button>} />
        </StudioResult>;
    }

    if (phase === "done" && result) {
        return <StudioResult title={`Split at every “${search.trim()}”.`} detail={downloadStarted(2)}>
            <StudioFile name={result.name} status="done" detail={formatFileSize(result.blob.size)} />
            <StudioActions tone="success"
                primary={<button type="button" className="ts-primary-button" onClick={() => downloadBlob(result.blob, result.name)}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(2)}</button>}
                more={<button type="button" className="ts-text-button" onClick={() => startOver()}>Split another</button>} />
        </StudioResult>;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<>
        <div className="ts-setting">
            <label htmlFor="split-by-text-search">Search term</label>
            <input id="split-by-text-search" ref={searchField} type="text" value={search} disabled={busy} onChange={e => setSearch(e.target.value)}
                placeholder='e.g. "Invoice #", "Chapter", "Statement of"' />
            {file && !search.trim() && !busy && <p className="ts-caption">Enter the text that starts each part.</p>}
        </div>
        <label className="ts-check"><input type="checkbox" checked={caseSensitive} disabled={busy} onChange={e => setCaseSensitive(e.target.checked)} />Case-sensitive</label>
    </>} action={<StudioActionBar ready={!!file} count={file ? fileCount(1, "PDF") : undefined}>
        <button type="button" ref={runButton} className="ts-primary-button" onClick={process} disabled={!canProcess}><Scissors size={16} aria-hidden="true" /> Split PDF</button>
    </StudioActionBar>}>
        {file
            ? <StudioFile name={file.name} detail={formatFileSize(file.size)} onRemove={busy ? undefined : () => setFile(null)} />
            : <FileIntake accepts=".pdf" acceptance={acceptance} title="Select a PDF to split by text" detail="Cuts before every page containing the search term."
                autoFocus={returning === "intake"} onFiles={acceptance.receive} />}
        <IntakeNotice advice={acceptance.advice} onDismiss={acceptance.dismiss} />
        {busy && <StudioProgress label="Splitting your PDF" detail={`A new part at every page with “${search.trim()}”`} />}
    </StudioLayout>;
}
