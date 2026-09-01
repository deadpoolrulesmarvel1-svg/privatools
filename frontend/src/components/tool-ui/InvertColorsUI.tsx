/**
 * InvertColorsUI — invert PDF colors for dark mode reading.
 *
 * Mode picker (Full vs Night), DPI picker, workshop dropzone.
 * Multi-file via useMultiFileProcessor — same mode/DPI applied to every PDF.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, Moon, Sun, CheckCircle2, Download, RotateCcw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const INVERT_COLORS_DEFAULTS: { mode: "full" | "night"; dpi: number } = {
    mode: "full",
    dpi: 150,
};

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function InvertColorsUI() {
    const [config, , { setField }] = useToolDefaults("invert-colors", INVERT_COLORS_DEFAULTS);
    const { mode, dpi } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof INVERT_COLORS_DEFAULTS["mode"]>) => setField("mode", v), [setField]);
    const setDpi = useCallback((v: React.SetStateAction<typeof INVERT_COLORS_DEFAULTS["dpi"]>) => setField("dpi", v), [setField]);
    const proc = useMultiFileProcessor();

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Same naming as before: "<stem>_inverted.pdf". The server sends a generic
    // "inverted.pdf" so we name client-side.
    const outNameFor = useCallback((name: string) => buildOutputFilename(name, "inverted", "pdf"), []);

    const downloadResults = useCallback(() => {
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, outNameFor(done[0].name));
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: outNameFor(e.name),
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), "archive_inverted.zip");
        })();
    }, [proc.entries, outNameFor]);

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/invert-colors",
            outputSuffix: "inverted",
            outputExt: "pdf",
            params: { dpi, mode },
        }, retry);
        setPhase("done");
    }, [proc, dpi, mode]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            downloadResults();
        }
    }, [phase, proc.doneCount, downloadResults]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess && phase === "idle") {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, phase, process]);

    if (phase === "done") {
        const isMulti = proc.entries.length > 1;
        return (
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
                                {isMulti || proc.doneCount === 0
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> PDF{proc.doneCount === 1 ? "" : "s"} inverted{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">{mode === "night" ? "Night-mode" : "Inverted"}</span> PDF downloaded</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={downloadResults} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                <button onClick={() => { proc.reset(); setPhase("idle"); downloadedRef.current = false; }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60">
                                    <RotateCcw size={12} /> Process another
                                </button>
                            </div>
                            {proc.failedCount > 0 && (
                                <div className="mt-4 space-y-1.5">
                                    {proc.entries.filter(e => e.status === "failed").map(e => (
                                        <p key={e.id} className="flex items-center gap-2 text-[12px] text-destructive">
                                            <AlertCircle size={12} className="shrink-0" /> {e.name}: {e.error}
                                        </p>
                                    ))}
                                </div>
                            )}
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
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDFs"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Moon size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Drop PDFs to invert colors"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">Dark mode for any document · several files become a ZIP</p>
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

            {proc.entries.length > 0 && (
                <div className="flex items-center gap-3">
                    <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {phase === "processing"
                            ? <><Loader2 size={13} className="animate-spin" /> Inverting… ({proc.doneCount}/{proc.entries.length})</>
                            : <><Download size={13} /> Invert colors{proc.entries.length > 1 ? ` — ${proc.entries.length} PDFs` : ""}</>}
                    </button>
                    {phase === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
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
