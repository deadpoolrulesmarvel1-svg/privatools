/**
 * RotateUI — rotate PDF pages by 90°/180°/270° across one or many PDFs.
 * Multi-file via useMultiFileProcessor.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Download, Loader2, CheckCircle2, AlertCircle, RotateCw, RotateCcw, Upload } from "lucide-react";
import { cn, isValidPageRange, pageRangeError } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type Angle = 90 | 180 | 270;

const angles: { value: Angle; label: string; desc: string; preview: string }[] = [
    { value: 90,  label: "90° right",  desc: "Clockwise",          preview: "↻" },
    { value: 180, label: "180°",        desc: "Upside down",         preview: "↕" },
    { value: 270, label: "90° left",   desc: "Counter-clockwise",   preview: "↺" },
];

const ROTATE_DEFAULTS: { angle: Angle } = {
    angle: 90,
};

export function RotateUI() {
    const [config, , { setField }] = useToolDefaults("rotate-pdf", ROTATE_DEFAULTS);
    const { angle } = config;
    const setAngle = (v: React.SetStateAction<typeof ROTATE_DEFAULTS["angle"]>) => setField("angle", v);
    const proc = useMultiFileProcessor();

    const [pages, setPages] = useState("all");
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const rangeOk = pages === "all" || (pages.trim().length > 0 && isValidPageRange(pages));
    const canProcess = proc.entries.length > 0 && rangeOk && phase !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/rotate",
            outputSuffix: "rotated",
            outputExt: "pdf",
            params: { angle, pages: pages.trim() || "all" },
        }, retry);
        setPhase("done");
    }, [proc, angle, pages]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_rotated");
        }
    }, [phase, proc]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    const rangeErr = pages !== "all" ? pageRangeError(pages) : null;

    if (phase === "done") {
        const isMulti = proc.entries.length > 1;
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Rotated</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} rotated{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <>Pages rotated <span className="italic text-accent">{angle}°</span></>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    <span className="text-accent">§</span> {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_rotated")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                    <RotateCcw size={12} /> Rotate more
                                </button>
                            </div>
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
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <RotateCw size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Select PDFs to rotate"}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">
                    Multi-file OK · same angle applied to all · max {MAX_FILE_SIZE_LABEL} each
                </p>
            </div>

            {proc.entries.length > 0 && (
                <>
                    <MultiFileQueue
                        entries={proc.entries}
                        reorderable={false}
                        onRemove={proc.removeFile}
                        onReorder={proc.reorder}
                        onClearAll={proc.clearAll}
                        onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                        busy={phase === "processing"}
                    />

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Rotation angle
                        </div>
                        <div className="p-3 grid grid-cols-3 gap-2">
                            {angles.map((a, idx) => {
                                const active = angle === a.value;
                                return (
                                    <button
                                        key={a.value}
                                        onClick={() => setAngle(a.value)}
                                        className={cn(
                                            "flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40",
                                        )}
                                    >
                                        <div className={cn(
                                            "h-10 w-10 rounded-md flex items-center justify-center font-display text-[22px] font-bold leading-none transition-colors",
                                            active ? "bg-accent/15 text-accent border border-accent/30" : "bg-paper-2 text-muted-foreground border border-border",
                                        )}>
                                            {a.preview}
                                        </div>
                                        <div className="text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <span className="font-mono text-[9.5px] tracking-[0.10em] uppercase text-accent">{String(idx + 1).padStart(2, "0")}</span>
                                                <p className="font-display text-[13px] font-semibold text-foreground tracking-[-0.015em]">{a.label}</p>
                                            </div>
                                            <p className="text-[10.5px] text-muted-foreground mt-0.5">{a.desc}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Apply to
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setPages("all")}
                                    className={cn(
                                        "rounded-lg border py-2.5 px-3 text-[13px] font-medium transition-colors",
                                        pages === "all" ? "border-accent bg-accent/[0.06] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40",
                                    )}
                                >
                                    All pages
                                </button>
                                <button
                                    onClick={() => { if (pages === "all") setPages(""); }}
                                    className={cn(
                                        "rounded-lg border py-2.5 px-3 text-[13px] font-medium transition-colors",
                                        pages !== "all" ? "border-accent bg-accent/[0.06] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40",
                                    )}
                                >
                                    Specific pages
                                </button>
                            </div>
                            {pages !== "all" && (
                                <div className="space-y-1.5 animate-fade-in">
                                    <input
                                        type="text"
                                        value={pages}
                                        onChange={e => setPages(e.target.value)}
                                        placeholder="1,3,5-8"
                                        spellCheck={false}
                                        aria-invalid={!isValidPageRange(pages)}
                                        className={cn(
                                            "w-full rounded-md border bg-card px-3 py-2 font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 transition-colors",
                                            isValidPageRange(pages)
                                                ? "border-border focus:border-accent focus:ring-accent/20"
                                                : "border-destructive/60 focus:border-destructive focus:ring-destructive/20",
                                        )}
                                    />
                                    {rangeErr ? (
                                        <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-destructive">{rangeErr}</p>
                                    ) : (
                                        <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85">
                                            <span className="text-accent">§</span> Comma-separated · ranges with hyphen
                                            {proc.entries.length > 1 && <> · same range across all PDFs</>}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button type="button" onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Rotating… ({proc.doneCount}/{proc.entries.length})</>
                                : <><RotateCw size={13} /> Rotate {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"} {angle}°</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        {!rangeOk && (
                            <span className="font-mono text-[10.5px] tracking-[0.04em] uppercase text-muted-foreground/85 inline-flex items-center gap-1">
                                <AlertCircle size={11} /> Fix the page range
                            </span>
                        )}
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
