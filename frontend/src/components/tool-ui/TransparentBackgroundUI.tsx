/**
 * TransparentBackgroundUI — make near-white pixels transparent.
 * Multi-file via useMultiFileProcessor (same threshold/DPI applied to every PDF).
 */
import { useState, useEffect, useCallback } from "react";
import { Eraser } from "lucide-react";
import { downloadBlob, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const TRANSPARENT_BACKGROUND_DEFAULTS: { threshold: number; dpi: number } = {
    threshold: 245,
    dpi: 144,
};

export function TransparentBackgroundUI() {
    const [config, , { setField }] = useToolDefaults("transparent-background", TRANSPARENT_BACKGROUND_DEFAULTS);
    const { threshold, dpi } = config;
    const setThreshold = useCallback((v: React.SetStateAction<typeof TRANSPARENT_BACKGROUND_DEFAULTS["threshold"]>) => setField("threshold", v), [setField]);
    const setDpi = useCallback((v: React.SetStateAction<typeof TRANSPARENT_BACKGROUND_DEFAULTS["dpi"]>) => setField("dpi", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/transparent-background",
            outputSuffix: "transparent",
            outputExt: "pdf",
            params: { threshold, dpi },
        }, retry);
        setPhase("done");
    }, [proc, threshold, dpi]);

    // The backend answers with a generic `transparent.pdf` name; the old UI
    // named downloads after the source file (`stem_transparent.pdf`). Keep
    // that: build names client-side. N=1 → direct blob, N>1 → zip.
    const downloadResults = useCallback(() => {
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, buildOutputFilename(done[0].name, "transparent", "pdf"));
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: buildOutputFilename(e.name, "transparent", "pdf"),
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), "archive_transparent.zip");
        })();
    }, [proc.entries]);

    useDownloadOnce(phase === "done", proc.doneCount, downloadResults);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && proc.entries.length > 0 && phase === "idle") {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [proc.entries.length, phase, process]);

    if (phase === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files);
            setReturning(true); setPhase("idle");
        };
        return <ProcessorResult proc={proc} verb="made transparent" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs made transparent.` : "Your transparent PDF is ready."}
            detail={downloadStarted(proc.doneCount)}
            onDownload={downloadResults} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Process another" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<>
        <div className="ts-setting">
            <label htmlFor="threshold-range">White threshold · {threshold}</label>
            <input id="threshold-range" type="range" min={180} max={255} value={threshold} disabled={busy} onChange={e => setThreshold(parseInt(e.target.value, 10))} />
            <p className="ts-caption">Higher → only bright whites removed · Lower → also clears light backgrounds</p>
        </div>
        <div className="ts-setting">
            <label htmlFor="dpi-range">Render DPI · {dpi}</label>
            <input id="dpi-range" type="range" min={72} max={300} value={dpi} disabled={busy} onChange={e => setDpi(parseInt(e.target.value, 10))} />
            <p className="ts-caption">Rasterizes pages — higher DPI = sharper but larger file</p>
        </div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!proc.entries.length || busy}><Eraser size={16} aria-hidden="true" /> Remove background{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDF to make background transparent" detail="Convert near-white pixels to transparent"
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Clearing the white" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
