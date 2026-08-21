/**
 * SplitUI — split a PDF by ranges / individual pages / chunks.
 *
 * Workshop aesthetic: workshop dropzone, mode picker as a radio
 * group of cards with mono syntax examples, range input mono-styled.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle, ScissorsLineDashed, RotateCcw } from "lucide-react";
import { cn, friendlyError, isValidPageRange, pageRangeError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type Mode = "pages" | "individual" | "every_n";

const modes: { id: Mode; label: string; desc: string; example: string }[] = [
    { id: "pages",      label: "By page ranges", desc: "Specify ranges by hand",            example: "1-3, 5, 7-end" },
    { id: "individual", label: "Every page",     desc: "Each page becomes a separate file", example: "" },
    { id: "every_n",    label: "Every N pages",  desc: "Split into equal chunks",           example: "" },
];

const SPLIT_DEFAULTS: { mode: Mode; n: number } = {
    mode: "pages",
    n: 2,
};

export function SplitUI() {
    const [config, , { setField }] = useToolDefaults("split-pdf", SPLIT_DEFAULTS);
    const { mode, n } = config;
    const setMode = (v: React.SetStateAction<typeof SPLIT_DEFAULTS["mode"]>) => setField("mode", v);
    const setN = (v: React.SetStateAction<typeof SPLIT_DEFAULTS["n"]>) => setField("n", v);
    const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);

    const [pages, setPages] = useState("1-3");

    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const pick = (fl: FileList) => {
        const f = fl[0];
        setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
        setState("idle");
        setError(null);
    };

    const rangeOk = mode !== "pages" || (pages.trim().length > 0 && isValidPageRange(pages));
    const nOk = mode !== "every_n" || (n >= 1 && Number.isFinite(n));
    const canProcess = !!file && rangeOk && nOk && state !== "processing";

    const process = useCallback(async () => {
        if (!file || !canProcess) return;
        setState("processing");
        setError(null);
        try {
            const params: Record<string, string | number> = { mode };
            if (mode === "pages") params.pages = pages;
            if (mode === "every_n") params.n = n;
            const res = await uploadFile("/split", file.raw, params);
            const blob = await res.blob();
            const ext = blob.type.includes("zip") ? "zip" : "pdf";
            downloadBlob(blob, buildOutputFilename(file.name, "split", ext));
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Split failed";
            setError(friendlyError(msg, "Couldn't split this PDF."));
            setState("idle");
        }
    }, [file, canProcess, mode, pages, n]);

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

    const rangeErr = mode === "pages" ? pageRangeError(pages) : null;
    const previewSummary = mode === "individual"
        ? "Output: one PDF per page (ZIP)"
        : mode === "every_n"
            ? `Output: chunks of ${n} pages each (ZIP)`
            : pages.trim()
                ? `Output: one PDF for "${pages.trim()}"`
                : "Output preview appears as you type";

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks accent />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Split complete</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">Split</span> downloaded.
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
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) pick(e.dataTransfer.files); }}
                    onClick={() => ref.current?.click()}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload file"
                    className={cn(
                        "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                        drag
                            ? "border-accent bg-accent/[0.06]"
                            : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <CornerMarks />
                    <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => { e.target.files && pick(e.target.files); e.target.value = ""; }} />
                    <div className={cn(
                        "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                        drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                    )}>
                        <Upload size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Select a PDF to split</p>
                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">Drag &amp; drop or click to browse</p>
                </div>
            ) : (
                <>
                    {/* File card */}
                    <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                        <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                            <FileText size={16} className="text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                            <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">{file.size}</p>
                        </div>
                        <button
                            onClick={() => setFile(null)}
                            className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                            aria-label="Remove file"
                        >
                            <X size={13} />
                        </button>
                    </div>

                    {/* Mode picker */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-border bg-paper-2/40 flex items-center gap-2 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <ScissorsLineDashed size={11} className="text-accent" />
                            Split mode
                        </div>
                        <div className="p-3 space-y-1.5">
                            {modes.map((m, idx) => {
                                const active = mode === m.id;
                                return (
                                    <button
                                        key={m.id}
                                        onClick={() => setMode(m.id)}
                                        className={cn(
                                            "w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                                            active
                                                ? "border-accent bg-accent/[0.06]"
                                                : "border-border hover:border-border-strong hover:bg-paper-2/30"
                                        )}
                                    >
                                        <div className={cn(
                                            "h-4 w-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5",
                                            active ? "border-accent bg-accent" : "border-border-strong"
                                        )}>
                                            {active && <div className="h-1.5 w-1.5 rounded-full bg-accent-foreground" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-display text-[15px] font-semibold text-foreground tracking-[-0.015em] leading-tight">
                                                <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent mr-1.5">{String(idx + 1).padStart(2, "0")}</span>
                                                {m.label}
                                            </p>
                                            <p className="text-[12.5px] text-muted-foreground mt-0.5 leading-snug">{m.desc}</p>
                                            {m.example && active && (
                                                <p className="mt-2 font-mono text-[11px] text-muted-foreground/85">
                                                    e.g.&nbsp;<span className="text-foreground">{m.example}</span>
                                                </p>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Inline option inputs */}
                        {mode === "pages" && (
                            <div className="border-t border-border p-4 bg-paper-2/30">
                                <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Page ranges</label>
                                <input
                                    value={pages}
                                    onChange={e => setPages(e.target.value)}
                                    spellCheck={false}
                                    aria-invalid={!isValidPageRange(pages)}
                                    className={cn(
                                        "mt-1.5 w-full rounded-md border bg-card px-3 py-2 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-2 transition-colors",
                                        isValidPageRange(pages)
                                            ? "border-border focus:border-accent focus:ring-accent/20"
                                            : "border-destructive/60 focus:border-destructive focus:ring-destructive/20"
                                    )}
                                    placeholder="1-3, 5, 7-end, -4, 9-"
                                />
                                {rangeErr ? (
                                    <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-destructive mt-2">{rangeErr}</p>
                                ) : (
                                    <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-2">
                                        <span className="text-accent">§</span> Syntax — comma-separated ranges · "end" = last page · "-4" = first 4 · "9-" = page 9 to end
                                    </p>
                                )}
                            </div>
                        )}
                        {mode === "every_n" && (
                            <div className="border-t border-border p-4 bg-paper-2/30">
                                <label className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">Pages per chunk</label>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    value={n}
                                    onChange={e => setN(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                                    min={1}
                                    max={1000}
                                    className="mt-1.5 w-32 rounded-md border border-border bg-card px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                            </div>
                        )}
                    </div>

                    {/* Output preview */}
                    <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-2.5">
                        <div className="h-8 w-8 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
                            <Download size={13} className="text-accent" />
                        </div>
                        <p className="font-mono text-[11.5px] text-foreground/85 flex-1 min-w-0 truncate">{previewSummary}</p>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button type="button" onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {state === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Splitting…</>
                                : <><Download size={13} /> Split PDF</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                    </div>
                </>
            )}
        </div>
    );
}

function CornerMarks({ accent }: { accent?: boolean }) {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    const color = accent ? "bg-accent" : "bg-accent/70";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className={`absolute top-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className={`absolute top-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 right-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className={`absolute bottom-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className={`absolute bottom-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 right-0 w-px h-3 ${color}`} />
            </span>
        </>
    );
}
