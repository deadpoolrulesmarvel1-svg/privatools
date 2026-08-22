/**
 * InvertColorsUI — invert PDF colors for dark mode reading.
 *
 * Mode picker (Full vs Night), DPI picker, workshop dropzone.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, Moon, Sun, CheckCircle2, X, FileText, Download, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const INVERT_COLORS_DEFAULTS: { mode: "full" | "night"; dpi: number } = {
    mode: "full",
    dpi: 150,
};

export function InvertColorsUI() {
    const [config, , { setField }] = useToolDefaults("invert-colors", INVERT_COLORS_DEFAULTS);
    const { mode, dpi } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof INVERT_COLORS_DEFAULTS["mode"]>) => setField("mode", v), [setField]);
    const setDpi = useCallback((v: React.SetStateAction<typeof INVERT_COLORS_DEFAULTS["dpi"]>) => setField("dpi", v), [setField]);
    const [file, setFile] = useState<File | null>(null);

    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const outputName = file ? buildOutputFilename(file.name, "inverted", "pdf") : "inverted.pdf";

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing");
        setError(null);
        try {
            const res = await uploadFile("/invert-colors", file, { dpi, mode });
            const blob = await res.blob();
            setResultBlob(blob);
            downloadBlob(blob, outputName);
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't invert colors on that PDF."));
            setStatus("idle");
        }
    }, [file, dpi, mode, outputName]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && status === "idle") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file, status, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks accent />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Colors inverted</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{mode === "night" ? "Night-mode" : "Inverted"}</span> PDF downloaded
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && downloadBlob(resultBlob, outputName)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download again
                            </button>
                            <button onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60">
                                <RotateCcw size={12} /> Process another
                            </button>
                        </div>
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
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
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
                    <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => { e.target.files?.[0] && setFile(e.target.files[0]); e.target.value = ""; }} />
                    <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                        <Moon size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Drop a PDF to invert colors</p>
                    <p className="font-medium text-[11.5px] text-muted-foreground">Dark mode for any document</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                    <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                        <FileText size={16} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                        <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">{formatFileSize(file.size)}</p>
                    </div>
                    <button onClick={() => setFile(null)} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60" aria-label="Remove file">
                        <X size={13} />
                    </button>
                </div>
            )}

            {/* Mode + DPI */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Options
                </div>
                <div className="p-5 space-y-5">
                    {/* Mode */}
                    <div>
                        <p className="font-medium text-[11.5px] text-muted-foreground mb-2">Inversion mode</p>
                        <div className="grid grid-cols-2 gap-2">
                            {([
                                { id: "full" as const,  label: "Full invert", desc: "Flip every color", icon: Moon },
                                { id: "night" as const, label: "Night mode",  desc: "Warm dark tint",   icon: Sun  },
                            ]).map((m, idx) => {
                                const active = mode === m.id;
                                const Icon = m.icon;
                                return (
                                    <button
                                        key={m.id}
                                        onClick={() => setMode(m.id)}
                                        className={cn(
                                            "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <div className={cn(
                                            "h-9 w-9 rounded-md flex items-center justify-center shrink-0",
                                            active ? "bg-accent/15 border border-accent/30 text-accent" : "bg-paper-2 text-muted-foreground border border-border"
                                        )}>
                                            <Icon size={16} />
                                        </div>
                                        <div>
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="font-medium text-[11px] text-accent">{String(idx + 1).padStart(2, "0")}</span>
                                                <p className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">{m.label}</p>
                                            </div>
                                            <p className="text-[11.5px] text-muted-foreground mt-0.5">{m.desc}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* DPI */}
                    <div>
                        <p className="font-medium text-[11.5px] text-muted-foreground mb-2">Quality (DPI)</p>
                        <div className="grid grid-cols-3 gap-1.5">
                            {[
                                { val: 72,  label: "Fast",     hint: "72 dpi" },
                                { val: 150, label: "Balanced", hint: "150 dpi" },
                                { val: 200, label: "Sharp",    hint: "200 dpi" },
                            ].map(d => {
                                const active = dpi === d.val;
                                return (
                                    <button
                                        key={d.val}
                                        onClick={() => setDpi(d.val)}
                                        className={cn(
                                            "rounded-md border py-2 transition-colors",
                                            active ? "border-accent bg-accent/[0.06] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                        )}
                                    >
                                        <p className="font-display text-[13px] font-semibold tracking-[-0.015em]">{d.label}</p>
                                        <p className="font-mono text-[10px] tracking-wide text-muted-foreground">{d.hint}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {file && (
                <div className="flex items-center gap-3">
                    <button onClick={process} disabled={status === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Inverting…</> : <><Download size={13} /> Invert colors</>}
                    </button>
                    {status === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
