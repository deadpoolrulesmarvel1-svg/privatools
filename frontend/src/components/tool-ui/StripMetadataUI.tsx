/**
 * StripMetadataUI — strip ALL hidden metadata from one or more PDFs.
 * Workshop: signal-green dropzone, batch file list, privacy receipt readout.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, X, FileText, AlertCircle, DatabaseZap, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename, MAX_FILE_SIZE_LABEL } from "@/lib/api";

type StripFile = { id: string; name: string; size: string; raw: File };
let fileId = 0;

const STRIPPED = [
    "Author / Creator",
    "Created / Modified dates",
    "GPS coordinates",
    "Software fingerprint",
    "XMP metadata",
];

export function StripMetadataUI() {
    const [files, setFiles] = useState<StripFile[]>([]);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const addFiles = (fl: FileList) => {
        const next: StripFile[] = Array.from(fl)
            .filter(f => f.name.toLowerCase().endsWith(".pdf"))
            .map(f => ({ id: String(++fileId), name: f.name, size: formatFileSize(f.size), raw: f }));
        if (next.length) { setFiles(prev => [...prev, ...next]); setState("idle"); setError(null); }
    };
    const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
    const canProcess = files.length > 0 && state !== "processing";

    const process = useCallback(async () => {
        if (!files.length) return;
        setState("processing"); setError(null);
        try {
            const outExt = files.length === 1 ? "pdf" : "zip";
            const outName = buildOutputFilename(files[0]?.raw.name, "stripped", outExt);
            await processFilesAndDownload("/strip-metadata", files.map(f => f.raw), outName);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't strip metadata from those PDFs."));
            setState("idle");
        }
    }, [files]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (state === "done") return (
        <div className="space-y-4 animate-fade-up">
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Metadata stripped</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                <span className="italic text-accent">{files.length}</span> file{files.length !== 1 && "s"} sanitized
                            </h2>
                            <button
                                onClick={() => { setFiles([]); setState("idle"); }}
                                className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Strip more
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Per-file receipt — shows what was stripped from each PDF */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Privacy receipt</span>
                    <span>{files.length} file{files.length !== 1 && "s"}</span>
                </div>
                <div className="divide-y divide-border">
                    {files.map((f, i) => (
                        <div key={f.id} className="px-4 py-3">
                            <div className="flex items-center gap-3 mb-2">
                                <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70 w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                <FileText size={13} className="text-accent shrink-0" />
                                <p className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">{f.name}</p>
                                <span className="font-mono text-[10px] tracking-wider text-muted-foreground/85 shrink-0">{f.size}</span>
                            </div>
                            <div className="ml-10 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                                {STRIPPED.map(s => (
                                    <div key={s} className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground">
                                        <CheckCircle2 size={9} className="text-accent shrink-0" /> {s}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload PDFs"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <DatabaseZap size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{files.length ? "Add more PDFs" : "Select PDFs to scrub"}</p>
                <p className="font-medium text-[11.5px] text-muted-foreground">Author · timestamps · GPS · software · XMP · max {MAX_FILE_SIZE_LABEL}</p>
            </div>

            {files.length > 0 && (
                <>
                    <div className="space-y-2">
                        {files.map((f, i) => (
                            <div key={f.id} className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                                <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70 w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                                    <FileText size={15} className="text-accent" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[14px] font-medium text-foreground truncate">{f.name}</p>
                                    <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">{f.size}</p>
                                </div>
                                <button onClick={() => removeFile(f.id)} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60" aria-label="Remove">
                                    <X size={13} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Will be removed
                        </div>
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                            {STRIPPED.map(s => (
                                <div key={s} className="flex items-center gap-2 text-[12.5px] text-foreground">
                                    <span className="h-1 w-1 rounded-full bg-accent shrink-0" />
                                    {s}
                                </div>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Stripping…</> : <><DatabaseZap size={13} /> Strip {files.length > 1 ? `${files.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
