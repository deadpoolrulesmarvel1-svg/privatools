/** A page-aware merge workspace. Preview locally, then explicitly merge on the server. */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
    FileText, FolderOpen, X, Loader2, CheckCircle2, GripVertical, Plus,
    AlertCircle, AlertTriangle, ChevronUp, ChevronDown, Download, Sparkles, Server,
    ChevronLeft, ChevronRight, Check, SlidersHorizontal, Info, BookmarkPlus, LockKeyhole,
} from "lucide-react";
import { adviseRejection, type RejectionAdvice } from "@/lib/file-acceptance";
import { IntakeNotice, StudioActionBar } from "@/skins/experience/ToolStudio";
import { fileCount } from "@/skins/experience/file-format-label";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { cn, friendlyError } from "@/lib/utils";
import {
    uploadFiles, downloadBlob, formatFileSize, buildOutputFilename, requestSize,
    MAX_FILE_SIZE, MAX_FILES_PER_REQUEST, MAX_REQUEST_SIZE, MAX_REQUEST_SIZE_LABEL, withErrorKind,
} from "@/lib/api";
import { loadSamplePdf } from "@/lib/sample-files";
import { emitToolSuccess } from "@/hooks/useFirstSuccess";
import { useIsMobile } from "@/hooks/use-mobile";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { emitToolRun } from "@/lib/toolRun";
import { ResultHandoff } from "./ResultHandoff";
import { mergePageSelection, mergeOutputFilename, moveMergeFile, toggleMergePage, mergeSourceMap, compactMergePages, saveMergeWorkflow, type MergeSourceMap } from "./merge-model";
import { openMergePreview, type MergePreviewDocument } from "./merge-preview";
import "./merge-workspace.css";

interface MergeFile {
    id: string;
    file: File;
    pages: string;
    document: MergePreviewDocument | null;
    /** "invalid": pdf.js found no PDF in it. "locked": it needs its password.
     *  Both stay listed, with the reason, and are left out of the merge. */
    preview: "loading" | "ready" | "unavailable" | "invalid" | "locked";
    previewNote?: string;
}

const notMergeable = (file: MergeFile) => file.preview === "invalid" || file.preview === "locked";

/** Merge keeps a selection whole, so one file that isn't a PDF holds back the
 *  rest and nothing is dropped silently. The notice names the file and points
 *  to a tool that can turn it into a PDF. */
function selectionRejection(notPdf: File[]): RejectionAdvice | null {
    const advice = adviseRejection(notPdf, { accepts: ".pdf", fromSlug: "merge-pdf", prefer: "convert" });
    if (!advice) return null;
    const others = notPdf.length - 1;
    const headline = `${notPdf[0].name}${others ? ` and ${others} other file${others === 1 ? "" : "s"} aren’t PDFs` : " isn’t a PDF"}, so this selection wasn’t added.`;
    return { ...advice, headline, text: advice.text.replace(advice.headline, headline) };
}

// Previews must not make the existing 100-file / 500 MB merge capability unusable
// on smaller devices. Files outside this local rendering budget still merge.
const MAX_PREVIEW_DOCUMENTS = 8;
const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;

type MergeResult = MergeSourceMap & { blob: Blob; filename: string; sourceCount: number; selectedCount: number | null; excludedCount: number | null };
type Phase = "idle" | "processing" | "done";

export function MergeUI() {
    const [files, setFiles] = useState<MergeFile[]>([]);
    const filesRef = useRef<MergeFile[]>([]);
    const [phase, setPhase] = useState<Phase>("idle");
    const [error, setError] = useState<string | null>(null);
    const [rejection, setRejection] = useState<RejectionAdvice | null>(null);
    const [notice, setNotice] = useState("");
    const [result, setResult] = useState<MergeResult | null>(null);
    const [filename, setFilename] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [loadingSample, setLoadingSample] = useState(false);
    const [processingMessage, setProcessingMessage] = useState("Sending PDFs and waiting for the merged file…");
    const [panelBodyHeight, setPanelBodyHeight] = useState(0);
    const [savedWorkflow, setSavedWorkflow] = useState<string | null>(null);
    const [workflowError, setWorkflowError] = useState<string | null>(null);
    const mobile = useIsMobile();
    const inputRef = useRef<HTMLInputElement>(null);
    const settingsBodyRef = useRef<HTMLDivElement>(null);
    const resultHeading = useRef<HTMLHeadingElement>(null);
    const activeRequest = useRef<AbortController | null>(null);
    const alive = useRef(true);
    const activeFiles = useRef(new Set<string>());
    const openDocuments = useRef(new Map<string, MergePreviewDocument>());
    const previewQueue = useRef(Promise.resolve());
    const handoff = useRef<Promise<File[]> | null>(null);

    useEffect(() => {
        alive.current = true;
        const documents = openDocuments.current;
        return () => {
            alive.current = false;
            activeRequest.current?.abort();
            activeRequest.current = null;
            for (const document of documents.values()) void document.destroy();
            documents.clear();
        };
    }, []);

    const replaceFiles = useCallback((next: MergeFile[]) => {
        filesRef.current = next;
        setFiles(next);
    }, []);

    const invalidateResult = useCallback(() => {
        setResult(null);
        setPhase("idle");
        setError(null);
        setRejection(null);
        setSavedWorkflow(null);
        setWorkflowError(null);
    }, []);

    const add = useCallback((input: FileList | File[]) => {
        if (activeRequest.current) return;
        const incoming = Array.from(input);
        if (!incoming.length) return;
        const notPdf = incoming.filter(file => !file.name.toLowerCase().endsWith(".pdf"));
        if (notPdf.length) {
            setError(null);
            setRejection(selectionRejection(notPdf));
            return;
        }
        setRejection(null);
        const empty = incoming.find(file => file.size === 0);
        if (empty) { setError(`“${empty.name}” is empty. Choose a PDF with content; this selection was not added.`); return; }
        const oversized = incoming.find(file => file.size > MAX_FILE_SIZE);
        if (oversized) { setError(`“${oversized.name}” exceeds 500 MB. Choose a smaller PDF; this selection was not added.`); return; }
        if (filesRef.current.length + incoming.length > MAX_FILES_PER_REQUEST) {
            setError(`You can merge up to ${MAX_FILES_PER_REQUEST} PDFs at a time. Remove some files before adding this selection.`);
            return;
        }
        // Every PDF goes in one request, and a request over 500 MB is refused.
        const combined = [...filesRef.current.map(entry => entry.file), ...incoming];
        if (requestSize(combined) > MAX_REQUEST_SIZE) {
            const total = formatFileSize(combined.reduce((sum, file) => sum + file.size, 0));
            const which = incoming.length === 1 ? `“${incoming[0].name}”` : `these ${incoming.length} PDFs`;
            setError(`You can merge up to ${MAX_REQUEST_SIZE_LABEL} at a time, counting the form the PDFs are sent in. Adding ${which} would make ${total}, so ${incoming.length === 1 ? "it was" : "they were"} not added.`);
            return;
        }
        invalidateResult();
        const entries: MergeFile[] = incoming.map(file => ({
            id: crypto.randomUUID(), file, pages: "", document: null, preview: "loading",
        }));
        for (const entry of entries) activeFiles.current.add(entry.id);
        replaceFiles([...filesRef.current, ...entries]);
        setNotice(`${incoming.length} PDF${incoming.length === 1 ? "" : "s"} added. Files stay on this device until you choose Merge.`);
        // Open files sequentially so a large batch does not start many PDF workers at once.
        for (const entry of entries) {
            previewQueue.current = previewQueue.current.then(async () => {
                if (!alive.current || !activeFiles.current.has(entry.id)) return;
                const previewBytes = filesRef.current.reduce((total, file) => total + (openDocuments.current.has(file.id) ? file.file.size : 0), 0);
                if (openDocuments.current.size >= MAX_PREVIEW_DOCUMENTS || previewBytes + entry.file.size > MAX_PREVIEW_BYTES) {
                    replaceFiles(filesRef.current.map(file => file.id === entry.id ? {
                        ...file, preview: "unavailable", previewNote: "Preview skipped to keep memory use low. This PDF is still included in the merge.",
                    } : file));
                    return;
                }
                try {
                    const document = await openMergePreview(entry.file);
                    if (!alive.current || !activeFiles.current.has(entry.id)) { void document.destroy(); return; }
                    openDocuments.current.set(entry.id, document);
                    replaceFiles(filesRef.current.map(file => file.id === entry.id ? { ...file, document, preview: "ready" } : file));
                } catch (cause) {
                    if (alive.current && activeFiles.current.has(entry.id)) {
                        // pdf.js names what it met. Only a file that is not a PDF at
                        // all, or one locked with a password, is left out; any other
                        // preview failure keeps the file in the merge.
                        const name = (cause as { name?: unknown } | null)?.name;
                        const preview = name === "InvalidPDFException" ? "invalid" : name === "PasswordException" ? "locked" : "unavailable";
                        replaceFiles(filesRef.current.map(file => file.id === entry.id ? { ...file, preview } : file));
                        if (preview === "invalid") setNotice(`${entry.file.name} doesn’t look like a valid PDF, so it won’t be merged.`);
                        if (preview === "locked") setNotice(`${entry.file.name} is locked with a password, so it won’t be merged.`);
                    }
                }
            });
        }
    }, [invalidateResult, replaceFiles]);

    useEffect(() => {
        let cancelled = false;
        // Keep the same promise through StrictMode's effect replay; consumption is one-shot.
        handoff.current ??= consumeFileHandoffs("merge-pdf");
        void handoff.current.then(incoming => { if (!cancelled && incoming.length) add(incoming); });
        return () => { cancelled = true; };
    }, [add]);

    const trySample = useCallback(async () => {
        if (loadingSample || activeRequest.current) return;
        setLoadingSample(true);
        setError(null);
        try {
            const first = await loadSamplePdf();
            const second = new File([await first.arrayBuffer()], "privatools-sample-2.pdf", { type: "application/pdf" });
            if (alive.current) add([first, second]);
        } catch {
            if (alive.current) setError("The sample PDFs could not load. Try again, or choose PDFs from your device.");
        } finally {
            if (alive.current) setLoadingSample(false);
        }
    }, [loadingSample, add]);

    const removeFile = (id: string) => {
        if (activeRequest.current) return;
        invalidateResult();
        const removed = filesRef.current.find(file => file.id === id);
        activeFiles.current.delete(id);
        const document = openDocuments.current.get(id);
        if (document) void document.destroy();
        openDocuments.current.delete(id);
        replaceFiles(filesRef.current.filter(file => file.id !== id));
        setNotice(`${removed?.file.name ?? "PDF"} removed.`);
    };

    const reset = () => {
        activeRequest.current?.abort();
        activeRequest.current = null;
        activeFiles.current.clear();
        for (const document of openDocuments.current.values()) void document.destroy();
        openDocuments.current.clear();
        replaceFiles([]);
        setFilename(null);
        invalidateResult();
        setNotice("Selection cleared. Choose PDFs to start another merge.");
        inputRef.current?.focus();
    };

    const moveFile = (from: number, to: number) => {
        if (activeRequest.current) return;
        const current = filesRef.current;
        const next = moveMergeFile(current, from, to);
        if (next === current) return;
        invalidateResult();
        replaceFiles(next);
        setNotice(`${current[from].file.name} moved to position ${to + 1}.`);
    };

    const updatePages = (id: string, pages: string) => {
        if (activeRequest.current) return;
        invalidateResult();
        replaceFiles(filesRef.current.map(file => file.id === id ? { ...file, pages } : file));
    };

    const selections = useMemo(() => files.map(file => mergePageSelection(file.pages, file.document?.numPages ?? null)), [files]);
    // A file this browser could not open as a PDF, or one locked with a
    // password, stays listed with its reason but is never sent to the merge.
    const mergeable = useMemo(() => files.filter(file => !notMergeable(file)), [files]);
    const mergeableSelections = useMemo(() => mergeable.map(file => mergePageSelection(file.pages, file.document?.numPages ?? null)), [mergeable]);
    const countsKnown = mergeable.length > 0 && mergeable.every(file => file.document) && mergeableSelections.every(selection => selection.pages !== null);
    const selectedCount = countsKnown ? mergeableSelections.reduce((sum, selection) => sum + selection.pages!.length, 0) : null;
    const totalCount = countsKnown ? mergeable.reduce((sum, file) => sum + file.document!.numPages, 0) : null;
    const excludedCount = totalCount !== null && selectedCount !== null ? totalCount - selectedCount : null;
    const previewsLoading = files.some(file => file.preview === "loading");
    const allRangesValid = mergeableSelections.every(selection => !selection.error);
    const busy = phase === "processing";
    const leading = mergeable[0] ?? files[0];
    const fallbackName = leading ? buildOutputFilename(leading.file.name, "merged", "pdf") : "Combined.pdf";
    const outputName = mergeOutputFilename(filename ?? fallbackName, fallbackName);
    const canProcess = mergeable.length >= 2 && allRangesValid && !previewsLoading && !busy && !result;
    const leftOut = files.length - mergeable.length;

    const process = useCallback(async () => {
        if (!canProcess || activeRequest.current) return;
        const controller = new AbortController();
        activeRequest.current = controller;
        setPanelBodyHeight(settingsBodyRef.current?.getBoundingClientRect().height ?? 0);
        setPhase("processing");
        setResult(null);
        setError(null);
        setNotice("");
        setProcessingMessage("Sending PDFs and waiting for the merged file…");
        const snapshot = { filename: outputName, sourceCount: mergeable.length, selectedCount, excludedCount,
            ...mergeSourceMap(mergeable.map(file => ({ filename: file.file.name, total: file.document?.numPages ?? null, range: file.pages }))) };
        try {
            const params = { page_ranges: JSON.stringify(mergeable.map(file => file.pages.trim() || "all")) };
            const response = await uploadFiles("/merge", mergeable.map(file => file.file), params, {
                signal: controller.signal,
                onRetry: (attempt, total) => {
                    if (activeRequest.current === controller) setProcessingMessage(`Connection interrupted. Retrying (${attempt} of ${total})…`);
                },
            });
            if (controller.signal.aborted || activeRequest.current !== controller) return;
            setProcessingMessage("Receiving your merged PDF…");
            const blob = await response.blob();
            if (controller.signal.aborted || activeRequest.current !== controller || !alive.current) return;
            if (!blob.size) throw withErrorKind(new Error("The server returned an empty PDF. Try merging again."), "server");
            setResult({ blob, ...snapshot });
            setPhase("done");
            setNotice("Your merged PDF is ready to download.");
            emitToolRun({ outcome: "success", files: mergeable.length });
        } catch (cause) {
            if (controller.signal.aborted || activeRequest.current !== controller || !alive.current) return;
            setError(friendlyError(cause instanceof Error ? cause.message : "", "Could not merge these PDFs. Try again."));
            setPhase("idle");
            emitToolRun({ outcome: "error", files: mergeable.length }, cause);
        } finally {
            if (activeRequest.current === controller) activeRequest.current = null;
        }
    }, [canProcess, mergeable, outputName, selectedCount, excludedCount]);

    const cancel = () => {
        activeRequest.current?.abort();
        activeRequest.current = null;
        setPhase("idle");
        setResult(null);
        setNotice("Request cancelled. Your selection is ready to edit. Server processing may finish independently.");
    };

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canProcess) {
                event.preventDefault();
                void process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    // Only when nothing else holds focus: never out of a dialog or a field the visitor moved to.
    useEffect(() => { if (phase === "done") focusIfIdle(resultHeading.current); }, [phase]);

    const previewOrder = useMemo(() => mergeable.flatMap((file, index) =>
        (mergeableSelections[index].pages ?? []).map(page => ({ file, page }))), [mergeable, mergeableSelections]);

    // The run action in the shared action bar, with how many PDFs and where they go. Beside the
    // files it sits in the settings card under the full disclosure; on a phone it follows the
    // card, so it can stick to the bottom of the screen.
    const actionBar = !result && files.length > 0 ? <StudioActionBar className="merge-action-bar" ready count={fileCount(mergeable.length, "PDF")}>
        {busy ? <button className="merge-button" type="button" onClick={cancel}>Cancel request</button>
            : <button className="merge-button merge-button--primary" type="button" disabled={!canProcess} onClick={() => void process()}>
                {previewsLoading ? <><Loader2 size={19} className="merge-spinner" />Reading PDFs…</>
                    : mergeable.length < 2 ? "Add one more PDF"
                        : selectedCount !== null ? `Merge ${selectedCount} pages` : `Merge ${mergeable.length} PDFs`}
            </button>}
        {busy ? <p className="ts-action-hint">Cancelling stops this request. A merge already running on the server may still finish.</p>
            : !allRangesValid && <p className="ts-action-hint merge-field-error">Check the highlighted page ranges before merging.</p>}
    </StudioActionBar> : null;

    return (
        <div
            className={cn("merge-workbench", drag && "merge-workbench--drag", result && "merge-workbench--done")}
            onDragOver={event => {
                if (!busy && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDrag(true); }
            }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrag(false); }}
            onDrop={event => {
                if (event.dataTransfer.files.length) { event.preventDefault(); setDrag(false); if (!busy) add(event.dataTransfer.files); }
            }}
        >
            <input
                ref={inputRef} type="file" accept=".pdf,application/pdf" multiple
                className="sr-only" tabIndex={-1} aria-label="Choose PDFs to merge" disabled={busy}
                onChange={event => { if (event.target.files) add(event.target.files); event.target.value = ""; }}
            />
            <p className="sr-only" role="status" aria-live="polite">{notice}</p>
            {error && <div className="merge-error" role="alert"><AlertCircle size={20} /><p>{error}</p></div>}
            <IntakeNotice advice={rejection} onDismiss={() => setRejection(null)} />
            {files.length === 0 ? (
                <div className="merge-empty">
                    <div className="merge-empty-icon"><FileText size={35} strokeWidth={1.6} /><Plus size={20} /></div>
                    <h2>Bring your PDFs together.</h2>
                    <p>Choose two or more PDFs. Preview the pages, arrange your files, and make one document.</p>
                    <button type="button" className="merge-button merge-button--primary" onClick={() => inputRef.current?.click()}>
                        <FolderOpen size={20} aria-hidden="true" /> Choose PDFs
                    </button>
                    <p className="merge-empty-hint">Or drop PDFs here · Up to {MAX_FILES_PER_REQUEST} files, 500 MB in total</p>
                    <button className="merge-text-button" type="button" disabled={loadingSample} onClick={() => void trySample()}>
                        {loadingSample ? <Loader2 size={17} className="merge-spinner" /> : <Sparkles size={17} />}
                        {loadingSample ? "Loading sample PDFs…" : "Try with sample PDFs"}
                    </button>
                    <div className="merge-empty-privacy"><Server size={19} /><p>Preview on this device. Files are sent to PrivaTools for temporary processing only when you choose Merge.</p></div>
                </div>
            ) : (
                <div className="merge-layout">
                    <section className="merge-content" aria-label={result ? "Merged PDF preview" : "PDF files and page order"}>
                        {result ? (
                            <>
                                <div className="merge-result-heading"><CheckCircle2 size={30} /><h2 tabIndex={-1} ref={resultHeading}>Your PDF is ready</h2></div>
                                <p className="merge-lead">{result.selectedCount !== null ? `${result.selectedCount} selected pages, together in one file.` : "Your selected pages, together in one file."}</p>
                                <ResultPreview result={result} />
                                {result.excludedPages.map((source, index) => <p className="merge-notice" key={index}><Info size={17} /><span>Page{source.pages.length === 1 ? "" : "s"} {compactMergePages(source.pages)} of {source.filename} {source.pages.length === 1 ? "was" : "were"} excluded.</span></p>)}
                            </>
                        ) : (
                            <>
                                <div className="merge-section-heading">
                                    <div><h2>Your files</h2><p>{files.length} file{files.length === 1 ? "" : "s"}{leftOut ? ` · ${leftOut} left out` : ""}{selectedCount !== null ? ` · ${selectedCount} of ${totalCount} pages` : ` · ${formatFileSize(mergeable.reduce((sum, file) => sum + file.file.size, 0))}`}</p></div>
                                    <button className="merge-text-button merge-add-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}><Plus size={18} aria-hidden="true" />Add PDFs</button>
                                </div>
                                <p className="merge-help">Move files into order. Select thumbnails or enter page ranges in Merge settings.</p>
                                <ol className="merge-files">
                                    {files.map((file, index) => (
                                        <li key={file.id}
                                            className={cn("merge-file", draggedId === file.id && "merge-file--dragging")}
                                            onDragOver={event => { if (draggedId && !busy) event.preventDefault(); }}
                                            onDrop={event => {
                                                if (!draggedId || busy) return;
                                                event.preventDefault(); event.stopPropagation();
                                                moveFile(files.findIndex(item => item.id === draggedId), index); setDraggedId(null);
                                            }}>
                                            <div className="merge-file-heading">
                                                <span className="merge-drag-handle" draggable={!busy}
                                                    onDragStart={event => { setDraggedId(file.id); event.dataTransfer.setData("text/plain", file.id); event.dataTransfer.effectAllowed = "move"; }}
                                                    onDragEnd={() => setDraggedId(null)} title="Drag to reorder" aria-hidden="true"><GripVertical size={20} /></span>
                                                <div className="merge-file-name"><h3 title={file.file.name}>{file.file.name}</h3><p>{file.document ? `${file.document.numPages} source page${file.document.numPages === 1 ? "" : "s"}` : formatFileSize(file.file.size)}{selections[index].pages ? ` · ${selections[index].pages!.length} selected` : ""}</p></div>
                                                <div className="merge-file-actions">
                                                    <button type="button" disabled={busy || index === 0} className="merge-icon-button" onClick={() => moveFile(index, index - 1)} aria-label={`Move ${file.file.name} up`}><ChevronUp size={18} /></button>
                                                    <button type="button" disabled={busy || index === files.length - 1} className="merge-icon-button" onClick={() => moveFile(index, index + 1)} aria-label={`Move ${file.file.name} down`}><ChevronDown size={18} /></button>
                                                    <button type="button" disabled={busy} className="merge-icon-button" onClick={() => removeFile(file.id)} aria-label={`Remove ${file.file.name}`}><X size={18} /></button>
                                                </div>
                                            </div>
                                            <SourcePages file={file} selected={selections[index].pages} disabled={busy || !!selections[index].error}
                                                onToggle={page => {
                                                    const next = toggleMergePage(file.pages, file.document!.numPages, page);
                                                    if (next === null) { toast.message("Keep at least one page per file", { description: "Use Remove to leave a whole PDF out of the merge." }); return; }
                                                    updatePages(file.id, next);
                                                }} />
                                        </li>
                                    ))}
                                </ol>
                                {countsKnown && previewOrder.length > 0 && <PageOrderPreview pages={previewOrder} />}
                                {notice && <p className="merge-notice merge-selection-notice"><Info size={17} aria-hidden="true" />{notice}</p>}
                            </>
                        )}
                    </section>
                    <aside className="merge-settings" aria-label={result ? "Download merged PDF" : "Merge settings"} aria-busy={busy}>
                        <div ref={settingsBodyRef} className="merge-settings-body" style={{ minHeight: phase === "idle" ? undefined : panelBodyHeight }}>
                            {(!result || !mobile) && <h2>{result ? "Ready to download" : busy ? "Making your PDF" : "Merge settings"}</h2>}
                            {result ? (
                                mobile ? <details className="merge-result-details"><summary>Merge details</summary><ResultSummary result={result} /></details> : <ResultSummary result={result} />
                            ) : busy ? (
                                <div className="merge-processing" role="status" aria-live="polite">
                                    <Loader2 size={30} className="merge-spinner" />
                                    <p>{processingMessage}</p>
                                    <div className="merge-processing-detail"><CheckCircle2 size={18} /><span>{mergeable.length} PDFs selected{selectedCount !== null ? ` · ${selectedCount} pages to include` : ""}</span></div>
                                    <p className="merge-help">Keep this tab open. The server does not report page-by-page progress.</p>
                                </div>
                            ) : (
                                <div className="merge-ranges">
                                    <h3>Pages to include</h3>
                                    <p className="merge-help" id="merge-range-help">Blank includes all pages. Use 1-3,5, end, or 2-end. Pages follow the order you enter.</p>
                                    {files.map((file, index) => !notMergeable(file) && <div className="merge-field" key={file.id}>
                                        <label htmlFor={`merge-pages-${file.id}`}>{file.file.name}</label>
                                        <input id={`merge-pages-${file.id}`} type="text" value={file.pages} placeholder="All pages"
                                            onChange={event => updatePages(file.id, event.target.value)} spellCheck={false} autoComplete="off"
                                            aria-invalid={!!selections[index].error} aria-describedby={`merge-range-help${selections[index].error ? ` merge-range-error-${file.id}` : ""}`} />
                                        {selections[index].error && <p className="merge-field-error" id={`merge-range-error-${file.id}`}>{selections[index].error}</p>}
                                    </div>)}
                                    {excludedCount !== null && excludedCount > 0 && <p className="merge-help">{excludedCount} source page{excludedCount === 1 ? " is" : "s are"} excluded.</p>}
                                </div>
                            )}
                            {!result && <div className="merge-field merge-filename-field">
                                <label htmlFor="merge-output-filename">Output filename</label>
                                <input id="merge-output-filename" type="text" value={filename ?? fallbackName} disabled={busy} maxLength={185}
                                    onChange={event => { invalidateResult(); setFilename(event.target.value); }}
                                    onBlur={() => { if (filename !== null) setFilename(mergeOutputFilename(filename, fallbackName)); }} spellCheck={false} />
                            </div>}
                        </div>
                        <div className="merge-action-area">
                            <div className="merge-processing-location"><Server size={23} /><div>
                                <strong>{result ? "Processed by PrivaTools" : "Processing: temporary server upload"}</strong>
                                <p>{result ? "The result is ready in this browser. Source files and the server result are removed after the response." : "Choosing Merge sends these PDFs to PrivaTools. Server copies are removed after the response."}</p>
                            </div></div>
                            {result && <button className="merge-button merge-button--primary" type="button" onClick={() => { downloadBlob(result.blob, result.filename); emitToolSuccess("Merge PDF"); }}><Download size={20} />Download PDF</button>}
                            {result && <>
                                <button className="merge-button merge-button--quiet" type="button" onClick={() => { invalidateResult(); setNotice("Adjust the pages or order, then merge again to create an updated PDF."); }}><SlidersHorizontal size={18} />Adjust pages</button>
                                <div className="merge-save-workflow">
                                    <button className="merge-text-button" type="button" disabled={!!savedWorkflow} onClick={() => {
                                        try { setSavedWorkflow(saveMergeWorkflow()); setWorkflowError(null); }
                                        catch { setWorkflowError("This browser could not save the workflow. Free some site storage or allow local storage, then try again."); }
                                    }}>{savedWorkflow ? <Check size={18} /> : <BookmarkPlus size={18} />}{savedWorkflow ? "Workflow saved" : "Save workflow"}</button>
                                    <p className="merge-help">Saves the Merge PDF operation on this device. Choose files, page ranges, order, and filename again each time.</p>
                                    {savedWorkflow && <p className="merge-help" role="status">“{savedWorkflow}” is available in <a href="/">your home workspace</a>.</p>}
                                    {workflowError && <p className="merge-field-error" role="alert">{workflowError}</p>}
                                </div>
                                <button className="merge-text-button" type="button" onClick={reset}>Start another merge</button>
                            </>}
                        </div>
                        {/* A child of the card itself, so beside the files it can stick to the bottom of the screen anywhere in the card. */}
                        {!mobile && actionBar}
                        {!result && !busy && <div className="merge-action-extras">
                            <button className="merge-text-button" type="button" onClick={reset}>Clear selection</button>
                            {canProcess && <p className="merge-action-help">Shortcut: Ctrl / ⌘ + Enter</p>}
                        </div>}
                    </aside>
                    {/* On a phone the bar leaves the settings card, so it can stick to the bottom of the screen. */}
                    {mobile && actionBar}
                    {result && <div className="merge-handoff"><ResultHandoff blob={result.blob} filename={result.filename} fromSlug="merge-pdf" /></div>}
                </div>
            )}
        </div>
    );
}

function ResultSummary({ result }: { result: MergeResult }) {
    return <>
        <p className="merge-output-name">{result.filename}</p>
        <dl className="merge-summary">
            <div><dt>Source files</dt><dd>{result.sourceCount}</dd></div>
            {result.selectedCount !== null && <div><dt>Included pages</dt><dd>{result.selectedCount}</dd></div>}
            {result.excludedCount !== null && <div><dt>Excluded pages</dt><dd>{result.excludedCount}</dd></div>}
            <div><dt>File size</dt><dd>{formatFileSize(result.blob.size)}</dd></div>
        </dl>
        <p className="merge-help">Review the pages, then save your PDF.</p>
    </>;
}

function PdfThumbnail({ document, page, label, large = false }: { document: MergePreviewDocument; page: number; label: string; large?: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    useEffect(() => {
        let disposed = false;
        let renderTask: ReturnType<Awaited<ReturnType<MergePreviewDocument["getPage"]>>["render"]> | undefined;
        setStatus("loading");
        void (async () => {
            try {
                const pdfPage = await document.getPage(page);
                if (disposed || !canvasRef.current) return;
                const canvas = canvasRef.current;
                const initial = pdfPage.getViewport({ scale: 1 });
                const target = large ? 750 : 220;
                const viewport = pdfPage.getViewport({ scale: target / Math.max(initial.width, initial.height) });
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                renderTask = pdfPage.render({ canvas, viewport });
                await renderTask.promise;
                if (!disposed) setStatus("ready");
            } catch { if (!disposed) setStatus("error"); }
        })();
        return () => { disposed = true; renderTask?.cancel(); };
    }, [document, page, large]);
    return <span className={cn("merge-page-image", large && "merge-page-image--large")}>
        <canvas ref={canvasRef} role="img" aria-label={label} className={status === "ready" ? "" : "merge-canvas-pending"} />
        {status === "loading" && <span className="merge-page-placeholder" aria-label="Loading page preview"><Loader2 size={20} className="merge-spinner" /></span>}
        {status === "error" && <span className="merge-page-placeholder"><FileText size={25} /><span>Page {page}<br />Preview unavailable</span></span>}
    </span>;
}

function SourcePages({ file, selected, disabled, onToggle }: { file: MergeFile; selected: number[] | null; disabled: boolean; onToggle: (page: number) => void }) {
    const [start, setStart] = useState(0);
    const pageCount = file.document?.numPages ?? 0;
    const pageSize = 2;
    if (file.preview === "loading") return <p className="merge-preview-status"><Loader2 className="merge-spinner" size={18} />Reading pages on this device…</p>;
    if (file.preview === "invalid") return <p className="merge-preview-status merge-preview-status--left-out"><AlertTriangle size={20} aria-hidden="true" /><span><strong>This doesn’t look like a valid PDF.</strong> It won’t be included in the merge. Remove it, or add a PDF that opens.</span></p>;
    if (file.preview === "locked") return <p className="merge-preview-status merge-preview-status--left-out"><LockKeyhole size={20} aria-hidden="true" /><span><strong>This PDF is locked with a password.</strong> It won’t be included in the merge. <a href="/tool/unlock-pdf">Unlock PDF</a> can remove the password first.</span></p>;
    if (!file.document) return <p className="merge-preview-status"><FileText size={20} />{file.previewNote || "This browser can’t show a preview of this PDF. It is still included in the merge."}</p>;
    return <div className="merge-source-pages">
        <div className="merge-source-page-list">
            {Array.from({ length: Math.min(pageSize, pageCount - start) }, (_, offset) => start + offset + 1).map(page => {
                const included = !!selected?.includes(page);
                return <button key={page} type="button" className={cn("merge-page-toggle", !included && "merge-page-toggle--excluded")}
                    disabled={disabled} aria-pressed={included} aria-label={`${included ? "Exclude" : "Include"} page ${page} of ${file.file.name}`}
                    onClick={() => onToggle(page)}>
                    <PdfThumbnail document={file.document!} page={page} label={`Page ${page} of ${file.file.name}`} />
                    <span className="merge-page-caption"><span className="merge-check-box">{included && <Check size={13} />}</span>Page {page}{!included && <span>Excluded</span>}</span>
                </button>;
            })}
        </div>
        {pageCount > pageSize && <div className="merge-page-pager">
            <button className="merge-icon-button" type="button" disabled={start === 0} onClick={() => setStart(value => Math.max(0, value - pageSize))} aria-label={`Previous pages of ${file.file.name}`}><ChevronLeft size={18} /></button>
            <span>Pages {start + 1}–{Math.min(start + pageSize, pageCount)} of {pageCount}</span>
            <button className="merge-icon-button" type="button" disabled={start + pageSize >= pageCount} onClick={() => setStart(value => value + pageSize)} aria-label={`Next pages of ${file.file.name}`}><ChevronRight size={18} /></button>
        </div>}
    </div>;
}

function PageOrderPreview({ pages }: { pages: { file: MergeFile; page: number }[] }) {
    const [offset, setOffset] = useState(0);
    const start = Math.min(offset, Math.max(0, Math.floor((pages.length - 1) / 6) * 6));
    return <section className="merge-order" aria-label="Preview of page order">
        <h3>Preview of page order</h3>
        {/* On a phone this list scrolls sideways; a keyboard has to be able to reach it (axe scrollable-region-focusable). */}
        <ol className="merge-order-list" tabIndex={0} aria-label="Output pages in order">
            {pages.slice(start, start + 6).map(({ file, page }, index) => <li key={`${file.id}-${page}`}>
                <span className="merge-order-number">{start + index + 1}</span>
                <PdfThumbnail document={file.document!} page={page} label={`Output page ${start + index + 1}: ${file.file.name}, page ${page}`} />
                <span title={file.file.name}>{file.file.name}</span><small>Page {page}</small>
            </li>)}
        </ol>
        {pages.length > 6 && <div className="merge-page-pager">
            <button className="merge-icon-button" type="button" disabled={start === 0} onClick={() => setOffset(start - 6)} aria-label="Previous output pages"><ChevronLeft size={18} /></button>
            <span>{start + 1}–{Math.min(start + 6, pages.length)} of {pages.length} pages</span>
            <button className="merge-icon-button" type="button" disabled={start + 6 >= pages.length} onClick={() => setOffset(start + 6)} aria-label="Next output pages"><ChevronRight size={18} /></button>
        </div>}
    </section>;
}

function ResultPreview({ result }: { result: MergeResult }) {
    const [document, setDocument] = useState<MergePreviewDocument | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [start, setStart] = useState(0);
    const mobile = useIsMobile();
    const pageSize = mobile ? 1 : 2;
    useEffect(() => {
        let disposed = false;
        let opened: MergePreviewDocument | null = null;
        if (result.blob.size > MAX_PREVIEW_BYTES) {
            setPreviewError("This PDF is ready. To keep memory use low, download it to review the pages on your device.");
            return;
        }
        void openMergePreview(result.blob).then(pdf => {
            opened = pdf;
            if (disposed) { void pdf.destroy(); return; }
            setDocument(pdf);
        }).catch(() => { if (!disposed) setPreviewError("The preview could not load. Download the PDF to review it on your device."); });
        return () => { disposed = true; if (opened) void opened.destroy(); };
    }, [result.blob]);
    const total = document?.numPages ?? result.selectedCount;
    const sourceFor = (page: number) => result.outputPages?.length === total ? result.outputPages[page - 1] : null;
    const captionFor = (page: number) => {
        const source = sourceFor(page);
        return source ? `${page} · ${source.filename}, page ${source.page}` : `Page ${page}`;
    };
    return <div className="merge-result-preview">
        <div className="merge-result-file"><FileText size={24} /><div><h3>{result.filename}</h3><p>{total !== null ? `${total} pages · ` : ""}PDF · {formatFileSize(result.blob.size)}</p></div></div>
        {document ? <>
            <div className="merge-result-pages">
                {Array.from({ length: Math.min(pageSize, document.numPages - start) }, (_, offset) => start + offset + 1).map(page => <figure key={page}>
                    <PdfThumbnail document={document} page={page} label={`Merged PDF, ${captionFor(page)}`} large /><figcaption>{captionFor(page)}</figcaption>
                </figure>)}
            </div>
            {document.numPages > pageSize && <div className="merge-page-pager">
                <button className="merge-icon-button" type="button" disabled={start === 0} onClick={() => setStart(value => Math.max(0, value - pageSize))} aria-label="Previous result pages"><ChevronLeft size={20} /></button>
                <span>{start + 1}{pageSize > 1 ? `–${Math.min(start + pageSize, document.numPages)}` : ""} of {document.numPages}</span>
                <button className="merge-icon-button" type="button" disabled={start + pageSize >= document.numPages} onClick={() => setStart(value => value + pageSize)} aria-label="Next result pages"><ChevronRight size={20} /></button>
            </div>}
            {mobile && <div className="merge-result-strip" role="group" aria-label="Choose a result page">
                {Array.from({ length: Math.min(6, document.numPages - Math.floor(start / 6) * 6) }, (_, index) => Math.floor(start / 6) * 6 + index + 1).map(page => <button
                    key={page} type="button" className="merge-result-thumbnail" aria-label={`Show ${captionFor(page)}`} aria-pressed={start === page - 1} onClick={() => setStart(page - 1)}>
                    <PdfThumbnail document={document} page={page} label={`Thumbnail, ${captionFor(page)}`} />
                    <span>{sourceFor(page)?.filename || `Page ${page}`}</span><small>{sourceFor(page) ? `Source page ${sourceFor(page)!.page}` : `Output page ${page}`}</small>
                </button>)}
            </div>}
        </> : <p className="merge-preview-status">{previewError ? <><FileText size={21} />{previewError}</> : <><Loader2 size={20} className="merge-spinner" />Loading your merged PDF preview…</>}</p>}
    </div>;
}
