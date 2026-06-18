/**
 * CreateZipUI — bundle any files into a single ZIP archive.
 * Workshop: drag&drop multi-add + numbered file list.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2, AlertCircle, FileText, X, Plus, Archive, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { formatFileSize, downloadBlob, buildOutputFilename, postFormData } from "@/lib/api";

export function CreateZipUI() {
    const [files, setFiles] = useState<{ id: string; name: string; size: string; file: File }[]>([]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const [compression, setCompression] = useState(6);
    const ref = useRef<HTMLInputElement>(null);

    const add = (fl: FileList) => {
        setFiles(p => [...p, ...Array.from(fl).map(f => ({ id: Math.random().toString(36).slice(2), name: f.name, size: formatFileSize(f.size), file: f }))]);
    };

    const totalBytes = files.reduce((s, f) => s + f.file.size, 0);
    const compressionLabel = compression === 0 ? "Store (no compression)" : compression <= 3 ? "Fast" : compression <= 6 ? "Balanced" : "Maximum";

    const canProcess = files.length > 0 && status !== "processing";

    const process = useCallback(async () => {
        if (files.length === 0) return;
        setStatus("processing"); setError(null);
        try {
            const res = await postFormData("/create-zip", () => {
                const fd = new FormData();
                for (const f of files) fd.append("files", f.file);
                fd.append("compression", String(compression));
                return fd;
            }, { timeoutMs: 300_000 });
            const blob = await res.blob();
            downloadBlob(blob, buildOutputFilename(files[0]?.name, "archive", "zip"));
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't create that archive."));
            setStatus("idle");
        }
    }, [files, compression]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <Archive size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Archive sealed</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{files.length}</span> file{files.length !== 1 && "s"} → .zip
                        </h2>
                        <button onClick={() => { setFiles([]); setStatus("idle"); }} className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                            <RotateCcw size={12} /> Create another
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload files"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" multiple className="hidden" onChange={e => { e.target.files && add(e.target.files); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <Archive size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{files.length ? "Add more files" : "Drop files to zip"}</p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">Any file types · multiple allowed</p>
            </div>

            {files.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span><span className="text-accent">§</span> Manifest ({files.length})</span>
                        <button onClick={() => ref.current?.click()} className="inline-flex items-center gap-1 text-accent hover:opacity-80">
                            <Plus size={11} /> Add more
                        </button>
                    </div>
                    <div className="divide-y divide-border">
                        {files.map((f, i) => (
                            <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                                <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70 w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                <FileText size={13} className="text-muted-foreground shrink-0" />
                                <span className="text-[13px] text-foreground flex-1 truncate">{f.name}</span>
                                <span className="font-mono text-[10.5px] tracking-[0.04em] uppercase text-muted-foreground">{f.size}</span>
                                <button onClick={() => setFiles(p => p.filter(x => x.id !== f.id))} aria-label={`Remove ${f.name}`} className="h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {files.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span><span className="text-accent">§</span> Compression</span>
                        <span className="text-accent normal-case tracking-normal">{compressionLabel} · level {compression}</span>
                    </div>
                    <div className="p-4">
                        <input
                            type="range" min={0} max={9} step={1}
                            value={compression}
                            onChange={e => setCompression(parseInt(e.target.value, 10))}
                            className="w-full accent-accent"
                            aria-label="ZIP compression level"
                            aria-valuetext={`Level ${compression} — ${compressionLabel}`}
                        />
                        <div className="flex justify-between font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground/85 mt-2">
                            <span>Store (0)</span><span>Balanced (6)</span><span>Maximum (9)</span>
                        </div>
                    </div>
                </div>
            )}

            <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85">
                <span className="text-accent">§</span> {files.length > 0 && `${formatFileSize(totalBytes)} uncompressed · `}Standard ZIP archive · password-encrypted output not yet supported
            </p>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
                <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Sealing…</> : <><Archive size={13} /> Create ZIP ({files.length} {files.length === 1 ? "file" : "files"})</>}
                </button>
                {canProcess && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
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
