/**
 * BookmarksUI — inject a TOC tree of bookmarks into a PDF.
 * Workshop: structured row editor + JSON code view toggle.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2, CheckCircle2, X, FileText, AlertCircle, Bookmark, Plus, Trash2, RotateCcw, Code2, ListTree } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";

type Mark = { title: string; page: number };

export function BookmarksUI() {
    const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [marks, setMarks] = useState<Mark[]>([
        { title: "Chapter 1", page: 1 },
        { title: "Chapter 2", page: 5 },
    ]);
    const [mode, setMode] = useState<"rows" | "json">("rows");
    const [json, setJson] = useState(JSON.stringify(marks, null, 2));
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const pick = (fl: FileList) => { const f = fl[0]; setFile({ name: f.name, size: formatFileSize(f.size), raw: f }); setState("idle"); setError(null); };

    const updateMark = (i: number, patch: Partial<Mark>) => {
        const next = marks.map((m, idx) => idx === i ? { ...m, ...patch } : m);
        setMarks(next);
        setJson(JSON.stringify(next, null, 2));
    };
    const addMark = () => {
        const next = [...marks, { title: "New section", page: 1 }];
        setMarks(next);
        setJson(JSON.stringify(next, null, 2));
    };
    const removeMark = (i: number) => {
        const next = marks.filter((_, idx) => idx !== i);
        setMarks(next);
        setJson(JSON.stringify(next, null, 2));
    };

    const syncFromJson = (v: string) => {
        setJson(v);
        try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) setMarks(parsed); } catch { /* keep raw text */ }
    };

    // Validate JSON when in JSON mode
    const jsonValid = (() => {
        if (mode !== "json") return true;
        try {
            const v = JSON.parse(json);
            return Array.isArray(v) && v.every(x => typeof x?.title === "string" && Number.isFinite(x?.page));
        } catch {
            return false;
        }
    })();
    const marksValid = marks.length > 0 && marks.every(m => m.title.trim().length > 0 && Number.isFinite(m.page) && m.page >= 1);
    const canProcess = !!file && (mode === "json" ? jsonValid : marksValid) && state !== "processing";

    const process = useCallback(async () => {
        if (!file || !canProcess) return;
        setState("processing"); setError(null);
        try {
            const payload = mode === "json" ? json : JSON.stringify(marks);
            await processAndDownload("/bookmarks", file.raw, buildOutputFilename(file.name, "bookmarked", "pdf"), { bookmarks: payload });
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't add bookmarks."));
            setState("idle");
        }
    }, [file, canProcess, mode, json, marks]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Bookmarks added</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{marks.length}</span> entries written
                        </h2>
                        <button
                            onClick={() => { setFile(null); setState("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Add to another
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {!file ? (
                <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) pick(e.dataTransfer.files); }}
                    onClick={() => ref.current?.click()}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload PDF"
                    className={cn(
                        "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                        drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <CornerMarks />
                    <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => { e.target.files && pick(e.target.files); e.target.value = ""; }} />
                    <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                        <Bookmark size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Select a PDF to bookmark</p>
                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">Build a table of contents · point to page numbers</p>
                </div>
            ) : (
                <>
                    <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                        <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                            <FileText size={16} className="text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                            <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">{file.size}</p>
                        </div>
                        <button onClick={() => setFile(null)} className="h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60" aria-label="Remove">
                            <X size={13} />
                        </button>
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> Bookmarks</span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setMode("rows")}
                                    className={cn("h-6 px-2 rounded inline-flex items-center gap-1 transition-colors", mode === "rows" ? "bg-accent/15 text-accent" : "text-muted-foreground hover:bg-secondary/40")}
                                >
                                    <ListTree size={10} /> Rows
                                </button>
                                <button
                                    onClick={() => setMode("json")}
                                    className={cn("h-6 px-2 rounded inline-flex items-center gap-1 transition-colors", mode === "json" ? "bg-accent/15 text-accent" : "text-muted-foreground hover:bg-secondary/40")}
                                >
                                    <Code2 size={10} /> JSON
                                </button>
                            </div>
                        </div>
                        {mode === "rows" ? (
                            <div className="p-3 space-y-2 animate-fade-in">
                                {marks.map((m, i) => (
                                    <div key={i} className="flex items-center gap-2 group">
                                        <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70 w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                        <input
                                            value={m.title}
                                            onChange={e => updateMark(i, { title: e.target.value })}
                                            placeholder="Section title"
                                            className="flex-1 min-w-0 rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                        />
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="font-mono text-[9.5px] tracking-wider text-muted-foreground/70">p.</span>
                                            <input
                                                type="number" min={1} max={99999} value={m.page}
                                                onChange={e => updateMark(i, { page: Math.max(1, Math.min(99999, parseInt(e.target.value) || 1)) })}
                                                className="w-16 rounded-md border border-border bg-card px-2 py-2 font-mono text-[13px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                            />
                                        </div>
                                        <button
                                            onClick={() => removeMark(i)}
                                            className="h-8 w-8 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                                            aria-label="Remove"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                ))}
                                <button
                                    onClick={addMark}
                                    className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-md border border-dashed border-border-strong text-[12px] font-medium text-muted-foreground hover:text-accent hover:border-accent/55 hover:bg-accent/[0.04] transition-colors"
                                >
                                    <Plus size={12} /> Add bookmark
                                </button>
                            </div>
                        ) : (
                            <div className="p-3 animate-fade-in">
                                <textarea
                                    value={json}
                                    onChange={e => syncFromJson(e.target.value)}
                                    rows={Math.max(6, marks.length + 2)}
                                    spellCheck={false}
                                    aria-invalid={!jsonValid}
                                    className={cn(
                                        "w-full rounded-md border bg-paper-2/40 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground outline-none focus:ring-2 transition-colors",
                                        jsonValid
                                            ? "border-border focus:border-accent focus:ring-accent/20"
                                            : "border-destructive/60 focus:border-destructive focus:ring-destructive/20"
                                    )}
                                />
                                {jsonValid ? (
                                    <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-2">
                                        <span className="text-accent">§</span> Array of <span className="text-foreground">{`{ title, page }`}</span> objects
                                    </p>
                                ) : (
                                    <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-destructive mt-2">
                                        Invalid JSON — expected an array of <span className="text-foreground">{`{ title: string, page: number }`}</span>
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button type="button" onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Writing…</> : <><Bookmark size={13} /> Add bookmarks</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
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
