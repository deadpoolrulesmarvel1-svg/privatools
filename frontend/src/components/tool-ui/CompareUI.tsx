/**
 * CompareUI — side-by-side PDF diff (visual or text).
 * Paired source sheets with visual or text comparison and a readable result.
 */
import { useState, useEffect, useCallback } from "react";
import { Download, GitCompare } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, buildOutputFilename, postFormData, readJson } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioFile, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { fileCount } from "@/skins/experience/file-format-label";

const MODES = [
    { value: "visual", label: "Visual", desc: "Side-by-side with diff highlights" },
    { value: "text",   label: "Text",   desc: "Compare text content only" },
] as const;

interface TextResult {
    diff: string[];
    page_count_1: number;
    page_count_2: number;
}

type FileState = { name: string; size: string; raw: File } | null;

const COMPARE_DEFAULTS: { mode: "visual" | "text"; highlight: string } = {
    mode: "visual",
    highlight: "#0E8A56",
};

export function CompareUI() {
    const [config, , { setField }] = useToolDefaults("compare-pdf", COMPARE_DEFAULTS);
    const { mode, highlight } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof COMPARE_DEFAULTS["mode"]>) => setField("mode", v), [setField]);
    const setHighlight = useCallback((v: React.SetStateAction<typeof COMPARE_DEFAULTS["highlight"]>) => setField("highlight", v), [setField]);
    const [file1, setFile1] = useState<FileState>(null);
    const [file2, setFile2] = useState<FileState>(null);

    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [textResult, setTextResult] = useState<TextResult | null>(null);

    const process = useCallback(async () => {
        if (!file1 || !file2) return;
        setState("processing"); setError(null);
        try {
            const res = await postFormData("/compare", () => {
                const fd = new FormData();
                fd.append("file1", file1.raw);
                fd.append("file2", file2.raw);
                fd.append("mode", mode);
                fd.append("highlight_color", highlight);
                return fd;
            });
            if (mode === "visual") {
                const blob = await res.blob();
                setResultBlob(blob); setTextResult(null);
                downloadBlob(blob, buildOutputFilename(file1.name, "comparison", "pdf"));
            } else {
                const json = await readJson<TextResult>(res);
                setTextResult(json); setResultBlob(null);
            }
            setState("done");
            emitToolRun({ outcome: "success", files: 2 });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't compare those PDFs."));
            setState("idle");
            emitToolRun({ outcome: "error", files: 2 }, e);
        }
    }, [file1, file2, mode, highlight]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file1 && file2 && state !== "processing") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file1, file2, state, process]);

    const pick = (set: (file: FileState) => void, files: File[]) => { const file = files[0]; if (file) set({ name: file.name, size: formatFileSize(file.size), raw: file }); };
    if (state === "done") return <StudioResult title={mode === "visual" ? "See what changed." : `${textResult?.diff.length || 0} lines to compare.`} detail={mode === "visual" ? "The differences are highlighted in your downloaded comparison PDF." : `${textResult?.page_count_1 || 0} original pages · ${textResult?.page_count_2 || 0} modified pages`}>
        {textResult && <pre className="ts-comparison-text" aria-label="Text differences">{textResult.diff.length ? textResult.diff.map((line, i) => <span key={i} data-change={line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : "same"}>{line}{"\n"}</span>) : "No text differences found."}</pre>}
        <div className="ts-actions">{mode === "visual" && resultBlob && <button className="ts-primary-button" onClick={() => downloadBlob(resultBlob, buildOutputFilename(file1?.name, "comparison", "pdf"))}><Download size={16} /> Download again</button>}<button className="ts-text-button" onClick={() => { setFile1(null); setFile2(null); setState("idle"); setResultBlob(null); setTextResult(null); }}>Compare more</button></div>
    </StudioResult>;
    return <StudioLayout options={<>
        <div><p className="ts-eyebrow">Notice the difference</p><h2>Compare your way</h2><div className="ts-choices">{MODES.map(item => <button className="ts-choice" key={item.value} aria-pressed={mode === item.value} disabled={state === "processing"} onClick={() => setMode(item.value)}><strong>{item.label}</strong><span>{item.desc}</span></button>)}</div></div>
        {mode === "visual" && <div className="ts-setting"><label htmlFor="comparison-highlight">Highlight color</label><input id="comparison-highlight" type="color" value={highlight} disabled={state === "processing"} onChange={event => setHighlight(event.target.value)} /></div>}
    </>} action={<StudioActionBar ready={!!file1 && !!file2} count={file1 && file2 ? fileCount(2, "PDF") : undefined}>
        <button className="ts-primary-button" onClick={process} disabled={!file1 || !file2 || state === "processing"}><GitCompare size={16} /> Compare PDFs</button>
    </StudioActionBar>}>
        <div className="ts-paired-inputs">{([{ label: "Original", file: file1, set: setFile1 }, { label: "Modified", file: file2, set: setFile2 }]).map(item => <section key={item.label}><p className="ts-eyebrow">{item.label === "Original" ? "Where you started" : "The latest version"}</p>{item.file ? <StudioFile name={item.file.name} detail={item.file.size} onRemove={state !== "processing" ? () => item.set(null) : undefined} removeLabel="Remove" /> : <FileIntake accepts=".pdf" label={`Upload ${item.label}`} title={`${item.label} PDF`} detail={item.label === "Original" ? "Choose the earlier document." : "Choose the version to compare."} onFiles={files => pick(item.set, files)} disabled={state === "processing"} />}</section>)}</div>
        {state === "processing" && <StudioProgress label="Looking a little closer" detail="Comparing both documents for changes." />}{error && <div className="ts-error" role="alert">{error}</div>}
    </StudioLayout>;
}
