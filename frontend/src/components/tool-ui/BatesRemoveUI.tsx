/**
 * BatesRemoveUI — strip Bates stamps back off a production set.
 *
 * The counterpart to BatesUI. Adobe ships this and nobody else free does.
 *
 * Removal is redaction, not an overlay: the point of taking a production
 * number off a document is that it is no longer in the file, so covering it
 * would defeat the exercise. Matching is confined to the page margins and to
 * text shaped like a Bates number, which is why the prefix/suffix hints matter
 * — supplying them turns a shape match into an exact one.
 *
 * Multi-file via useMultiFileProcessor — the same pattern is applied to every
 * PDF. Each answer says how many stamps left the file (X-Bates-Removed), how
 * many were found but are still in it (X-Bates-Remaining: drawn where
 * redaction cannot reach, such as a stamp annotation), and how many matches
 * were left in place (X-Bates-Elsewhere): with a prefix or suffix, any other
 * match for it in the file; without one, Bates-shaped numbers on pages turned
 * a quarter that sit where a stamp can be but the net without a prefix does
 * not reach. They are summed, the files that still hold something are named,
 * and the summary never calls the file clean while a stamp or a match is
 * still in it, nor claims anything when every file failed.
 */
import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Eraser } from "lucide-react";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function BatesRemoveUI() {
    const proc = useMultiFileProcessor();
    const [prefix, setPrefix] = useState("");
    const [suffix, setSuffix] = useState("");
    const [digits, setDigits] = useState(6);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const canProcess = proc.entries.length > 0 && status !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setStatus("processing");
        await proc.run({
            endpoint: "/bates-remove",
            outputSuffix: "bates_removed",
            outputExt: "pdf",
            params: { prefix, suffix, digits },
        }, retry);
        setStatus("done");
    }, [proc, prefix, suffix, digits]);

    useDownloadOnce(status === "done", proc.doneCount, () => proc.downloadAll("archive_bates_removed"));

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess && status === "idle") {
                e.preventDefault(); void process(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, status, process]);

    if (status === "done") {
        const isMulti = proc.entries.length > 1;
        const count = (value: string | undefined) => {
            const n = Number(value ?? "0");
            return Number.isFinite(n) ? n : 0;
        };
        const results = proc.entries.filter(e => e.status === "done").map(e => ({
            id: e.id,
            name: e.name,
            removed: count(e.headers?.["x-bates-removed"]),
            remaining: count(e.headers?.["x-bates-remaining"]),
            elsewhere: count(e.headers?.["x-bates-elsewhere"]),
        }));
        const sum = (key: "removed" | "remaining" | "elsewhere") => results.reduce((total, r) => total + r[key], 0);
        const removed = sum("removed");
        const remaining = sum("remaining");
        const elsewhere = sum("elsewhere");
        const exact = prefix !== "" || suffix !== "";
        const someLeft = remaining > 0;
        const leftInPlace = elsewhere > 0;
        const nothingMatched = removed === 0 && !someLeft && !leftInPlace;
        const files = proc.doneCount > 1 ? "files" : "file";
        // In a batch, the files the visitor has to open before sharing.
        const toCheck = isMulti ? results.filter(r => r.remaining > 0 || r.elsewhere > 0) : [];
        const stamps = (n: number) => `${n} stamp${n === 1 ? "" : "s"}`;
        // What was left in place: with a prefix or suffix, any other match for
        // it; without one, only Bates-shaped numbers on pages turned a quarter
        // that sit where a stamp can be but the net without a prefix does not reach.
        const leftWhat = exact
            ? `${elsewhere === 1 ? "match" : "matches"}`
            : `Bates-shaped number${elsewhere === 1 ? "" : "s"}`;
        const elsewhereSentence = exact
            ? `${someLeft ? `${elsewhere} more ${elsewhere === 1 ? "match" : "matches"} for the prefix or suffix ${elsewhere === 1 ? "was" : "were"}` : "Text matching the prefix or suffix was"} found elsewhere in the ${files}, away from the page margins the tool clears, and left in place: it may be a reference to a Bates number, or a stamp placed further in.`
            : `${elsewhere} Bates-shaped number${elsewhere === 1 ? " was" : "s were"} left in place on pages turned a quarter, outside the margins searched without a prefix. If ${elsewhere === 1 ? "it is a stamp" : "they are stamps"}, give the prefix to remove ${elsewhere === 1 ? "it" : "them"}.`;
        const title = someLeft
            ? `${remaining} stamp${remaining === 1 ? "" : "s"} could not be removed.`
            : leftInPlace
                ? `${elsewhere} ${leftWhat} left in place.`
                : nothingMatched
                    ? "No Bates numbers found."
                    : isMulti
                        ? `${stamps(removed)} removed across ${proc.doneCount} file${proc.doneCount === 1 ? "" : "s"}.`
                        : `${stamps(removed)} removed.`;
        const summary = someLeft
            ? [`${remaining === 1 ? "It was" : "They were"} found in the page margins but ${remaining === 1 ? "is" : "are"} still in the ${files}, drawn where redaction cannot reach, such as a stamp annotation or a form field. Check before you share.`,
                removed > 0 ? `${removed} other stamp${removed === 1 ? " was" : "s were"} removed.` : "",
                leftInPlace ? elsewhereSentence : ""].filter(Boolean).join(" ")
            : leftInPlace
                ? [`${elsewhereSentence} Check before you share.`, removed > 0 ? `${stamps(removed)} in the margins ${removed === 1 ? "was" : "were"} removed.` : ""].filter(Boolean).join(" ")
                : nothingMatched
                    ? exact
                        ? "Nothing in the file matched the prefix or suffix. Check the ones the stamps actually use."
                        : "Nothing in the top or bottom inch of the pages looked like a Bates number. Try giving the prefix or suffix the stamps actually use."
                    : `Redacted, not covered: the removed stamps' text is gone from the ${files}.`;
        // A partial run's heading is the kit's "1 of 2 PDFs processed.", so the detail opens with
        // the sentence this heading would have said, where the summary follows on from it: what
        // could not be removed ("It was found…"), or how many stamps were removed. The other
        // summaries say what they report themselves.
        const lead = proc.failedCount > 0 && proc.doneCount > 0 && (someLeft || (!leftInPlace && !nothingMatched)) ? `${title} ` : "";
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setStatus("idle");
        };
        return <ProcessorResult proc={proc} verb="processed" accepts=".pdf"
            title={title} detail={`${lead}${summary} ${downloadStarted(proc.doneCount)}`}
            // A stamp or a match still in the file, or nothing found: the file is made, but read this before sharing it.
            attention={someLeft || leftInPlace || nothingMatched}
            receipt={toCheck.length > 0 && <ul aria-label="Files to check" className="ts-checklist ts-checklist-warn">
                {toCheck.map(r => <li key={r.id}><AlertTriangle size={14} aria-hidden="true" /><span className="ts-checklist-name">{r.name}</span><span>{[r.remaining > 0 ? `${r.remaining} could not be removed` : "", r.elsewhere > 0 ? `${r.elsewhere} left in place` : ""].filter(Boolean).join(" · ")}</span></li>)}
            </ul>}
            onDownload={() => proc.downloadAll("archive_bates_removed")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Remove from another" />;
    }

    const busy = status === "processing";
    return <StudioLayout options={<>
        <div>
            <h2>What the stamps look like</h2>
            <p>Optional.</p>
            <div className="ts-field-grid">
                <div className="ts-setting"><label htmlFor="rm-prefix">Prefix</label><input id="rm-prefix" value={prefix} disabled={busy} onChange={e => setPrefix(e.target.value)} placeholder="DOC-" maxLength={32} /></div>
                <div className="ts-setting"><label htmlFor="rm-suffix">Suffix</label><input id="rm-suffix" value={suffix} disabled={busy} onChange={e => setSuffix(e.target.value)} placeholder="-CONF" maxLength={32} /></div>
                <div className="ts-setting"><label htmlFor="rm-digits">Digits</label><input id="rm-digits" type="number" inputMode="numeric" value={digits} min={1} max={10} disabled={busy} onChange={e => setDigits(Math.max(1, Math.min(10, parseInt(e.target.value) || 6)))} /></div>
            </div>
        </div>
        <div>
            <p>
                Leave these blank and anything shaped like a Bates number in the top or bottom inch
                of a page is removed, and on a page turned a quarter, one running along the inch
                at either side.
                Filling them in makes the match exact: a match within an inch of any edge is
                removed, and any found elsewhere is left and reported. That is safer on documents
                that carry other numbering in the header or footer.
            </p>
        </div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Eraser size={16} aria-hidden="true" /> Remove Bates numbers{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to remove Bates numbers" detail="Only Bates-shaped numbers in the page margins are touched · up to 500 MB each · several files become a ZIP"
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Removing the numbers" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
