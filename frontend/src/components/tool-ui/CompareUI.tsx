/**
 * CompareUI — side-by-side PDF diff (visual or text).
 * Workshop: two-slot pickup + mode toggle + lab-report style result with diff hunk colors.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Loader2, X, FileText, AlertCircle, Download, GitCompare, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, buildOutputFilename, postFormData } from "@/lib/api";

const MODES = [
    { value: "visual", label: "Visual", desc: "Side-by-side with diff highlights" },
    { value: "text",   label: "Text",   desc: "Compare text content only" },
] as const;

interface TextResult {
    diff: string[];
    page_count_1: number;
    page_count_2: number;
}

type FileState = { name: string; size: string; raw: File } | null;

export function CompareUI() {
    const [file1, setFile1] = useState<FileState>(null);
    const [file2, setFile2] = useState<FileState>(null);
    const [mode, setMode] = useState<"visual" | "text">("visual");
    const [highlight, setHighlight] = useState("#0E8A56");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [textResult, setTextResult] = useState<TextResult | null>(null);
    const ref1 = useRef<HTMLInputElement>(null);
    const ref2 = useRef<HTMLInputElement>(null);

    const process = useCallback(async () => {
        if (!file1 || !file2) return;
        setState("processing"); setError(null);
        try {
            const res = await postFormData("/compare", () => {
                const fd = new FormData();
                fd.append("file1", file1.raw);
                fd.append("file2", file2.raw);
                fd.append("mode", mode);
                fd.append("highlight_color", highlight);
                return fd;
            }, { timeoutMs: 300_000 });
            if (mode === "visual") {
                const blob = await res.blob();
                setResultBlob(blob); setTextResult(null);
                downloadBlob(blob, buildOutputFilename(file1.name, "comparison", "pdf"));
            } else {
                const json = await res.json() as TextResult;
                setTextResult(json); setResultBlob(null);
            }
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't compare those PDFs."));
            setState("idle");
        }
    }, [file1, file2, mode, highlight]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file1 && file2 && state !== "processing") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file1, file2, state, process]);

    const pick = (idx: 1 | 2, fl: FileList | null) => {
        if (!fl?.[0]) return;
        const f = fl[0];
        const wrapped = { name: f.name, size: formatFileSize(f.size), raw: f };
        if (idx === 1) setFile1(wrapped); else setFile2(wrapped);
    };

    const Slot = ({ label, hint, file, set, ref, idx }: { label: string; hint: string; file: FileState; set: (f: FileState) => void; ref: React.RefObject<HTMLInputElement>; idx: 1 | 2 }) => {
        const [drag, setDrag] = useState(false);
        return (
            <div>
                <div className="flex items-center justify-between mb-1.5 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span><span className="text-accent">§{String(idx).padStart(2, "0")}</span> {label}</span>
                    <span className="text-muted-foreground/60">{hint}</span>
                </div>
                {!file ? (
                    <div
                        onDragOver={e => { e.preventDefault(); setDrag(true); }}
                        onDragLeave={() => setDrag(false)}
                        onDrop={e => { e.preventDefault(); setDrag(false); pick(idx, e.dataTransfer.files); }}
                        onClick={() => ref.current?.click()}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                        role="button" tabIndex={0} aria-label={`Upload ${label}`}
                        className={cn(
                            "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors py-8 text-center group",
                            drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                        )}
                    >
                        <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => { pick(idx, e.target.files); e.target.value = ""; }} />
                        <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30")}>
                            <Upload size={16} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <p className="font-display text-[14px] font-semibold text-foreground">Drop PDF</p>
                    </div>
                ) : (
                    <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                        <div className="h-9 w-9 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                            <FileText size={14} className="text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-foreground truncate">{file.name}</p>
                            <p className="font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">{file.size}</p>
                        </div>
                        <button onClick={() => set(null)} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60" aria-label="Remove">
                            <X size={13} />
                        </button>
                    </div>
                )}
            </div>
        );
    };

    if (state === "done") return (
        <div className="space-y-4 animate-fade-up">
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <GitCompare size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Comparison complete</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {mode === "visual"
                                    ? <><span className="italic text-accent">Visual diff</span> highlighted</>
                                    : <><span className="italic text-accent">{textResult?.diff.length || 0}</span> diff lines</>}
                            </h2>
                            <div className="mt-5 flex flex-wrap gap-2">
                                {mode === "visual" && resultBlob && (
                                    <button onClick={() => downloadBlob(resultBlob, buildOutputFilename(file1?.name, "comparison", "pdf"))} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download again
                                    </button>
                                )}
                                <button
                                    onClick={() => { setFile1(null); setFile2(null); setState("idle"); setResultBlob(null); setTextResult(null); }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Compare more
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {mode === "text" && textResult && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span><span className="text-accent">§</span> Text diff</span>
                        <span>p.{textResult.page_count_1} vs p.{textResult.page_count_2}</span>
                    </div>
                    <div className="p-3 max-h-[420px] overflow-auto">
                        {textResult.diff.length === 0 ? (
                            <p className="font-mono text-[11px] tracking-wider text-muted-foreground/70 text-center py-6">No textual differences found</p>
                        ) : (
                            <pre className="font-mono text-[12px] leading-relaxed text-foreground whitespace-pre-wrap">
                                {textResult.diff.slice(0, 200).map((l, i) => {
                                    const sign = l[0];
                                    return (
                                        <div
                                            key={i}
                                            className={cn(
                                                "px-2",
                                                sign === "+" && "bg-accent/[0.08] text-accent",
                                                sign === "-" && "bg-destructive/[0.08] text-destructive",
                                                sign === "?" && "bg-copper/[0.08] text-copper",
                                            )}
                                        >{l}</div>
                                    );
                                })}
                                {textResult.diff.length > 200 && (
                                    <div className="px-2 mt-2 pt-2 border-t border-border/60 text-muted-foreground/85 font-mono text-[10.5px] tracking-[0.04em] uppercase">
                                        § showing first 200 of {textResult.diff.length} diff lines
                                    </div>
                                )}
                            </pre>
                        )}
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Slot label="Original" hint="before" file={file1} set={setFile1} ref={ref1} idx={1} />
                <Slot label="Modified" hint="after" file={file2} set={setFile2} ref={ref2} idx={2} />
            </div>

            {(file1 || file2) && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span className="text-accent">§</span> Comparison mode
                    </div>
                    <div className="p-3 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            {MODES.map(m => {
                                const active = mode === m.value;
                                return (
                                    <button
                                        key={m.value}
                                        onClick={() => setMode(m.value)}
                                        className={cn(
                                            "rounded-lg border p-3 text-left transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <p className={cn("font-display text-[14px] font-semibold tracking-[-0.015em]", active ? "text-accent" : "text-foreground")}>{m.label}</p>
                                        <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-1">{m.desc}</p>
                                    </button>
                                );
                            })}
                        </div>
                        {mode === "visual" && (
                            <div className="flex items-center gap-3 animate-fade-in">
                                <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Highlight</label>
                                <input
                                    type="color" value={highlight}
                                    onChange={e => setHighlight(e.target.value)}
                                    className="h-7 w-9 rounded border border-border cursor-pointer"
                                />
                                <span className="font-mono text-[11px] text-muted-foreground">{highlight.toUpperCase()}</span>
                            </div>
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
                <button onClick={process} disabled={state === "processing" || !file1 || !file2} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Comparing…</> : <><GitCompare size={13} /> Compare PDFs</>}
                </button>
                {file1 && file2 && state === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
