/**
 * AlternateMixUI — interleave pages from two PDFs.
 *
 * Two-pane file picker, mode toggle, workshop styling.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { Upload, Shuffle, Loader2, AlertCircle, FileText, X, CheckCircle2, Download, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, buildOutputFilename, postFormData } from "@/lib/api";

type MixMode = "alternate" | "reverse-alternate";

const MODES: { value: MixMode; label: string; desc: string }[] = [
    { value: "alternate",         label: "Alternate",         desc: "1A · 1B · 2A · 2B …" },
    { value: "reverse-alternate", label: "Reverse alternate", desc: "1A · lastB · 2A · prevB …" },
];

interface FileBox { name: string; size: string; raw: File }

export function AlternateMixUI() {
    const [file1, setFile1] = useState<FileBox | null>(null);
    const [file2, setFile2] = useState<FileBox | null>(null);
    const [mode, setMode] = useState<MixMode>("alternate");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const r1 = useRef<HTMLInputElement>(null);
    const r2 = useRef<HTMLInputElement>(null);

    const outputName = file1 ? buildOutputFilename(file1.name, "alternate_mix", "pdf") : "alternate_mix.pdf";

    const process = useCallback(async () => {
        if (!file1 || !file2) return;
        setState("processing");
        setError(null);
        try {
            const res = await postFormData("/alternate-mix", () => {
                const fd = new FormData();
                fd.append("file1", file1.raw);
                fd.append("file2", file2.raw);
                fd.append("mode", mode);
                return fd;
            }, { timeoutMs: 300_000 });
            const blob = await res.blob();
            setResultBlob(blob);
            downloadBlob(blob, outputName);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Alternate mix failed";
            setError(friendlyError(msg, "Couldn't alternate-mix those PDFs."));
            setState("idle");
        }
    }, [file1, file2, mode, outputName]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file1 && file2 && state === "idle") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file1, file2, state, process]);

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks accent />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Mix complete</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">Pages interleaved</span>
                        </h2>
                        <p className="mt-2 font-mono text-[11px] tracking-[0.06em] uppercase text-muted-foreground">{outputName}</p>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && downloadBlob(resultBlob, outputName)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download again
                            </button>
                            <button onClick={() => { setFile1(null); setFile2(null); setState("idle"); setResultBlob(null); }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60">
                                <RotateCcw size={12} /> Mix another pair
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FileSlot label="A" file={file1} setFile={setFile1} inputRef={r1} />
                <FileSlot label="B" file={file2} setFile={setFile2} inputRef={r2} />
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span className="text-accent">§</span> Mix mode
                </div>
                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {MODES.map((m, idx) => {
                        const active = mode === m.value;
                        return (
                            <button
                                key={m.value}
                                onClick={() => setMode(m.value)}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                                    active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                )}
                            >
                                <div className={cn(
                                    "h-9 w-9 rounded-md flex items-center justify-center shrink-0 transition-colors",
                                    active ? "bg-accent/15 border border-accent/30" : "bg-paper-2 border border-border"
                                )}>
                                    <Shuffle size={14} className={active ? "text-accent" : "text-muted-foreground"} />
                                </div>
                                <div>
                                    <div className="flex items-baseline gap-1.5">
                                        <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent">{String(idx + 1).padStart(2, "0")}</span>
                                        <p className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">{m.label}</p>
                                    </div>
                                    <p className="font-mono text-[10.5px] tracking-wider text-muted-foreground mt-0.5">{m.desc}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3">
                <button onClick={process} disabled={!file1 || !file2 || state === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Mixing…</> : <><Shuffle size={13} /> Mix PDFs</>}
                </button>
                {file1 && file2 && state === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
            </div>
        </div>
    );
}

function FileSlot({
    label, file, setFile, inputRef,
}: {
    label: string;
    file: FileBox | null;
    setFile: (f: FileBox | null) => void;
    inputRef: React.RefObject<HTMLInputElement>;
}) {
    const [drag, setDrag] = useState(false);
    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                <span className="text-accent">§</span> File {label}
            </div>
            {!file ? (
                <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => {
                        e.preventDefault(); setDrag(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
                    }}
                    onClick={() => inputRef.current?.click()}
                    className={cn(
                        "flex flex-col items-center gap-2 m-3 rounded-lg border-2 border-dashed cursor-pointer py-6 px-4 transition-colors",
                        drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <input
                        ref={inputRef}
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
                            e.target.value = "";
                        }}
                    />
                    <div className="h-10 w-10 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center">
                        <Upload size={16} className="text-accent" />
                    </div>
                    <p className="font-display text-[14px] text-foreground tracking-[-0.015em]">Select PDF {label}</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 px-4 py-3">
                    <div className="h-9 w-9 rounded-md bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                        <FileText size={14} className="text-accent" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{file.name}</p>
                        <p className="font-mono text-[10px] tracking-wider text-muted-foreground mt-0.5">{file.size}</p>
                    </div>
                    <button onClick={() => setFile(null)} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors" aria-label="Remove">
                        <X size={13} />
                    </button>
                </div>
            )}
        </div>
    );
}

function CornerMarks({ accent }: { accent?: boolean }) {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    const color = accent ? "bg-accent" : "bg-accent/70";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}><span className={`absolute top-0 left-0 h-px w-3 ${color}`} /><span className={`absolute top-0 left-0 w-px h-3 ${color}`} /></span>
            <span className={`${cls} -top-1 -right-1`}><span className={`absolute top-0 right-0 h-px w-3 ${color}`} /><span className={`absolute top-0 right-0 w-px h-3 ${color}`} /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className={`absolute bottom-0 left-0 h-px w-3 ${color}`} /><span className={`absolute bottom-0 left-0 w-px h-3 ${color}`} /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className={`absolute bottom-0 right-0 h-px w-3 ${color}`} /><span className={`absolute bottom-0 right-0 w-px h-3 ${color}`} /></span>
        </>
    );
}
