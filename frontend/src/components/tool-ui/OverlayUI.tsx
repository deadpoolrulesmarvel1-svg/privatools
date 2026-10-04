/**
 * OverlayUI — combine two PDFs by layering one onto the other, on the shared
 * kit: the base and the overlay as two named inputs (PairedIntake, with a
 * swap, since the order decides which is kept), the mode in the options, the
 * run button in the action bar, and the kit's result. One request makes one
 * PDF, which downloads by itself once.
 */
import { useState, useEffect, useCallback } from "react";
import { Download, Layers } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, buildOutputFilename, postFormData } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { PairedIntake, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { downloadAgainLabel, downloadStarted, runFailure, runFailureDetail, type RunFailure } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const MODES = [
    { value: "overlay" as const, label: "Overlay", desc: "Place B on top of A" },
    { value: "stamp"   as const, label: "Stamp",   desc: "Place B as a background" },
];

const OVERLAY_DEFAULTS: { mode: "overlay" | "stamp" } = {
    mode: "overlay",
};

export function OverlayUI() {
    const [config, , { setField }] = useToolDefaults("overlay", OVERLAY_DEFAULTS);
    const { mode } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof OVERLAY_DEFAULTS["mode"]>) => setField("mode", v), [setField]);
    const [file1, setFile1] = useState<File | null>(null);
    const [file2, setFile2] = useState<File | null>(null);

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [failure, setFailure] = useState<RunFailure | null>(null);
    // Back from a result: focus the pair again.
    const [returning, setReturning] = useState(false);

    const outputName = file1 ? buildOutputFilename(file1.name, "overlay", "pdf") : "overlay.pdf";

    const process = useCallback(async () => {
        if (!file1 || !file2) return;
        setPhase("processing");
        setFailure(null);
        try {
            const res = await postFormData("/overlay", () => {
                const fd = new FormData();
                fd.append("base_file", file1);
                fd.append("overlay_file", file2);
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
            const msg = e instanceof Error ? e.message : "Overlay failed";
            setResultBlob(null);
            setFailure(runFailure(e, friendlyError(msg, "Couldn't overlay those PDFs.")));
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

    const stamp = mode === "stamp";
    if (phase === "done" && failure) {
        return <StudioResult tone="failure" title="These PDFs couldn’t be combined." detail={runFailureDetail(failure)}>
            <StudioFile name={`${file1?.name ?? "Base PDF"} and ${file2?.name ?? "Overlay PDF"}`} status="error" detail={failure.message} />
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void process()}
                back={{ label: "Change the files", onBack: backToFiles }} />
        </StudioResult>;
    }

    if (phase === "done" && resultBlob) {
        return <StudioResult title="Your combined PDF is ready." detail={`${stamp ? "B is drawn behind every page of A, as a background." : "B is drawn on top of every page of A."} ${downloadStarted(1)}`}>
            <StudioFile name={outputName} status="done" detail={formatFileSize(resultBlob.size)} />
            <StudioActions tone="success"
                primary={<button type="button" className="ts-primary-button" onClick={() => downloadBlob(resultBlob, outputName)}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(1)}</button>}
                more={<button type="button" className="ts-text-button" onClick={startOver}>Overlay more</button>} />
        </StudioResult>;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<div>
        <h2>Mode</h2>
        <div className="ts-choices" role="group" aria-label="Mode">{MODES.map(m => <button type="button" className="ts-choice" key={m.value}
            aria-pressed={mode === m.value} disabled={busy} onClick={() => setMode(m.value)}>
            <strong>{m.label}</strong><span>{m.desc}</span>
        </button>)}</div>
    </div>} action={<StudioActionBar ready={!!file1 && !!file2} count={file1 && file2 ? fileCount(2, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={process} disabled={!file1 || !file2 || busy}><Layers size={16} aria-hidden="true" /> {stamp ? "Apply stamp" : "Overlay PDFs"}</button>
    </StudioActionBar>}>
        <PairedIntake accepts=".pdf" disabled={busy} autoFocus={returning} slots={[
            { role: "Base PDF (A)", detail: "The main document. Its pages, links and form fields are kept.", file: file1, onFile: setFile1 },
            { role: "Overlay PDF (B)", detail: stamp ? "Drawn behind every page of A, as a background." : "Drawn on top of every page of A.", file: file2, onFile: setFile2 },
        ]} swap={{ label: "Swap base and overlay", onSwap: () => { setFile1(file2); setFile2(file1); } }} />
        {busy && <StudioProgress label="Combining your PDFs" />}
    </StudioLayout>;
}
