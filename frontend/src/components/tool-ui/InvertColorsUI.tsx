/**
 * InvertColorsUI — invert PDF colors for dark mode reading.
 *
 * Mode picker (Full vs Night) and DPI picker.
 * Multi-file via useMultiFileProcessor — same mode/DPI applied to every PDF.
 */
import { useState, useEffect, useCallback } from "react";
import { Moon } from "lucide-react";
import { downloadBlob, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const INVERT_COLORS_DEFAULTS: { mode: "full" | "night"; dpi: number } = {
    mode: "full",
    dpi: 150,
};

const MODES = [
    { id: "full" as const, label: "Full invert", desc: "Flip every color" },
    { id: "night" as const, label: "Night mode", desc: "Warm dark tint" },
];

const QUALITIES = [
    { val: 72, label: "Fast", hint: "72 dpi" },
    { val: 150, label: "Balanced", hint: "150 dpi" },
    { val: 200, label: "Sharp", hint: "200 dpi" },
];

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function InvertColorsUI() {
    const [config, , { setField }] = useToolDefaults("invert-colors", INVERT_COLORS_DEFAULTS);
    const { mode, dpi } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof INVERT_COLORS_DEFAULTS["mode"]>) => setField("mode", v), [setField]);
    const setDpi = useCallback((v: React.SetStateAction<typeof INVERT_COLORS_DEFAULTS["dpi"]>) => setField("dpi", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Same naming as before: "<stem>_inverted.pdf". The server sends a generic
    // "inverted.pdf" so we name client-side.
    const outNameFor = useCallback((name: string) => buildOutputFilename(name, "inverted", "pdf"), []);

    const downloadResults = useCallback(() => {
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, outNameFor(done[0].name));
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: outNameFor(e.name),
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), "archive_inverted.zip");
        })();
    }, [proc.entries, outNameFor]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/invert-colors",
            outputSuffix: "inverted",
            outputExt: "pdf",
            params: { dpi, mode },
        }, retry);
        setPhase("done");
    }, [proc, dpi, mode]);

    useDownloadOnce(phase === "done", proc.doneCount, downloadResults);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess && phase === "idle") {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, phase, process]);

    if (phase === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setPhase("idle");
        };
        return <ProcessorResult proc={proc} verb="inverted" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs inverted.` : mode === "night" ? "Your night-mode PDF is ready." : "Your inverted PDF is ready."}
            detail={downloadStarted(proc.doneCount)}
            onDownload={downloadResults} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Process another" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<>
        <div>
            <h2>Inversion mode</h2>
            <div className="ts-choices">{MODES.map(m => <button type="button" className="ts-choice" key={m.id} aria-pressed={mode === m.id} disabled={busy} onClick={() => setMode(m.id)}><strong>{m.label}</strong><span>{m.desc}</span></button>)}</div>
        </div>
        <div>
            <h2>Quality (DPI)</h2>
            <div className="ts-choices">{QUALITIES.map(d => <button type="button" className="ts-choice" key={d.val} aria-pressed={dpi === d.val} disabled={busy} onClick={() => setDpi(d.val)}><strong>{d.label}</strong><span>{d.hint}</span></button>)}</div>
        </div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Moon size={16} aria-hidden="true" /> Invert colors{proc.entries.length > 1 ? ` — ${proc.entries.length} PDFs` : ""}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to invert colors" detail="Dark mode for any document · several files become a ZIP"
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Inverting the colors" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
