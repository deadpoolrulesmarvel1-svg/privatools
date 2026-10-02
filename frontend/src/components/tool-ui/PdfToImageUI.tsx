/**
 * PdfToImageUI — rasterize each PDF page to JPEG/PNG at chosen DPI.
 *
 * The backend returns a ZIP per PDF containing the page images. For N=1 we
 * download that ZIP directly. For N>1 we wrap the per-file ZIPs inside one
 * outer archive (nested ZIPs, but at STORE compression so unzip is fast).
 */
import { useState, useEffect, useCallback } from "react";
import { Image as ImageIcon } from "lucide-react";
import { MAX_FILE_SIZE_LABEL, formatFileSize } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { fileCount } from "@/skins/experience/file-format-label";

type Fmt = "jpeg" | "png";

const formats: { id: Fmt; label: string; desc: string }[] = [
    { id: "jpeg", label: "JPEG", desc: "Smaller · lossy" },
    { id: "png",  label: "PNG",  desc: "Lossless · larger" },
];

const dpiOptions = [72, 150, 300];

// Rough output zip-size estimator (per file).
function estimateOutputSize(srcBytes: number, fmt: Fmt, dpi: number): number {
    const dpiScale = (dpi / 150) ** 2;
    const fmtScale = fmt === "png" ? 3.0 : 0.9;
    return Math.round(srcBytes * dpiScale * fmtScale);
}

const PDF_TO_IMAGE_DEFAULTS: { format: Fmt; dpi: number } = {
    format: "jpeg",
    dpi: 150,
};

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function PdfToImageUI() {
    const [config, , { setField }] = useToolDefaults("pdf-to-image", PDF_TO_IMAGE_DEFAULTS);
    const { format, dpi } = config;
    const setFormat = useCallback((v: React.SetStateAction<typeof PDF_TO_IMAGE_DEFAULTS["format"]>) => setField("format", v), [setField]);
    const setDpi = useCallback((v: React.SetStateAction<typeof PDF_TO_IMAGE_DEFAULTS["dpi"]>) => setField("dpi", v), [setField]);
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    const totalBytes = proc.entries.reduce((s, e) => s + e.size, 0);
    const estTotal = totalBytes ? estimateOutputSize(totalBytes, format, dpi) : 0;

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/pdf-to-image",
            outputSuffix: "images",
            outputExt: "zip",
            params: { format, dpi },
        }, retry);
        setPhase("done");
    }, [proc, format, dpi]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_images"));

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (phase === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setPhase("idle");
        };
        return <ProcessorResult proc={proc} verb="converted" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs converted to ${format.toUpperCase()} at ${dpi} dpi.` : `Your pages, as ${format.toUpperCase()} at ${dpi} dpi.`}
            detail={proc.doneCount > 1 ? "The ZIP download has started: one ZIP of page images per PDF inside." : "The ZIP of page images has started downloading."}
            onDownload={() => proc.downloadAll("archive_images")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Convert more" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<>
        <div>
            <h2>Output format</h2>
            <div className="ts-choices">{formats.map(f => <button type="button" className="ts-choice" key={f.id} aria-pressed={format === f.id} disabled={busy} onClick={() => setFormat(f.id)}><strong>{f.label}</strong><span>{f.desc}</span></button>)}</div>
        </div>
        <div>
            <h2>Resolution</h2>
            <div className="ts-choices">{dpiOptions.map(d => <button type="button" className="ts-choice" key={d} aria-pressed={dpi === d} disabled={busy} onClick={() => setDpi(d)}><strong>{d} dpi</strong></button>)}</div>
            <p className="ts-caption">{dpi <= 72 ? "Screen · fast" : dpi <= 150 ? "Balanced" : "Print · larger files"}{totalBytes > 0 && ` · Est. ~ ${formatFileSize(estTotal)} total`}</p>
        </div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><ImageIcon size={16} aria-hidden="true" /> Convert {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : `to ${format.toUpperCase()}`}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to rasterize" detail={`Each page → image · zipped output · max ${MAX_FILE_SIZE_LABEL} each`}
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Turning pages into images" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
