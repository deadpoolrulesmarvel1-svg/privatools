/**
 * MultiFileUI — multi-file uploader with reorder + remove.
 * An ordered collection with shared canvas, controls, and result presentations.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { uploadFilesWithProgress, downloadBlob, chooseDownloadFilename, isAbortError, formatFileSize, buildOutputFilename } from "@/lib/api";
import { getFilenameFromContentDisposition } from "@/lib/tool-endpoints";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { emitToolRun } from "@/lib/toolRun";
import { FileIntake, LocalFilePreview, StudioActionBar, StudioLayout, StudioFile, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { fileCount } from "@/skins/experience/file-format-label";

interface Item { id: string; name: string; size: string; file: File }

interface Props {
    endpoint: string;
    /** Public route slug, which can differ from the processing endpoint. */
    handoffSlug?: string;
    accepts: string;
    outputFilename: string;
    fileLabel: string;
    minFiles?: number;
    params?: Record<string, string | number | boolean>;
    ordered?: boolean;
    actionVerb?: string;
    /** What the visitor should know about the result before running it. */
    note?: string;
}

export function MultiFileUI({
    endpoint, handoffSlug, accepts, outputFilename, fileLabel,
    minFiles = 2, params, ordered = true, actionVerb = "Process", note,
}: Props) {
    const [files, setFiles] = useState<Item[]>([]);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);

    const [result, setResult] = useState<{blob: Blob; name: string} | null>(null);
    const [progress, setProgress] = useState<number | undefined>();
    const [progressLabel, setProgressLabel] = useState("Uploading files");
    const request = useRef<AbortController | null>(null);
    useEffect(() => () => request.current?.abort(), []);

    const add = useCallback((fl: FileList | File[]) => {
        setFiles(p => [
            ...p,
            ...Array.from(fl).map(f => ({
                id: Math.random().toString(36).slice(2),
                name: f.name,
                size: formatFileSize(f.size),
                file: f,
            })),
        ]);
        setState("idle");
        setError(null);
    }, []);

    useEffect(() => {
        let cancelled = false;
        // Never infer a public destination from an API endpoint: aliases can
        // share the same endpoint. A mounted caller must name its route.
        if (!handoffSlug) return;
        queueMicrotask(() => {
            if (cancelled) return;
            void consumeFileHandoffs(handoffSlug).then(files => {
                if (!cancelled && files.length) add(files);
            });
        });
        return () => { cancelled = true; };
    }, [handoffSlug, add]);

    const remove = (id: string) => setFiles(p => p.filter(f => f.id !== id));
    const move = (i: number, delta: number) => {
        setFiles(p => {
            const j = i + delta;
            if (j < 0 || j >= p.length) return p;
            const copy = [...p];
            [copy[i], copy[j]] = [copy[j], copy[i]];
            return copy;
        });
    };

    const canProcess = files.length >= minFiles && state !== "processing";

    const process = useCallback(async () => {
        if (files.length < minFiles) {
            setError(`Add at least ${minFiles} ${fileLabel}.`);
            return;
        }
        if (request.current) return;
        const controller = new AbortController();
        request.current = controller;
        setState("processing");
        setProgress(0);
        setError(null);
        try {
            const labelStem = outputFilename.replace(/\.[^.]+$/, "");
            const extMatch = outputFilename.match(/\.([^.]+)$/);
            const ext = extMatch ? extMatch[1] : "zip";
            const GENERIC = /^(archive|output|result|file|compressed-pdfs?|merged-files?|combined-files?)$/i;
            let suffix: string;
            if (actionVerb && actionVerb.toLowerCase() !== "process") {
                suffix = actionVerb.toLowerCase() + (actionVerb.toLowerCase().endsWith("e") ? "d" : "ed");
            } else if (labelStem && !GENERIC.test(labelStem)) {
                suffix = labelStem;
            } else {
                suffix = "combined";
            }
            const outName = buildOutputFilename(files[0]?.file.name, suffix, ext);
            const response = await uploadFilesWithProgress(endpoint, files.map(f => f.file), params, (phase, value) => {
                setProgress(phase === "upload" && value < 100 ? value : undefined);
                setProgressLabel(phase === "upload" && value < 100 ? "Uploading files" : "Preparing your result");
            }, controller.signal);
            const blob = await response.blob();
            if (controller.signal.aborted) return;
            const name = chooseDownloadFilename(outName, getFilenameFromContentDisposition(response.headers.get("content-disposition")));
            setResult({ blob, name });
            downloadBlob(blob, name);
            setState("done");
            emitToolRun({ outcome: "success", files: files.length });
        } catch (e: unknown) {
            if (isAbortError(e)) { setState("idle"); return; }
            const msg = e instanceof Error ? e.message : "Processing failed";
            setError(friendlyError(msg, "Couldn't process those files."));
            setState("idle");
            emitToolRun({ outcome: "error", files: files.length }, e);
        } finally { request.current = null; }
    }, [files, minFiles, fileLabel, outputFilename, actionVerb, endpoint, params]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    const totalSize = files.reduce((s, f) => s + f.file.size, 0);

    if (state === "done") return <StudioResult title="Together in one file." detail="Your download has started. Your original files are unchanged.">
        <StudioFile name={result?.name || outputFilename} detail={`${files.length} source files · ${formatFileSize(result?.blob.size || totalSize)}`} status="done" />
        {result && <LocalFilePreview file={result.blob} name={result.name} label="Combined result" />}
        <div className="ts-actions"><button className="ts-primary-button" onClick={() => result && downloadBlob(result.blob, result.name)}>Download again</button><button className="ts-text-button" onClick={() => { setFiles([]); setResult(null); setState("idle"); }}>Start another</button></div>
    </StudioResult>;
    return <StudioLayout options={<>
        <div><p className="ts-eyebrow">Bring them together</p><h2>Your collection</h2><p>{ordered ? "Put files in the order you want. They become one result." : "Each selected file joins this collection."}</p></div>
        {note && <div><p>{note}</p></div>}
        <div><dl><div><dt>Selected</dt><dd>{files.length} files · {formatFileSize(totalSize)}</dd></div><div><dt>Result</dt><dd>{outputFilename}</dd></div></dl></div>
    </>} action={<StudioActionBar ready={files.length > 0} count={files.length ? fileCount(files.length, fileLabel.replace(/s$/, ""), fileLabel) : undefined}>
        <button className="ts-primary-button" onClick={process} disabled={!canProcess}>{files.length ? `${actionVerb} ${files.length} ${fileLabel}` : `${actionVerb} ${fileLabel}`}</button>
        <p className="ts-action-hint">{files.length < minFiles ? `Add at least ${minFiles} ${fileLabel} to begin.` : "Your files are ready."}</p>
    </StudioActionBar>}>
        <FileIntake accepts={accepts} multiple label={files.length ? "Add more" : `Add ${fileLabel}`} detail="Choose files together, then arrange the collection." compact={files.length > 0} disabled={state === "processing"} onFiles={add} />
        {files.length > 0 && <section aria-label="Selected files">{files.map((file, i) => <div className="ts-ordered-file" key={file.id}><span className="ts-page-number">{i + 1}</span><StudioFile name={file.name} detail={file.size} onRemove={state !== "processing" ? () => remove(file.id) : undefined} />{ordered && <div className="ts-order-controls"><button type="button" className="ts-icon-button" onClick={() => move(i, -1)} disabled={i === 0 || state === "processing"} aria-label="Move up"><ChevronUp size={16} /></button><button type="button" className="ts-icon-button" onClick={() => move(i, 1)} disabled={i === files.length - 1 || state === "processing"} aria-label="Move down"><ChevronDown size={16} /></button></div>}</div>)}</section>}
        {state === "processing" && <StudioProgress label={progressLabel} progress={progress} detail={`${files.length} files · Keep this tab open while we prepare your result.`} onCancel={() => request.current?.abort()} />}
        {error && <div className="ts-error" role="alert">{error}</div>}
    </StudioLayout>;
}
