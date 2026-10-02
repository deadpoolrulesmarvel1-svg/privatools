/**
 * ResizeUI — resize one or many PDFs to a standard or custom page size.
 * Multi-file via useMultiFileProcessor — same target size applied to all.
 */
import { useState, useCallback, useEffect } from "react";
import { Maximize2 } from "lucide-react";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const sizes = [
    { id: "a4",     label: "A4",     dims: "210 × 297 mm" },
    { id: "letter", label: "Letter", dims: "8.5 × 11 in"  },
    { id: "a3",     label: "A3",     dims: "297 × 420 mm" },
    { id: "legal",  label: "Legal",  dims: "8.5 × 14 in"  },
    { id: "custom", label: "Custom", dims: "any size"      },
];

const RESIZE_DEFAULTS = {
    pageSize: "a4",
    width: 595,
    height: 842,
};

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function ResizeUI() {
    const [config, , { setField }] = useToolDefaults("resize-pdf", RESIZE_DEFAULTS);
    const { pageSize, width, height } = config;
    const setPageSize = useCallback((v: React.SetStateAction<typeof RESIZE_DEFAULTS["pageSize"]>) => setField("pageSize", v), [setField]);
    const setWidth = useCallback((v: React.SetStateAction<typeof RESIZE_DEFAULTS["width"]>) => setField("width", v), [setField]);
    const setHeight = useCallback((v: React.SetStateAction<typeof RESIZE_DEFAULTS["height"]>) => setField("height", v), [setField]);
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const customValid = pageSize !== "custom" || (width >= 72 && height >= 72 && width <= 14400 && height <= 14400);
    const canProcess = proc.entries.length > 0 && customValid && phase !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        const params: Record<string, string | number> = { page_size: pageSize };
        if (pageSize === "custom") { params.width = width; params.height = height; }
        await proc.run({
            endpoint: "/resize",
            outputSuffix: "resized",
            outputExt: "pdf",
            params,
        }, retry);
        setPhase("done");
    }, [proc, pageSize, width, height]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_resized"));

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

    if (phase === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setPhase("idle");
        };
        const size = sizes.find(s => s.id === pageSize)?.label ?? pageSize.toUpperCase();
        return <ProcessorResult proc={proc} verb="resized" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs resized to ${size}.` : `Resized to ${size}.`}
            detail={downloadStarted(proc.doneCount)}
            onDownload={() => proc.downloadAll("archive_resized")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Resize more" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<div>
        <h2>Page size</h2>
        <div className="ts-choices">{sizes.map(s => <button type="button" className="ts-choice" key={s.id} aria-pressed={pageSize === s.id} disabled={busy} onClick={() => setPageSize(s.id)}><strong>{s.label}</strong><span>{s.dims}</span></button>)}</div>
        {pageSize === "custom" && <>
            <div className="ts-field-grid">
                <div className="ts-setting"><label htmlFor="resize-width">Width (pt)</label><input id="resize-width" type="number" inputMode="numeric" value={width} min={72} max={14400} disabled={busy} onChange={e => setWidth(Math.min(14400, Math.max(72, parseInt(e.target.value) || 595)))} /></div>
                <div className="ts-setting"><label htmlFor="resize-height">Height (pt)</label><input id="resize-height" type="number" inputMode="numeric" value={height} min={72} max={14400} disabled={busy} onChange={e => setHeight(Math.min(14400, Math.max(72, parseInt(e.target.value) || 842)))} /></div>
            </div>
            <p className="ts-caption">Min 72 pt (1 inch) · Max 14400 pt (200 in)</p>
            {!customValid && <p className="ts-error" role="alert">Width/height out of range</p>}
        </>}
    </div>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Maximize2 size={16} aria-hidden="true" /> Resize {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Select PDFs to resize" detail={`A4 · Letter · A3 · Legal · Custom · max ${MAX_FILE_SIZE_LABEL} each`}
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Fitting your pages" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
