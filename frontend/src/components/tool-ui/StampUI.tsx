/**
 * StampUI — rubber-stamp PDF pages with CONFIDENTIAL / DRAFT / APPROVED etc.
 * Workshop: stamp preset gallery showing actual stamp look, position picker, opacity slider.
 * Multi-file via useMultiFileProcessor — same stamp applied to every PDF.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, Stamp, RotateCcw, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

const STAMP_PRESETS = [
    { value: "confidential", label: "CONFIDENTIAL", tone: "destructive" },
    { value: "draft",         label: "DRAFT",         tone: "muted" },
    { value: "approved",      label: "APPROVED",      tone: "accent" },
    { value: "final",         label: "FINAL",         tone: "accent" },
    { value: "copy",          label: "COPY",          tone: "muted" },
    { value: "void",          label: "VOID",          tone: "destructive" },
    { value: "sample",        label: "SAMPLE",        tone: "muted" },
    { value: "not_approved",  label: "NOT APPROVED",  tone: "destructive" },
    { value: "custom",        label: "Custom",        tone: "accent" },
];

const POSITIONS = [
    { value: "center",   label: "Center" },
    { value: "diagonal", label: "Diagonal" },
    { value: "top",      label: "Top" },
    { value: "bottom",   label: "Bottom" },
];

const STAMP_DEFAULTS: { stampType: string; customText: string; opacity: number; position: string } = {
    stampType: "confidential",
    customText: "",
    opacity: 30,
    position: "center",
};

export function StampUI() {
    const [config, , { setField }] = useToolDefaults("stamp-pdf", STAMP_DEFAULTS);
    const { stampType, customText, opacity, position } = config;
    const setStampType = useCallback((v: React.SetStateAction<typeof STAMP_DEFAULTS["stampType"]>) => setField("stampType", v), [setField]);
    const setCustomText = useCallback((v: React.SetStateAction<typeof STAMP_DEFAULTS["customText"]>) => setField("customText", v), [setField]);
    const setOpacity = useCallback((v: React.SetStateAction<typeof STAMP_DEFAULTS["opacity"]>) => setField("opacity", v), [setField]);
    const setPosition = useCallback((v: React.SetStateAction<typeof STAMP_DEFAULTS["position"]>) => setField("position", v), [setField]);
    const proc = useMultiFileProcessor();

    const [pages, setPages] = useState("all");
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");

    const activePreset = STAMP_PRESETS.find(s => s.value === stampType);
    const displayText = stampType === "custom" ? (customText.trim().toUpperCase() || "CUSTOM") : (activePreset?.label || "");

    const toneClasses = (tone: string, active: boolean) => {
        if (!active) return "border-border bg-card text-muted-foreground hover:border-accent/55 hover:text-foreground";
        if (tone === "destructive") return "border-destructive/55 bg-destructive/[0.08] text-destructive";
        if (tone === "accent") return "border-accent bg-accent/[0.08] text-accent";
        return "border-foreground/45 bg-secondary/60 text-foreground";
    };

    const stampPreviewColor = activePreset?.tone === "destructive" ? "hsl(var(--destructive))" : activePreset?.tone === "accent" ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))";

    const canProcess = proc.entries.length > 0 && phase !== "processing" && !(stampType === "custom" && !customText.trim());

    const process = useCallback(async (retry = false) => {
        const params: Record<string, string | number | boolean> = {
            stamp_type: stampType,
            opacity: opacity / 100,
            position,
            pages,
        };
        if (stampType === "custom" && customText.trim()) params.custom_text = customText.trim();
        setPhase("processing");
        await proc.run({
            endpoint: "/stamp-pdf",
            outputSuffix: "stamped",
            outputExt: "pdf",
            params,
        }, retry);
        setPhase("done");
    }, [proc, stampType, opacity, position, pages, customText]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_stamped");
        }
    }, [phase, proc]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
            if ((tag === "input" || tag === "textarea") && !((e.metaKey || e.ctrlKey) && e.key === "Enter")) return;
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

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
                            <p className="section-mark mb-2">Stamp applied</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} marked <span className="italic text-accent">{displayText}</span>{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <>Marked <span className="italic text-accent">{displayText}</span></>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={() => proc.downloadAll("archive_stamped")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                <button
                                    onClick={() => { proc.reset(); setPhase("idle"); downloadedRef.current = false; }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Stamp another
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
            <FileUploadZone
                file={null}
                onFileSelect={f => proc.addFiles([f])}
                onFilesSelect={fs => proc.addFiles(fs)}
                onClear={proc.clearAll}
                multiple
                accept=".pdf"
                label={proc.entries.length ? "Add more files" : "Drop PDFs to stamp"}
                hint="Apply CONFIDENTIAL / DRAFT / APPROVED etc. · same stamp on every file"
            />

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

                    {/* Stamp gallery */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Stamp text
                        </div>
                        <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-2">
                            {STAMP_PRESETS.map(s => {
                                const active = stampType === s.value;
                                return (
                                    <button
                                        key={s.value}
                                        onClick={() => setStampType(s.value)}
                                        className={cn(
                                            "rounded-lg border py-3 px-2 text-center font-display text-[12.5px] font-bold tracking-[0.04em] transition-colors",
                                            toneClasses(s.tone, active)
                                        )}
                                    >
                                        {s.label}
                                    </button>
                                );
                            })}
                        </div>
                        {stampType === "custom" && (
                            <div className="border-t border-border p-4 animate-fade-in">
                                <label className="font-medium text-[11px] text-muted-foreground">Custom text</label>
                                <input
                                    type="text" value={customText} onChange={e => setCustomText(e.target.value)}
                                    placeholder="e.g. REVIEW COPY" maxLength={30}
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-display font-bold tracking-wider text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                            </div>
                        )}
                    </div>

                    {/* Placement + preview */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Placement</span>
                            <span className="text-accent">{opacity}% opacity</span>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5 p-4 items-center">
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {POSITIONS.map(p => {
                                        const active = position === p.value;
                                        return (
                                            <button
                                                key={p.value}
                                                onClick={() => setPosition(p.value)}
                                                className={cn(
                                                    "rounded-lg border py-2 px-2 text-[12.5px] font-medium transition-colors",
                                                    active ? "border-accent bg-accent/[0.08] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                                )}
                                            >
                                                {p.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div>
                                    <div className="flex items-center justify-between">
                                        <label className="font-medium text-[11px] text-muted-foreground">Opacity</label>
                                        <span className="font-mono text-[11px] text-accent">{opacity}%</span>
                                    </div>
                                    <input
                                        type="range" min={5} max={100} value={opacity}
                                        onChange={e => setOpacity(+e.target.value)}
                                        aria-label={`Stamp opacity: ${opacity} percent`}
                                        className="mt-2 w-full accent-accent"
                                    />
                                </div>
                                <div>
                                    <label className="font-medium text-[11px] text-muted-foreground">Pages</label>
                                    <input
                                        value={pages} onChange={e => setPages(e.target.value)}
                                        placeholder="all · 1,3,5-8"
                                        className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                    />
                                    {proc.entries.length > 1 && (
                                        <p className="font-medium text-[11px] text-muted-foreground mt-1">
                                            Same pages · same stamp across all {proc.entries.length} PDFs
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Mini preview */}
                            <div className="relative aspect-[3/4] bg-card border border-border rounded-md mx-auto w-full max-w-[180px] overflow-hidden">
                                <div className="absolute inset-0 grid grid-cols-1 grid-rows-6 gap-1 p-3 opacity-30">
                                    {Array.from({ length: 12 }).map((_, i) => (
                                        <div key={i} className="h-px bg-muted-foreground/40" />
                                    ))}
                                </div>
                                <div
                                    className={cn(
                                        "absolute inset-0 flex font-display font-extrabold pointer-events-none",
                                        position === "top" && "items-start justify-center pt-3",
                                        position === "bottom" && "items-end justify-center pb-3",
                                        position === "center" && "items-center justify-center",
                                        position === "diagonal" && "items-center justify-center",
                                    )}
                                >
                                    <span
                                        className="px-2 py-0.5 border-2 rounded"
                                        style={{
                                            color: stampPreviewColor,
                                            borderColor: stampPreviewColor,
                                            opacity: opacity / 100,
                                            transform: position === "diagonal" ? "rotate(-25deg)" : undefined,
                                            fontSize: Math.max(9, Math.min(displayText.length > 10 ? 11 : 14, 18)),
                                        }}
                                    >
                                        {displayText}
                                    </span>
                                </div>
                                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-wider text-muted-foreground">page</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => void process(false)}
                            disabled={!canProcess}
                            className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Stamping… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Stamp size={13} /> Apply stamp{proc.entries.length > 1 ? ` — ${proc.entries.length} PDFs` : ""}</>}
                        </button>
                        {canProcess && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>
                        )}
                        {proc.entries.length > 0 && stampType === "custom" && !customText.trim() && phase !== "processing" && (
                            <span className="font-medium text-[11.5px] text-muted-foreground inline-flex items-center gap-1">
                                <AlertCircle size={11} /> Enter the custom text first
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
