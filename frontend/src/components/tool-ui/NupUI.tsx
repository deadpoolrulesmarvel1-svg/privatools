/**
 * NupUI — combine multiple PDF pages onto each sheet (2-up / 4-up / 6-up / 9-up / 16-up).
 * Option cards with mini layout previews.
 * Multi-file via useMultiFileProcessor — the same layout is applied to every PDF.
 */
import { useState, useEffect, useCallback } from "react";
import { Layout } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const opts = [
    { id: 2,  label: "2-up",  cols: 2, rows: 1 },
    { id: 4,  label: "4-up",  cols: 2, rows: 2 },
    { id: 6,  label: "6-up",  cols: 2, rows: 3 },
    { id: 9,  label: "9-up",  cols: 3, rows: 3 },
    { id: 16, label: "16-up", cols: 4, rows: 4 },
];

// Orientation only matters for 2-up: side-by-side (2×1) or stacked (1×2)
type Orient = "horizontal" | "vertical";

const ORIENTATIONS: { id: Orient; label: string; hint: string }[] = [
    { id: "horizontal", label: "Side-by-side", hint: "2 × 1" },
    { id: "vertical",   label: "Stacked",      hint: "1 × 2" },
];

const NUP_DEFAULTS: { pps: number; orient: Orient } = {
    pps: 2,
    orient: "horizontal",
};

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

/** A sheet in miniature: `count` pages in `cols` × `rows`. */
function SheetPreview({ count, cols, rows, active }: { count: number; cols: number; rows: number; active: boolean }) {
    return <span aria-hidden="true" className={cn("ts-sheet-preview aspect-[3/4] w-10 grid gap-0.5 p-1 rounded-sm border", active ? "border-accent/60 bg-accent/10" : "border-border bg-paper-2/60")}
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {Array.from({ length: count }).map((_, i) => <span key={i} className={cn("rounded-[1px]", active ? "bg-accent/55" : "bg-muted-foreground/40")} />)}
    </span>;
}

export function NupUI() {
    const [config, , { setField }] = useToolDefaults("nup", NUP_DEFAULTS);
    const { pps, orient } = config;
    const setPps = useCallback((v: React.SetStateAction<typeof NUP_DEFAULTS["pps"]>) => setField("pps", v), [setField]);
    const setOrient = useCallback((v: React.SetStateAction<typeof NUP_DEFAULTS["orient"]>) => setField("orient", v), [setField]);
    const proc = useMultiFileProcessor();

    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const canProcess = proc.entries.length > 0 && state !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setState("processing");
        const params: Record<string, string | number> = { pages_per_sheet: pps };
        if (pps === 2) params.orientation = orient;
        await proc.run({
            endpoint: "/nup",
            outputSuffix: "nup",
            outputExt: "pdf",
            params,
        }, retry);
        setState("done");
    }, [proc, pps, orient]);

    useDownloadOnce(state === "done", proc.doneCount, () => proc.downloadAll("archive_nup"));

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (state === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setState("idle");
        };
        return <ProcessorResult proc={proc} verb="laid out" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs laid out ${pps}-up.` : `${pps}-up sheets ready.`}
            detail={downloadStarted(proc.doneCount)}
            onDownload={() => proc.downloadAll("archive_nup")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Lay out another" />;
    }

    const busy = state === "processing";
    return <StudioLayout options={<>
        <div>
            <h2>Pages per sheet</h2>
            <div className="ts-choices">{opts.map(o => {
                const active = pps === o.id;
                // For 2-up active, swap rows/cols based on orientation
                const vertical = o.id === 2 && active && orient === "vertical";
                return <button type="button" className="ts-choice" key={o.id} aria-label={`${o.label} layout`} aria-pressed={active} disabled={busy} onClick={() => setPps(o.id)}>
                    <SheetPreview count={o.id} cols={vertical ? 1 : o.cols} rows={vertical ? 2 : o.rows} active={active} /><strong>{o.label}</strong>
                </button>;
            })}</div>
        </div>
        {/* Orientation only matters for 2-up */}
        {pps === 2 && <div>
            <h2>2-up orientation</h2>
            <div className="ts-choices">{ORIENTATIONS.map(o => {
                const active = orient === o.id;
                return <button type="button" className="ts-choice" key={o.id} aria-label={`${o.label} orientation`} aria-pressed={active} disabled={busy} onClick={() => setOrient(o.id)}>
                    <SheetPreview count={2} cols={o.id === "horizontal" ? 2 : 1} rows={o.id === "horizontal" ? 1 : 2} active={active} /><strong>{o.label}</strong><span>{o.hint}</span>
                </button>;
            })}</div>
        </div>}
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Layout size={16} aria-hidden="true" /> Create {pps}-up layout{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to N-up" detail="Combine multiple pages per sheet — print-ready · several files become a ZIP"
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Composing the sheets" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
