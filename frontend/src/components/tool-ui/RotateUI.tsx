/**
 * RotateUI — rotate PDF pages by 90°/180°/270° across one or many PDFs.
 * Multi-file via useMultiFileProcessor.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Download, RotateCw } from "lucide-react";
import { isValidPageRange, pageRangeError } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL, formatFileSize } from "@/lib/api";
import { FileIntake, StudioActions, StudioLayout, StudioProgress, StudioResult, StudioFile } from "@/skins/experience/ToolStudio";
import { failureDetail, studioOutcome } from "@/skins/experience/studio-outcome";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type Angle = 90 | 180 | 270;

const angles: { value: Angle; label: string; desc: string; preview: string }[] = [
    { value: 90,  label: "90° right",  desc: "Clockwise",          preview: "↻" },
    { value: 180, label: "180°",        desc: "Upside down",         preview: "↕" },
    { value: 270, label: "90° left",   desc: "Counter-clockwise",   preview: "↺" },
];

const ROTATE_DEFAULTS: { angle: Angle } = {
    angle: 90,
};

export function RotateUI() {
    const [config, , { setField }] = useToolDefaults("rotate-pdf", ROTATE_DEFAULTS);
    const { angle } = config;
    const setAngle = useCallback((v: React.SetStateAction<typeof ROTATE_DEFAULTS["angle"]>) => setField("angle", v), [setField]);
    const proc = useMultiFileProcessor();

    const [pages, setPages] = useState("all");
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [returning, setReturning] = useState(false);

    const rangeOk = pages === "all" || (pages.trim().length > 0 && isValidPageRange(pages));
    const canProcess = proc.entries.length > 0 && rangeOk && phase !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/rotate",
            outputSuffix: "rotated",
            outputExt: "pdf",
            params: { angle, pages: pages.trim() || "all" },
        }, retry);
        setPhase("done");
    }, [proc, angle, pages]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_rotated");
        }
    }, [phase, proc]);

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

    const rangeErr = pages !== "all" ? pageRangeError(pages) : null;

    if (phase === "done") {
        const tone = studioOutcome(proc.doneCount, proc.failedCount);
        const several = proc.entries.length > 1;
        const startOver = (files?: File[]) => {
            proc.reset(); downloadedRef.current = false;
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setPhase("idle");
        };
        return <StudioResult tone={tone}
            title={tone === "failure" ? several ? "None of these PDFs could be rotated." : "This PDF couldn’t be rotated."
                : tone === "partial" ? `${proc.doneCount} of ${proc.entries.length} PDFs rotated.` : `${proc.doneCount} PDF${proc.doneCount === 1 ? "" : "s"}, a fresh perspective.`}
            detail={tone === "failure" ? failureDetail(proc.failedCount, proc.retryableCount)
                : `Pages rotated ${angle}°. Your original documents are unchanged.${tone === "partial" ? ` ${proc.failedCount === 1 ? "One file" : `${proc.failedCount} files`} couldn’t be rotated; the reason is below.` : ""}`}>
            {proc.entries.map(entry => <StudioFile key={entry.id} name={entry.outName || entry.name} detail={entry.error || `${angle}° · ${entry.blob ? formatFileSize(entry.blob.size) : formatFileSize(entry.size)}`} status={entry.status === "failed" ? "error" : entry.status} />)}
            <StudioActions tone={tone} retryCount={proc.retryableCount} onRetry={() => { downloadedRef.current = false; void process("transient"); }}
                choose={{ accepts: ".pdf", multiple: true, label: several ? "Choose different files" : "Choose a different file", onFiles: startOver }}
                primary={<button className="ts-primary-button" onClick={() => proc.downloadAll("archive_rotated")}><Download size={16} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}</button>}
                more={tone !== "failure" && <button className="ts-text-button" onClick={() => startOver()}>Rotate more</button>} />
        </StudioResult>;
    }
    return <StudioLayout options={<>
        <div><p className="ts-eyebrow">Point it in the right direction</p><h3>Rotation</h3><div className="ts-choices">{angles.map(item => <button className="ts-choice" key={item.value} disabled={phase === "processing"} aria-pressed={angle === item.value} onClick={() => setAngle(item.value)}><strong>{item.label}</strong><span>{item.desc}</span></button>)}</div></div>
        <div className="ts-setting"><label htmlFor="rotate-pages">Apply to pages</label><div className="ts-mode-switch"><button onClick={() => setPages("all")} disabled={phase === "processing"} aria-pressed={pages === "all"}>All pages</button><button onClick={() => { if (pages === "all") setPages(""); }} disabled={phase === "processing"} aria-pressed={pages !== "all"}>Specific pages</button></div>{pages !== "all" && <><input id="rotate-pages" value={pages} placeholder="1,3,5-8" disabled={phase === "processing"} aria-invalid={!rangeOk} onChange={event => setPages(event.target.value)} />{rangeErr && <p className="ts-error">{rangeErr}</p>}</>}</div>
        <div className="ts-actions"><button className="ts-primary-button" onClick={() => process(false)} disabled={!canProcess}><RotateCw size={16} /> Rotate {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"} {angle}°</button></div>
    </>}>
        <FileIntake accepts=".pdf" multiple label="Upload files" title="A better way to look at it." detail={`Choose PDFs to rotate · Max ${MAX_FILE_SIZE_LABEL} each`} disabled={phase === "processing"} compact={proc.entries.length > 0} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        {proc.entries.length > 0 && <section aria-label="Selected PDFs">{proc.entries.map(entry => <StudioFile key={entry.id} name={entry.name} detail={entry.error || formatFileSize(entry.size)} status={entry.status === "failed" ? "error" : entry.status} onRemove={phase !== "processing" ? () => proc.removeFile(entry.id) : undefined} />)}</section>}
        {phase === "processing" && <StudioProgress label="Turning things around" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
