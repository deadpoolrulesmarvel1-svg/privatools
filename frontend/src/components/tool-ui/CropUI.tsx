/**
 * CropUI — trim margins (top/right/bottom/left) from one or many PDFs in points.
 * Multi-file via useMultiFileProcessor — same margins applied to every input.
 */
import { useState, useCallback, useEffect } from "react";
import { Crop } from "lucide-react";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { PdfPageStage } from "./pdf/PdfPageStage";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const MAX_PT = 500;
const clamp = (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 0) return "0";
    if (n > MAX_PT) return String(MAX_PT);
    return String(n);
};

const CROP_DEFAULTS = {
    top: "50",
    bottom: "50",
    left: "30",
    right: "30",
};

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function CropUI() {
    const [config, , { setField }] = useToolDefaults("crop-pdf", CROP_DEFAULTS);
    const { top, bottom, left, right } = config;
    const setTop = useCallback((v: React.SetStateAction<typeof CROP_DEFAULTS["top"]>) => setField("top", v), [setField]);
    const setBottom = useCallback((v: React.SetStateAction<typeof CROP_DEFAULTS["bottom"]>) => setField("bottom", v), [setField]);
    const setLeft = useCallback((v: React.SetStateAction<typeof CROP_DEFAULTS["left"]>) => setField("left", v), [setField]);
    const setRight = useCallback((v: React.SetStateAction<typeof CROP_DEFAULTS["right"]>) => setField("right", v), [setField]);
    const proc = useMultiFileProcessor();
    const [previewPage, setPreviewPage] = useState(1);
    const [pageSize, setPageSize] = useState({ width: 612, height: 792 });
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/crop",
            outputSuffix: "cropped",
            outputExt: "pdf",
            // The margins are drawn and typed on the page as shown, so the route
            // measures them there, on each page of every file. By default it
            // measures from the MediaBox before /Rotate, which cropped the wrong
            // sides of a turned page and showed more of a page already cropped.
            params: { top, bottom, left, right, margins_from: "shown" },
        }, retry);
        setPhase("done");
    }, [proc, top, bottom, left, right]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_cropped"));

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
        return <ProcessorResult proc={proc} verb="cropped" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs cropped.` : "Margins trimmed."}
            detail={downloadStarted(proc.doneCount)}
            onDownload={() => proc.downloadAll("archive_cropped")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Crop more" />;
    }

    const busy = phase === "processing";
    const margins = [
        { id: "crop-top", label: "Top", value: top, set: setTop },
        { id: "crop-bottom", label: "Bottom", value: bottom, set: setBottom },
        { id: "crop-left", label: "Left", value: left, set: setLeft },
        { id: "crop-right", label: "Right", value: right, set: setRight },
    ];
    return <StudioLayout options={<>
        <div>
            <h2>Crop margins</h2>
            <div className="ts-field-grid">
                {margins.map(m => <div className="ts-setting" key={m.id}>
                    <label htmlFor={m.id}>{m.label} (pt)</label>
                    <input id={m.id} type="number" inputMode="numeric" min={0} max={MAX_PT} value={m.value} disabled={busy}
                        onChange={e => m.set(clamp(e.target.value))} onBlur={e => m.set(clamp(e.target.value || "0"))} />
                </div>)}
            </div>
            <p className="ts-caption">1 pt = 1/72 inch</p>
        </div>
        <div><button type="button" className="ts-text-button" disabled={busy} onClick={() => { setTop("50"); setBottom("50"); setLeft("30"); setRight("30"); }}>Reset to defaults</button></div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Crop size={16} aria-hidden="true" /> Crop {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Select PDFs to crop" detail={`Multi-file OK · same margins applied to all · max ${MAX_FILE_SIZE_LABEL} each`}
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {proc.entries.length > 0 && <PdfPageStage file={proc.entries[0].file} page={previewPage} onPageChange={setPreviewPage} coordinates="shown" onDimensions={info => setPageSize({ width: info.width, height: info.height })} regions={[{ id: "crop", page: previewPage, x: Number(left), y: Number(top), width: Math.max(0, pageSize.width - Number(left) - Number(right)), height: Math.max(0, pageSize.height - Number(top) - Number(bottom)), kind: "rectangle", color: "#397dec", label: "Area to keep" }]} drawLabel="Draw the area to keep" disabled={busy} onDraw={region => { setTop(String(Math.round(region.y))); setLeft(String(Math.round(region.x))); setRight(String(Math.max(0, Math.round(pageSize.width - region.x - region.width)))); setBottom(String(Math.max(0, Math.round(pageSize.height - region.y - region.height)))); }} />}
        {busy && <StudioProgress label="Trimming the margins" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
