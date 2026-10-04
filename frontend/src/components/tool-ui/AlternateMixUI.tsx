/**
 * AlternateMixUI — interleave pages from two PDFs, on the shared kit: the two
 * named inputs (PairedIntake, with a swap, since the order decides which
 * pages come first), the mode in the options, the run button in the action
 * bar, and the kit's result. One request makes one PDF, which downloads by
 * itself once.
 */
import { useState, useEffect, useCallback } from "react";
import { Download, Shuffle } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, buildOutputFilename, postFormData } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { PairedIntake, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { downloadAgainLabel, downloadStarted, runFailure, runFailureDetail, type RunFailure } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

type MixMode = "alternate" | "reverse-alternate";

const MODES: { value: MixMode; label: string; desc: string }[] = [
    { value: "alternate",         label: "Alternate",         desc: "1A · 1B · 2A · 2B …" },
    { value: "reverse-alternate", label: "Reverse alternate", desc: "1A · lastB · 2A · prevB …" },
];

const ALTERNATE_MIX_DEFAULTS: { mode: MixMode } = {
    mode: "alternate",
};

export function AlternateMixUI() {
    const [config, , { setField }] = useToolDefaults("alternate-mix", ALTERNATE_MIX_DEFAULTS);
    const { mode } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof ALTERNATE_MIX_DEFAULTS["mode"]>) => setField("mode", v), [setField]);
    const [file1, setFile1] = useState<File | null>(null);
    const [file2, setFile2] = useState<File | null>(null);

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [failure, setFailure] = useState<RunFailure | null>(null);
    // Back from a result: focus the pair again.
    const [returning, setReturning] = useState(false);

    const outputName = file1 ? buildOutputFilename(file1.name, "alternate_mix", "pdf") : "alternate_mix.pdf";

    const process = useCallback(async () => {
        if (!file1 || !file2) return;
        setPhase("processing");
        setFailure(null);
        try {
            const res = await postFormData("/alternate-mix", () => {
                const fd = new FormData();
                fd.append("file1", file1);
                fd.append("file2", file2);
                fd.append("mode", mode);
                return fd;
            });
            const blob = await res.blob();
            setResultBlob(blob);
            // The download policy: the result downloads by itself, once per run.
            downloadBlob(blob, outputName);
            setPhase("done");
            emitToolRun({ outcome: "success", files: 2 });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Alternate mix failed";
            setResultBlob(null);
            setFailure(runFailure(e, friendlyError(msg, "Couldn't alternate-mix those PDFs.")));
            setPhase("done");
            emitToolRun({ outcome: "error", files: 2 }, e);
        }
    }, [file1, file2, mode, outputName]);

    // Ctrl/⌘+Enter runs from the form and after a failure, not from a finished result (as before the kit).
    const runnable = phase === "idle" || (phase === "done" && !!failure);
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file1 && file2 && runnable) {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file1, file2, runnable, process]);

    const startOver = () => { setFile1(null); setFile2(null); setResultBlob(null); setFailure(null); setReturning(true); setPhase("idle"); };
    // The reason does not say which of the two the server refused: back to the pair, both kept.
    const backToFiles = () => { setResultBlob(null); setFailure(null); setReturning(true); setPhase("idle"); };

    if (phase === "done" && failure) {
        return <StudioResult tone="failure" title="These PDFs couldn’t be mixed." detail={runFailureDetail(failure)}>
            <StudioFile name={`${file1?.name ?? "First PDF"} and ${file2?.name ?? "Second PDF"}`} status="error" detail={failure.message} />
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void process()}
                back={{ label: "Change the files", onBack: backToFiles }} />
        </StudioResult>;
    }

    if (phase === "done" && resultBlob) {
        return <StudioResult title="The pages are interleaved." detail={downloadStarted(1)}>
            <StudioFile name={outputName} status="done" detail={formatFileSize(resultBlob.size)} />
            <StudioActions tone="success"
                primary={<button type="button" className="ts-primary-button" onClick={() => downloadBlob(resultBlob, outputName)}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(1)}</button>}
                more={<button type="button" className="ts-text-button" onClick={startOver}>Mix another pair</button>} />
        </StudioResult>;
    }

    const busy = phase === "processing";
    const reversed = mode === "reverse-alternate";
    return <StudioLayout options={<div>
        <h2>Mix mode</h2>
        <div className="ts-choices" role="group" aria-label="Mix mode">{MODES.map(m => <button type="button" className="ts-choice" key={m.value}
            aria-pressed={mode === m.value} disabled={busy} onClick={() => setMode(m.value)}>
            <strong>{m.label}</strong><span>{m.desc}</span>
        </button>)}</div>
    </div>} action={<StudioActionBar ready={!!file1 && !!file2} count={file1 && file2 ? fileCount(2, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={process} disabled={!file1 || !file2 || busy}><Shuffle size={16} aria-hidden="true" /> Mix PDFs</button>
    </StudioActionBar>}>
        <PairedIntake accepts=".pdf" disabled={busy} autoFocus={returning} slots={[
            { role: "First PDF (A)", detail: "Its pages come first in each pair.", file: file1, onFile: setFile1 },
            { role: "Second PDF (B)", detail: reversed ? "Its pages come second, from its last page back." : "Its pages come second, from its first page on.", file: file2, onFile: setFile2 },
        ]} swap={{ label: "Swap A and B", onSwap: () => { setFile1(file2); setFile2(file1); } }} />
        {busy && <StudioProgress label="Mixing your PDFs" />}
    </StudioLayout>;
}
