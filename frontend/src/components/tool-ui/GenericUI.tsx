/**
 * GenericUI — the default tool surface used by ~80 tools.
 *
 * Shared file canvas, contextual controls, and a downloadable result receipt.
 *
 * Multi-file: every tool this surface backs is a per-file transform (the
 * batch page has always run them that way), so the queue accepts many files
 * and processes them sequentially — one upload in flight at a time, per-file
 * results, and a client-side ZIP for "download all". One file behaves
 * exactly as it always has, auto-download included.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Download, ArrowRight, Archive } from "lucide-react";
import { zipSync } from "fflate";
import { friendlyError } from "@/lib/utils";
import {
    buildOutputFilename,
    chooseDownloadFilename,
    downloadBlob,
    formatErrorForClipboard,
    formatFileSize,
    isAbortError,
    MAX_FILE_SIZE,
    MAX_FILE_SIZE_LABEL,
    uploadFileWithProgress,
    type ProgressCallback,
} from "@/lib/api";
import { getFilenameFromContentDisposition, getToolEndpoint, plannedNameForAnswer } from "@/lib/tool-endpoints";
import { getFileSizeWarning, estimateTime } from "@/hooks/useUxHelpers";
import { useElapsed } from "@/hooks/useElapsed";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { emitToolRun, runOutcome } from "@/lib/toolRun";
import { ResultHandoff } from "./ResultHandoff";
import { ConversionPath, FileIntake, LocalFilePreview, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { fileFormatLabel } from "../../skins/experience/file-format-label";

const MAX_QUEUE = 25;

interface GenericUIProps {
    toolName: string;
    outputLabel: string;
    accepts: string;
    actionLabel?: string;
    slug: string;
    apiEndpoint?: string;
    params?: Record<string, string | number | boolean>;
}

type ItemStatus = "queued" | "processing" | "done" | "error";
interface QueueItem {
    id: string;
    name: string;
    size: string;
    bytes: number;
    file: File;
    status: ItemStatus;
    blob?: Blob | null;
    outName?: string;
    errMsg?: string;
}

export function GenericUI({
    toolName, outputLabel, accepts, actionLabel, slug, apiEndpoint, params,
}: GenericUIProps) {
    const [files, setFiles] = useState<QueueItem[]>([]);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [lastError, setLastError] = useState<unknown>(null);
    const [progress, setProgress] = useState<number | undefined>(undefined);
    const [progressLabel, setProgressLabel] = useState("Processing...");
    const [currentName, setCurrentName] = useState<string>("");
    const abortRef = useRef<AbortController | null>(null);
    const stopRef = useRef(false);
    const elapsed = useElapsed(state === "processing");

    const acceptsLabel = accepts && accepts !== "*" ? accepts.split(",").map(v => v.trim()).filter(Boolean).join(", ") : "Any file";

    const plannedOutputName = useCallback((inputName: string) => {
        const outDot = outputLabel.lastIndexOf(".");
        const labelStem = outDot > 0 ? outputLabel.substring(0, outDot) : "";
        const ext = outDot > 0 ? outputLabel.substring(outDot + 1) : "pdf";
        const GENERIC_TYPES = new Set([
            "image", "audio", "video", "document", "converted",
            "output", "result", "file",
        ]);
        const suffix = labelStem && !GENERIC_TYPES.has(labelStem.toLowerCase()) ? labelStem : null;
        return buildOutputFilename(inputName, suffix, ext);
    }, [outputLabel]);

    const addFiles = useCallback((incoming: File[]) => {
        setError(null);
        setLastError(null);
        setFiles(prev => {
            const next = [...prev];
            const omissions: string[] = [];
            let overflow = 0;
            for (const f of incoming) {
                if (next.length >= MAX_QUEUE) {
                    overflow++;
                    continue;
                }
                if (f.size > MAX_FILE_SIZE) {
                    omissions.push(`"${f.name}" was not added: ${formatFileSize(f.size)} exceeds the ${MAX_FILE_SIZE_LABEL} maximum.`);
                    continue;
                }
                // Equal names and sizes do not mean equal content. Every
                // selected file remains a distinct queue entry.
                next.push({
                    id: Math.random().toString(36).slice(2),
                    name: f.name,
                    size: formatFileSize(f.size),
                    bytes: f.size,
                    file: f,
                    status: "queued",
                });
            }
            if (overflow) omissions.push(`${overflow} file${overflow === 1 ? " was" : "s were"} not added because the queue holds ${MAX_QUEUE} files. Process or remove files, then add the remaining selection.`);
            if (omissions.length) setError(omissions.join(" "));
            return next;
        });
        setState("idle");
    }, []);

    const add = useCallback((fl: FileList | File[]) => {
        const selected = Array.from(fl);
        if (selected.length) addFiles(selected);
    }, [addFiles]);

    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            void consumeFileHandoffs(slug).then(files => {
                if (!cancelled && files.length) addFiles(files);
            });
        });
        return () => { cancelled = true; };
    }, [slug, addFiles]);

    const biggest = files.reduce((m, f) => Math.max(m, f.bytes), 0);
    const sizeWarning = files.length > 0 ? getFileSizeWarning(biggest) : null;
    const timeEstimate = files.length > 0 ? estimateTime(biggest) : null;
    const queued = files.filter(f => f.status === "queued" || f.status === "error");
    const doneItems = files.filter(f => f.status === "done" && f.blob);
    const canProcess = queued.length > 0 && state !== "processing";

    const processRef = useRef<() => void>();
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                processRef.current?.();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const onProgress = useCallback<ProgressCallback>((phase, pct) => {
        if (phase === "upload") {
            setProgress(pct < 100 ? pct : undefined);
            setProgressLabel(pct < 100 ? "Uploading file" : "Processing your file");
        } else {
            setProgress(pct);
            setProgressLabel("Preparing download");
        }
    }, []);

    const setItem = (id: string, patch: Partial<QueueItem>) =>
        setFiles(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)));

    const process = useCallback(async () => {
        const run = files.filter(f => f.status === "queued" || f.status === "error");
        if (!run.length) return;
        const single = files.length === 1;
        stopRef.current = false;
        setState("processing");
        setError(null);
        setLastError(null);
        const endpoint = apiEndpoint || getToolEndpoint(slug);
        let firstFailure: unknown = null;
        let done = 0, failed = 0;
        for (let i = 0; i < run.length; i++) {
            if (stopRef.current) break;
            const item = run[i];
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setItem(item.id, { status: "processing", errMsg: undefined });
            setCurrentName(run.length > 1 ? `File ${i + 1} of ${run.length} — ${item.name}` : item.name);
            setProgress(undefined);
            setProgressLabel("Starting...");
            try {
                const res = await uploadFileWithProgress(endpoint, item.file, params, onProgress, controller.signal);
                setProgressLabel("Reading result");
                setProgress(96);
                const blob = await res.blob();
                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const outName = chooseDownloadFilename(
                    plannedNameForAnswer(plannedOutputName(item.name), res.headers.get("Content-Type")),
                    getFilenameFromContentDisposition(res.headers.get("Content-Disposition")),
                );
                setItem(item.id, { status: "done", blob, outName });
                done++;
                if (single) downloadBlob(blob, outName);
            } catch (e: unknown) {
                if (isAbortError(e)) {
                    setItem(item.id, { status: "queued" });
                    stopRef.current = true;
                    break;
                }
                const msg = e instanceof Error ? e.message : "Processing failed";
                setItem(item.id, { status: "error", errMsg: friendlyError(msg, "Processing failed") });
                failed++;
                if (!firstFailure) firstFailure = e;
            } finally {
                if (abortRef.current === controller) abortRef.current = null;
            }
        }
        setProgress(undefined);
        setProgressLabel("Processing...");
        setCurrentName("");
        const outcome = runOutcome(done, failed);
        if (outcome) emitToolRun({ mode: "single", outcome, files: done + failed }, firstFailure);
        if (stopRef.current) {
            setState("idle");
            return;
        }
        if (firstFailure && single) {
            const msg = firstFailure instanceof Error ? firstFailure.message : "Processing failed";
            setError(friendlyError(msg, "Processing failed"));
            setLastError(firstFailure);
            setState("idle");
            return;
        }
        setLastError(firstFailure);
        setState("done");
    }, [files, apiEndpoint, slug, params, onProgress, plannedOutputName]);
    processRef.current = process;

    const downloadAllZip = useCallback(async () => {
        const entries: Record<string, Uint8Array> = {};
        const used = new Set<string>();
        for (const item of doneItems) {
            let name = item.outName || plannedOutputName(item.name);
            if (used.has(name)) {
                const dot = name.lastIndexOf(".");
                let n = 2;
                const stem = dot > 0 ? name.slice(0, dot) : name;
                const ext = dot > 0 ? name.slice(dot) : "";
                while (used.has(`${stem} (${n})${ext}`)) n++;
                name = `${stem} (${n})${ext}`;
            }
            used.add(name);
            entries[name] = new Uint8Array(await item.blob!.arrayBuffer());
        }
        const zipped = zipSync(entries, { level: 0 });
        // Uint8Array views are BlobPart-compatible; copy to a plain buffer for TS.
        downloadBlob(new Blob([zipped.slice().buffer], { type: "application/zip" }), `${slug}-results.zip`);
    }, [doneItems, plannedOutputName, slug]);

    const handleDownloadOne = (item: QueueItem) => { if (item.blob) downloadBlob(item.blob, item.outName || plannedOutputName(item.name)); };
    const cancelProcessing = () => { stopRef.current = true; abortRef.current?.abort(); };
    const clearFile = () => {
        setFiles([]);
        setError(null);
        setLastError(null);
        setState("idle");
        setProgress(undefined);
        setProgressLabel("Processing...");
    };
    const removeOne = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

    const single = files.length === 1;
    const okCount = doneItems.length;
    const failCount = files.filter(f => f.status === "error").length;
    if (state === "done") {
        const singleItem = single ? files[0] : null;
        return <StudioResult title={single ? "Your file is ready." : `${okCount} files, ready to go.`}
            detail={single ? singleItem?.outName : failCount ? `${failCount} files need another try. Your completed files are ready below.` : "Download your results individually or bring them together in one ZIP."}>
            {files.map(item => <StudioFile key={item.id} name={item.outName || item.name}
                detail={item.errMsg || (item.blob ? formatFileSize(item.blob.size) : item.size)} status={item.status}
                onDownload={item.blob ? () => handleDownloadOne(item) : undefined} />)}
            <div className="ts-actions">
                {single ? <button className="ts-primary-button" onClick={() => singleItem && handleDownloadOne(singleItem)}><Download size={17} /> Download again</button>
                    : okCount > 1 ? <button className="ts-primary-button" onClick={downloadAllZip}><Archive size={17} /> Download all ({okCount}) as .zip</button> : null}
                {failCount > 0 && <button className="ts-secondary-button" onClick={process}>Retry {failCount} failed</button>}
                <button className="ts-text-button" onClick={clearFile}>Process another <ArrowRight size={16} /></button>
            </div>
            {singleItem?.blob && <LocalFilePreview file={singleItem.blob} name={singleItem.outName || plannedOutputName(singleItem.name)} label="Result preview" />}
            {single && <ResultHandoff blob={singleItem?.blob ?? null} filename={singleItem?.outName || plannedOutputName(singleItem?.name || "")} fromSlug={slug} />}
        </StudioResult>;
    }
    return <StudioLayout options={<>
        <ConversionPath accepts={accepts} output={outputLabel} />
        <div><p className="ts-eyebrow">Conversion details</p><h3>Your output</h3><dl><div><dt>Format</dt><dd>{outputLabel}</dd></div><div><dt>Selected</dt><dd>{files.length ? `${files.length} file${single ? "" : "s"} · ${formatFileSize(files.reduce((n, f) => n + f.bytes, 0))}` : "Choose one or several files"}</dd></div></dl></div>
        <div><p>Each file is processed separately. Your original files stay as they are.</p>{timeEstimate && <p className="ts-caption">Usually {timeEstimate} per file.</p>}</div>
        <div className="ts-actions"><button className="ts-primary-button" onClick={process} disabled={!canProcess}>{actionLabel || toolName}{queued.length > 1 ? ` — ${queued.length} files` : ""}<ArrowRight size={16} /></button>{files.length > 0 && state !== "processing" && <button className="ts-text-button" onClick={clearFile}>Clear selection</button>}</div>
    </>}>
        <FileIntake accepts={accepts} multiple label={`Upload files for ${toolName}`} title={`Choose ${fileFormatLabel(accepts)} ${fileFormatLabel(accepts) === "FILE" ? "files" : "files to process"}`} detail={`${acceptsLabel} · Up to ${MAX_QUEUE} files, ${MAX_FILE_SIZE_LABEL} each`}
            onFiles={addFiles} compact={files.length > 0} disabled={state === "processing"} />
        {files[0] && <LocalFilePreview file={files[0].file} name={files[0].name} label="Original · on your device" />}
        {files.length > 0 && <section aria-label="Selected files">{files.map(item => <StudioFile key={item.id} name={item.name} detail={item.errMsg || item.size} status={item.status}
            onRemove={state !== "processing" ? () => removeOne(item.id) : undefined} onDownload={item.blob ? () => handleDownloadOne(item) : undefined} />)}</section>}
        {state === "processing" && <StudioProgress label={progressLabel} detail={`${currentName} · ${elapsed}`} progress={progress} onCancel={cancelProcessing} />}
        {sizeWarning && <p className="ts-caption">{sizeWarning}</p>}
        {error && <div className="ts-error" role="alert">{error}{lastError != null && <button className="ts-text-button" onClick={() => navigator.clipboard.writeText(formatErrorForClipboard(lastError, toolName)).catch(() => {})}>Copy error details</button>}</div>}
    </StudioLayout>;
}
