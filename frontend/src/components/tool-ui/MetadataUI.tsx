/**
 * MetadataUI — read or write the Title / Author / Subject / Keywords of a PDF.
 * Workshop: read view shows lab-report rows · write view shows form inputs.
 */
import { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, AlertCircle, FileSearch, Pencil, RotateCcw, ArrowRight } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, uploadFileGetJson, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

export function MetadataUI() {
    const [file, setFile] = useState<File | null>(null);
    const [mode, setMode] = useState<"read" | "write">("read");
    const [meta, setMeta] = useState<Record<string, string> | null>(null);
    const [title, setTitle] = useState("");
    const [author, setAuthor] = useState("");
    const [subject, setSubject] = useState("");
    const [keywords, setKeywords] = useState("");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);

    const readMeta = useCallback(async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            const data = await uploadFileGetJson<Record<string, string>>("/metadata", file);
            setMeta(data);
            setTitle(data.title || ""); setAuthor(data.author || "");
            setSubject(data.subject || ""); setKeywords(data.keywords || "");
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't read the PDF metadata."));
            setState("idle");
        }
    }, [file]);

    const writeMeta = useCallback(async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            const res = await uploadFile("/metadata/update", file, { title, author, subject, keywords });
            const blob = await res.blob();
            downloadBlob(blob, `${file.name.replace(/\.pdf$/i, "")}_metadata.pdf`);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't update the PDF metadata."));
            setState("idle");
        }
    }, [file, title, author, subject, keywords]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && state !== "processing") {
                e.preventDefault();
                if (mode === "read") readMeta(); else writeMeta();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file, mode, state, readMeta, writeMeta]);

    if (state === "done" && mode === "read" && meta) return (
        <div className="space-y-4 animate-fade-up">
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="font-medium px-5 py-3 border-b border-accent/20 bg-paper-2/40 flex items-center justify-between text-[11.5px]">
                    <span className="text-accent">Lab report — metadata</span>
                    <span className="text-muted-foreground">{Object.keys(meta).length} fields</span>
                </div>
                <div className="p-5 space-y-2">
                    {Object.entries(meta).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[140px_1fr] gap-3 py-2 border-b border-border/40 last:border-0">
                            <span className="font-medium text-[11.5px] text-muted-foreground">{k.replace(/_/g, " ")}</span>
                            <span className="text-[13.5px] text-foreground break-all">{String(v) || <span className="text-muted-foreground/50">—</span>}</span>
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => { setMode("write"); setState("idle"); }}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90"
                >
                    <Pencil size={12} /> Edit metadata
                </button>
                <button
                    onClick={() => { setFile(null); setState("idle"); setMeta(null); }}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                >
                    <RotateCcw size={12} /> New file
                </button>
            </div>
        </div>
    );

    if (state === "done" && mode === "write") return (
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
                            <span className="italic text-accent">Document info</span> rewritten
                        </h2>
                        <button
                            onClick={() => { setFile(null); setState("idle"); setMeta(null); setMode("read"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Process another
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={f => { setFile(f); setMeta(null); }}
                onClear={() => { setFile(null); setMeta(null); }}
                accept=".pdf"
                label="Drop PDF to inspect metadata"
                hint="View or edit Title · Author · Subject · Keywords"
            />

            {file && (
                <>
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

                    {mode === "write" && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden animate-fade-in">
                            <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                                <span>Document properties</span>
                                {meta && <span className="text-muted-foreground/70">Current → new</span>}
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
                                                <div className="flex items-center gap-2 mb-1 font-mono text-[11px] text-muted-foreground/85 break-all">
                                                    <span className="line-through opacity-70">{c.current}</span>
                                                    <ArrowRight size={10} className="shrink-0 text-accent" />
                                                </div>
                                            )}
                                            <input
                                                value={c.val} onChange={e => c.set(e.target.value)}
                                                placeholder={c.placeholder}
                                                aria-label={`${c.label} metadata field`}
                                                className={cn(
                                                    "w-full rounded-md border bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-accent/20 transition-colors",
                                                    changed ? "border-accent/60 focus:border-accent" : "border-border focus:border-accent"
                                                )}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button onClick={mode === "read" ? readMeta : writeMeta} disabled={state === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {state === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Processing…</>
                                : mode === "read" ? <><FileSearch size={13} /> Read metadata</> : <><Pencil size={13} /> Update metadata</>}
                        </button>
                        {state !== "processing" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
