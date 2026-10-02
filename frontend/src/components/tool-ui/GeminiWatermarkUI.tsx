/**
 * Gemini Watermark Remover: takes the visible Gemini sparkle out of images,
 * in this browser. Files are never uploaded; each one is checked for the logo
 * first and left untouched when it is not there, or when it is there but
 * removing it would leave a visible trace.
 *
 * Runs through useMultiFileProcessor with a local processor, so the queue,
 * retries and the usage event are the shared ones. An image left unchanged
 * counts as done on the page, is marked as such and is left out of the
 * download; the usage event counts it as a miss (LocalResult.unchanged).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowRight, Check, CircleSlash, X } from "lucide-react";
import { FileChooserButton } from "@/skins/experience/ToolStudio";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { retryKinds, retryLine } from "@/skins/experience/studio-outcome";
import { downloadBlob, formatFileSize } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor, type FileEntry } from "@/hooks/useMultiFileProcessor";
import { sparkleRegion } from "@/lib/gemini-watermark/geometry";
import { placeLabel } from "@/lib/gemini-watermark/labels";
import { removeGeminiSparkle, type SparkleResult } from "@/lib/gemini-watermark/process";
import { ImageComparison, MediaBusy, MediaField, MediaLayout, MediaPreview, MediaUpload } from "./media/MediaStudio";
import { useMediaUrl } from "./media/media-files";
import "./gemini-watermark.css";

const ACCEPTS = ".png,.jpg,.jpeg,.webp";
const isImage = (file: File) => /\.(png|jpe?g|webp)$/i.test(file.name);

type Results = Map<File, SparkleResult>;
const outcomeOf = (results: Results, entry: FileEntry) => entry.status === "done" ? results.get(entry.file) : undefined;

interface View {
    left: number;
    top: number;
    side: number;
}

/** A square around a box, inside the picture. */
function viewAround(width: number, height: number, x: number, y: number, w: number, h: number, minimum: number): View {
    const side = Math.min(width, height, Math.max(w * 3, h * 3, minimum));
    const left = Math.min(Math.max(0, x + w / 2 - side / 2), width - side);
    const top = Math.min(Math.max(0, y + h / 2 - side / 2), height - side);
    return { left, top, side };
}

/** The logo's corner, enlarged: at full-picture scale the sparkle is too small to judge. */
function CornerZoom({ before, after, width, height, view, caption }: { before: Blob; after?: Blob; width: number; height: number; view: View; caption: string }) {
    const beforeUrl = useMediaUrl(before);
    const afterUrl = useMediaUrl(after ?? before);
    const { left, top, side } = view;
    const style = (url: string): CSSProperties => ({
        backgroundImage: url ? `url("${url}")` : undefined,
        backgroundSize: `${(width / side) * 100}% ${(height / side) * 100}%`,
        backgroundPosition: `${(left / Math.max(1, width - side)) * 100}% ${(top / Math.max(1, height - side)) * 100}%`,
    });
    return <figure className="gw-zoom">
        <div className={after ? "gw-zoom-pair" : "gw-zoom-single"}>
            {after ? <>
                <div><span className="gw-zoom-view" style={style(beforeUrl)} role="img" aria-label="The corner before, enlarged" /><small>Before</small></div>
                <div><span className="gw-zoom-view" style={style(afterUrl)} role="img" aria-label="The corner after, enlarged" /><small>After</small></div>
            </> : <div><span className="gw-zoom-view" style={style(beforeUrl)} role="img" aria-label="The corner, enlarged" /><small>Unchanged</small></div>}
        </div>
        <figcaption>{caption}</figcaption>
    </figure>;
}

function zoomFor(result: SparkleResult): { view: View; caption: string } | null {
    const { width, height } = result;
    if (result.status === "not-found") {
        const region = sparkleRegion(width, height);
        if (!region) return null;
        return {
            view: viewAround(width, height, region.left, region.top, region.width, region.height, 0),
            caption: "The corner where Gemini puts the sparkle, enlarged. If you can see it here, the tool did not find it.",
        };
    }
    const { x, y, width: w, height: h } = result.fit;
    return {
        view: viewAround(width, height, x, y, w, h, 120),
        caption: result.status === "removed" ? "The corner where the sparkle was, enlarged." : "The sparkle the tool found, enlarged. Nothing was changed.",
    };
}

export function GeminiWatermarkUI() {
    const proc = useMultiFileProcessor();
    const results = useRef<Results>(new Map());
    const summary = useRef<HTMLHeadingElement>(null);
    // Set after "Choose a different image", so focus lands on the intake instead of the page body.
    const [returning, setReturning] = useState(false);
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [selectedId, setSelectedId] = useState("");
    const busy = phase === "processing";
    const finished = phase === "done";

    const resultFor = (entry: FileEntry) => outcomeOf(results.current, entry);
    const removed = proc.entries.filter(entry => resultFor(entry)?.status === "removed");
    const notClean = proc.entries.filter(entry => resultFor(entry)?.status === "not-clean");
    const notFound = proc.entries.filter(entry => resultFor(entry)?.status === "not-found");

    const run = useCallback(async (retry: boolean | "transient" = false) => {
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
                if (result.status === "removed") return { blob: result.blob, outName: result.outName };
                // Left as it was: no sparkle found counts as the input's, one that would not come out cleanly as the tool's.
                return { blob: file, outName: file.name, unchanged: result.status === "not-found" ? "bad_input" : "browser" };
            },
        }, retry);
        setPhase("done");
    }, [proc]);

    // The Run button disappears when a run ends; move focus to the result so keyboard and screen reader users hear it,
    // unless the visitor has moved on to a field or a dialog meanwhile.
    useEffect(() => {
        if (finished) focusIfIdle(summary.current);
    }, [finished]);

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
    const zoom = selectedResult ? zoomFor(selectedResult) : null;

    const statusLine = (entry: FileEntry) => {
        const result = resultFor(entry);
        if (entry.status === "queued") return formatFileSize(entry.size);
        if (entry.status === "running") return "Checking…";
        if (entry.status === "failed") return "Could not be processed";
        if (result?.status === "removed") return `Sparkle removed · ${placeLabel(result.fit)}`;
        if (result?.status === "not-clean") return "Sparkle found, but not removed cleanly · left unchanged";
        return "No Gemini sparkle found · left unchanged";
    };

    const caption = selectedResult?.status === "not-found"
        ? "No Gemini sparkle found at the sizes and places this tool checks. Nothing was changed."
        : selectedResult?.status === "not-clean"
            ? `A Gemini sparkle was found (${placeLabel(selectedResult.fit.layout)}), but the tool could not confirm that removing it would leave no trace, so the image was left as it was.`
            : "Original";

    // Every image failed: nothing was checked to the end. "No sparkle found" and
    // "Not removed cleanly" are honest answers, not failures, and keep their own titles.
    const allFailed = finished && proc.failedCount > 0 && !removed.length && !notClean.length && !notFound.length;
    const title = !finished ? "Take the sparkle off." : removed.length
        ? `${removed.length} ${removed.length === 1 ? "image" : "images"} cleaned.`
        : allFailed
            // Shared failure grammar: invite another attempt only when one could work.
            ? proc.retryableCount ? "Let’s try that again." : proc.entries.length > 1 ? "None of these images could be processed." : "This image couldn’t be processed."
            : notClean.length ? "Not removed cleanly." : "No sparkle found.";

    const counts = [
        `${removed.length} cleaned`,
        notClean.length ? `${notClean.length} found but not removed cleanly, left unchanged` : "",
        notFound.length ? `${notFound.length} with no sparkle found, left unchanged` : "",
        proc.failedCount ? `${proc.failedCount} could not be processed` : "",
    ].filter(Boolean).join(" · ");

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
        <div className="ms-result-summary" role="status" data-tone={allFailed ? "failure" : undefined}>
            <span className="ms-result-seal">{removed.length ? <Check size={27} /> : allFailed ? <AlertTriangle size={25} /> : <CircleSlash size={27} />}</span>
            <h3 ref={summary} tabIndex={-1}>{removed.length ? "Sparkle removed." : "Nothing was changed."}</h3>
            <p>{counts}</p>
        </div>
        {removed.length > 0 && <button className="ms-primary" onClick={download}><ArrowDownToLine size={16} />{removed.length > 1 ? `Download ${removed.length} images as ZIP` : "Download image"}</button>}
        {notClean.length + notFound.length > 0 && <p className="ms-caption">Images left unchanged are not in the download; your originals are already those files.</p>}
        {allFailed && <FileChooserButton className="ms-primary" accepts={ACCEPTS} multiple onFiles={files => { reset(); proc.addFiles(files, isImage); setReturning(true); }}>{proc.entries.length > 1 ? "Choose different images" : "Choose a different image"}</FileChooserButton>}
        {/* Images are read in this browser, so a failure is the file's or the browser's: another attempt would fail the same way. */}
        {proc.retryableCount > 0 && <button className="ms-secondary" onClick={() => void run("transient")}>{proc.retryableCount > 1 ? `Try ${proc.retryableCount} again` : "Try again"}</button>}
        {!allFailed && <button className="ms-text" onClick={reset}>Start a new set</button>}
    </>;

    return <MediaLayout
        title={title}
        detail={!finished ? "Gemini’s visible logo, reversed pixel by pixel."
            : !allFailed ? "Check the corner before you keep the result."
                : proc.retryableCount ? `Your images are still here. ${retryLine(retryKinds(proc.entries))}`
                    : proc.entries.length > 1 ? "Nothing was created. The reason is shown with each image." : "Nothing was created. The reason is shown with the image."}
        busy={busy}
        className="gw-workspace"
        settings={settings}
    >
        {!selected ? <MediaUpload accepts={ACCEPTS} multiple disabled={busy} title="Bring your Gemini images." detail="PNG · JPEG · WebP · One or more images" onFiles={files => proc.addFiles(files, isImage)} /> : <>
            <div className="ms-selected-file"><span>{selected.name}</span><span>{formatFileSize(selected.size)}</span></div>
            {selectedResult?.status === "removed"
                ? <ImageComparison before={selected.file} after={selectedResult.blob} name={selected.name} />
                : <MediaPreview file={selected.file} name={selected.name} kind="image" caption={caption}
                    unavailableNote={finished && selected.status === "failed" ? "Your browser cannot preview this file." : undefined} />}
            {selectedResult && zoom && <CornerZoom before={selected.file} after={selectedResult.status === "removed" ? selectedResult.blob : undefined}
                width={selectedResult.width} height={selectedResult.height} view={zoom.view} caption={zoom.caption} />}
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
            {!finished && <MediaUpload accepts={ACCEPTS} multiple compact disabled={busy} autoFocus={returning} title="Add more images" onFiles={files => proc.addFiles(files, isImage)} />}
        </>}
        {busy && <MediaBusy label="Looking for the sparkle" done={proc.doneCount + proc.failedCount} total={proc.entries.length} detail="Keep this page open. Your images stay on this device." />}
    </MediaLayout>;
}
