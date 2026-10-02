/**
 * CompressUI — shrink one or many PDFs.
 * File canvas with purpose-based settings and a before/after result receipt.
 * Multi-file via useMultiFileProcessor — same level applied to every PDF, with
 * per-file before/after sizes read off each response's X-Compressed-Size header.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Download, Minimize2, Sparkles } from "lucide-react";
import { formatFileSize, MAX_FILE_SIZE_LABEL, buildOutputFilename } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { loadSamplePdf } from "@/lib/sample-files";
import { emitToolSuccess } from "@/hooks/useFirstSuccess";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { ResultHandoff } from "./ResultHandoff";
import { useMultiFileProcessor, type FileEntry } from "@/hooks/useMultiFileProcessor";
import { FileIntake, StudioActions, StudioLayout, StudioProgress, StudioResult, StudioFile } from "@/skins/experience/ToolStudio";
import { failureDetail, studioOutcome } from "@/skins/experience/studio-outcome";

type Level =
    | "light" | "recommended" | "extreme" | "custom"
    // Purpose-named profiles: you know you are emailing something, and
    // shouldn't have to translate that into a quality percentage.
    | "email" | "print" | "archive" | "web"
    // Client-side only — sends level=custom plus target_size_mb.
    | "target";

const levels: { id: Level; label: string; desc: string; saving: string; intensity: number }[] = [
    { id: "light",       label: "Light",       desc: "Minimal quality loss",                              saving: "~20% smaller", intensity: 25 },
    { id: "recommended", label: "Recommended", desc: "Balanced quality & size",                           saving: "~50% smaller", intensity: 55 },
    { id: "extreme",     label: "Extreme",     desc: "Maximum compression",                               saving: "~75% smaller", intensity: 85 },
    { id: "custom",      label: "Custom",      desc: "Set JPEG quality + max image dimension yourself", saving: "Tunable",      intensity: 65 },
    { id: "email",       label: "Email",       desc: "Small enough for a 10 MB attachment limit",       saving: "~70% smaller", intensity: 78 },
    { id: "print",       label: "Print",       desc: "300 DPI equivalent, minimal quality loss",        saving: "~15% smaller", intensity: 18 },
    { id: "archive",     label: "Archive",     desc: "Long-term storage, quality preserved",            saving: "~30% smaller", intensity: 35 },
    { id: "web",         label: "Web",         desc: "Fast to load in a browser",                       saving: "~55% smaller", intensity: 60 },
    { id: "target",      label: "Target size", desc: "Compress until it fits a size you choose",        saving: "You decide",   intensity: 70 },
];

// Map level → expected fraction saved (rough; tuned to match server behavior)
const SAVINGS_BY_LEVEL: Record<Exclude<Level, "custom" | "target">, number> = {
    light: 0.20,
    recommended: 0.50,
    extreme: 0.75,
    email: 0.70,
    print: 0.15,
    archive: 0.30,
    web: 0.55,
};

const COMPRESS_DEFAULTS = {
    level: "recommended" as Level,
    customQuality: 75,
    customMaxDim: 1800,
    targetMb: 10,
};

/** Per-file compressed size: the X-Compressed-Size response header when the
 *  server sent one, otherwise the result blob's own size. */
function compressedBytesOf(e: FileEntry): number {
    return parseInt(e.headers?.["x-compressed-size"] || "0") || e.blob?.size || 0;
}

export function CompressUI() {
    const proc = useMultiFileProcessor();
    // Form config persists across refreshes (file picks intentionally don't).
    const [config, setConfig, { restored, reset: resetConfig }] = useToolDefaults("compress-pdf", COMPRESS_DEFAULTS, { legacyKey: "compress" });
    const { level, customQuality, customMaxDim, targetMb } = config;
    const setLevel = (v: Level) => setConfig(c => ({ ...c, level: v }));
    const setTargetMb = (v: number) => setConfig(c => ({ ...c, targetMb: v }));
    const setCustomQuality = (v: number) => setConfig(c => ({ ...c, customQuality: v }));
    const setCustomMaxDim = (v: number) => setConfig(c => ({ ...c, customMaxDim: v }));
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    // Show "Restored previous settings" toast once on mount if we loaded non-default values.
    useEffect(() => {
        if (restored) {
            toast.message("Restored previous settings", {
                description: "Picked up where you left off.",
                duration: 3000,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Load the bundled sample PDF and pre-fill the dropzone. Used by the
     *  "Try with a sample file" button and by the FirstRunWelcome handoff. */
    const [loadingSample, setLoadingSample] = useState(false);
    const trySample = useCallback(async () => {
        if (loadingSample) return;
        setLoadingSample(true);
        try {
            const file = await loadSamplePdf();
            proc.addFiles([file], isPdfOnly);
            toast.message("Sample PDF loaded", { description: "1-page demo — process it like any of your own files.", duration: 2400 });
        } catch (e) {
            console.error(e);
            toast.error("Couldn't load the sample PDF.");
        } finally {
            setLoadingSample(false);
        }
    }, [loadingSample, proc]);

    useEffect(() => {
        let cancelled = false;
        // Defer claiming until the effect survives StrictMode's setup replay.
        queueMicrotask(() => {
            if (cancelled) return;
            void consumeFileHandoffs("compress-pdf").then(files => {
                // addFiles names any file that isn't a PDF and the tool that takes it.
                if (!cancelled && files.length) proc.addFiles(files, isPdfOnly);
            });
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proc.addFiles]);

    const totalBytes = proc.entries.reduce((s, e) => s + e.size, 0);
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Live estimated output size (front-end heuristic, server may differ)
    const estimatedSavingFraction = level === "target" ? 0.5 : level === "custom"
        // Linear: q=15→0.85 saved, q=95→0.10 saved
        ? Math.max(0.1, Math.min(0.85, 1 - (customQuality / 100) * 0.95))
        : SAVINGS_BY_LEVEL[level];
    const estimatedOutputBytes = Math.max(1024, Math.round(totalBytes * (1 - estimatedSavingFraction)));

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        const params: Record<string, string | number> = { level };
        if (level === "custom") {
            params.jpeg_quality = customQuality;
            params.max_image_dim = customMaxDim;
        }
        if (level === "target") {
            // The server searches for the lightest setting that fits, so it
            // takes the target rather than a quality figure.
            params.level = "custom";
            params.target_size_mb = targetMb;
        }
        setPhase("processing");
        await proc.run({
            endpoint: "/compress",
            outputSuffix: "compressed",
            outputExt: "pdf",
            params,
        }, retry);
        setPhase("done");
    }, [proc, level, customQuality, customMaxDim, targetMb]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            emitToolSuccess("Compress PDF");
            proc.downloadAll("archive_compressed");
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

    if (phase === "done") {
        const doneEntries = proc.entries.filter(entry => entry.status === "done");
        const failedCount = proc.entries.filter(entry => entry.status === "failed").length;
        const tone = studioOutcome(doneEntries.length, failedCount);
        const originalTotal = doneEntries.reduce((sum, entry) => sum + entry.size, 0);
        const outputTotal = doneEntries.reduce((sum, entry) => sum + compressedBytesOf(entry), 0);
        const saving = originalTotal ? Math.max(0, Math.round((1 - outputTotal / originalTotal) * 100)) : 0;
        const singleDone = doneEntries.length === 1 && proc.entries.length === 1 ? doneEntries[0] : null;
        const several = proc.entries.length > 1;
        const startOver = (files?: File[]) => {
            proc.reset(); downloadedRef.current = false;
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setPhase("idle");
        };
        const title = tone === "failure" ? several ? "None of these PDFs could be compressed." : "This PDF couldn’t be compressed."
            : tone === "partial" ? `${doneEntries.length} of ${proc.entries.length} PDFs compressed.`
            : saving > 0 ? `A little lighter. ${saving}% smaller.` : "Your PDF is ready.";
        const receipt = `${formatFileSize(originalTotal)} became ${formatFileSize(outputTotal)}${tone === "partial" && saving > 0 ? ` (${saving}% smaller)` : ""}. The download has started.`;
        const detail = tone === "failure" ? failureDetail(failedCount, proc.retryableCount)
            : tone === "partial" ? `${receipt} ${failedCount === 1 ? "One file" : `${failedCount} files`} couldn’t be compressed; the reason is below.` : receipt;
        return <StudioResult tone={tone} title={title} detail={detail}>
            {tone !== "failure" && <div className="ts-compression-receipt"><div><span>Before</span><strong>{formatFileSize(originalTotal)}</strong></div><span>→</span><div><span>After</span><strong>{formatFileSize(outputTotal)}</strong></div></div>}
            {proc.entries.map(entry => <StudioFile key={entry.id} name={entry.outName || entry.name} status={entry.status === "failed" ? "error" : entry.status}
                detail={entry.status === "done" ? `${formatFileSize(entry.size)} → ${formatFileSize(compressedBytesOf(entry))}${entry.headers?.["x-target-met"] === "false" ? " · Target could not be reached; smallest result provided" : ""}` : entry.error || "Could not process this file"} />)}
            <StudioActions tone={tone} retryCount={proc.retryableCount} onRetry={() => { downloadedRef.current = false; void process("transient"); }}
                choose={{ accepts: ".pdf", multiple: true, label: several ? "Choose different files" : "Choose a different file", onFiles: startOver }}
                primary={<button className="ts-primary-button" onClick={() => proc.downloadAll("archive_compressed")}><Download size={16} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}</button>}
                more={tone !== "failure" && <button className="ts-text-button" onClick={() => startOver()}>Compress more</button>} />
            {singleDone && <ResultHandoff blob={singleDone.blob ?? null} filename={singleDone.outName || buildOutputFilename(singleDone.name, "compressed", "pdf")} fromSlug="compress-pdf" />}
        </StudioResult>;
    }
    return <StudioLayout className="ts-compress-studio" options={<>
        <div className="ts-compression-levels"><p className="ts-eyebrow">Keep the good parts</p><h3>How small?</h3><div className="ts-choices">{levels.slice(0, 3).map(item => <button type="button" className="ts-choice" key={item.id} onClick={() => setLevel(item.id)} aria-pressed={level === item.id} disabled={phase === "processing"}><strong>{item.label}</strong><span>{item.desc}</span></button>)}</div></div>
        <div className="ts-setting"><label htmlFor="compression-purpose">Or choose for a purpose</label><select id="compression-purpose" disabled={phase === "processing"} value={["light", "recommended", "extreme"].includes(level) ? "" : level} onChange={event => { if (event.target.value) setLevel(event.target.value as Level); }}><option value="">Everyday compression</option>{levels.slice(3).map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select>
            {level === "custom" && <><label htmlFor="jpeg-q">JPEG quality · {customQuality}</label><input id="jpeg-q" type="range" min={15} max={95} step={1} disabled={phase === "processing"} value={customQuality} onChange={event => setCustomQuality(parseInt(event.target.value, 10))} /><label htmlFor="max-dim">Max image dimension (px) · {customMaxDim}</label><input id="max-dim" type="range" min={300} max={4000} step={100} disabled={phase === "processing"} value={customMaxDim} onChange={event => setCustomMaxDim(parseInt(event.target.value, 10))} /></>}
            {level === "target" && <><label htmlFor="target-mb">Target size (MB)</label><input id="target-mb" type="number" min={0.1} max={500} step={0.5} value={targetMb} disabled={phase === "processing"} onChange={event => setTargetMb(Math.max(0.1, Math.min(500, parseFloat(event.target.value) || 10)))} /><p>We return the lightest setting that fits. If the target is out of reach, you get the smallest version we can make.</p></>}
        </div>
        <div><p className="ts-caption">{totalBytes > 0 ? `Rough estimate: ${formatFileSize(totalBytes)} → ${formatFileSize(estimatedOutputBytes)}. Actual savings depend on the PDF.` : "Text stays readable. Image-heavy PDFs usually have the most room to shrink."}</p><div className="ts-actions"><button className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Minimize2 size={16} /> Compress {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</button><button className="ts-text-button" onClick={resetConfig} disabled={phase === "processing"}>Reset to defaults</button></div></div>
    </>}>
        <FileIntake accepts=".pdf" multiple label="Upload files" title="Make a little more room." detail={`Choose PDFs to compress · Up to ${MAX_FILE_SIZE_LABEL} each`} compact={proc.entries.length > 0} disabled={phase === "processing"} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        {proc.entries.length === 0 && <button type="button" className="ts-text-button" onClick={trySample} disabled={loadingSample}><Sparkles size={15} /> {loadingSample ? "Loading sample…" : "Try with a sample PDF"}</button>}
        {proc.entries.length > 0 && <section aria-label="Selected PDFs">{proc.entries.map(entry => <StudioFile key={entry.id} name={entry.name} detail={entry.error || formatFileSize(entry.size)} status={entry.status === "failed" ? "error" : entry.status} onRemove={phase !== "processing" ? () => proc.removeFile(entry.id) : undefined} />)}</section>}
        {phase === "processing" && <StudioProgress label="Making space for your PDF" detail={`${proc.doneCount} of ${proc.entries.length} files completed. Your originals stay unchanged.`} />}
    </StudioLayout>;
}
