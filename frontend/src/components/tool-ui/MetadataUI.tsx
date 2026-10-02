/**
 * MetadataUI — read or write the Title / Author / Subject / Keywords of PDFs.
 * View reads the FIRST file and shows its fields; Edit writes the SAME values
 * to every queued PDF via useMultiFileProcessor.
 */
import { useState, useEffect, useCallback } from "react";
import { ArrowRight, FileSearch, Pencil } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { uploadFileGetJson } from "@/lib/api";
import { emitToolRun, isTransientFailure, toolErrorKind, type ToolErrorKind } from "@/lib/toolRun";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { FileIntake, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted, retryLine } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function MetadataUI() {
    const proc = useMultiFileProcessor();
    const [mode, setMode] = useState<"read" | "write">("read");
    const [meta, setMeta] = useState<Record<string, string> | null>(null);
    const [title, setTitle] = useState("");
    const [author, setAuthor] = useState("");
    const [subject, setSubject] = useState("");
    const [keywords, setKeywords] = useState("");
    // Read (single request against the first file) and write (queue run)
    // have independent lifecycles.
    const [readState, setReadState] = useState<"idle" | "processing" | "done">("idle");
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // A read that failed: its reason, and whether another attempt could work.
    const [readFailure, setReadFailure] = useState<{ message: string; retryable: boolean; kind?: ToolErrorKind } | null>(null);
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const first = proc.entries[0];
    const firstId = first?.id;
    const isMulti = proc.entries.length > 1;
    const processing = readState === "processing" || phase === "processing";

    // The read view / prefill belongs to the FIRST file — drop it if that
    // file changes (removed, replaced) so we never show stale values.
    useEffect(() => {
        setMeta(null);
        setReadState("idle");
    }, [firstId]);

    const readMeta = useCallback(async () => {
        const entry = proc.entries[0];
        if (!entry) return;
        setReadState("processing"); setReadFailure(null);
        try {
            const data = await uploadFileGetJson<Record<string, string>>("/metadata", entry.file);
            setMeta(data);
            setTitle(data.title || ""); setAuthor(data.author || "");
            setSubject(data.subject || ""); setKeywords(data.keywords || "");
            setReadState("done");
            emitToolRun({ outcome: "success", files: 1 });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            const kind = toolErrorKind(e);
            setReadFailure({ message: friendlyError(msg, "Couldn't read the PDF metadata."), retryable: isTransientFailure(e), kind: kind === "cancelled" ? undefined : kind });
            setReadState("idle");
            emitToolRun({ outcome: "error", files: 1 }, e);
        }
    }, [proc.entries]);

    const writeMeta = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing"); setReadFailure(null);
        await proc.run({
            endpoint: "/metadata/update",
            outputSuffix: "metadata",
            outputExt: "pdf",
            params: { title, author, subject, keywords },
        }, retry);
        setPhase("done");
    }, [proc, title, author, subject, keywords]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_metadata"));

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && proc.entries.length > 0 && !processing) {
                e.preventDefault();
                if (mode === "read") void readMeta(); else void writeMeta(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [proc.entries.length, mode, processing, readMeta, writeMeta]);

    const startOver = (files?: File[]) => {
        proc.reset(); setPhase("idle"); setReadState("idle"); setMeta(null); setReadFailure(null); setMode("read");
        if (files) proc.addFiles(files, isPdfOnly);
        setReturning(true);
    };

    if (phase === "done") {
        return <ProcessorResult proc={proc} verb="updated" accepts=".pdf"
            title={proc.doneCount > 1 ? `Document info rewritten in ${proc.doneCount} PDFs.` : "Document info rewritten."}
            detail={proc.doneCount > 1 ? `${downloadStarted(proc.doneCount)} The same values were written to every file.` : downloadStarted(proc.doneCount)}
            onDownload={() => proc.downloadAll("archive_metadata")} onRetry={() => void writeMeta("transient")}
            onStartOver={startOver} more="Process another" />;
    }

    // The shared failure grammar for a read: the reason, a different PDF first,
    // and "Try again" only when another attempt could work.
    if (readFailure && first && mode === "read" && readState === "idle") {
        return <StudioResult tone="failure" title="This PDF’s metadata couldn’t be read."
            detail={readFailure.retryable ? `Nothing was read. ${retryLine([readFailure.kind])}` : "Nothing was read. The reason is below."}>
            <StudioFile name={first.name} status="error" detail={readFailure.message} />
            <StudioActions tone="failure" retryCount={readFailure.retryable ? 1 : 0} onRetry={() => void readMeta()}
                choose={{ accepts: ".pdf", multiple: true, onFiles: files => startOver(files) }} />
        </StudioResult>;
    }

    if (readState === "done" && mode === "read" && meta) {
        const fields = Object.entries(meta);
        return <StudioResult title={`${fields.length} field${fields.length === 1 ? "" : "s"} read.`}
            detail={isMulti ? `From ${first?.name}, the first of ${proc.entries.length} chosen files.` : first?.name}>
            <dl className="ts-fields">{fields.map(([k, v]) => <div key={k}><dt>{k.replace(/_/g, " ")}</dt><dd>{String(v) || "—"}</dd></div>)}</dl>
            <div className="ts-actions">
                <button type="button" className="ts-primary-button" onClick={() => { setMode("write"); setReadState("idle"); }}><Pencil size={16} aria-hidden="true" /> Edit metadata</button>
                <button type="button" className="ts-text-button" onClick={() => startOver()}>New file</button>
            </div>
        </StudioResult>;
    }

    const fields = [
        { id: "meta-title", label: "Title", val: title, set: setTitle, current: meta?.title || "", placeholder: "Document title" },
        { id: "meta-author", label: "Author", val: author, set: setAuthor, current: meta?.author || "", placeholder: "Author name" },
        { id: "meta-subject", label: "Subject", val: subject, set: setSubject, current: meta?.subject || "", placeholder: "Subject" },
        { id: "meta-keywords", label: "Keywords", val: keywords, set: setKeywords, current: meta?.keywords || "", placeholder: "comma, separated, terms" },
    ];
    return <StudioLayout options={<>
        <div>
            <h2>View or edit</h2>
            <div className="ts-mode-switch" role="group" aria-label="Metadata operation">
                <button type="button" aria-pressed={mode === "read"} disabled={processing} onClick={() => setMode("read")}><FileSearch size={14} aria-hidden="true" /> View</button>
                <button type="button" aria-pressed={mode === "write"} disabled={processing} onClick={() => setMode("write")}><Pencil size={14} aria-hidden="true" /> Edit</button>
            </div>
            {mode === "read" && isMulti && <p>View reads the first file — {first?.name}</p>}
        </div>
        {mode === "write" && <div>
            <h2>Document properties</h2>
            {fields.map(c => {
                const changed = !!meta && c.val !== c.current;
                return <div className="ts-setting" key={c.id}>
                    <label htmlFor={c.id}>{c.label}{changed ? " · edited" : ""}</label>
                    {meta && c.current && changed && <p className="ts-caption ts-was"><s>{c.current}</s> <ArrowRight size={12} aria-hidden="true" /></p>}
                    <input id={c.id} value={c.val} disabled={processing} onChange={e => c.set(e.target.value)} placeholder={c.placeholder} />
                </div>;
            })}
            {isMulti && <p>These values are written to all {proc.entries.length} files{meta ? " · “current” shows the first file" : ""}.</p>}
        </div>}
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => { if (mode === "read") void readMeta(); else void writeMeta(false); }} disabled={!proc.entries.length || processing}>
            {mode === "read" ? <><FileSearch size={16} aria-hidden="true" /> Read metadata</> : <><Pencil size={16} aria-hidden="true" /> Update metadata{isMulti ? ` — ${proc.entries.length} PDFs` : ""}</>}
        </button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to inspect metadata" detail="View or edit Title · Author · Subject · Keywords"
            compact={proc.entries.length > 0} disabled={processing} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={processing} label="Selected PDFs" />
        {readState === "processing" && <StudioProgress label="Reading the document info" />}
        {phase === "processing" && <StudioProgress label="Writing the document info" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
