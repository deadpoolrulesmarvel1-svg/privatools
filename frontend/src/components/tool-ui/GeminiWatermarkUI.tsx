/**
 * Gemini Watermark Remover: takes the visible Gemini sparkle out of images,
 * in this browser. Files are never uploaded; each one is checked for the logo
 * first and left untouched when it is not there.
 *
 * Runs through useMultiFileProcessor with a local processor, so the queue,
 * retries and the usage event are the shared ones. An image with no sparkle
 * counts as done, but it is marked unchanged and left out of the download.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDownToLine, ArrowRight, Check, CircleSlash, X } from "lucide-react";
import { downloadBlob, formatFileSize } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor, type FileEntry } from "@/hooks/useMultiFileProcessor";
import { removeGeminiSparkle, type SparkleResult } from "@/lib/gemini-watermark/process";
import { ImageComparison, MediaBusy, MediaField, MediaLayout, MediaPreview, MediaUpload } from "./media/MediaStudio";
import { useMediaUrl } from "./media/media-files";
import "./gemini-watermark.css";

const ACCEPTS = ".png,.jpg,.jpeg,.webp";
const isImage = (file: File) => /\.(png|jpe?g|webp)$/i.test(file.name);

type Results = Map<File, SparkleResult>;
const outcomeOf = (results: Results, entry: FileEntry) => entry.status === "done" ? results.get(entry.file) : undefined;

function layoutLabel(result: SparkleResult): string {
    if (result.status !== "removed") return "";
    const { layout, size } = result.detection.candidate;
    return `${size} px logo, ${layout === "current" ? "current layout" : "layout before Gemini 3.5"}`;
}

/** The logo's corner, enlarged, before and after: at full-picture scale the sparkle is too small to judge. */
function CornerZoom({ before, after, result }: { before: Blob; after: Blob; result: SparkleResult & { status: "removed" } }) {
    const beforeUrl = useMediaUrl(before);
    const afterUrl = useMediaUrl(after);
    const { x, y, size } = result.detection.candidate;
    const side = Math.min(result.width, result.height, Math.max(size * 3, 120));
    const left = Math.min(Math.max(0, x + size / 2 - side / 2), result.width - side);
    const top = Math.min(Math.max(0, y + size / 2 - side / 2), result.height - side);
    const view = (url: string): CSSProperties => ({
        backgroundImage: url ? `url("${url}")` : undefined,
        backgroundSize: `${(result.width / side) * 100}% ${(result.height / side) * 100}%`,
        backgroundPosition: `${(left / Math.max(1, result.width - side)) * 100}% ${(top / Math.max(1, result.height - side)) * 100}%`,
    });
    return <figure className="gw-zoom">
        <div className="gw-zoom-pair">
            <div><span className="gw-zoom-view" style={view(beforeUrl)} role="img" aria-label="The corner before, enlarged" /><small>Before</small></div>
            <div><span className="gw-zoom-view" style={view(afterUrl)} role="img" aria-label="The corner after, enlarged" /><small>After</small></div>
        </div>
        <figcaption>The corner where the sparkle was, enlarged.</figcaption>
    </figure>;
}

export function GeminiWatermarkUI() {
    const proc = useMultiFileProcessor();
    const results = useRef<Results>(new Map());
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [selectedId, setSelectedId] = useState("");
    const busy = phase === "processing";
    const finished = phase === "done";

    const resultFor = (entry: FileEntry) => outcomeOf(results.current, entry);
    const removed = proc.entries.filter(entry => resultFor(entry)?.status === "removed");
    const unchanged = proc.entries.filter(entry => resultFor(entry)?.status === "not-found");

    const run = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            // Never requested: localProcess handles every file inside this tab.
            endpoint: "",
            outputExt: "png",
            outputSuffix: null,
            concurrency: 1,
            localProcess: async (file: File) => {
                const result = await removeGeminiSparkle(file);
                results.current.set(file, result);
                return result.status === "removed" ? { blob: result.blob, outName: result.outName } : { blob: file, outName: file.name };
            },
        }, retry);
        setPhase("done");
    }, [proc]);

    const download = useCallback(() => {
        const done = proc.entries.flatMap(entry => {
            const result = outcomeOf(results.current, entry);
            return result?.status === "removed" ? [result] : [];
        });
        if (done.length === 1) { downloadBlob(done[0].blob, done[0].outName); return; }
        if (done.length > 1) {
            void (async () => {
                const items = await Promise.all(done.map(async result => ({ name: result.outName, data: new Uint8Array(await result.blob.arrayBuffer()) })));
                downloadBlob(buildZip(items), "gemini-sparkle-removed.zip");
            })();
        }
    }, [proc.entries]);

    const reset = useCallback(() => {
        proc.reset();
        results.current.clear();
        setSelectedId("");
        setPhase("idle");
    }, [proc]);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && proc.entries.length && phase === "idle") { event.preventDefault(); void run(); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [proc.entries.length, phase, run]);

    const selected = proc.entries.find(entry => entry.id === selectedId) || proc.entries[0];
    const selectedResult = selected ? resultFor(selected) : undefined;

    const statusLine = (entry: FileEntry) => {
        const result = resultFor(entry);
        if (entry.status === "queued") return formatFileSize(entry.size);
        if (entry.status === "running") return "Checking…";
        if (entry.status === "failed") return "Could not be processed";
        if (result?.status === "removed") return `Sparkle removed · ${layoutLabel(result)}`;
        return "No Gemini sparkle found · left unchanged";
    };

    const title = !finished ? "Take the sparkle off." : removed.length
        ? `${removed.length} ${removed.length === 1 ? "image" : "images"} cleaned.`
        : proc.failedCount && !unchanged.length ? "Let’s try that again." : "No sparkle to remove.";

    const settings = !finished ? <>
        <MediaField label="What it removes" detail="Only the visible Gemini sparkle in the bottom-right corner, and only where it is found. SynthID, Google’s invisible watermark, stays in the image, and the file’s metadata is kept as it was." />
        <MediaField label="Quality" detail="PNG and lossless WebP stay lossless: only the sparkle’s pixels change. JPEG and lossy WebP are saved again at quality 95, which recompresses the whole picture slightly." />
        <MediaField label="Use it fairly" detail="Don’t use a cleaned image to pass an AI picture off as a real photo, for example as evidence in a complaint, a refund claim or a news story. Follow each platform’s rules for labelling AI images." />
        <div className="ms-run">
            <button className="ms-primary" disabled={!proc.entries.length || busy} onClick={() => void run(false)}><ArrowRight size={16} />{busy ? "Checking…" : "Remove sparkle"}</button>
            <p className="ms-caption">Runs in this browser. Your images are not uploaded.</p>
            <a className="ms-caption" href="/third-party/gemini-watermark-masks.txt" target="_blank" rel="noreferrer">Logo mask credits &amp; licences</a>
        </div>
    </> : <>
        <div className="ms-result-summary">
            <span className="ms-result-seal">{removed.length ? <Check size={27} /> : <CircleSlash size={27} />}</span>
            <h3>{removed.length ? "Sparkle removed." : "Nothing was changed."}</h3>
            <p>{removed.length} cleaned{unchanged.length ? ` · ${unchanged.length} with no sparkle, left unchanged` : ""}{proc.failedCount ? ` · ${proc.failedCount} could not be processed` : ""}</p>
        </div>
        {removed.length > 0 && <button className="ms-primary" onClick={download}><ArrowDownToLine size={16} />{removed.length > 1 ? `Download ${removed.length} images as ZIP` : "Download image"}</button>}
        {unchanged.length > 0 && <p className="ms-caption">Images with no sparkle found are not in the download; your originals are already the right files.</p>}
        {proc.failedCount > 0 && <button className="ms-secondary" onClick={() => void run(true)}>Retry {proc.failedCount} failed</button>}
        <button className="ms-text" onClick={reset}>Start a new set</button>
    </>;

    return <MediaLayout
        title={title}
        detail={finished ? "Check the corner before you keep the result." : "Gemini’s visible logo, reversed pixel by pixel."}
        busy={busy}
        className="gw-workspace"
        settings={settings}
    >
        {!selected ? <MediaUpload accepts={ACCEPTS} multiple disabled={busy} title="Bring your Gemini images." detail="PNG · JPEG · WebP · One or more images" onFiles={files => proc.addFiles(files, isImage)} /> : <>
            <div className="ms-selected-file"><span>{selected.name}</span><span>{formatFileSize(selected.size)}</span></div>
            {selectedResult?.status === "removed" ? <>
                <ImageComparison before={selected.file} after={selectedResult.blob} name={selected.name} />
                <CornerZoom before={selected.file} after={selectedResult.blob} result={selectedResult} />
            </> : <MediaPreview file={selected.file} name={selected.name} kind="image"
                caption={selectedResult?.status === "not-found" ? "No Gemini sparkle found. Nothing was changed." : "Original"} />}
            <div className="ms-file-shelf" aria-label="Your images">
                {proc.entries.map((entry, index) => {
                    const result = resultFor(entry);
                    return <article key={entry.id} className={entry.id === selected.id ? "is-selected" : ""} data-outcome={result?.status ?? entry.status}>
                        <button className="ms-file-select" onClick={() => setSelectedId(entry.id)} aria-pressed={entry.id === selected.id}>
                            <span className="ms-file-number">{String(index + 1).padStart(2, "0")}</span>
                            <span><strong>{entry.name}</strong><small>{statusLine(entry)}</small></span>
                        </button>
                        {!busy && !finished && <button className="ms-icon-button" onClick={() => proc.removeFile(entry.id)} aria-label={`Remove ${entry.name}`}><X size={15} /></button>}
                        {entry.error && <p className="ms-error" role="alert">{entry.error}</p>}
                    </article>;
                })}
            </div>
            {!finished && <MediaUpload accepts={ACCEPTS} multiple compact disabled={busy} title="Add more images" onFiles={files => proc.addFiles(files, isImage)} />}
        </>}
        {busy && <MediaBusy label="Looking for the sparkle" done={proc.doneCount + proc.failedCount} total={proc.entries.length} detail="Keep this page open. Your images stay on this device." />}
    </MediaLayout>;
}
