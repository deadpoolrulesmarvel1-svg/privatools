/**
 * HeaderFooterUI — drop header/footer text bands onto every page of one or
 * more PDFs. Multi-file processing via useMultiFileProcessor (3-at-a-time,
 * per-file status, a retry for failures another attempt could fix).
 */
import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Heading } from "lucide-react";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const HEADER_FOOTER_DEFAULTS = {
    headerText: "",
    footerText: "",
    fontSize: 10,
};

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function HeaderFooterUI() {
    const proc = useMultiFileProcessor();
    const [config, setConfig, { restored, reset: resetConfig }] = useToolDefaults("header-footer", HEADER_FOOTER_DEFAULTS);
    const { headerText, footerText, fontSize } = config;
    const setHeaderText = (v: string) => setConfig(c => ({ ...c, headerText: v }));
    const setFooterText = (v: string) => setConfig(c => ({ ...c, footerText: v }));
    const setFontSize = (v: number) => setConfig(c => ({ ...c, fontSize: v }));
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    useEffect(() => {
        if (restored) toast.message("Restored previous settings", { description: "Picked up where you left off.", duration: 3000 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const hasText = headerText.trim().length > 0 || footerText.trim().length > 0;
    const canProcess = proc.entries.length > 0 && hasText && phase !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/header-footer",
            outputSuffix: "header_footer",
            outputExt: "pdf",
            params: { header_text: headerText, footer_text: footerText, font_size: fontSize },
        }, retry);
        setPhase("done");
    }, [proc, headerText, footerText, fontSize]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_header_footer"));

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
        return <ProcessorResult proc={proc} verb="stamped" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs stamped.` : "Header & footer set."}
            detail={downloadStarted(proc.doneCount)}
            onDownload={() => proc.downloadAll("archive_header_footer")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Apply to more" />;
    }

    const busy = phase === "processing";
    const bandSize = `${Math.max(6, fontSize / 1.6)}px`;
    return <StudioLayout options={<>
        <div>
            <h2>Text bands</h2>
            <div className="ts-setting"><label htmlFor="hf-header">Header</label><input id="hf-header" value={headerText} disabled={busy} onChange={e => setHeaderText(e.target.value)} placeholder="e.g. Company Report 2026" /></div>
            <div className="ts-setting"><label htmlFor="hf-footer">Footer</label><input id="hf-footer" value={footerText} disabled={busy} onChange={e => setFooterText(e.target.value)} placeholder="e.g. Confidential — page {n}" /></div>
            <div className="ts-setting"><label htmlFor="hf-size">Font size · {fontSize} pt</label><input id="hf-size" type="range" min={6} max={32} step={1} value={fontSize} disabled={busy} onChange={e => setFontSize(parseInt(e.target.value))} /></div>
            {!hasText && proc.entries.length > 0 && <p className="ts-caption">Enter at least one band.</p>}
        </div>
        <div className="ts-page-mock" aria-hidden="true">
            <span className="ts-page-mock-band" style={{ fontSize: bandSize }}>{headerText || "—"}</span>
            <span className="ts-page-mock-body">page</span>
            <span className="ts-page-mock-band" style={{ fontSize: bandSize }}>{footerText || "—"}</span>
        </div>
        <div><button type="button" className="ts-text-button" onClick={resetConfig} disabled={busy}>Reset to defaults</button></div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Heading size={16} aria-hidden="true" /> Apply to {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Select PDFs for header & footer" detail={`Multi-file OK · same bands applied to all · max ${MAX_FILE_SIZE_LABEL} each`}
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Setting the bands" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
