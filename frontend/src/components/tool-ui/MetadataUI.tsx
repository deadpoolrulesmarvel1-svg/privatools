/**
 * MetadataUI — read or write the Title / Author / Subject / Keywords of PDFs.
 * Workshop: read view shows lab-report rows · write view shows form inputs.
 * Multi-file via useMultiFileProcessor — the SAME values are written to every
 * queued PDF; the "View" tab reads (and prefills from) the FIRST file.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, CheckCircle2, AlertCircle, FileSearch, Pencil, RotateCcw, ArrowRight, Download } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFileGetJson } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

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
    const [error, setError] = useState<string | null>(null);

    const first = proc.entries[0];
    const firstId = first?.id;
    const isMulti = proc.entries.length > 1;
    const processing = readState === "processing" || phase === "processing";

    // The lab report / prefill belongs to the FIRST file — drop it if that
    // file changes (removed, replaced) so we never show stale values.
    useEffect(() => {
        setMeta(null);
        setReadState("idle");
    }, [firstId]);

    const readMeta = useCallback(async () => {
        const entry = proc.entries[0];
        if (!entry) return;
        setReadState("processing"); setError(null);
        try {
            const data = await uploadFileGetJson<Record<string, string>>("/metadata", entry.file);
            setMeta(data);
            setTitle(data.title || ""); setAuthor(data.author || "");
            setSubject(data.subject || ""); setKeywords(data.keywords || "");
            setReadState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't read the PDF metadata."));
            setReadState("idle");
        }
    }, [proc.entries]);

    const writeMeta = useCallback(async (retry = false) => {
        setPhase("processing"); setError(null);
        await proc.run({
            endpoint: "/metadata/update",
            outputSuffix: "metadata",
            outputExt: "pdf",
            params: { title, author, subject, keywords },
        }, retry);
        setPhase("done");
    }, [proc, title, author, subject, keywords]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_metadata");
        }
    }, [phase, proc]);

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

    if (phase === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Metadata updated</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            {isMulti
                                ? <><span className="italic text-accent">Document info</span> rewritten in <span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"}{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                : <><span className="italic text-accent">Document info</span> rewritten</>}
                        </h2>
                        {proc.doneCount > 0 && (
                            <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                {proc.doneCount > 1 ? "ZIP downloaded · same values written to every file" : "PDF downloaded"}
                            </p>
                        )}
                        <div className="mt-5 flex flex-wrap gap-2">
                            {proc.doneCount > 0 && (
                                <button
                                    onClick={() => proc.downloadAll("archive_metadata")}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90"
                                >
                                    <Download size={13} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}
                                </button>
                            )}
                            {proc.failedCount > 0 && (
                                <button
                                    onClick={() => { downloadedRef.current = false; void writeMeta(true); }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
                                >
                                    Retry {proc.failedCount} failed
                                </button>
                            )}
                            <button
                                onClick={() => { proc.reset(); setPhase("idle"); setReadState("idle"); setMeta(null); setMode("read"); downloadedRef.current = false; }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Process another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    if (readState === "done" && mode === "read" && meta) return (
        <div className="space-y-4 animate-fade-up">
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="font-medium px-5 py-3 border-b border-accent/20 bg-paper-2/40 flex items-center justify-between text-[11.5px]">
                    <span className="text-accent">Lab report — metadata</span>
                    <span className="text-muted-foreground">{Object.keys(meta).length} fields</span>
                </div>
                {isMulti && (
                    <div className="px-5 py-2 border-b border-border/40 font-mono text-[10.5px] tracking-wide text-muted-foreground truncate">
                        From {first?.name} — the first of {proc.entries.length} queued files
                    </div>
                )}
                <div className="p-5 space-y-2">
                    {Object.entries(meta).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[140px_1fr] gap-3 py-2 border-b border-border/40 last:border-0">
                            <span className="font-medium text-[11.5px] text-muted-foreground">{k.replace(/_/g, " ")}</span>
                            <span className="text-[13.5px] text-foreground break-all">{String(v) || <span className="text-muted-foreground">—</span>}</span>
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => { setMode("write"); setReadState("idle"); }}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90"
                >
                    <Pencil size={12} /> Edit metadata
                </button>
                <button
                    onClick={() => { proc.reset(); setReadState("idle"); setMeta(null); }}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                >
                    <RotateCcw size={12} /> New file
                </button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={null}
                onFileSelect={f => proc.addFiles([f])}
                onFilesSelect={fs => proc.addFiles(fs)}
                onClear={proc.clearAll}
                multiple
                accept=".pdf"
                label={proc.entries.length ? "Add more files" : "Drop PDFs to inspect metadata"}
                hint="View or edit Title · Author · Subject · Keywords"
            />

            {proc.entries.length > 0 && (
                <>
                    <MultiFileQueue
                        entries={proc.entries}
                        reorderable={false}
                        onRemove={proc.removeFile}
                        onReorder={proc.reorder}
                        onClearAll={proc.clearAll}
                        onRetryFailed={() => { downloadedRef.current = false; void writeMeta(true); }}
                        busy={phase === "processing"}
                    />

                    <div role="tablist" aria-label="Metadata operation" className="grid grid-cols-2 gap-1 p-1 rounded-md border border-border bg-paper-2/40">
                        {(["read", "write"] as const).map(m => (
                            <button
                                key={m}
                                role="tab"
                                aria-selected={mode === m}
                                aria-label={m === "read" ? "View metadata" : "Edit metadata"}
                                onClick={() => setMode(m)}
                                className={cn(
                                    "rounded h-9 text-[12.5px] font-medium transition-colors inline-flex items-center justify-center gap-1.5",
                                    mode === m ? "bg-card border border-accent text-accent" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                )}
                            >
                                {m === "read" ? <><FileSearch size={12} /> View</> : <><Pencil size={12} /> Edit</>}
                            </button>
                        ))}
                    </div>

                    {mode === "read" && isMulti && (
                        <p className="font-medium text-[11.5px] text-muted-foreground px-1">
                            View reads the first file — {first?.name}
                        </p>
                    )}

                    {mode === "write" && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden animate-fade-in">
                            <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                                <span>Document properties</span>
                                {meta && <span className="text-muted-foreground">Current → new</span>}
                            </div>
                            <div className="p-4 space-y-3">
                                {([
                                    { label: "Title", val: title, set: setTitle, current: meta?.title || "", placeholder: "Document title" },
                                    { label: "Author", val: author, set: setAuthor, current: meta?.author || "", placeholder: "Author name" },
                                    { label: "Subject", val: subject, set: setSubject, current: meta?.subject || "", placeholder: "Subject" },
                                    { label: "Keywords", val: keywords, set: setKeywords, current: meta?.keywords || "", placeholder: "comma, separated, terms" },
                                ]).map(c => {
                                    const changed = meta && c.val !== c.current;
                                    return (
                                        <div key={c.label}>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="font-medium text-[11px] text-muted-foreground">{c.label}</label>
                                                {changed && (
                                                    <span className="font-medium text-[9.5px] text-accent">edited</span>
                                                )}
                                            </div>
                                            {meta && c.current && changed && (
                                                <div className="flex items-center gap-2 mb-1 font-mono text-[11px] text-muted-foreground break-all">
                                                    <span className="line-through opacity-70">{c.current}</span>
                                                    <ArrowRight size={10} className="shrink-0 text-accent" />
                                                </div>
                                            )}
                                            <input
                                                value={c.val} onChange={e => c.set(e.target.value)}
                                                placeholder={c.placeholder}
                                                aria-label={`${c.label} metadata field`}
                                                className={cn(
                                                    "w-full rounded-md border bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-accent/20 transition-colors",
                                                    changed ? "border-accent/60 focus:border-accent" : "border-border focus:border-accent"
                                                )}
                                            />
                                        </div>
                                    );
                                })}
                                {isMulti && (
                                    <p className="font-medium text-[11px] text-muted-foreground">
                                        These values are written to all {proc.entries.length} files{meta ? <> · "current" shows the first file</> : null}.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button onClick={() => { if (mode === "read") void readMeta(); else void writeMeta(false); }} disabled={processing} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {processing
                                ? <><Loader2 size={13} className="animate-spin" /> Processing…{phase === "processing" ? ` (${proc.doneCount}/${proc.entries.length})` : ""}</>
                                : mode === "read" ? <><FileSearch size={13} /> Read metadata</> : <><Pencil size={13} /> Update metadata{isMulti ? ` — ${proc.entries.length} PDFs` : ""}</>}
                        </button>
                        {!processing && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
                    </div>
                </>
            )}
        </div>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 right-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" /></span>
        </>
    );
}
