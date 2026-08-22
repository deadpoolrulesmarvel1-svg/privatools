/**
 * HighlightUI — find every match of a phrase in one or many PDFs and highlight it.
 * Multi-file via useMultiFileProcessor — same query/color applied to all PDFs.
 *
 * The backend returns an `X-Highlight-Hits` header per file; we sum across the
 * batch and show the total.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Loader2, AlertCircle, Highlighter, CheckCircle2, RotateCcw, Search, Upload, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const COLORS = [
    { id: "yellow", label: "Yellow", swatch: "#ffea00" },
    { id: "green",  label: "Green",  swatch: "#8cee8c" },
    { id: "pink",   label: "Pink",   swatch: "#ffa1c7" },
    { id: "blue",   label: "Blue",   swatch: "#8cc7ff" },
    { id: "orange", label: "Orange", swatch: "#ffa800" },
];

const HIGHLIGHT_DEFAULTS = {
    color: "yellow",
    caseSensitive: false,
};

export function HighlightUI() {
    const [config, , { setField }] = useToolDefaults("highlight-pdf", HIGHLIGHT_DEFAULTS);
    const { color, caseSensitive } = config;
    const setColor = useCallback((v: React.SetStateAction<typeof HIGHLIGHT_DEFAULTS["color"]>) => setField("color", v), [setField]);
    const setCaseSensitive = useCallback((v: React.SetStateAction<typeof HIGHLIGHT_DEFAULTS["caseSensitive"]>) => setField("caseSensitive", v), [setField]);
    const proc = useMultiFileProcessor();
    const [query, setQuery] = useState("");

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && query.trim().length > 0 && phase !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    // Sum hits across all done entries.
    const totalHits = proc.entries.reduce((s, e) => {
        if (e.status !== "done") return s;
        const h = e.headers?.["x-highlight-hits"];
        return h ? s + (parseInt(h, 10) || 0) : s;
    }, 0);

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/highlight",
            outputSuffix: "highlighted",
            outputExt: "pdf",
            params: { query: query.trim(), color, case_sensitive: caseSensitive },
        }, retry);
        setPhase("done");
    }, [proc, query, color, caseSensitive]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_highlighted");
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
        const isMulti = proc.entries.length > 1;
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Highlighted</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {totalHits > 0
                                    ? <><span className="italic text-accent">{totalHits}</span> match{totalHits === 1 ? "" : "es"} marked{isMulti ? <> across <span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"}</> : null}</>
                                    : <>{isMulti ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} processed</> : <>Matches highlighted</>}</>}
                            </h2>
                            {query && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    Query: <span className="text-foreground">"{query}"</span>
                                    {proc.failedCount > 0 && <> · <span className="text-destructive">{proc.failedCount} failed</span></>}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button
                                        onClick={() => proc.downloadAll("archive_highlighted")}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90"
                                    >
                                        <Download size={13} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}
                                    </button>
                                )}
                                {proc.failedCount > 0 && (
                                    <button
                                        onClick={() => { downloadedRef.current = false; void process(true); }}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
                                    >
                                        Retry {proc.failedCount} failed
                                    </button>
                                )}
                                <button
                                    onClick={() => { proc.reset(); setQuery(""); setPhase("idle"); downloadedRef.current = false; }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Start over
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isPdfOnly); }}
                onClick={() => fileRef.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDFs"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Highlighter size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Select PDFs to highlight"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Multi-file OK · same query applied to all · max {MAX_FILE_SIZE_LABEL} each
                </p>
            </div>

            {proc.entries.length > 0 && (
                <MultiFileQueue
                    entries={proc.entries}
                    reorderable={false}
                    onRemove={proc.removeFile}
                    onReorder={proc.reorder}
                    onClearAll={proc.clearAll}
                    onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                    busy={phase === "processing"}
                />
            )}

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Search
                </div>
                <div className="p-4 space-y-4">
                    <div className="relative">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                        <input
                            type="text" value={query} onChange={e => setQuery(e.target.value)}
                            placeholder='e.g. "confidential"'
                            maxLength={500}
                            className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    </div>
                    <div>
                        <label className="font-medium text-[11px] text-muted-foreground">Color</label>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {COLORS.map(c => (
                                <button
                                    key={c.id}
                                    onClick={() => setColor(c.id)}
                                    aria-label={c.label}
                                    aria-pressed={color === c.id}
                                    className={cn(
                                        "h-10 w-10 rounded-lg border-2 transition-colors",
                                        color === c.id ? "border-foreground/70 ring-2 ring-accent/40" : "border-border hover:border-foreground/30",
                                    )}
                                    style={{ backgroundColor: c.swatch }}
                                />
                            ))}
                        </div>
                    </div>
                    <button
                        onClick={() => setCaseSensitive(v => !v)}
                        className={cn(
                            "inline-flex items-center gap-2 h-9 px-3 rounded-md border text-[12.5px] font-medium transition-colors",
                            caseSensitive
                                ? "border-accent bg-accent/[0.06] text-accent"
                                : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
                        )}
                    >
                        <span className={cn(
                            "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                            caseSensitive ? "bg-accent border-accent text-background" : "border-border",
                        )}>
                            {caseSensitive && <CheckCircle2 size={9} strokeWidth={3} />}
                        </span>
                        Case sensitive
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {phase === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Highlighting… ({proc.doneCount}/{proc.entries.length})</>
                        : <><Highlighter size={13} /> Highlight {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "every match"}</>}
                </button>
                {canProcess && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>
                )}
                {proc.entries.length > 0 && !query.trim() && (
                    <span className="font-medium text-[11.5px] text-muted-foreground/85 inline-flex items-center gap-1">
                        <AlertCircle size={11} /> Enter a query
                    </span>
                )}
            </div>
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
