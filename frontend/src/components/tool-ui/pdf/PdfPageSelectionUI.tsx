import { useEffect, useRef, useState } from "react";
import { Download, Minus, Plus } from "lucide-react";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { downloadBlob, formatFileSize } from "@/lib/api";
import { FileIntake, StudioActions, StudioFile, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { failureDetail, studioOutcome } from "@/skins/experience/studio-outcome";
import { mergePageSelection } from "../merge-model";
import { PdfPageStage } from "./PdfPageStage";

const isPdf = (file: File) => file.name.toLowerCase().endsWith(".pdf");

/** Shared page-selection controller for the two inverse operations. */
export function PdfPageSelectionUI({ operation }: { operation: "delete" | "extract" }) {
    const proc = useMultiFileProcessor();
    const { addFiles, doneCount, downloadAll } = proc;
    const [pages, setPages] = useState("");
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState<number | null>(null);
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [returning, setReturning] = useState(false);
    const downloaded = useRef(false);
    const first = proc.entries[0];
    const removing = operation === "delete", slug = `${operation}-pages`;
    const selection = mergePageSelection(pages, total);
    const selected = pages.trim() ? selection.pages || [] : [];
    const invalid = pages.trim() ? selection.error || (removing && total && selected.length === total ? "Keep at least one page in your PDF." : null) : null;
    const ready = !!first && !!pages.trim() && !invalid && phase === "idle";
    useEffect(() => { setTotal(null); setPage(1); }, [first?.id]);
    useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void consumeFileHandoffs(slug).then(files => { if (!cancelled) addFiles(files, isPdf); }); }); return () => { cancelled = true; }; }, [slug, addFiles]);
    async function process(retry: boolean | "transient" = false) {
        if (!first || (!retry && !ready)) return;
        setPhase("processing");
        await proc.run({ endpoint: `/${slug}`, outputExt: "pdf", outputSuffix: removing ? "trimmed" : "extracted", params: { pages } }, retry);
        setPhase("done");
    }
    useEffect(() => { if (phase === "done" && doneCount && !downloaded.current) { downloaded.current = true; void downloadAll(`${slug}.zip`); } }, [phase, doneCount, downloadAll, slug]);
    useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && ready) { event.preventDefault(); void process(); } }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); });
    const toggle = () => { const next = new Set(selected); next.has(page) ? next.delete(page) : next.add(page); setPages([...next].sort((a, b) => a - b).join(",")); };
    if (phase === "done") {
        const tone = studioOutcome(proc.doneCount, proc.failedCount);
        const several = proc.entries.length > 1;
        const adjust = () => { const files = proc.entries.map(entry => entry.file); proc.reset(); proc.addFiles(files); downloaded.current = false; setReturning(true); setPhase("idle"); };
        const fresh = (files?: File[]) => { proc.reset(); setPages(""); downloaded.current = false; if (files) proc.addFiles(files, isPdf); setReturning(true); setPhase("idle"); };
        return <StudioResult tone={tone}
            title={tone === "failure" ? removing ? "The pages couldn’t be removed." : "The pages couldn’t be extracted."
                : tone === "partial" ? `Done for ${proc.doneCount} of ${proc.entries.length} PDFs.` : removing ? "A little less. Just what you need." : "Your chosen pages, together."}
            detail={tone === "failure" ? `${failureDetail(proc.failedCount, proc.retryableCount)}${proc.retryableCount ? "" : " Check the page numbers, or choose a different PDF."}`
                : `${proc.doneCount} completed${proc.failedCount ? ` · ${proc.failedCount} couldn’t be changed; the reason is below` : ""}`}>
            {proc.entries.map(entry => <StudioFile key={entry.id} name={entry.outName || entry.name} detail={entry.error || (entry.blob ? formatFileSize(entry.blob.size) : formatFileSize(entry.size))} status={entry.status === "failed" ? "error" : entry.status} onDownload={entry.blob ? () => downloadBlob(entry.blob!, entry.outName || entry.name) : undefined} />)}
            <StudioActions tone={tone} retryCount={proc.retryableCount} onRetry={() => { downloaded.current = false; void process("transient"); }}
                choose={{ accepts: ".pdf", multiple: true, label: several ? "Choose different PDFs" : "Choose a different PDF", onFiles: fresh }}
                primary={<button className="ts-primary-button" onClick={() => proc.downloadAll(`${slug}.zip`)}><Download size={16} />Download {proc.doneCount > 1 ? "all" : "again"}</button>}
                more={<><button className="ts-text-button" onClick={adjust}>Adjust selection</button>{tone !== "failure" && <button className="ts-text-button" onClick={() => fresh()}>Choose another PDF</button>}</>} />
        </StudioResult>;
    }
    return <div className="space-y-5">
        <FileIntake accepts=".pdf" multiple compact={!!first} disabled={phase === "processing"} label="Choose PDFs" title={removing ? "Make room for what matters." : "Keep the pages you came for."} detail="Choose pages visually, or enter a range. The same selection applies to each file." autoFocus={returning} onFiles={files => proc.addFiles(files, isPdf)} />
        {proc.entries.map(entry => <StudioFile key={entry.id} name={entry.name} detail={formatFileSize(entry.size)} status={entry.status === "failed" ? "error" : entry.status} onRemove={phase === "processing" ? undefined : () => proc.removeFile(entry.id)} />)}
        {first && <div className="pdf-coordinate-workspace"><PdfPageStage file={first.file} page={page} onPageChange={setPage} onDimensions={info => setTotal(info.pages)} /><fieldset className="pdf-coordinate-controls" disabled={phase === "processing"}>
            <div><p className="ts-eyebrow">Choose your pages</p><h3>{removing ? "Take these out." : "Bring these along."}</h3><p className="pdf-preview-context-note">Previewing {first.name}{proc.entries.length > 1 ? ". The same page numbers apply to every selected PDF." : "."}</p></div>
            <button className="ts-secondary-button" aria-pressed={selected.includes(page)} onClick={toggle}>{selected.includes(page) ? <Minus size={16} /> : <Plus size={16} />}{selected.includes(page) ? `Unselect page ${page}` : `${removing ? "Remove" : "Keep"} page ${page}`}</button>
            <div className="ts-setting"><label htmlFor={`pdf-${operation}-pages`}>Page range</label><input id={`pdf-${operation}-pages`} value={pages} onChange={event => setPages(event.target.value)} placeholder="1,3-5" /><p>{selected.length ? `${selected.length} ${selected.length === 1 ? "page" : "pages"} selected` : "Select a page above, or enter page numbers."}{total ? ` · ${total} pages in this PDF` : ""}</p></div>
            {invalid && <p className="ts-error" role="alert">{invalid}</p>}
            <button className="ts-primary-button" disabled={!ready} onClick={() => void process()}>{removing ? "Delete pages" : "Extract pages"}</button>
            <p className="pdf-preview-context-note">A new PDF is created. Your original file stays on your device.</p>
        </fieldset></div>}
        {phase === "processing" && <StudioProgress label={removing ? "Removing the selected pages" : "Gathering the selected pages"} detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </div>;
}
