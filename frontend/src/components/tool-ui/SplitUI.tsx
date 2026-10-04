/**
 * SplitUI — split a PDF by ranges / individual pages / chunks, on the shared
 * kit: the intake, the split mode and its field in the options, the run
 * button in the action bar, and the kit's result. One request makes one
 * result (a PDF, or a ZIP of parts), which downloads by itself once.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { Download, Scissors } from "lucide-react";
import { friendlyError, isValidPageRange, pageRangeError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, IntakeNotice, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { useFileAcceptance } from "@/skins/experience/useFileAcceptance";
import { downloadAgainLabel, downloadStarted, runFailure, runFailureDetail, type RunFailure } from "@/skins/experience/studio-outcome";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { fileCount } from "@/skins/experience/file-format-label";

type Mode = "pages" | "individual" | "every_n";

const modes: { id: Mode; label: string; desc: string }[] = [
    { id: "pages",      label: "By page ranges", desc: "Specify ranges by hand" },
    { id: "individual", label: "Every page",     desc: "Each page becomes a separate file" },
    { id: "every_n",    label: "Every N pages",  desc: "Split into equal chunks" },
];

const SPLIT_DEFAULTS: { mode: Mode; n: number } = {
    mode: "pages",
    n: 2,
};

export function SplitUI() {
    const [config, , { setField }] = useToolDefaults("split-pdf", SPLIT_DEFAULTS);
    const { mode, n } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof SPLIT_DEFAULTS["mode"]>) => setField("mode", v), [setField]);
    const setN = useCallback((v: React.SetStateAction<typeof SPLIT_DEFAULTS["n"]>) => setField("n", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [pages, setPages] = useState("1-3");

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // What the run downloaded, for "Download again" (the download policy), or why it failed.
    const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
    const [failure, setFailure] = useState<RunFailure | null>(null);
    // Back from a result: to the intake, to the split settings that may need
    // changing, or, with a different file chosen there, to the run button.
    const [returning, setReturning] = useState<"intake" | "settings" | "run" | null>(null);
    const settingsField = useRef<HTMLInputElement>(null);
    const firstMode = useRef<HTMLButtonElement>(null);
    const runButton = useRef<HTMLButtonElement>(null);

    // A file that isn't a PDF is named beside the intake, with the tool that
    // can help, and the notice stays beside the chosen file after a mixed drop.
    const acceptance = useFileAcceptance(".pdf", files => {
        setFile(files[0]);
        setPhase("idle");
        setFailure(null);
    });

    const rangeOk = mode !== "pages" || (pages.trim().length > 0 && isValidPageRange(pages));
    const nOk = mode !== "every_n" || (n >= 1 && Number.isFinite(n));
    const canProcess = !!file && rangeOk && nOk && phase !== "processing";

    const process = useCallback(async () => {
        if (!file || !canProcess) return;
        setPhase("processing");
        setFailure(null);
        try {
            const params: Record<string, string | number> = { mode };
            if (mode === "pages") params.pages = pages;
            if (mode === "every_n") params.n = n;
            const res = await uploadFile("/split", file, params);
            const blob = await res.blob();
            const ext = blob.type.includes("zip") ? "zip" : "pdf";
            const name = buildOutputFilename(file.name, "split", ext);
            // The download policy: the result downloads by itself, once per run.
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
    }, [file, canProcess, mode, pages, n]);

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

    // Back with a file: focus the field that may need changing, or the run button.
    useEffect(() => {
        if (phase !== "idle") return;
        if (returning === "settings") focusIfIdle(settingsField.current ?? firstMode.current);
        if (returning === "run") focusIfIdle(runButton.current);
    }, [phase, returning]);

    const startOver = (files?: File[]) => {
        setResult(null); setFailure(null); acceptance.dismiss();
        setFile(files?.[0] ?? null);
        setReturning(files?.length ? "run" : "intake"); setPhase("idle");
    };
    const backToSettings = () => { setResult(null); setFailure(null); setReturning("settings"); setPhase("idle"); };

    const rangeErr = mode === "pages" ? pageRangeError(pages) : null;
    const previewSummary = mode === "individual"
        ? "Output: one PDF per page (ZIP)"
        : mode === "every_n"
            ? `Output: chunks of ${n} pages each (ZIP)`
            : pages.trim()
                ? `Output: one PDF for "${pages.trim()}"`
                : "Output preview appears as you type";

    if (phase === "done" && failure && file) {
        return <StudioResult tone="failure" title="This PDF couldn’t be split." detail={runFailureDetail(failure)}>
            <StudioFile name={file.name} status="error" detail={failure.message} />
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void process()}
                choose={{ accepts: ".pdf", onFiles: files => startOver(files) }}
                more={<button type="button" className="ts-text-button" onClick={backToSettings}>Change the split</button>} />
        </StudioResult>;
    }

    if (phase === "done" && result) {
        // One part comes back as a PDF, several as a ZIP (split_service).
        const zip = result.name.endsWith(".zip");
        const title = !zip ? "Your pages are in a new PDF."
            : mode === "every_n" ? `Split into parts of ${n} ${n === 1 ? "page" : "pages"}.`
            : mode === "individual" ? "Every page is its own PDF." : "Your PDF is split into parts.";
        return <StudioResult title={title} detail={downloadStarted(zip ? 2 : 1)}>
            <StudioFile name={result.name} status="done" detail={formatFileSize(result.blob.size)} />
            <StudioActions tone="success"
                primary={<button type="button" className="ts-primary-button" onClick={() => downloadBlob(result.blob, result.name)}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(zip ? 2 : 1)}</button>}
                more={<button type="button" className="ts-text-button" onClick={() => startOver()}>Split another</button>} />
        </StudioResult>;
    }

    const busy = phase === "processing";
    const rangeHint = "split-pages-hint";
    return <StudioLayout options={<>
        <div>
            <h2>Split mode</h2>
            <div className="ts-choices" role="group" aria-label="Split mode">{modes.map((m, index) => <button type="button" className="ts-choice" key={m.id}
                ref={index === 0 ? firstMode : undefined} aria-pressed={mode === m.id} disabled={busy} onClick={() => setMode(m.id)}>
                <strong>{m.label}</strong><span>{m.desc}</span>
            </button>)}</div>
        </div>
        {mode === "pages" && <div className="ts-setting">
            <label htmlFor="split-pages">Page ranges</label>
            <input id="split-pages" ref={settingsField} value={pages} onChange={e => setPages(e.target.value)} spellCheck={false} disabled={busy}
                aria-invalid={!isValidPageRange(pages)} aria-describedby={rangeHint} placeholder="1-3, 5, 7-end, -4, 9-" />
            {rangeErr
                ? <p className="ts-error" id={rangeHint}>{rangeErr}</p>
                : <p className="ts-caption" id={rangeHint}>Comma-separated ranges · "end" = last page · "-4" = first 4 · "9-" = page 9 to end</p>}
        </div>}
        {mode === "every_n" && <div className="ts-setting">
            <label htmlFor="split-n">Pages per chunk</label>
            <input id="split-n" ref={settingsField} type="number" inputMode="numeric" value={n} min={1} max={1000} disabled={busy}
                onChange={e => setN(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))} />
        </div>}
        <p className="ts-caption">{previewSummary}</p>
    </>} action={<StudioActionBar ready={!!file} count={file ? fileCount(1, "PDF") : undefined}>
        <button type="button" ref={runButton} className="ts-primary-button" onClick={process} disabled={!canProcess}><Scissors size={16} aria-hidden="true" /> Split PDF</button>
    </StudioActionBar>}>
        {file
            ? <StudioFile name={file.name} detail={formatFileSize(file.size)} onRemove={busy ? undefined : () => setFile(null)} />
            : <FileIntake accepts=".pdf" acceptance={acceptance} title="Select a PDF to split" detail="By page ranges, every page, or every N pages."
                autoFocus={returning === "intake"} onFiles={acceptance.receive} />}
        <IntakeNotice advice={acceptance.advice} onDismiss={acceptance.dismiss} />
        {busy && <StudioProgress label="Splitting your PDF" />}
    </StudioLayout>;
}
