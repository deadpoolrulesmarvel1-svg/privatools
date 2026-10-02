/**
 * PageNumbersUI — stamp visible page numbers on every page of one or many PDFs.
 * Multi-file via useMultiFileProcessor.
 */
import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { ListOrdered } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const PAGE_NUMBERS_DEFAULTS = {
    position: "bottom-center",
    startNumber: 1,
    fontSize: 12,
};

const positions = [
    { id: "top-left",      label: "Top left",      row: 0, col: 0 },
    { id: "top-center",    label: "Top center",    row: 0, col: 1 },
    { id: "top-right",     label: "Top right",     row: 0, col: 2 },
    { id: "bottom-left",   label: "Bottom left",   row: 1, col: 0 },
    { id: "bottom-center", label: "Bottom center", row: 1, col: 1 },
    { id: "bottom-right",  label: "Bottom right",  row: 1, col: 2 },
];

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function PageNumbersUI() {
    const proc = useMultiFileProcessor();
    const [config, setConfig, { restored, reset: resetConfig }] = useToolDefaults("page-numbers", PAGE_NUMBERS_DEFAULTS);
    const { position, startNumber, fontSize } = config;
    const setPosition = (v: string) => setConfig(c => ({ ...c, position: v }));
    const setStartNumber = (v: number) => setConfig(c => ({ ...c, startNumber: v }));
    const setFontSize = (v: number) => setConfig(c => ({ ...c, fontSize: v }));
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    useEffect(() => {
        if (restored) toast.message("Restored previous settings", { description: "Picked up where you left off.", duration: 3000 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/page-numbers",
            outputSuffix: "numbered",
            outputExt: "pdf",
            params: { position, start_number: startNumber, font_size: fontSize },
        }, retry);
        setPhase("done");
    }, [proc, position, startNumber, fontSize]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_numbered"));

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
        return <ProcessorResult proc={proc} verb="numbered" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs numbered.` : `Numbered from ${startNumber}.`}
            detail={downloadStarted(proc.doneCount)}
            onDownload={() => proc.downloadAll("archive_numbered")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Number more" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<>
        <div>
            <h2>Number position</h2>
            <div className="relative aspect-[3/4] bg-paper-2/40 border border-border rounded-md mx-auto w-full max-w-[200px]" role="group" aria-label="Number position">
                {positions.map(p => {
                    const active = position === p.id;
                    const dy = p.row === 0 ? "top-2" : "bottom-2";
                    const dx = p.col === 0 ? "left-2" : p.col === 1 ? "left-1/2 -translate-x-1/2" : "right-2";
                    return <button type="button" key={p.id} onClick={() => setPosition(p.id)} disabled={busy} aria-pressed={active}
                        className={cn("absolute h-7 min-w-[34px] px-1.5 rounded border tabular-nums text-[11px] flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))]", dy, dx,
                            // An opaque fill: a see-through tint over the picker's own tint and the options panel left the 11px number at 4.3:1.
                            active ? "border-accent bg-[color:color-mix(in_srgb,hsl(var(--accent))_10%,hsl(var(--card)))] text-accent font-semibold" : "border-border bg-card text-muted-foreground hover:border-accent/55 hover:text-foreground")}>
                        <span className="sr-only">{p.label}: </span>{startNumber}
                    </button>;
                })}
            </div>
        </div>
        <div>
            <div className="ts-setting"><label htmlFor="pn-start">Start number</label><input id="pn-start" type="number" inputMode="numeric" value={startNumber} min={1} max={99999} disabled={busy} onChange={e => setStartNumber(Math.max(1, Math.min(99999, parseInt(e.target.value) || 1)))} /></div>
            <div className="ts-setting"><label htmlFor="pn-size">Font size · {fontSize} pt</label><input id="pn-size" type="range" min={6} max={48} step={1} value={fontSize} disabled={busy} onChange={e => setFontSize(parseInt(e.target.value))} /></div>
            <button type="button" className="ts-text-button" onClick={resetConfig} disabled={busy}>Reset to defaults</button>
        </div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><ListOrdered size={16} aria-hidden="true" /> Number {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Select PDFs to number" detail={`Multi-file OK · same settings applied to all · max ${MAX_FILE_SIZE_LABEL} each`}
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Numbering the pages" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
