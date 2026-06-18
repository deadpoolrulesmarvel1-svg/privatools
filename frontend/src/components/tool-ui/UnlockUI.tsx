/**
 * UnlockUI — remove password protection from one or more PDFs.
 * Workshop dropzone + vault-style password panel.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, X, FileText, AlertCircle, Eye, EyeOff, LockOpen, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename, MAX_FILE_SIZE_LABEL } from "@/lib/api";

type UnlockFile = { id: string; name: string; size: string; raw: File };
let fileId = 0;

export function UnlockUI() {
    const [files, setFiles] = useState<UnlockFile[]>([]);
    const [password, setPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const addFiles = (fl: FileList) => {
        const next: UnlockFile[] = Array.from(fl)
            .filter(f => f.name.toLowerCase().endsWith(".pdf"))
            .map(f => ({ id: String(++fileId), name: f.name, size: formatFileSize(f.size), raw: f }));
        if (next.length) { setFiles(prev => [...prev, ...next]); setState("idle"); setError(null); }
    };
    const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
    const canProcess = files.length > 0 && !!password && state !== "processing";

    const process = useCallback(async () => {
        if (!files.length || !password) return;
        setState("processing"); setError(null);
        try {
            const outExt = files.length === 1 ? "pdf" : "zip";
            const outName = buildOutputFilename(files[0]?.raw.name, "unlocked", outExt);
            await processFilesAndDownload("/unlock", files.map(f => f.raw), outName, { password });
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Unlock failed";
            setError(friendlyError(msg, "Couldn't unlock that PDF. The password may be wrong."));
            setState("idle");
        }
    }, [files, password]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
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
                        <p className="section-mark mb-2">Unlocked</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{files.length}</span> file{files.length !== 1 && "s"} freed
                        </h2>
                        <button
                            onClick={() => { setFiles([]); setState("idle"); setPassword(""); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Unlock more
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
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDFs"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <LockOpen size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{files.length ? "Add more PDFs" : "Select protected PDFs"}</p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">Multiple files · single password · max {MAX_FILE_SIZE_LABEL}</p>
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
                                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">{f.size}</p>
                                </div>
                                <button onClick={() => removeFile(f.id)} className="h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60" aria-label="Remove">
                                    <X size={13} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Document password
                        </div>
                        <div className="p-4 space-y-2">
                            <div className="relative">
                                <input
                                    type={showPw ? "text" : "password"}
                                    value={password} onChange={e => setPassword(e.target.value)}
                                    placeholder="Enter the existing password"
                                    autoFocus
                                    autoComplete="current-password"
                                    className="w-full rounded-md border border-border bg-card px-3 py-2.5 pr-10 font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPw(!showPw)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                                    aria-label={showPw ? "Hide password" : "Show password"}
                                    aria-pressed={showPw}
                                >
                                    {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                            </div>
                            <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85">
                                <span className="text-accent">§</span> {files.length > 1 ? `Same password applied to all ${files.length} files` : "We unlock locally — never sent to a third party"}
                            </p>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Unlocking…</> : <><LockOpen size={13} /> Unlock {files.length > 1 ? `${files.length} PDFs` : "PDF"}</>}
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
