/**
 * HighlightUI — find every match of a phrase in one or many PDFs and highlight it.
 * Multi-file via useMultiFileProcessor — same query/color applied to all PDFs.
 *
 * The backend returns an `X-Highlight-Hits` header per file; we sum across the
 * batch and show the total.
 */
import { useCallback, useEffect, useState } from "react";
import { Highlighter } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL, formatFileSize } from "@/lib/api";
import { useMultiFileProcessor, type FileEntry } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const COLORS = [
    { id: "yellow", label: "Yellow", swatch: "#ffea00" },
    { id: "green",  label: "Green",  swatch: "#8cee8c" },
    { id: "pink",   label: "Pink",   swatch: "#ffa1c7" },
    { id: "blue",   label: "Blue",   swatch: "#8cc7ff" },
    { id: "orange", label: "Orange", swatch: "#ffa800" },
];

const HIGHLIGHT_DEFAULTS = {
    color: "yellow",
    caseSensitive: false,
};

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");
const hitsOf = (entry: FileEntry) => parseInt(entry.headers?.["x-highlight-hits"] || "0", 10) || 0;

export function HighlightUI() {
    const [config, , { setField }] = useToolDefaults("highlight-pdf", HIGHLIGHT_DEFAULTS);
    const { color, caseSensitive } = config;
    const setColor = useCallback((v: React.SetStateAction<typeof HIGHLIGHT_DEFAULTS["color"]>) => setField("color", v), [setField]);
    const setCaseSensitive = useCallback((v: React.SetStateAction<typeof HIGHLIGHT_DEFAULTS["caseSensitive"]>) => setField("caseSensitive", v), [setField]);
    const proc = useMultiFileProcessor();

    const [query, setQuery] = useState("");
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const canProcess = proc.entries.length > 0 && query.trim().length > 0 && phase !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/highlight",
            outputSuffix: "highlighted",
            outputExt: "pdf",
            params: { query: query.trim(), color, case_sensitive: caseSensitive },
        }, retry);
        setPhase("done");
    }, [proc, query, color, caseSensitive]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_highlighted"));

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
        // Sum hits across all done entries.
        const totalHits = proc.entries.reduce((sum, entry) => entry.status === "done" ? sum + hitsOf(entry) : sum, 0);
        const startOver = (files?: File[]) => {
            proc.reset();
            if (!files) setQuery("");
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setPhase("idle");
        };
        const matches = `${totalHits} match${totalHits === 1 ? "" : "es"}`;
        return <ProcessorResult proc={proc} verb="highlighted" accepts=".pdf"
            title={totalHits > 0 ? `${matches} marked${proc.doneCount > 1 ? ` across ${proc.doneCount} PDFs` : ""}.` : proc.doneCount > 1 ? `${proc.doneCount} PDFs processed.` : "Matches highlighted."}
            detail={`Query: “${query.trim()}”. ${downloadStarted(proc.doneCount)}`}
            fileDetail={entry => `${hitsOf(entry)} match${hitsOf(entry) === 1 ? "" : "es"} · ${formatFileSize(entry.blob?.size ?? 0)}`}
            onDownload={() => proc.downloadAll("archive_highlighted")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Start over" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<>
        <div>
            <h2>Search</h2>
            <div className="ts-setting"><label htmlFor="highlight-query">Text to highlight</label><input id="highlight-query" type="text" value={query} disabled={busy} onChange={e => setQuery(e.target.value)} placeholder='e.g. "confidential"' maxLength={500} /></div>
            {proc.entries.length > 0 && !query.trim() && <p className="ts-caption">Enter a query.</p>}
            <label className="ts-check"><input type="checkbox" checked={caseSensitive} disabled={busy} onChange={e => setCaseSensitive(e.target.checked)} /> Case sensitive</label>
        </div>
        <div>
            <h2>Color</h2>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Highlight color">
                {COLORS.map(c => <button type="button" key={c.id} onClick={() => setColor(c.id)} disabled={busy} aria-label={c.label} aria-pressed={color === c.id}
                    className={cn("h-10 w-10 rounded-lg border-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))]", color === c.id ? "border-foreground/70 ring-2 ring-accent/40" : "border-border hover:border-foreground/30")}
                    style={{ backgroundColor: c.swatch }} />)}
            </div>
        </div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Highlighter size={16} aria-hidden="true" /> Highlight {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "every match"}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Select PDFs to highlight" detail={`Multi-file OK · same query applied to all · max ${MAX_FILE_SIZE_LABEL} each`}
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Finding every match" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
