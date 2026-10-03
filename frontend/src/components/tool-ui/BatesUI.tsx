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
 * A single file still uses /bates-numbering through the shared queue.
 */
import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Download, Hash, Info } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, friendlyError } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL, uploadFiles, downloadBlob } from "@/lib/api";
import { emitToolRun, isTransientFailure, toolErrorKind, type ToolErrorKind } from "@/lib/toolRun";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { BatesCounterPicker } from "@/components/BatesCounterPicker";
import * as counters from "@/lib/localStore/counters";
import { countPdfPages } from "@/lib/pdfMeta";
import { blobBytes } from "@/lib/localStore/blobs";
import { FileIntake, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadAgainLabel, downloadStarted, retryLine } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const positions = [
    { id: "top-left",      name: "Top left",      row: 0, col: 0 },
    { id: "top-center",    name: "Top center",    row: 0, col: 1 },
    { id: "top-right",     name: "Top right",     row: 0, col: 2 },
    { id: "bottom-left",   name: "Bottom left",   row: 1, col: 0 },
    { id: "bottom-center", name: "Bottom center", row: 1, col: 1 },
    { id: "bottom-right",  name: "Bottom right",  row: 1, col: 2 },
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

/** The numbered set from one batch request: the ZIP, and its manifest when the server sent one. */
interface BatchResult { zip: Blob; manifest: BatesManifestEntry[] | null; files: number }
/** Why a batch request failed, and whether another attempt could work. */
interface BatchFailure { message: string; retryable: boolean; kind?: ToolErrorKind }

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

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
    // What the stamp did to the matter, as a sentence for the result.
    const [matterNote, setMatterNote] = useState<string | null>(null);
    const [batch, setBatch] = useState<BatchResult | null>(null);
    const [batchFailure, setBatchFailure] = useState<BatchFailure | null>(null);
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    // Seed the stamp settings from the active matter.
    const activateMatter = useCallback((c: counters.BatesCounter | null) => {
        setMatter(c);
        if (!c) return;
        setConfig(prev => ({ ...prev, prefix: c.prefix, digits: c.digits, position: c.position, startNumber: c.next }));
    }, [setConfig]);

    useEffect(() => {
        if (restored) toast.message("Restored previous settings", { description: "Picked up where you left off.", duration: 3000 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const sample = `${prefix}${String(startNumber).padStart(digits, "0")}${suffix}`;
    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Move the active matter past the pages a confirmed stamp numbered. Gaps
    // in a Bates sequence are a real problem in discovery, so this runs only
    // after the server confirmed the stamp, never optimistically. A stamp in
    // another prefix or width is not this matter's sequence and leaves it alone.
    const advanceMatter = useCallback(async (stamp: { prefix: string; digits: number; start: number }, countPages: () => Promise<number>) => {
        if (!matter) return;
        if (stamp.prefix !== matter.prefix || stamp.digits !== matter.digits) {
            setMatterNote(`${matter.name} stays at ${counters.formatNext(matter)}: these numbers aren’t in its format.`);
            return;
        }
        try {
            const pages = await countPages();
            if (pages > 0) {
                const updated = await counters.advanceCounter(matter.id, stamp.start, pages);
                setMatter(updated);
                setMatterNote(`${updated.name} continues at ${counters.formatNext(updated)} next time.`);
            }
        } catch {
            /* counting failed — leave the counter untouched rather than
               guessing, and let the user correct it in /my-stuff */
        }
    }, [matter]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        setBatchFailure(null);

        // More than one file is a production set, and a production set carries
        // ONE sequence. That has to be decided in a single server-side pass —
        // N independent calls would restart every file at `startNumber`.
        const files = proc.entries.map(e => e.file);
        if (files.length > 1) {
            try {
                const res = await uploadFiles("/bates-numbering-batch", files, {
                    prefix, suffix, start_number: startNumber, digits, position,
                });
                let manifest: BatesManifestEntry[] | null = null;
                const header = res.headers.get("X-Bates-Manifest");
                if (header) {
                    try { manifest = JSON.parse(header) as BatesManifestEntry[]; }
                    catch { /* header is a convenience; the ZIP is the deliverable */ }
                }
                const zip = await res.blob();
                // The set is one result: it downloads by itself, once.
                downloadBlob(zip, "bates_numbered.zip");
                setBatch({ zip, manifest, files: files.length });
                setPhase("done");
                emitToolRun({ outcome: "success", files: files.length });
                // The set is numbered whole: the matter moves on by every page in it.
                await advanceMatter({ prefix, digits, start: startNumber }, async () => manifest ? manifest.reduce((n, m) => n + m.pages, 0) : countPdfPages(files, blobBytes));
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : "Failed";
                const kind = toolErrorKind(e);
                setBatchFailure({ message: friendlyError(msg, "Couldn't number that set."), retryable: isTransientFailure(e), kind: kind === "cancelled" ? undefined : kind });
                setPhase("done");
                emitToolRun({ outcome: "error", files: files.length }, e);
            }
            return;
        }

        // What this run did comes back from the hook's ref mirror: `proc` here
        // is the render this callback was made in, from before the run.
        const ran = await proc.run({
            endpoint: "/bates-numbering",
            outputSuffix: "bates",
            outputExt: "pdf",
            params: { prefix, suffix, start_number: startNumber, digits, position },
        }, retry);
        setPhase("done");

        // Only the files that were actually stamped, never a failed one.
        const stamped = ran.filter(e => e.status === "done").map(e => e.file);
        if (stamped.length > 0) await advanceMatter({ prefix, digits, start: startNumber }, () => countPdfPages(stamped, blobBytes));
    }, [proc, prefix, suffix, startNumber, digits, position, advanceMatter]);

    // The single-file queue's result downloads once; the batch set downloads in process().
    useDownloadOnce(phase === "done" && !batch && !batchFailure, proc.doneCount, () => proc.downloadAll("archive_bates"));

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

    const startOver = (files?: File[]) => {
        proc.reset(); setMatterNote(null); setBatch(null); setBatchFailure(null);
        if (files) proc.addFiles(files, isPdfOnly);
        setReturning(true); setPhase("idle");
    };

    if (phase === "done" && batchFailure) {
        // A production set is numbered whole or not at all, so its failure is the set's.
        return <StudioResult tone="failure" title="None of these PDFs could be numbered."
            detail={batchFailure.retryable ? `Nothing was created. ${retryLine([batchFailure.kind])}` : "Nothing was created. The reason is below."}>
            <StudioFile name={`${proc.entries.length} PDFs, numbered as one set`} status="error" detail={batchFailure.message} />
            <StudioActions tone="failure" retryCount={batchFailure.retryable ? 1 : 0} onRetry={() => void process(false)}
                choose={{ accepts: ".pdf", multiple: true, label: "Choose different files", onFiles: files => startOver(files) }} />
        </StudioResult>;
    }

    if (phase === "done" && batch) {
        const manifest = batch.manifest;
        const pages = manifest?.reduce((n, m) => n + m.pages, 0) ?? 0;
        return <StudioResult title={manifest ? `Numbered ${manifest[0]?.firstBates} to ${manifest[manifest.length - 1]?.lastBates}.` : `${batch.files} PDFs numbered from ${sample}.`}
            detail={`${batch.files} files · one continuous sequence${manifest ? ` · ${pages} pages` : ""}. ${downloadStarted(2)}${matterNote ? ` ${matterNote}` : ""}`}>
            {manifest && <section className="ts-receipt" aria-label="Numbering manifest">
                <h3>Numbering manifest</h3>
                <dl className="ts-fields">{manifest.map(m => <div key={m.index}><dt>{m.file ?? `File ${m.index + 1}`}</dt><dd>{m.firstBates} – {m.lastBates}</dd></div>)}</dl>
                <p>Also saved as bates-manifest.json inside the ZIP</p>
            </section>}
            <div className="ts-actions">
                <button type="button" className="ts-primary-button" onClick={() => downloadBlob(batch.zip, "bates_numbered.zip")}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(2)}</button>
                <button type="button" className="ts-text-button" onClick={() => startOver()}>Number more</button>
            </div>
        </StudioResult>;
    }

    if (phase === "done") {
        return <ProcessorResult proc={proc} verb="numbered" accepts=".pdf"
            title={`Stamped from ${sample}.`}
            detail={`${downloadStarted(proc.doneCount)}${matterNote ? ` ${matterNote}` : ""}`}
            onDownload={() => proc.downloadAll("archive_bates")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Number more" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<>
        <div><BatesCounterPicker onActivate={activateMatter} /></div>
        <div>
            <h2>Number format</h2>
            <p>Starts at <strong className="ts-sample">{sample}</strong></p>
            <div className="ts-field-grid">
                <div className="ts-setting"><label htmlFor="bates-prefix">Prefix</label><input id="bates-prefix" value={prefix} disabled={busy} onChange={e => setPrefix(e.target.value)} placeholder="DOC-" maxLength={32} /></div>
                <div className="ts-setting"><label htmlFor="bates-suffix">Suffix</label><input id="bates-suffix" value={suffix} disabled={busy} onChange={e => setSuffix(e.target.value)} placeholder="-CONF" maxLength={32} /></div>
                <div className="ts-setting"><label htmlFor="bates-start">Start</label><input id="bates-start" type="number" inputMode="numeric" value={startNumber} min={1} max={9999999} disabled={busy} onChange={e => setStartNumber(Math.max(1, Math.min(9999999, parseInt(e.target.value) || 1)))} /></div>
                <div className="ts-setting">
                    <div className="ts-label-row"><label htmlFor="bates-digits">Digits</label>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button type="button" className="ts-icon-button ts-hint-button" aria-label="What does the digits field do?"><Info size={14} aria-hidden="true" /></button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px] text-[12px] leading-relaxed font-sans normal-case tracking-normal">
                                Pad the page number with leading zeros so every stamp is the same width. <span className="font-semibold">6</span> matches the legal-discovery convention (DOC-000001). Use a smaller value for short documents, larger for cases over a million pages.
                            </TooltipContent>
                        </Tooltip>
                    </div>
                    <input id="bates-digits" type="number" inputMode="numeric" value={digits} min={1} max={12} disabled={busy} onChange={e => setDigits(Math.max(1, Math.min(12, parseInt(e.target.value) || 6)))} />
                </div>
            </div>
            {proc.entries.length > 1 && <p className="ts-caption">All {proc.entries.length} files are numbered as one continuous run starting at {sample}. You'll get a ZIP with a numbering manifest.</p>}
        </div>
        <div>
            <h2>Stamp position</h2>
            <div className="ts-choices" role="group" aria-label="Stamp position">{positions.map(p => <button type="button" className="ts-choice" key={p.id} aria-pressed={position === p.id} disabled={busy} onClick={() => setPosition(p.id)}><strong>{p.name}</strong></button>)}</div>
            <div className="relative aspect-[3/4] bg-paper-2/40 border border-border rounded-md mx-auto w-full max-w-[140px] mt-3" aria-hidden="true">
                {positions.map(p => {
                    const active = position === p.id;
                    const dy = p.row === 0 ? "top-2" : "bottom-2";
                    const dx = p.col === 0 ? "left-2" : p.col === 1 ? "left-1/2 -translate-x-1/2" : "right-2";
                    return <span key={p.id} className={cn("absolute font-mono text-[7.5px] tracking-tight transition-colors", dy, dx, active ? "text-accent font-semibold" : "text-muted-foreground")}>{sample}</span>;
                })}
            </div>
        </div>
        <div><button type="button" className="ts-text-button" onClick={resetConfig} disabled={busy}>Reset to defaults</button></div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Hash size={16} aria-hidden="true" /> Stamp {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Select PDFs to Bates-stamp" detail={`Multi-file OK · numbered as one run from ${sample} · max ${MAX_FILE_SIZE_LABEL} in total`}
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Stamping the numbers" detail={proc.entries.length > 1 ? `${proc.entries.length} PDFs, numbered as one set` : undefined} />}
    </StudioLayout>;
}
