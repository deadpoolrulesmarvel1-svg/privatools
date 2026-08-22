/**
 * BatesUI — sequential legal-style Bates numbering on every page of one or many PDFs.
 *
 * Multiple files are stamped as ONE continuous sequence: file 2 picks up where
 * file 1 stopped, which is what a production set actually requires. That runs
 * through the single-request /bates-numbering-batch endpoint rather than N
 * independent calls, because the numbering has to be decided server-side in one
 * pass — and because a production is atomic. Half a numbered set is not a
 * partial success, it is a set you have to redo.
 *
 * A single file still uses /bates-numbering, which keeps the per-file queue UI.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertCircle, Hash, RotateCcw, Upload, Download, Undo2, Info } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, friendlyError } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL, uploadFiles, downloadBlob } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { BatesCounterPicker } from "@/components/BatesCounterPicker";
import * as counters from "@/lib/localStore/counters";
import { countPdfPages } from "@/lib/pdfMeta";
import { blobBytes } from "@/lib/localStore/blobs";

const positions = [
    { id: "top-left",      label: "Top-L",  row: 0, col: 0 },
    { id: "top-center",    label: "Top-C",  row: 0, col: 1 },
    { id: "top-right",     label: "Top-R",  row: 0, col: 2 },
    { id: "bottom-left",   label: "Bot-L",  row: 1, col: 0 },
    { id: "bottom-center", label: "Bot-C",  row: 1, col: 1 },
    { id: "bottom-right",  label: "Bot-R",  row: 1, col: 2 },
];

const BATES_DEFAULTS = {
    prefix: "DOC-",
    suffix: "",
    startNumber: 1,
    digits: 6,
    position: "bottom-right",
};

interface BatesManifestEntry {
    index: number;
    pages: number;
    firstBates: string;
    lastBates: string;
    file?: string;
}

export function BatesUI() {
    const proc = useMultiFileProcessor();
    const [config, setConfig, { restored, reset: resetConfig }] = useToolDefaults("bates-numbering", BATES_DEFAULTS, { legacyKey: "bates" });
    const { prefix, suffix, startNumber, digits, position } = config;
    const setPrefix = (v: string) => setConfig(c => ({ ...c, prefix: v }));
    const setSuffix = (v: string) => setConfig(c => ({ ...c, suffix: v }));
    const setStartNumber = (v: number) => setConfig(c => ({ ...c, startNumber: v }));
    const setDigits = (v: number) => setConfig(c => ({ ...c, digits: v }));
    const setPosition = (v: string) => setConfig(c => ({ ...c, position: v }));
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Active Bates matter, if the user has created one. Numbering continues
    // across documents and sessions per matter — a single global counter would
    // silently corrupt numbering the moment someone works two cases.
    const [matter, setMatter] = useState<counters.BatesCounter | null>(null);
    const [advancedTo, setAdvancedTo] = useState<string | null>(null);
    const [manifest, setManifest] = useState<BatesManifestEntry[] | null>(null);
    const [batchError, setBatchError] = useState<string | null>(null);

    // Seed the stamp settings from the active matter.
    const activateMatter = useCallback((c: counters.BatesCounter | null) => {
        setMatter(c);
        if (!c) return;
        setConfig(prev => ({ ...prev, prefix: c.prefix, digits: c.digits, position: c.position, startNumber: c.next }));
    }, [setConfig]);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (restored) toast.message("Restored previous settings", { description: "Picked up where you left off.", duration: 3000 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const sample = `${prefix}${String(startNumber).padStart(digits, "0")}${suffix}`;
    const canProcess = proc.entries.length > 0 && phase !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        setBatchError(null);

        // More than one file is a production set, and a production set carries
        // ONE sequence. That has to be decided in a single server-side pass —
        // N independent calls would restart every file at `startNumber`.
        const files = proc.entries.map(e => e.file);
        if (files.length > 1) {
            try {
                const res = await uploadFiles("/bates-numbering-batch", files, {
                    prefix, suffix, start_number: startNumber, digits, position,
                });
                const header = res.headers.get("X-Bates-Manifest");
                if (header) {
                    try { setManifest(JSON.parse(header) as BatesManifestEntry[]); }
                    catch { /* header is a convenience; the ZIP is the deliverable */ }
                }
                downloadBlob(await res.blob(), "bates_numbered.zip");
                setPhase("done");
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : "Failed";
                setBatchError(friendlyError(msg, "Couldn't number that set."));
                setPhase("idle");
            }
            return;
        }

        await proc.run({
            endpoint: "/bates-numbering",
            outputSuffix: "bates",
            outputExt: "pdf",
            params: { prefix, suffix, start_number: startNumber, digits, position },
        }, retry);
        setPhase("done");

        // Advance the matter's counter ONLY for files that actually succeeded.
        // Gaps in a Bates sequence are a real problem in discovery, so we never
        // advance optimistically, and never for a failed file.
        if (matter && proc.doneCount > 0) {
            const stamped = proc.entries
                .filter(e => e.status === "done")
                .map(e => e.file);
            try {
                const pages = await countPdfPages(stamped, blobBytes);
                if (pages > 0) {
                    const updated = await counters.advanceCounter(matter.id, pages);
                    setMatter(updated);
                    setAdvancedTo(counters.formatNext(updated));
                }
            } catch {
                /* counting failed — leave the counter untouched rather than
                   guessing, and let the user correct it in /my-stuff */
            }
        }
    }, [proc, prefix, suffix, startNumber, digits, position, matter]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !manifest && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_bates");
        }
    }, [phase, proc, manifest]);

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
                            <p className="section-mark mb-2">Bates numbered</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {manifest
                                    ? <>Numbered <span className="italic text-accent">{manifest[0]?.firstBates}</span> to <span className="italic text-accent">{manifest[manifest.length - 1]?.lastBates}</span></>
                                    : isMulti
                                    ? <><span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount === 1 ? "" : "s"} stamped{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <>Stamped from <span className="italic text-accent">{sample}</span></>}
                            </h2>
                            {manifest && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {manifest.length} files · one continuous sequence ·{" "}
                                    {manifest.reduce((n, m) => n + m.pages, 0)} pages · ZIP downloaded
                                </p>
                            )}
                            {!manifest && isMulti && proc.doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"} · starting at {sample}
                                </p>
                            )}
                            {advancedTo && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {matter?.name} continues at <span className="text-accent">{advancedTo}</span> next time
                                </p>
                            )}
                            {manifest && (
                                <div className="mt-4 rounded-lg border border-border bg-card/60 overflow-hidden">
                                    <div className="font-medium px-3 py-1.5 border-b border-border bg-paper-2/40 text-[11px] text-muted-foreground">
                                        Numbering manifest
                                    </div>
                                    <div className="max-h-56 overflow-y-auto divide-y divide-border">
                                        {manifest.map(m => (
                                            <div key={m.index} className="px-3 py-1.5 flex items-baseline justify-between gap-3 font-mono text-[11.5px]">
                                                <span className="truncate text-muted-foreground">{m.file ?? `File ${m.index + 1}`}</span>
                                                <span className="shrink-0 tabular-nums text-foreground">
                                                    {m.firstBates}<span className="text-muted-foreground"> – </span>{m.lastBates}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="px-3 py-1.5 border-t border-border font-mono text-[10px] tracking-[0.04em] text-muted-foreground/80">
                                        Also saved as bates-manifest.json inside the ZIP
                                    </p>
                                </div>
                            )}

                            <div className="mt-5 flex flex-wrap gap-2">
                                {(manifest || proc.doneCount > 0) && (
                                    <button onClick={() => proc.downloadAll("archive_bates")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
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
                                    onClick={() => { proc.reset(); setPhase("idle"); downloadedRef.current = false; setAdvancedTo(null); setManifest(null); setBatchError(null); }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Number more
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
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Hash size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Select PDFs to Bates-stamp"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Multi-file OK · each starts at {sample} · max {MAX_FILE_SIZE_LABEL} each
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

                    {batchError && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive" role="alert">
                            <AlertCircle size={13} className="shrink-0" />{batchError}
                        </div>
                    )}

                    <BatesCounterPicker onActivate={activateMatter} />

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Number format</span>
                            <span className="text-accent">{sample}</span>
                        </div>
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <div className="sm:col-span-1">
                                <label className="font-medium text-[11px] text-muted-foreground">Prefix</label>
                                <input
                                    value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="DOC-"
                                    maxLength={32}
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                            </div>
                            <div className="sm:col-span-1">
                                <label className="font-medium text-[11px] text-muted-foreground">Suffix</label>
                                <input
                                    value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="-CONF"
                                    maxLength={32}
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                            </div>
                            <div>
                                <label className="font-medium text-[11px] text-muted-foreground">Start</label>
                                <input
                                    type="number" inputMode="numeric" value={startNumber}
                                    onChange={e => setStartNumber(Math.max(1, Math.min(9999999, parseInt(e.target.value) || 1)))} min={1} max={9999999}
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                            </div>
                            <div>
                                <label htmlFor="bates-digits" className="font-medium text-[11px] text-muted-foreground inline-flex items-center gap-1">
                                    Digits
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                aria-label="What does the digits field do?"
                                                className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full text-muted-foreground/70 hover:text-foreground transition-colors"
                                            >
                                                <Info size={10} aria-hidden="true" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[240px] text-[12px] leading-relaxed font-sans normal-case tracking-normal">
                                            Pad the page number with leading zeros so every stamp is the same width. <span className="font-semibold">6</span> matches the legal-discovery convention (DOC-000001). Use a smaller value for short documents, larger for cases over a million pages.
                                        </TooltipContent>
                                    </Tooltip>
                                </label>
                                <input
                                    id="bates-digits"
                                    type="number" inputMode="numeric" value={digits}
                                    onChange={e => setDigits(Math.max(1, Math.min(12, parseInt(e.target.value) || 6)))} min={1} max={12}
                                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                            </div>
                        </div>
                    </div>

                    {proc.entries.length > 1 && (
                        <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-2 text-[12px] text-foreground">
                            <Info size={12} className="shrink-0 mt-0.5 text-accent" />
                            <span>
                                All {proc.entries.length} files are numbered as one continuous run
                                starting at <span className="font-mono font-semibold text-foreground">{sample}</span>.
                                You'll get a ZIP with a numbering manifest.
                            </span>
                        </div>
                    )}

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Stamp position
                        </div>
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-5 items-center">
                            <div className="grid grid-cols-3 gap-2">
                                {positions.map(p => {
                                    const active = position === p.id;
                                    return (
                                        <button
                                            key={p.id}
                                            onClick={() => setPosition(p.id)}
                                            className={cn(
                                                "font-medium rounded-lg border py-2 px-2 text-[11.5px] transition-colors",
                                                active ? "border-accent bg-accent/[0.08] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40",
                                            )}
                                        >
                                            {p.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="relative aspect-[3/4] bg-paper-2/40 border border-border rounded-md mx-auto w-full max-w-[140px]">
                                {positions.map(p => {
                                    const active = position === p.id;
                                    const dy = p.row === 0 ? "top-2" : "bottom-2";
                                    const dx = p.col === 0 ? "left-2" : p.col === 1 ? "left-1/2 -translate-x-1/2" : "right-2";
                                    return (
                                        <span
                                            key={p.id}
                                            className={cn(
                                                "absolute font-mono text-[7.5px] tracking-tight transition-colors",
                                                dy, dx,
                                                active ? "text-accent font-semibold" : "text-muted-foreground/40",
                                            )}
                                        >
                                            {sample}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button type="button" onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Stamping… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Hash size={13} /> Stamp {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                        <button
                            type="button"
                            onClick={resetConfig}
                            className="font-medium ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            title="Restore default settings"
                        >
                            <Undo2 size={10} /> Reset to defaults
                        </button>
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
