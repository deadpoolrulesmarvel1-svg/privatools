/**
 * SplitByTextUI — split a PDF every time a page contains a search string.
 * Workshop: dropzone, mono input, case-sensitive toggle, Cmd+Enter.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Loader2, AlertCircle, FileText, X, Scissors, CheckCircle2, RotateCcw, Download } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const SPLIT_BY_TEXT_DEFAULTS: { caseSensitive: boolean } = {
    caseSensitive: false,
};

export function SplitByTextUI() {
    const [config, , { setField }] = useToolDefaults("split-by-text", SPLIT_BY_TEXT_DEFAULTS);
    const { caseSensitive } = config;
    const setCaseSensitive = useCallback((v: React.SetStateAction<typeof SPLIT_BY_TEXT_DEFAULTS["caseSensitive"]>) => setField("caseSensitive", v), [setField]);
    const [file, setFile] = useState<File | null>(null);
    const [search, setSearch] = useState("");

    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const canProcess = !!file && search.trim().length > 0 && state !== "processing";

    const onPick = (f: FileList | null) => {
        if (!f || !f[0]) return;
        setFile(f[0]);
        setState("idle");
        setError(null);
    };

    const process = useCallback(async () => {
        if (!file || !search.trim()) return;
        setState("processing");
        setError(null);
        try {
            const res = await uploadFile("/split-by-text", file, {
                search: search.trim(),
                case_sensitive: caseSensitive,
            });
            const blob = await res.blob();
            const baseName = file.name.replace(/\.pdf$/i, "");
            downloadBlob(blob, `${baseName}_split.zip`);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Split failed";
            setError(friendlyError(msg, "Couldn't split this PDF."));
            setState("idle");
        }
    }, [file, search, caseSensitive]);

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
                        <p className="section-mark mb-2">Split complete</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            Split on <span className="italic text-accent">"{search.trim()}"</span>
                        </h2>
                        <button
                            onClick={() => { setFile(null); setState("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Split another
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
                    onDrop={e => { e.preventDefault(); setDrag(false); onPick(e.dataTransfer.files); }}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload PDF"
                    className={cn(
                        "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                        drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <CornerMarks />
                    <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={e => { onPick(e.target.files); e.target.value = ""; }} />
                    <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                        <Scissors size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Drop a PDF to split by text</p>
                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">Cuts before every page containing the search term</p>
                </div>
            ) : (
                <div className="rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                        <FileText size={16} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                        <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">{formatFileSize(file.size)}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => { setFile(null); setState("idle"); }}
                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                        aria-label="Remove"
                    >
                        <X size={13} />
                    </button>
                </div>
            )}

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span className="text-accent">§</span> Search term
                </div>
                <div className="p-4 space-y-3">
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder='e.g. "Invoice #", "Chapter", "Statement of"'
                        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                    />
                    <label className="flex items-center gap-2 text-[13px] text-foreground cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={caseSensitive}
                            onChange={e => setCaseSensitive(e.target.checked)}
                            className="h-3.5 w-3.5 accent-accent"
                        />
                        Case-sensitive
                    </label>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={process}
                    disabled={!canProcess}
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {state === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Splitting…</>
                        : <><Download size={13} /> Split PDF</>}
                </button>
                {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
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
